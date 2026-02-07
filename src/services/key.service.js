import { LicenseKey } from '../models/licensekey.model.js';
import { Product } from '../models/product.model.js';
import { encryptKey, decryptKey, hashKey } from '../utils/encryption.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import mongoose from 'mongoose';

// Purpose: Assigns an available license key to an order for a specific product
export const assignKeyToOrder = async (productId, orderId, existingSession = null) => {
  const useExistingSession = existingSession !== null;
  const session = existingSession || await mongoose.startSession();
  
  if (!useExistingSession) {
    session.startTransaction();
  }

  try {
    const licenseKeyDoc = await LicenseKey.findOne({
      productId: new mongoose.Types.ObjectId(productId),
    }).session(session);

    if (!licenseKeyDoc) {
      throw new ApiError(400, 'No license keys found for this product');
    }

    const availableKey = licenseKeyDoc.keys.find(key => !key.isUsed);
    
    if (!availableKey) {
      throw new ApiError(400, 'No available keys for this product');
    }

    availableKey.isUsed = true;
    availableKey.assignedToOrder = orderId;
    availableKey.assignedAt = new Date();

    await licenseKeyDoc.save({ session });

    await Product.findByIdAndUpdate(
      productId,
      {
        $inc: { 
          availableKeysCount: -1,
          stock: -1,
        },
      },
      { session }
    );

    if (!useExistingSession) {
      await session.commitTransaction();
    }
    
    if (!useExistingSession) {
      const { checkStockAfterAssignment } = await import('./stockNotification.service.js');
      await checkStockAfterAssignment(productId);
    }
    
    return {
      _id: availableKey._id,
      keyData: availableKey.keyData,
      keyType: availableKey.keyType,
      isUsed: availableKey.isUsed,
      assignedToOrder: availableKey.assignedToOrder,
      assignedAt: availableKey.assignedAt,
    };
  } catch (error) {
    if (!useExistingSession && session.inTransaction()) {
      await session.abortTransaction();
    }
    throw error;
  } finally {
    if (!useExistingSession && session && !session.hasEnded) {
      session.endSession();
    }
  }
};

// Purpose: Bulk uploads license keys for a product with duplicate detection
export const bulkUploadKeys = async (productId, keys, sellerId) => {
  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError(404, 'Product not found');
  }

  if (product.status === 'rejected') {
    throw new ApiError(403, 'Cannot upload keys for a rejected product.');
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    let licenseKeyDoc = await LicenseKey.findOne({
      productId: new mongoose.Types.ObjectId(productId),
    }).session(session);

    if (!licenseKeyDoc) {
      licenseKeyDoc = await LicenseKey.create([{
        productId: new mongoose.Types.ObjectId(productId),
        keys: [],
      }], { session });
      licenseKeyDoc = licenseKeyDoc[0];
    }

    const newKeys = [];
    const keyHashes = new Set();
    const existingHashes = new Set();
    
    for (const existingKey of licenseKeyDoc.keys) {
      try {
        const decrypted = decryptKey(existingKey.keyData);
        existingHashes.add(hashKey(decrypted));
      } catch (error) {
        logger.error('Error decrypting existing key for duplicate check', error);
      }
    }

    for (const keyData of keys) {
      if (!keyData || (typeof keyData !== 'string' && typeof keyData !== 'object')) {
        continue;
      }

      let keyString;
      let keyType = 'other';
      let metadata = null;

      if (typeof keyData === 'string') {
        keyString = keyData.trim();
        if (keyString === '') {
          continue;
        }
      } else if (typeof keyData === 'object') {
        const { key, email, password, username, emailPassword, ...rest } = keyData;
        
        if (key) {
          keyString = key.trim();
        } else if (email && password) {
          keyString = JSON.stringify({ email, password, username, emailPassword });
          keyType = 'account';
        } else {
          keyString = JSON.stringify(keyData);
          keyType = 'account';
        }

        if (Object.keys(rest).length > 0) {
          metadata = rest;
        }
      } else {
        continue;
      }

      const keyHash = hashKey(keyString);

      if (keyHashes.has(keyHash) || existingHashes.has(keyHash)) {
        continue;
      }

      keyHashes.add(keyHash);

      const encryptedKey = encryptKey(keyString);

      newKeys.push({
        keyData: encryptedKey,
        keyType: keyType,
        isUsed: false,
        encryptedAt: new Date(),
        metadata: metadata || undefined,
      });
    }

    if (newKeys.length === 0) {
      await session.abortTransaction();
      throw new ApiError(400, 'No valid keys to upload');
    }

    licenseKeyDoc.keys.push(...newKeys);
    await licenseKeyDoc.save({ session });

    await Product.findByIdAndUpdate(
      productId,
      {
        $inc: {
          totalKeysCount: newKeys.length,
          availableKeysCount: newKeys.length,
          stock: newKeys.length,
        },
      },
      { session }
    );

    await session.commitTransaction();
    return {
      success: true,
      uploaded: newKeys.length,
      total: licenseKeyDoc.keys.length,
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// Purpose: Retrieves and decrypts a license key by its ID
export const getDecryptedKey = async (keyId) => {
  const licenseKeyDoc = await LicenseKey.findOne({
    'keys._id': new mongoose.Types.ObjectId(keyId),
  });

  if (!licenseKeyDoc) {
    throw new ApiError(404, 'License key not found');
  }

  const key = licenseKeyDoc.keys.id(keyId);
  if (!key) {
    throw new ApiError(404, 'License key not found');
  }

  if (!key.keyData) {
    logger.error(`Key ${keyId} has no keyData`);
    throw new ApiError(500, 'License key data is missing');
  }

  if (typeof key.keyData === 'string' && !key.keyData.includes(':')) {
    logger.warn(`Key ${keyId} appears to be plain text, returning as-is`);
    return key.keyData;
  }

  const keyDataPreview = typeof key.keyData === 'string' 
    ? key.keyData.substring(0, 50) + (key.keyData.length > 50 ? '...' : '')
    : 'non-string';
  logger.debug(`Attempting to decrypt key ${keyId}, data preview: ${keyDataPreview}`);

  try {
    return decryptKey(key.keyData);
  } catch (error) {
    logger.error(`Failed to decrypt key ${keyId}:`, {
      message: error.message,
      keyDataLength: typeof key.keyData === 'string' ? key.keyData.length : 'N/A',
      keyDataFormat: typeof key.keyData === 'string' && key.keyData.includes(':') 
        ? `Encrypted format (${key.keyData.split(':').length} parts)`
        : 'Unknown format',
    });
    
    if (error.message.includes('encryption key may have changed')) {
      throw new ApiError(500, 'Failed to decrypt key: The encryption key has changed. This key was encrypted with a different key. Please contact support.');
    }
    
    throw new ApiError(500, `Failed to decrypt key: ${error.message}`);
  }
};

// Purpose: Synchronizes product stock count with available license keys
export const syncProductStock = async (productId) => {
  const licenseKeyDoc = await LicenseKey.findOne({
    productId: new mongoose.Types.ObjectId(productId),
  });

  if (!licenseKeyDoc) {
    await Product.findByIdAndUpdate(productId, {
      stock: 0,
      availableKeysCount: 0,
    });
    return 0;
  }

  const availableCount = licenseKeyDoc.keys.filter(key => !key.isUsed).length;

  await Product.findByIdAndUpdate(productId, {
    stock: availableCount,
    availableKeysCount: availableCount,
  });

  return availableCount;
};

// Purpose: Checks if a product has enough available keys for the requested quantity
export const checkKeyAvailability = async (productId, requestedQty = 1) => {
  const licenseKeyDoc = await LicenseKey.findOne({
    productId: new mongoose.Types.ObjectId(productId),
  });

  if (!licenseKeyDoc) {
    return {
      available: false,
      availableCount: 0,
      message: 'No license keys found for this product',
    };
  }

  const availableCount = licenseKeyDoc.keys.filter(key => !key.isUsed).length;

  if (availableCount < requestedQty) {
    return {
      available: false,
      availableCount: availableCount,
      message: availableCount === 0 
        ? 'No available keys for this product' 
        : `Only ${availableCount} key${availableCount > 1 ? 's' : ''} available, but ${requestedQty} requested`,
    };
  }

  return {
    available: true,
    availableCount: availableCount,
  };
};

// Purpose: Validates key format based on platform-specific patterns
export const validateKeyFormat = (keyData, keyType = 'other') => {
  if (!keyData || typeof keyData !== 'string') {
    return { valid: false, error: 'Key must be a non-empty string' };
  }

  const trimmed = keyData.trim();
  if (trimmed.length < 5) {
    return { valid: false, error: 'Key is too short' };
  }

  if (trimmed.length > 500) {
    return { valid: false, error: 'Key is too long' };
  }

  const formatPatterns = {
    steam: /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/i,
    epic: /^[a-f0-9]{32}$/i,
    origin: /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i,
    xbox: /^[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}$/i,
  };

  if (formatPatterns[keyType]) {
    const isValid = formatPatterns[keyType].test(trimmed);
    if (!isValid) {
      return { valid: false, error: `Invalid ${keyType} key format` };
    }
  }

  return { valid: true };
};

// Purpose: Retrieves paginated list of keys for a product with seller verification
export const getProductKeys = async (productId, sellerId, page = 1, limit = 50) => {
  const product = await Product.findById(productId);
  if (!product) {
    throw new ApiError(404, 'Product not found');
  }

  if (product.sellerId.toString() !== sellerId.toString()) {
    throw new ApiError(403, 'Access denied');
  }

  const licenseKeyDoc = await LicenseKey.findOne({ productId });

  if (!licenseKeyDoc) {
    return {
      keys: [],
      pagination: {
        page,
        limit,
        total: 0,
        pages: 0,
      },
    };
  }

  const allKeys = licenseKeyDoc.keys.map(key => ({
    _id: key._id,
    keyType: key.keyType,
    isUsed: key.isUsed,
    assignedAt: key.assignedAt,
    createdAt: key.encryptedAt || licenseKeyDoc.createdAt,
    metadata: key.metadata,
  })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const skip = (page - 1) * limit;
  const keys = allKeys.slice(skip, skip + limit);
  const total = allKeys.length;

  return {
    keys,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

