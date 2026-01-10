import crypto from 'crypto';

const algorithm = 'aes-256-gcm';
const secretKey = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

// Ensure secret key is 32 bytes
const getKey = () => {
  if (secretKey.length === 64) {
    return Buffer.from(secretKey, 'hex');
  }
  return crypto.scryptSync(secretKey, 'salt', 32);
};

/**
 * Encrypt license key data
 * @param {string} text - Plain text key data
 * @returns {string} - Encrypted string (iv:encrypted:authTag)
 */
export const encryptKey = (text) => {
  if (!text) {
    throw new Error('Key data is required for encryption');
  }

  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);

  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();

  // Return format: iv:encrypted:authTag
  return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`;
};

/**
 * Decrypt license key data
 * @param {string} encryptedData - Encrypted string (iv:encrypted:authTag)
 * @returns {string} - Decrypted plain text
 */
export const decryptKey = (encryptedData) => {
  if (!encryptedData) {
    throw new Error('Encrypted data is required');
  }

  // FIX: Handle if data is already a string but not in encrypted format
  if (typeof encryptedData !== 'string') {
    throw new Error('Encrypted data must be a string');
  }

  try {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error(`Invalid encrypted data format. Expected format: iv:encrypted:authTag, got ${parts.length} parts`);
    }

    const [ivHex, encryptedHex, authTagHex] = parts;
    
    // FIX: Validate hex strings
    if (!/^[0-9a-f]+$/i.test(ivHex) || !/^[0-9a-f]+$/i.test(encryptedHex) || !/^[0-9a-f]+$/i.test(authTagHex)) {
      throw new Error('Invalid hex format in encrypted data');
    }
    
    const key = getKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    // FIX: Provide more detailed error message
    if (error.message.includes('Invalid encrypted data format')) {
      throw error;
    }
    
    // FIX: Detect GCM authentication errors (encryption key mismatch)
    if (error.message.includes('Unsupported state') || 
        error.message.includes('unable to authenticate') ||
        error.message.includes('bad decrypt')) {
      throw new Error(`Decryption failed: The encryption key may have changed or the data was encrypted with a different key. Please verify ENCRYPTION_KEY in your environment variables matches the key used to encrypt this data. Original error: ${error.message}`);
    }
    
    throw new Error(`Decryption failed: ${error.message}`);
  }
};

/**
 * Hash key for duplicate detection
 * @param {string} keyData - Plain text key
 * @returns {string} - SHA256 hash
 */
export const hashKey = (keyData) => {
  return crypto.createHash('sha256').update(keyData).digest('hex');
};

