import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { LicenseKey } from "../models/licensekey.model.js";
import { Order } from "../models/order.model.js";
import { Product } from "../models/product.model.js";
import { getDecryptedKey } from "../services/key.service.js";
import { logger } from "../utils/logger.js";

const getMyLicenseKeys = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 20 } = req.query;

  const orders = await Order.find({
    userId: new mongoose.Types.ObjectId(userId),
    paymentStatus: 'paid',
    orderStatus: 'completed',
  })
    .select('_id items createdAt')
    .populate('items.productId', 'name images')
    .sort({ createdAt: -1 });

  const keyIds = [];
  const keyOrderMap = new Map();

  orders.forEach(order => {
    order.items.forEach(item => {
      if (item.assignedKeyIds && item.assignedKeyIds.length > 0) {
        item.assignedKeyIds.forEach(keyId => {
          keyIds.push(keyId);
          keyOrderMap.set(keyId.toString(), {
            orderId: order._id,
            orderDate: order.createdAt,
            productId: item.productId._id,
            productName: item.productId.name,
            productImage: item.productId.images?.[0],
          });
        });
      }
    });
  });

  if (keyIds.length === 0) {
    return res.status(200).json(
      new ApiResponse(200, {
        keys: [],
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: 0,
          pages: 0,
        },
      }, "No license keys found")
    );
  }

  const licenseKeyDocs = await LicenseKey.find({
    'keys._id': { $in: keyIds },
  });

  const allKeys = [];
  licenseKeyDocs.forEach(doc => {
    doc.keys.forEach(key => {
      if (keyIds.some(id => id.toString() === key._id.toString())) {
        allKeys.push({
          _id: key._id,
          keyType: key.keyType,
          isUsed: key.isUsed,
          assignedAt: key.assignedAt,
          emailSent: key.emailSent,
        });
      }
    });
  });

  allKeys.sort((a, b) => (b.assignedAt || 0) - (a.assignedAt || 0));

  const formattedKeys = allKeys
    .slice((page - 1) * limit, page * limit)
    .map(key => {
      const orderInfo = keyOrderMap.get(key._id.toString());
      return {
        keyId: key._id,
        keyType: key.keyType,
        productName: orderInfo?.productName || 'Unknown Product',
        productImage: orderInfo?.productImage,
        orderId: orderInfo?.orderId,
        orderDate: orderInfo?.orderDate,
        purchaseDate: key.assignedAt,
        emailSent: key.emailSent,
        isRevealed: false,
      };
    });

  const total = keyIds.length;

  return res.status(200).json(
    new ApiResponse(200, {
      keys: formattedKeys,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    }, "License keys retrieved successfully")
  );
});

const revealLicenseKey = asyncHandler(async (req, res) => {
  const { keyId } = req.params;
  const userId = req.user._id;

  if (!mongoose.Types.ObjectId.isValid(keyId)) {
    throw new ApiError(400, "Invalid key ID");
  }

  const licenseKeyDoc = await LicenseKey.findOne({
    'keys._id': new mongoose.Types.ObjectId(keyId),
  });

  if (!licenseKeyDoc) {
    throw new ApiError(404, "License key not found");
  }

  const key = licenseKeyDoc.keys.id(keyId);
  if (!key) {
    throw new ApiError(404, "License key not found");
  }

  const order = await Order.findOne({
    userId: new mongoose.Types.ObjectId(userId),
    paymentStatus: 'paid',
    'items.assignedKeyIds': new mongoose.Types.ObjectId(keyId),
  });

  if (!order) {
    throw new ApiError(403, "You do not have access to this license key");
  }

  const orderItem = order.items.find(item => 
    item.assignedKeyIds && item.assignedKeyIds.some(id => id.toString() === keyId)
  );
  
  if (!orderItem) {
    throw new ApiError(404, "Order item not found for this key");
  }
  
  const product = await Product.findById(orderItem.productId).select('name images');

  // FIX: Better error handling for decryption
  let decryptedKey;
  try {
    decryptedKey = await getDecryptedKey(keyId);
  } catch (error) {
    logger.error(`Failed to get decrypted key for ${keyId}:`, error);
    // Re-throw with more context if it's already an ApiError
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, error.message || 'Failed to decrypt key');
  }

  let keyData;
  try {
    // Try to parse as JSON (for account-based products)
    keyData = JSON.parse(decryptedKey);
  } catch {
    // If not JSON, use as plain text (for license keys)
    keyData = decryptedKey;
  }

  return res.status(200).json(
    new ApiResponse(200, {
      keyId: key._id,
      keyType: key.keyType,
      productName: product?.name,
      productImage: product?.images?.[0],
      orderId: order._id,
      purchaseDate: key.assignedAt,
      keyData: keyData,
      revealedAt: new Date(),
    }, "License key revealed successfully")
  );
});

export {
  getMyLicenseKeys,
  revealLicenseKey,
};

