import { Product } from '../models/product.model.js';
import { Seller } from '../models/seller.model.js';
import { User } from '../models/user.model.js';
import { createNotification } from './notification.service.js';
import { LicenseKey } from '../models/licensekey.model.js';
import { EmailLog } from '../models/emailLog.model.js';
import { logger } from '../utils/logger.js';
import mongoose from 'mongoose';
import nodemailer from 'nodemailer';

const LOW_STOCK_THRESHOLD = 10;
const OUT_OF_STOCK_THRESHOLD = 0;

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
  return nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    auth: {
      user: process.env.ETHEREAL_USER || 'test@ethereal.email',
      pass: process.env.ETHEREAL_PASS || 'test',
    },
  });
};

export const checkAndNotifyLowStock = async (productId) => {
  const product = await Product.findById(productId).populate('sellerId');
  if (!product) {
    return;
  }

  const licenseKeyDoc = await LicenseKey.findOne({
    productId: new mongoose.Types.ObjectId(productId),
  });

  const availableKeys = licenseKeyDoc 
    ? licenseKeyDoc.keys.filter(key => !key.isUsed).length 
    : 0;

  product.availableKeysCount = availableKeys;
  product.stock = availableKeys;

  if (availableKeys === 0 && ['active', 'approved'].includes(product.status)) {
  }

  await product.save();

  if (availableKeys > 0 && availableKeys <= LOW_STOCK_THRESHOLD) {
    const seller = await Seller.findById(product.sellerId);
    if (seller) {
      const sellerUser = await User.findById(seller.userId);
      if (sellerUser) {
        await createNotification(
          sellerUser._id,
          'system',
          'Low Stock Alert',
          `Your product "${product.name}" is running low on stock. Only ${availableKeys} keys remaining.`,
          {
            productId: product._id,
            productName: product.name,
            availableKeys,
          },
          `/seller/products/${product._id}`,
          'high'
        );
      }
    }
  }

  if (availableKeys === OUT_OF_STOCK_THRESHOLD) {
    const seller = await Seller.findById(product.sellerId);
    if (seller) {
      const sellerUser = await User.findById(seller.userId);
      if (sellerUser) {
        await createNotification(
          sellerUser._id,
          'system',
          'Out of Stock Alert',
          `Your product "${product.name}" is out of stock. Please add more ${product.productType === 'ACCOUNT_BASED' ? 'accounts' : 'license keys'}.`,
          {
            productId: product._id,
            productName: product.name,
            availableKeys: 0,
          },
          `/seller/products/${product._id}`,
          'high'
        );

        try {
          const transporter = createTransporter();
          const productTypeLabel = product.productType === 'ACCOUNT_BASED' ? 'Account' : 'License Key';
          const productTypeText = product.productType === 'ACCOUNT_BASED' ? 'accounts' : 'license keys';
          
          const emailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #dc3545; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
                .content { background: #fff; padding: 20px; border: 1px solid #ddd; }
                .alert-box { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; border-radius: 3px; }
                .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>Out of Stock Alert</h1>
                </div>
                <div class="content">
                  <p>Hello ${seller.shopName || 'Seller'},</p>
                  <p>Your product <strong>"${product.name}"</strong> (${productTypeLabel}) is now out of stock.</p>
                  <div class="alert-box">
                    <strong>⚠️ Stock Status:</strong> All uploaded ${productTypeText} have been consumed.
                  </div>
                  <p>To continue selling this product, please upload more ${productTypeText} through your seller dashboard.</p>
                  <p style="margin-top: 30px;">
                    <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/seller/products/${product._id}" 
                       style="display: inline-block; padding: 12px 24px; background: #4a90e2; color: white; text-decoration: none; border-radius: 5px;">
                      Manage Product
                    </a>
                  </p>
                </div>
                <div class="footer">
                  <p>© ${new Date().getFullYear()} DGMARQ. All rights reserved.</p>
                </div>
              </div>
            </body>
            </html>
          `;

          await transporter.sendMail({
            from: process.env.EMAIL_FROM || 'noreply@dgmarq.com',
            to: sellerUser.email,
            subject: `Out of Stock: ${product.name} (${productTypeLabel})`,
            html: emailHtml,
          });

          await EmailLog.create({
            recipient: sellerUser.email,
            subject: `Out of Stock: ${product.name} (${productTypeLabel})`,
            template: 'outOfStock',
            status: 'sent',
            sentAt: new Date(),
          });
        } catch (emailError) {
          logger.error('Failed to send out of stock email', emailError);
        }
      }
    }
  }

  return {
    productId: product._id,
    productName: product.name,
    availableKeys,
    isLowStock: availableKeys > 0 && availableKeys <= LOW_STOCK_THRESHOLD,
    isOutOfStock: availableKeys === OUT_OF_STOCK_THRESHOLD,
  };
};

export const checkStockAfterAssignment = async (productId) => {
  return await checkAndNotifyLowStock(productId);
};

