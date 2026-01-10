import nodemailer from 'nodemailer';
import mongoose from 'mongoose';
import { licenseKeyEmailTemplate, orderConfirmationEmailTemplate, payoutNotificationEmailTemplate } from '../utils/emailTemplates.js';
import { EmailLog } from '../models/emailLog.model.js';
import { decryptKey } from '../utils/encryption.js';
import { LicenseKey } from '../models/licensekey.model.js';
import { logger } from '../utils/logger.js';

const createTransporter = () => {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  return nodemailer.createTransporter({
    host: 'smtp.ethereal.email',
    port: 587,
    auth: {
      user: process.env.ETHEREAL_USER || 'test@ethereal.email',
      pass: process.env.ETHEREAL_PASS || 'test',
    },
  });
};

export const sendLicenseKeyEmail = async (order, user) => {
  try {
    const transporter = createTransporter();
    
    // FIX: Validate order and user
    if (!order || !user) {
      throw new Error('Order and user are required');
    }

    // FIX: Validate order._id is a valid ObjectId
    if (!order._id || !mongoose.Types.ObjectId.isValid(order._id)) {
      throw new Error(`Invalid order ID: ${order._id}`);
    }

    const keyIds = order.items
      .filter(item => item.assignedKeyIds && item.assignedKeyIds.length > 0)
      .flatMap(item => item.assignedKeyIds);

    // FIX: Safely extract productIds and validate ObjectIds
    const productIds = [];
    for (const item of order.items) {
      if (!item.productId) {
        logger.warn(`Order item missing productId in order ${order._id}`);
        continue;
      }
      
      // Handle populated productId (object) or direct ObjectId/string
      let productIdValue;
      if (typeof item.productId === 'object' && item.productId._id) {
        productIdValue = item.productId._id;
      } else {
        productIdValue = item.productId;
      }
      
      // Convert to string and validate
      const productIdStr = productIdValue.toString();
      if (mongoose.Types.ObjectId.isValid(productIdStr)) {
        productIds.push(productIdStr);
      } else {
        logger.warn(`Invalid productId in order ${order._id}: ${productIdStr}`);
      }
    }

    // FIX: Remove duplicates and validate all ObjectIds before querying
    const uniqueProductIds = [...new Set(productIds)];
    if (uniqueProductIds.length === 0) {
      logger.warn(`No valid productIds found in order ${order._id}`);
      throw new Error('No valid product IDs found in order');
    }

    // FIX: Validate all ObjectIds before creating them
    const validObjectIds = uniqueProductIds
      .filter(id => mongoose.Types.ObjectId.isValid(id))
      .map(id => {
        try {
          return new mongoose.Types.ObjectId(id);
        } catch (error) {
          logger.error(`Failed to create ObjectId from: ${id}`, error);
          return null;
        }
      })
      .filter(id => id !== null);

    if (validObjectIds.length === 0) {
      throw new Error('No valid product ObjectIds found');
    }

    const licenseKeyDocs = await LicenseKey.find({
      productId: { $in: validObjectIds },
    });
    
    const decryptedKeys = [];
    for (const doc of licenseKeyDocs) {
      for (const key of doc.keys) {
        if (keyIds.some(id => id.toString() === key._id.toString())) {
          try {
            const decrypted = decryptKey(key.keyData);
            decryptedKeys.push(decrypted);
          } catch (error) {
            logger.error(`Failed to decrypt key ${key._id}`, error);
            decryptedKeys.push('[Decryption Error]');
          }
        }
      }
    }

    const html = licenseKeyEmailTemplate(order, decryptedKeys, user);

    const hasAccountProducts = order.items.some(item => item.productId?.productType === 'ACCOUNT_BASED');
    const subject = hasAccountProducts 
      ? `Your Order Details - Order #${order._id}`
      : `Your License Keys - Order #${order._id}`;

    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@dgmarq.com',
      to: user.email,
      subject,
      html,
    };

    const info = await transporter.sendMail(mailOptions);

    // FIX: Validate order._id before creating EmailLog
    const orderId = mongoose.Types.ObjectId.isValid(order._id) 
      ? new mongoose.Types.ObjectId(order._id) 
      : null;

    await EmailLog.create({
      recipient: user.email,
      subject: mailOptions.subject,
      template: 'licenseKey',
      status: 'sent',
      orderId: orderId,
      sentAt: new Date(),
    });

    for (let i = 0; i < order.items.length; i++) {
      if (order.items[i].assignedKeyIds && order.items[i].assignedKeyIds.length > 0) {
        order.items[i].keyDeliveryEmail = user.email;
        order.items[i].keyDeliveryStatus = 'sent';
        order.items[i].keyDeliveredAt = new Date();
      }
    }

    for (const doc of licenseKeyDocs) {
      const docKeyIds = doc.keys
        .filter(key => keyIds.some(id => id.toString() === key._id.toString()))
        .map(key => key._id);
      
      if (docKeyIds.length > 0) {
        await LicenseKey.updateOne(
          { _id: doc._id },
          {
            $set: {
              'keys.$[key].emailSent': true,
              'keys.$[key].emailSentAt': new Date(),
            },
          },
          {
            arrayFilters: [{ 'key._id': { $in: docKeyIds } }],
          }
        );
      }
    }

    await order.save();

    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error('Failed to send license key email', error);
    
    // FIX: Validate order._id before creating EmailLog
    const orderIdForError = order && order._id && mongoose.Types.ObjectId.isValid(order._id)
      ? new mongoose.Types.ObjectId(order._id)
      : null;

    await EmailLog.create({
      recipient: user?.email || 'unknown',
      subject: `Your License Keys - Order #${order?._id || 'unknown'}`,
      template: 'licenseKey',
      status: 'failed',
      orderId: orderIdForError,
      error: error.message,
    });

    throw error;
  }
};

export const sendOrderConfirmation = async (order, user) => {
  try {
    // FIX: Validate order and user
    if (!order || !user) {
      throw new Error('Order and user are required');
    }

    // FIX: Validate order._id is a valid ObjectId
    if (!order._id || !mongoose.Types.ObjectId.isValid(order._id)) {
      throw new Error(`Invalid order ID: ${order._id}`);
    }

    const transporter = createTransporter();
    const html = orderConfirmationEmailTemplate(order, user);

    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@dgmarq.com',
      to: user.email,
      subject: `Order Confirmation - Order #${order._id}`,
      html,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Order confirmation email sent to ${user.email} for order ${order._id}`);

    // FIX: Validate order._id before creating EmailLog
    const orderId = mongoose.Types.ObjectId.isValid(order._id) 
      ? new mongoose.Types.ObjectId(order._id) 
      : null;

    await EmailLog.create({
      recipient: user.email,
      subject: mailOptions.subject,
      template: 'orderConfirmation',
      status: 'sent',
      orderId: orderId,
      sentAt: new Date(),
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error('Failed to send order confirmation', error);
    
    // FIX: Log error to EmailLog
    const orderIdForError = order && order._id && mongoose.Types.ObjectId.isValid(order._id)
      ? new mongoose.Types.ObjectId(order._id)
      : null;

    await EmailLog.create({
      recipient: user?.email || 'unknown',
      subject: `Order Confirmation - Order #${order?._id || 'unknown'}`,
      template: 'orderConfirmation',
      status: 'failed',
      orderId: orderIdForError,
      error: error.message,
    }).catch(logError => {
      logger.error('Failed to create EmailLog for failed order confirmation', logError);
    });
    
    throw error;
  }
};

export const sendPayoutNotification = async (payout, seller, user) => {
  try {
    const transporter = createTransporter();
    const html = payoutNotificationEmailTemplate(payout, seller);

    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@dgmarq.com',
      to: user.email,
      subject: `Payout Processed - $${payout.netAmount.toFixed(2)}`,
      html,
    };

    await transporter.sendMail(mailOptions);

    await EmailLog.create({
      recipient: user.email,
      subject: mailOptions.subject,
      template: 'payoutNotification',
      status: 'sent',
      sentAt: new Date(),
    });

    return { success: true };
  } catch (error) {
    logger.error('Failed to send payout notification', error);
    throw error;
  }
};

export const sendPasswordResetEmail = async (user, resetToken) => {
  try {
    const transporter = createTransporter();
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .button { display: inline-block; padding: 12px 24px; background: #4a90e2; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <h2>Password Reset Request</h2>
          <p>Hello ${user.name},</p>
          <p>You requested to reset your password. Click the button below to reset it:</p>
          <a href="${resetUrl}" class="button">Reset Password</a>
          <p>If you didn't request this, please ignore this email.</p>
          <p>This link will expire in 1 hour.</p>
        </div>
      </body>
      </html>
    `;

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'noreply@dgmarq.com',
      to: user.email,
      subject: 'Password Reset Request',
      html,
    });

    return { success: true };
  } catch (error) {
    logger.error('Failed to send password reset email', error);
    throw error;
  }
};

export const sendEmailVerificationOTP = async (user, otp) => {
  try {
    const transporter = createTransporter();
    const expiryMinutes = 10;
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; }
          .container { max-width: 600px; margin: 0 auto; padding: 30px; background-color: #ffffff; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .header { text-align: center; margin-bottom: 30px; }
          .otp-box { background-color: #f8f9fa; border: 2px dashed #4a90e2; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0; }
          .otp-code { font-size: 32px; font-weight: bold; color: #4a90e2; letter-spacing: 8px; font-family: 'Courier New', monospace; }
          .warning { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 4px; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; text-align: center; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2 style="color: #4a90e2; margin: 0;">Email Verification</h2>
          </div>
          <p>Hello ${user.name},</p>
          <p>You requested to verify your email address. Please use the One-Time Password (OTP) below:</p>
          
          <div class="otp-box">
            <div class="otp-code">${otp}</div>
          </div>
          
          <div class="warning">
            <strong>⚠️ Security Notice:</strong>
            <ul style="margin: 10px 0; padding-left: 20px;">
              <li>This OTP will expire in ${expiryMinutes} minutes</li>
              <li>Do not share this code with anyone</li>
              <li>If you didn't request this, please ignore this email</li>
            </ul>
          </div>
          
          <p style="margin-top: 20px;">Enter this code in the verification form to complete your email verification.</p>
          
          <div class="footer">
            <p>This is an automated email. Please do not reply.</p>
            <p>&copy; ${new Date().getFullYear()} DG Marq. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'noreply@dgmarq.com',
      to: user.email,
      subject: 'Email Verification OTP - DG Marq',
      html,
    });

    await EmailLog.create({
      recipient: user.email,
      subject: 'Email Verification OTP - DG Marq',
      template: 'emailVerificationOTP',
      status: 'sent',
      sentAt: new Date(),
    });

    return { success: true };
  } catch (error) {
    logger.error('Failed to send email verification OTP', error);
    
    await EmailLog.create({
      recipient: user.email,
      subject: 'Email Verification OTP - DG Marq',
      template: 'emailVerificationOTP',
      status: 'failed',
      error: error.message,
    });

    throw error;
  }
};

