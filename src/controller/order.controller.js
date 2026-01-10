import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { logger } from "../utils/logger.js";
import { Order } from "../models/order.model.js";
import { Checkout } from "../models/checkout.model.js";
import { Cart } from "../models/cart.model.js";
import { LicenseKey } from "../models/licensekey.model.js";
import { Product } from "../models/product.model.js";
import { User } from "../models/user.model.js";
import { Payout } from "../models/payout.model.js";
import { capturePayPalPayment, getPayPalOrder } from "../services/payment.service.js";
import { assignKeyToOrder } from "../services/key.service.js";
import { sendLicenseKeyEmail, sendOrderConfirmation } from "../services/email.service.js";
import { queueEmail } from "../jobs/email.job.js";
import { logAction } from "../services/audit.service.js";
import { notifyOrderCreated } from "../services/notification.service.js";
import { schedulePayout } from "../services/payout.service.js";
import { applyCoupon } from "../services/coupon.service.js";
import { checkStockAfterAssignment } from "../services/stockNotification.service.js";

const createOrder = asyncHandler(async (req, res) => {
  const { checkoutId, paypalOrderId } = req.body;

  if (!checkoutId || !paypalOrderId) {
    throw new ApiError(400, 'Checkout ID and PayPal Order ID are required');
  }

  // FIX: Don't use .lean() because we need to save the checkout later
  const checkout = await Checkout.findById(checkoutId)
    .populate('items.productId', 'name price stock');
  
  if (!checkout) {
    throw new ApiError(404, 'Checkout session not found');
  }

  if (checkout.status !== 'pending') {
    throw new ApiError(400, 'Checkout session already processed');
  }

  let paypalOrder;
  try {
    paypalOrder = await getPayPalOrder(paypalOrderId);
    
    // FIX: Accept both 'APPROVED' and 'COMPLETED' status
    // 'APPROVED' = order ready for capture
    // 'COMPLETED' = order already captured (when called from paypalOrders.controller.js)
    if (paypalOrder.status !== 'APPROVED' && paypalOrder.status !== 'COMPLETED') {
      throw new ApiError(400, `PayPal order not in valid state. Status: ${paypalOrder.status}`);
    }
  } catch (error) {
    throw new ApiError(400, `PayPal order verification failed: ${error.message}`);
  }

  let capture;
  // FIX: Only capture if order is APPROVED (not already COMPLETED)
  if (paypalOrder.status === 'APPROVED') {
    try {
      capture = await capturePayPalPayment(paypalOrderId);
      
      if (capture.status !== 'COMPLETED') {
        throw new ApiError(400, 'Payment capture failed');
      }
    } catch (error) {
      throw new ApiError(400, `Payment capture failed: ${error.message}`);
    }
  } else {
    // Order is already COMPLETED (captured), extract capture info from order
    const captureData = paypalOrder.purchase_units?.[0]?.payments?.captures?.[0];
    if (!captureData) {
      throw new ApiError(400, 'Payment capture data not found in completed order');
    }
    
    capture = {
      id: captureData.id,
      status: captureData.status || 'COMPLETED',
      captureId: captureData.id,
      amount: captureData.amount?.value ? parseFloat(captureData.amount.value) : null,
      payerId: paypalOrder.payer?.payer_id || null,
    };
    
    logger.info('[ORDER] Using existing capture from completed order', {
      orderId: paypalOrderId,
      captureId: capture.captureId,
      status: capture.status,
    });
  }

  // IDEMPOTENCY: Check if order already exists for this paypalOrderId
  const existingOrder = await Order.findOne({ paypalOrderId });
  if (existingOrder) {
    logger.warn('[ORDER] Order already exists (idempotent request)', {
      paypalOrderId,
      checkoutId,
      existingOrderId: existingOrder._id,
    });
    return res.status(200).json(
      new ApiResponse(200, existingOrder, 'Order already exists (idempotent request)')
    );
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const orderItems = [];
    const { getCommissionRate } = await import('../services/payout.service.js');
    const commissionRate = await getCommissionRate();

    for (const checkoutItem of checkout.items) {
      const product = checkoutItem.productId;
      
      const assignedKeys = [];
      for (let i = 0; i < checkoutItem.qty; i++) {
        const key = await assignKeyToOrder(
          product._id,
          null
        );
        assignedKeys.push(key);
      }
      
      await checkStockAfterAssignment(product._id);

      const lineTotal = checkoutItem.unitPrice * checkoutItem.qty;
      const commissionAmount = lineTotal * commissionRate;
      const sellerEarning = lineTotal - commissionAmount;

      // FIX: Ensure sellerId is properly converted to ObjectId
      let sellerId = checkoutItem.sellerId;
      if (sellerId && typeof sellerId === 'object' && sellerId._id) {
        sellerId = sellerId._id;
      }
      if (!sellerId || !mongoose.Types.ObjectId.isValid(sellerId)) {
        logger.error(`Invalid sellerId in checkout item: ${checkoutItem.sellerId}`, {
          productId: product._id,
          productName: product.name,
        });
        throw new ApiError(400, `Invalid seller ID for product: ${product?.name || 'Unknown'}`);
      }

      orderItems.push({
        productId: product._id,
        sellerId: new mongoose.Types.ObjectId(sellerId), // FIX: Ensure sellerId is ObjectId
        qty: checkoutItem.qty,
        unitPrice: checkoutItem.unitPrice,
        lineTotal: lineTotal,
        assignedKeyIds: assignedKeys.map(key => key._id),
        sellerEarning: sellerEarning,
        commissionAmount: commissionAmount,
        keyDeliveryStatus: 'pending',
      });
    }

    // FIX: Double-check inside transaction (race condition protection)
    const duplicateCheck = await Order.findOne({ paypalOrderId }).session(session);
    if (duplicateCheck) {
      await session.abortTransaction();
      session.endSession();
      logger.warn('[ORDER] Duplicate order detected during transaction', {
        paypalOrderId,
        existingOrderId: duplicateCheck._id,
      });
      return res.status(200).json(
        new ApiResponse(200, duplicateCheck, 'Order already exists (idempotent request)')
      );
    }

    // Generate unique order number
    const generateOrderNumber = () => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let orderNumber = '';
      for (let i = 0; i < 8; i++) {
        orderNumber += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return orderNumber;
    };

    // Ensure unique order number (retry if duplicate)
    let orderNumber;
    let attempts = 0;
    const maxAttempts = 10;
    do {
      orderNumber = generateOrderNumber();
      const existing = await Order.findOne({ orderNumber }).session(session);
      if (!existing) break;
      attempts++;
      if (attempts >= maxAttempts) {
        // Fallback: use timestamp + random
        orderNumber = `ORD${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        break;
      }
    } while (attempts < maxAttempts);

    // FIX: Create new order (idempotency already checked above)
    const createdOrderArray = await Order.create([{
      checkoutId: checkout._id,
      userId: checkout.userId,
      orderNumber: orderNumber,
      items: orderItems,
      currency: 'USD', // SECURITY: Hard-enforce USD currency
      subtotal: checkout.subtotal,
      discount: checkout.discount,
      totalAmount: checkout.totalAmount,
      couponId: checkout.couponId,
      paymentMethod: 'PayPal',
      paymentStatus: 'paid',
      paypalOrderId: paypalOrderId, // Unique index prevents duplicates
      paypalCaptureId: capture.captureId,
      paypalPayerId: capture.payerId || paypalOrder.payer?.payer_id || null,
      orderStatus: 'completed',
      payoutScheduledAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
    }], { session });
    
    const createdOrder = createdOrderArray[0];

    // Process keys for newly created order
    const allKeyIds = orderItems
      .filter(item => item.assignedKeyIds && item.assignedKeyIds.length > 0)
      .flatMap(item => item.assignedKeyIds);

    if (allKeyIds.length > 0) {
      const productIds = [...new Set(orderItems.map(item => item.productId.toString()))];
      
      for (const productId of productIds) {
        const itemKeyIds = orderItems
          .filter(item => item.productId.toString() === productId)
          .flatMap(item => item.assignedKeyIds || []);
        
        if (itemKeyIds.length > 0) {
          await LicenseKey.updateOne(
            { productId: new mongoose.Types.ObjectId(productId) },
            {
              $set: {
                'keys.$[key].assignedToOrder': createdOrder._id,
              },
            },
            {
              arrayFilters: [{ 'key._id': { $in: itemKeyIds } }],
              session,
            }
          );
        }
      }
    }

    const sellerPayouts = new Map();
    for (const item of orderItems) {
      const sellerId = item.sellerId.toString();
      if (!sellerPayouts.has(sellerId)) {
        sellerPayouts.set(sellerId, {
          sellerId: item.sellerId,
          amount: 0,
          commission: 0,
        });
      }
      const payout = sellerPayouts.get(sellerId);
      payout.amount += item.sellerEarning;
      payout.commission += item.commissionAmount;
    }

    // Create payout records
    // Note: amount should be the total lineTotal (gross), commission will be calculated in schedulePayout
    for (const [sellerId, payoutData] of sellerPayouts) {
      // Calculate gross amount: sellerEarning + commission
      const grossAmount = payoutData.amount + payoutData.commission;
      await schedulePayout({
        orderId: createdOrder._id,
        sellerId: payoutData.sellerId,
        amount: grossAmount, // Pass gross amount, commission will be recalculated
        orderCompletedAt: createdOrder.createdAt, // Use order creation as completion date
      }, session);
    }

    // Update checkout status
    checkout.status = 'paid';
    await checkout.save({ session });

    // Apply coupon usage tracking
    if (checkout.couponId) {
      await applyCoupon(checkout.couponId, createdOrder._id, checkout.userId);
    }

    // Clear cart
    await Cart.findOneAndUpdate(
      { userId: checkout.userId },
      { $set: { items: [] } },  
      { session }
    );

    await session.commitTransaction();

    // Queue emails and notifications (outside transaction)
    const user = await User.findById(checkout.userId);
    if (user) {
      try {
        // Queue emails for background processing
        const { queueEmail } = await import("../jobs/email.job.js");
        await queueEmail('order_confirmation', { orderId: createdOrder._id, userId: user._id });
        await queueEmail('license_key', { orderId: createdOrder._id, userId: user._id });
        
        // Create notification
        const { notifyOrderCreated } = await import("../services/notification.service.js");
        await notifyOrderCreated(user._id, createdOrder);
      } catch (emailError) {
        logger.error('Failed to queue emails', emailError);
        // Don't fail the order if email fails
      }
    }

    // Audit log
    await logAction(
      'order_created',
      checkout.userId,
      'Order',
      createdOrder._id,
      { totalAmount: createdOrder.totalAmount, itemsCount: createdOrder.items.length },
      req.ip || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || null,
      req.headers?.['user-agent'] || null
    );

    // Populate order for response
    const populatedOrder = await Order.findById(createdOrder._id)
      .populate('items.productId', 'name images')
      .populate('items.sellerId', 'shopName')
      .populate('userId', 'name email')
      .lean();

    return res.status(201).json(
      new ApiResponse(201, populatedOrder, 'Order created successfully')
    );
  } catch (error) {
    // FIX: Only abort transaction if it hasn't been committed yet
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    session.endSession();
  }
});

const getOrders = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  // FIX: Check roles array, not single role field
  const userRoles = Array.isArray(req.user.roles) ? req.user.roles : (req.user.role ? [req.user.role] : []);
  const isAdmin = userRoles.some(role => role.toLowerCase() === 'admin');
  const { page = 1, limit = 10, status, paymentStatus } = req.query;

  // FIX: Admin can see all orders, customers see only their own
  const match = {};
  if (!isAdmin) {
    match.userId = new mongoose.Types.ObjectId(userId);
  }
  
  if (status) {
    match.orderStatus = status;
  }
  
  if (paymentStatus) {
    match.paymentStatus = paymentStatus;
  }

  // Use regular find with populate for better performance
  const skip = (parseInt(page) - 1) * parseInt(limit);
  const limitNum = parseInt(limit);

  const orders = await Order.find(match)
    .populate('userId', 'name email')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum)
    .lean();

  const total = await Order.countDocuments(match);

  return res.status(200).json(
    new ApiResponse(200, {
      orders: orders,
      pagination: {
        page: parseInt(page),
        limit: limitNum,
        total: total,
        pages: Math.ceil(total / limitNum),
      },
    }, 'Orders retrieved successfully')
  );
});

const getOrderById = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new ApiError(400, 'Invalid order ID');
  }

  const order = await Order.findOne({
    _id: orderId,
    userId,
  })
    .populate('items.productId', 'name images description')
    .populate('items.sellerId', 'shopName shopLogo')
    .populate('items.assignedKeyIds', 'keyType')
    .populate('userId', 'name email');

  if (!order) {
    throw new ApiError(404, 'Order not found');
  }

  return res.status(200).json(
    new ApiResponse(200, order, 'Order retrieved successfully')
  );
});

const getOrderKeys = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new ApiError(400, 'Invalid order ID');
  }

  const order = await Order.findOne({
    _id: orderId,
    userId,
  });

  if (!order) {
    throw new ApiError(404, 'Order not found');
  }

  const keyIds = order.items
    .filter(item => item.assignedKeyIds && item.assignedKeyIds.length > 0)
    .flatMap(item => item.assignedKeyIds);

  const productIds = [...new Set(order.items.map(item => item.productId.toString()))];
  const licenseKeyDocs = await LicenseKey.find({
    productId: { $in: productIds.map(id => new mongoose.Types.ObjectId(id)) },
  });

  const keys = [];
  for (const doc of licenseKeyDocs) {
    for (const key of doc.keys) {
      if (keyIds.some(id => id.toString() === key._id.toString())) {
        keys.push({
          keyId: key._id,
          keyType: key.keyType,
          assignedAt: key.assignedAt,
          emailSent: key.emailSent,
        });
      }
    }
  }

  return res.status(200).json(
    new ApiResponse(200, {
      orderId: order._id,
      keys: keys,
    }, 'Order keys retrieved successfully')
  );
});

const cancelOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user._id;
  const { reason } = req.body;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new ApiError(400, 'Invalid order ID');
  }

  const order = await Order.findOne({
    _id: orderId,
    userId,
  });

  if (!order) {
    throw new ApiError(404, 'Order not found');
  }

  if (order.orderStatus === 'cancelled') {
    throw new ApiError(400, 'Order already cancelled');
  }

  if (order.paymentStatus !== 'paid') {
    throw new ApiError(400, 'Only paid orders can be cancelled');
  }

  // Check if refund already exists
  const { ReturnRefund } = await import('../models/returnrefund.model.js');
  const existingRefund = await ReturnRefund.findOne({
    orderId: order._id,
    userId: userId,
    status: { $in: ['pending', 'approved', 'refunded'] },
  });

  if (existingRefund) {
    throw new ApiError(400, 'A refund request already exists for this order');
  }

  // Create refund request for all items (full order cancellation)
  // For partial cancellation, use the refund request endpoint directly
  const refundRequests = [];
  for (const item of order.items) {
    if (!item.refunded) {
      const refund = await ReturnRefund.create({
        orderId: order._id,
        productId: item.productId,
        userId: userId,
        reason: reason || 'Order cancellation requested by buyer',
        status: 'pending',
      });
      refundRequests.push(refund._id);
    }
  }

  if (refundRequests.length === 0) {
    throw new ApiError(400, 'All items in this order have already been refunded');
  }

  return res.status(200).json(
    new ApiResponse(200, {
      orderId: order._id,
      refundRequests: refundRequests,
      message: 'Refund requests created. Admin will process the refunds.',
    }, 'Order cancellation requested. Refund requests created.')
  );
});

// Reorder
const reorder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new ApiError(400, "Invalid order ID");
  }

  const originalOrder = await Order.findOne({
    _id: orderId,
    userId,
  }).populate("items.productId");

  if (!originalOrder) {
    throw new ApiError(404, "Order not found");
  }

  let cart = await Cart.findOne({ userId });

  if (!cart) {
    cart = await Cart.create({ userId, items: [] });
  }

  for (const item of originalOrder.items) {
    const product = item.productId;

    if (!product) {
      continue;
    }

    const licenseKeyDoc = await LicenseKey.findOne({
      productId: product._id,
    });

    const availableKeys = licenseKeyDoc 
      ? licenseKeyDoc.keys.filter(key => !key.isUsed).length 
      : 0;

    if (availableKeys < item.qty) {
      throw new ApiError(400, `Insufficient stock for ${product.name}. Available: ${availableKeys}, Requested: ${item.qty}`);
    }

    const existingItem = cart.items.find(
      (cartItem) => cartItem.productId.toString() === product._id.toString()
    );

    if (existingItem) {
      existingItem.qty += item.qty;
    } else {
      cart.items.push({
        productId: product._id,
        sellerId: item.sellerId,
        qty: item.qty,
        unitPrice: product.price,
      });
    }
  }

  await cart.save();

  return res.status(200).json(
    new ApiResponse(200, cart, "Items added to cart for reorder")
  );
});

const getSellerOrders = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 10, status } = req.query;

  // Get seller record
  const { Seller } = await import("../models/seller.model.js");
  const seller = await Seller.findOne({ userId });
  
  if (!seller) {
    throw new ApiError(404, "Seller account not found");
  }

  // FIX: Match orders where items contain this seller's products
  // Convert seller._id to ObjectId for comparison
  const sellerObjectId = new mongoose.Types.ObjectId(seller._id);
  
  logger.debug('[SELLER ORDERS] Query params', {
    sellerId: seller._id,
    sellerObjectId: sellerObjectId.toString(),
    status,
    page,
    limit,
  });
  
  // FIX: Match orders where items contain this seller's products
  // Use $elemMatch for array matching
  const match = {
    paymentStatus: "paid",
    items: {
      $elemMatch: {
        sellerId: sellerObjectId,
      },
    },
  };
  
  if (status) {
    match.orderStatus = status;
  }
  
  logger.debug('[SELLER ORDERS] Match query', JSON.stringify(match, null, 2));

  // FIX: Test query to check if any orders exist for this seller (for debugging)
  const testOrder = await Order.findOne({
    'items.sellerId': sellerObjectId,
  }).limit(1);
  
  logger.debug('[SELLER ORDERS] Test order found', {
    found: !!testOrder,
    orderId: testOrder?._id,
    paymentStatus: testOrder?.paymentStatus,
    itemsCount: testOrder?.items?.length,
    firstItemSellerId: testOrder?.items?.[0]?.sellerId?.toString(),
  });

  const orders = await Order.aggregate([
    { $match: match },
    { $sort: { createdAt: -1 } },
    {
      $lookup: {
        from: 'products',
        localField: 'items.productId',
        foreignField: '_id',
        as: 'products',
      },
    },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'buyer',
      },
    },
    {
      $unwind: {
        path: '$buyer',
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $addFields: {
        // Filter items to only show this seller's items
        items: {
          $filter: {
            input: '$items',
            as: 'item',
            cond: {
              $eq: [
                '$$item.sellerId',
                sellerObjectId
              ]
            }
          }
        }
      }
    },
    {
      $project: {
        _id: 1,
        items: 1,
        totalAmount: 1,
        orderStatus: 1,
        paymentStatus: 1,
        createdAt: 1,
        updatedAt: 1,
        buyer: {
          name: '$buyer.name',
          email: '$buyer.email',
        },
        products: {
          $map: {
            input: '$products',
            as: 'product',
            in: {
              _id: '$$product._id',
              name: '$$product.name',
              images: '$$product.images',
            }
          }
        },
      },
    },
    // Filter out orders with no items after filtering
    {
      $match: {
        'items.0': { $exists: true }
      }
    },
  ]);

  logger.debug('[SELLER ORDERS] Found orders', { count: orders.length });

  const total = orders.length;
  const startIndex = (parseInt(page) - 1) * parseInt(limit);
  const endIndex = parseInt(page) * parseInt(limit);
  const paginatedOrders = orders.slice(startIndex, endIndex);

  return res.status(200).json(
    new ApiResponse(200, {
      orders: paginatedOrders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: orders.length,
        pages: Math.ceil(orders.length / limit),
      },
    }, 'Seller orders retrieved successfully')
  );
});

export {
  createOrder,
  getOrders,
  getOrderById,
  getOrderKeys,
  cancelOrder,
  reorder,
  getSellerOrders,
};

