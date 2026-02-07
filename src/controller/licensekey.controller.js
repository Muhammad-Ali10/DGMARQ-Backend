import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { LicenseKey } from "../models/licensekey.model.js";
import { Order } from "../models/order.model.js";
import { Product } from "../models/product.model.js";
import { Seller } from "../models/seller.model.js";
import { getDecryptedKey } from "../services/key.service.js";
import { logAction } from "../services/audit.service.js";
import { logger } from "../utils/logger.js";

// Purpose: Retrieves all license keys owned by the authenticated user with pagination
const getMyLicenseKeys = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 10 } = req.query;

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

// Purpose: Decrypts and reveals a license key to its owner after verifying ownership
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

  let decryptedKey;
  try {
    decryptedKey = await getDecryptedKey(keyId);
  } catch (error) {
    logger.error(`Failed to get decrypted key for ${keyId}:`, error);
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, error.message || 'Failed to decrypt key');
  }

  let keyData;
  try {
    keyData = JSON.parse(decryptedKey);
  } catch {
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

// Purpose: Retrieves license keys for a seller's product with pagination
const getSellerLicenseKeys = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { productId } = req.params;
  const { page = 1, limit = 10 } = req.query;

  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw new ApiError(400, "Invalid product ID");
  }

  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit) || 10));
  const skip = (pageNum - 1) * limitNum;

  const seller = await Seller.findOne({ userId }).lean();
  if (!seller) {
    throw new ApiError(404, "Seller account not found");
  }

  const product = await Product.findById(productId).lean();
  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  if (product.sellerId.toString() !== seller._id.toString()) {
    throw new ApiError(403, "You do not have access to this product's license keys");
  }

  const [licenseKeyDoc] = await LicenseKey.aggregate([
    { $match: { productId: new mongoose.Types.ObjectId(productId) } },
    {
      $project: {
        keys: 1,
        totalKeys: { $size: '$keys' },
        createdAt: 1,
      },
    },
  ]);

  if (!licenseKeyDoc || !licenseKeyDoc.keys || licenseKeyDoc.keys.length === 0) {
    return res.status(200).json(
      new ApiResponse(200, {
        keys: [],
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: 0,
          pages: 0,
        },
      }, "No license keys found for this product")
    );
  }

  const total = licenseKeyDoc.totalKeys || licenseKeyDoc.keys.length;

  const allKeys = licenseKeyDoc.keys.map(key => {
    let status = 'Active';
    if (key.isRefunded) {
      status = 'Refunded';
    } else if (key.isUsed) {
      status = 'Used';
    }

    const maskedKey = 'XXXX-XXXX-XXXX';

    const createdAt = key.encryptedAt || licenseKeyDoc.createdAt || new Date();

    return {
      _id: key._id,
      keyType: key.keyType || 'other',
      status,
      isUsed: key.isUsed || false,
      isRefunded: key.isRefunded || false,
      maskedKey,
      assignedAt: key.assignedAt || null,
      refundedAt: key.refundedAt || null,
      createdAt: createdAt,
      assignedToOrder: key.assignedToOrder || null,
    };
  });

  allKeys.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const paginatedKeys = allKeys.slice(skip, skip + limitNum);

  await logAction(
    'license_key:view',
    userId,
    'LicenseKey',
    productId,
    { productId, productName: product.name, totalKeys: total, page: pageNum, limit: limitNum },
    req.ip,
    req.get('user-agent')
  );

  return res.status(200).json(
    new ApiResponse(200, {
      keys: paginatedKeys,
      product: {
        _id: product._id,
        name: product.name,
      },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    }, "License keys retrieved successfully")
  );
});

// Purpose: Deletes an unused license key from a seller's product
const deleteSellerLicenseKey = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { keyId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(keyId)) {
    throw new ApiError(400, "Invalid key ID");
  }

  const seller = await Seller.findOne({ userId }).lean();
  if (!seller) {
    throw new ApiError(404, "Seller account not found");
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

  const product = await Product.findById(licenseKeyDoc.productId).lean();
  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  if (product.sellerId.toString() !== seller._id.toString()) {
    throw new ApiError(403, "You do not have access to this license key");
  }

  if (key.isUsed) {
    throw new ApiError(400, "Cannot delete a used license key");
  }

  if (key.isRefunded) {
    throw new ApiError(400, "Cannot delete a refunded license key");
  }

  if (key.assignedToOrder) {
    throw new ApiError(400, "Cannot delete a license key that has been assigned to an order");
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    licenseKeyDoc.keys.pull(keyId);
    await licenseKeyDoc.save({ session });

    await Product.findByIdAndUpdate(
      licenseKeyDoc.productId,
      {
        $inc: {
          totalKeysCount: -1,
          availableKeysCount: -1,
          stock: -1,
        },
      },
      { session }
    );

    await session.commitTransaction();

    await logAction(
      'license_key:delete',
      userId,
      'LicenseKey',
      keyId,
      {
        productId: licenseKeyDoc.productId,
        productName: product.name,
        keyType: key.keyType,
      },
      req.ip,
      req.get('user-agent')
    );

    return res.status(200).json(
      new ApiResponse(200, {
        deletedKeyId: keyId,
        productId: licenseKeyDoc.productId,
      }, "License key deleted successfully")
    );
  } catch (error) {
    await session.abortTransaction();
    logger.error('Error deleting license key:', error);
    throw new ApiError(500, "Failed to delete license key");
  } finally {
    session.endSession();
  }
});

// Purpose: Decrypts and reveals a license key for the seller who owns the product
const revealSellerLicenseKey = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { keyId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(keyId)) {
    throw new ApiError(400, "Invalid key ID");
  }

  const seller = await Seller.findOne({ userId }).lean();
  if (!seller) {
    throw new ApiError(404, "Seller account not found");
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

  const product = await Product.findById(licenseKeyDoc.productId).lean();
  if (!product) {
    throw new ApiError(404, "Product not found");
  }

  if (product.sellerId.toString() !== seller._id.toString()) {
    throw new ApiError(403, "You do not have access to this license key");
  }

  let decryptedKey;
  try {
    decryptedKey = await getDecryptedKey(keyId);
  } catch (error) {
    logger.error(`Failed to get decrypted key for ${keyId}:`, error);
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, error.message || 'Failed to decrypt key');
  }

  let keyData;
  try {
    keyData = JSON.parse(decryptedKey);
  } catch {
    keyData = decryptedKey;
  }

  await logAction(
    'license_key:reveal',
    userId,
    'LicenseKey',
    keyId,
    { productId: licenseKeyDoc.productId, productName: product.name },
    req.ip,
    req.get('user-agent')
  );

  return res.status(200).json(
    new ApiResponse(200, {
      keyId: key._id,
      keyType: key.keyType,
      productName: product.name,
      keyData: keyData,
      status: key.isRefunded ? 'Refunded' : key.isUsed ? 'Used' : 'Active',
      revealedAt: new Date(),
    }, "License key revealed successfully")
  );
});

export {
  getMyLicenseKeys,
  revealLicenseKey,
  getSellerLicenseKeys,
  deleteSellerLicenseKey,
  revealSellerLicenseKey,
};

