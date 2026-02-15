import { AuditLog } from '../models/auditLog.model.js';
import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';

// For refund/payout: metadata should include actor, previousStatus, newStatus, timestamp, notes when applicable.
export const logAction = async (action, userId, entityType, entityId, metadata = null, ipAddress = null, userAgent = null, status = 'success', error = null) => {
  try {
    const auditLog = await AuditLog.create({
      action,
      userId: userId ? new mongoose.Types.ObjectId(userId) : null,
      entityType,
      entityId: entityId ? new mongoose.Types.ObjectId(entityId) : null,
      metadata,
      ipAddress,
      userAgent,
      status,
      error,
    });
    return auditLog;
  } catch (err) {
    logger.error('Failed to create audit log', err);
    return null;
  }
};

export const getAuditTrail = async (entityType, entityId, page = 1, limit = 50) => {
  const skip = (page - 1) * limit;

  const logs = await AuditLog.find({
    entityType,
    entityId: new mongoose.Types.ObjectId(entityId),
  })
    .populate('userId', 'name email')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await AuditLog.countDocuments({
    entityType,
    entityId: new mongoose.Types.ObjectId(entityId),
  });

  return {
    logs,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

export const getUserAuditTrail = async (userId, page = 1, limit = 50) => {
  const skip = (page - 1) * limit;

  const logs = await AuditLog.find({
    userId: new mongoose.Types.ObjectId(userId),
  })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await AuditLog.countDocuments({
    userId: new mongoose.Types.ObjectId(userId),
  });

  return {
    logs,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
};

export const logSecurityEvent = async (event, userId, ipAddress, userAgent, metadata = null) => {
  return await logAction(
    `security:${event}`,
    userId,
    'Security',
    null,
    metadata,
    ipAddress,
    userAgent,
    'success'
  );
};

export const auditLog = async (userId, action, message, metadata = null) => {
  return await logAction(
    action,
    userId,
    'Admin',
    null,
    { ...metadata, message },
    null,
    null,
    'success'
  );
};

