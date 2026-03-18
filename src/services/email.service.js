import nodemailer from "nodemailer";
import mongoose from "mongoose";
import {
  licenseKeyEmailTemplate,
  orderConfirmationEmailTemplate,
  payoutNotificationEmailTemplate,
  refundDecisionCustomerEmailTemplate,
  refundDecisionSellerEmailTemplate,
  refundRequestAdminEmailTemplate,
  refundIssuedSellerEmailTemplate,
  refundRequestedSellerEmailTemplate,
  refundSellerInputRequestEmailTemplate,
  sellerProfileApprovedEmailTemplate,
  sellerProfileRejectedEmailTemplate,
  sellerProfileSubmissionAdminEmailTemplate,
  sellerProfileSubmissionSellerEmailTemplate,
  sellerNewOrderEmailTemplate,
  supportTicketCreatedAdminEmailTemplate,
} from "../utils/emailTemplates.js";
import { EmailLog } from "../models/emailLog.model.js";
import { decryptKey } from "../utils/encryption.js";
import { LicenseKey } from "../models/licensekey.model.js";
import { logger } from "../utils/logger.js";

const createTransporter = () => {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  return nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    auth: {
      user: process.env.ETHEREAL_USER || "test@ethereal.email",
      pass: process.env.ETHEREAL_PASS || "test",
    },
  });
};

const sendAndLogEmail = async ({ to, subject, html, template }) => {
  const transporter = createTransporter();
  await transporter.sendMail({
    from: {
      name: process.env.EMAIL_FROM_NAME || "DG Marq",
      address: process.env.EMAIL_FROM || "noreply@dgmarq.com",
    },
    to,
    subject,
    html,
  });

  await EmailLog.create({
    recipient: to,
    subject,
    template,
    status: "sent",
    sentAt: new Date(),
  });
};

export const sendLicenseKeyEmail = async (order, user) => {
  try {
    const transporter = createTransporter();

    if (!order || !user) {
      throw new Error("Order and user are required");
    }

    if (!order._id || !mongoose.Types.ObjectId.isValid(order._id)) {
      throw new Error(`Invalid order ID: ${order._id}`);
    }

    if (order.items && order.items.length > 0) {
      const { Product } = await import("../models/product.model.js");
      for (const item of order.items) {
        if (item.productId && !item.productId.name) {
          const product = await Product.findById(item.productId)
            .select("name images productType")
            .lean();
          if (product) {
            item.productId = product;
          } else if (!item.name) {
            item.name = "Product name unavailable";
          }
        }
      }
    }

    const keyIds = order.items
      .filter((item) => item.assignedKeyIds && item.assignedKeyIds.length > 0)
      .flatMap((item) => item.assignedKeyIds);

    const productIds = [];
    for (const item of order.items) {
      if (!item.productId) {
        logger.warn(`Order item missing productId in order ${order._id}`);
        continue;
      }

      let productIdValue;
      if (typeof item.productId === "object" && item.productId._id) {
        productIdValue = item.productId._id;
      } else {
        productIdValue = item.productId;
      }

      const productIdStr = productIdValue.toString();
      if (mongoose.Types.ObjectId.isValid(productIdStr)) {
        productIds.push(productIdStr);
      } else {
        logger.warn(`Invalid productId in order ${order._id}: ${productIdStr}`);
      }
    }

    const uniqueProductIds = [...new Set(productIds)];
    if (uniqueProductIds.length === 0) {
      logger.warn(`No valid productIds found in order ${order._id}`);
      throw new Error("No valid product IDs found in order");
    }

    const validObjectIds = uniqueProductIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => {
        try {
          return new mongoose.Types.ObjectId(id);
        } catch (error) {
          logger.error(`Failed to create ObjectId from: ${id}`, error);
          return null;
        }
      })
      .filter((id) => id !== null);

    if (validObjectIds.length === 0) {
      throw new Error("No valid product ObjectIds found");
    }

    const licenseKeyDocs = await LicenseKey.find({
      productId: { $in: validObjectIds },
    });

    const keyToItemMap = new Map();
    for (const item of order.items) {
      if (item.assignedKeyIds && item.assignedKeyIds.length > 0) {
        for (const keyId of item.assignedKeyIds) {
          keyToItemMap.set(keyId.toString(), item);
        }
      }
    }

    const decryptedKeys = [];
    for (const item of order.items) {
      if (item.assignedKeyIds && item.assignedKeyIds.length > 0) {
        for (const keyId of item.assignedKeyIds) {
          let found = false;
          for (const doc of licenseKeyDocs) {
            const key = doc.keys.find(
              (k) => k._id.toString() === keyId.toString(),
            );
            if (key) {
              try {
                const decrypted = decryptKey(key.keyData);
                decryptedKeys.push(decrypted);
                found = true;
                break;
              } catch (error) {
                logger.error(`Failed to decrypt key ${key._id}`, error);
                decryptedKeys.push("[Decryption Error]");
                found = true;
                break;
              }
            }
          }
          if (!found) {
            logger.warn(
              `Key ${keyId} not found in license key documents for order ${order._id}`,
            );
            decryptedKeys.push("[Key Not Found]");
          }
        }
      }
    }

    const html = licenseKeyEmailTemplate(
      order,
      decryptedKeys,
      user,
      keyToItemMap,
    );

    const hasAccountProducts = order.items.some(
      (item) => item.productId?.productType === "ACCOUNT_BASED",
    );
    const subject = hasAccountProducts
      ? `Your Order Details - Order #${order._id}`
      : `Your License Keys - Order #${order._id}`;

    const mailOptions = {
      from: {
        name: process.env.EMAIL_FROM_NAME || "DG Marq",
        address: process.env.EMAIL_FROM || "noreply@dgmarq.com",
      },
      to: user.email,
      subject,
      html,
    };

    const info = await transporter.sendMail(mailOptions);

    const orderId = mongoose.Types.ObjectId.isValid(order._id)
      ? new mongoose.Types.ObjectId(order._id)
      : null;

    await EmailLog.create({
      recipient: user.email,
      subject: mailOptions.subject,
      template: "licenseKey",
      status: "sent",
      orderId: orderId,
      sentAt: new Date(),
    });

    for (let i = 0; i < order.items.length; i++) {
      if (
        order.items[i].assignedKeyIds &&
        order.items[i].assignedKeyIds.length > 0
      ) {
        order.items[i].keyDeliveryEmail = user.email;
        order.items[i].keyDeliveryStatus = "sent";
        order.items[i].keyDeliveredAt = new Date();
      }
    }

    for (const doc of licenseKeyDocs) {
      const docKeyIds = doc.keys
        .filter((key) =>
          keyIds.some((id) => id.toString() === key._id.toString()),
        )
        .map((key) => key._id);

      if (docKeyIds.length > 0) {
        await LicenseKey.updateOne(
          { _id: doc._id },
          {
            $set: {
              "keys.$[key].emailSent": true,
              "keys.$[key].emailSentAt": new Date(),
            },
          },
          {
            arrayFilters: [{ "key._id": { $in: docKeyIds } }],
          },
        );
      }
    }

    await order.save();

    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error("Failed to send license key email", error);

    const orderIdForError =
      order && order._id && mongoose.Types.ObjectId.isValid(order._id)
        ? new mongoose.Types.ObjectId(order._id)
        : null;

    await EmailLog.create({
      recipient: user?.email || "unknown",
      subject: `Your License Keys - Order #${order?._id || "unknown"}`,
      template: "licenseKey",
      status: "failed",
      orderId: orderIdForError,
      error: error.message,
    });

    throw error;
  }
};

export const sendLicenseKeyEmailToGuest = async (order, guestEmail) => {
  try {
    const transporter = createTransporter();
    const emailTrimmed =
      typeof guestEmail === "string" ? guestEmail.trim().toLowerCase() : "";
    if (!emailTrimmed) {
      throw new Error("Guest email is required");
    }
    if (!order || !order._id || !mongoose.Types.ObjectId.isValid(order._id)) {
      throw new Error(`Invalid order: ${order?._id}`);
    }
    const guestUser = { email: emailTrimmed, name: "Guest" };
    if (order.items && order.items.length > 0) {
      const { Product } = await import("../models/product.model.js");
      for (const item of order.items) {
        if (item.productId && !item.productId.name) {
          const product = await Product.findById(item.productId)
            .select("name images productType")
            .lean();
          if (product) {
            item.productId = product;
          } else if (!item.name) {
            item.name = "Product name unavailable";
          }
        }
      }
    }
    const keyIds = order.items
      .filter((item) => item.assignedKeyIds && item.assignedKeyIds.length > 0)
      .flatMap((item) => item.assignedKeyIds);
    const productIds = [];
    for (const item of order.items) {
      if (!item.productId) continue;
      const productIdValue =
        typeof item.productId === "object" && item.productId._id
          ? item.productId._id
          : item.productId;
      const productIdStr = productIdValue.toString();
      if (mongoose.Types.ObjectId.isValid(productIdStr))
        productIds.push(productIdStr);
    }
    const uniqueProductIds = [...new Set(productIds)];
    if (uniqueProductIds.length === 0) {
      throw new Error("No valid product IDs found in order");
    }
    const validObjectIds = uniqueProductIds
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id))
      .filter((id) => id !== null);
    if (validObjectIds.length === 0)
      throw new Error("No valid product ObjectIds found");
    const licenseKeyDocs = await LicenseKey.find({
      productId: { $in: validObjectIds },
    });
    const keyToItemMap = new Map();
    for (const item of order.items) {
      if (item.assignedKeyIds && item.assignedKeyIds.length > 0) {
        for (const keyId of item.assignedKeyIds) {
          keyToItemMap.set(keyId.toString(), item);
        }
      }
    }
    const decryptedKeys = [];
    for (const item of order.items) {
      if (item.assignedKeyIds && item.assignedKeyIds.length > 0) {
        for (const keyId of item.assignedKeyIds) {
          let found = false;
          for (const doc of licenseKeyDocs) {
            const key = doc.keys.find(
              (k) => k._id.toString() === keyId.toString(),
            );
            if (key) {
              try {
                decryptedKeys.push(decryptKey(key.keyData));
              } catch (error) {
                logger.error(`Failed to decrypt key ${key._id}`, error);
                decryptedKeys.push("[Decryption Error]");
              }
              found = true;
              break;
            }
          }
          if (!found) decryptedKeys.push("[Key Not Found]");
        }
      }
    }
    const html = licenseKeyEmailTemplate(
      order,
      decryptedKeys,
      guestUser,
      keyToItemMap,
    );
    const hasAccountProducts = order.items.some(
      (item) => item.productId?.productType === "ACCOUNT_BASED",
    );
    const subject = hasAccountProducts
      ? `Your Order Details - Order #${order._id}`
      : `Your License Keys - Order #${order._id}`;
    const mailOptions = {
      from: {
        name: process.env.EMAIL_FROM_NAME || "DG Marq",
        address: process.env.EMAIL_FROM || "noreply@dgmarq.com",
      },
      to: emailTrimmed,
      subject,
      html,
    };
    const info = await transporter.sendMail(mailOptions);
    const orderIdObj = mongoose.Types.ObjectId.isValid(order._id)
      ? new mongoose.Types.ObjectId(order._id)
      : null;
    await EmailLog.create({
      recipient: emailTrimmed,
      subject: mailOptions.subject,
      template: "licenseKey",
      status: "sent",
      orderId: orderIdObj,
      sentAt: new Date(),
    });
    for (let i = 0; i < order.items.length; i++) {
      if (
        order.items[i].assignedKeyIds &&
        order.items[i].assignedKeyIds.length > 0
      ) {
        order.items[i].keyDeliveryEmail = emailTrimmed;
        order.items[i].keyDeliveryStatus = "sent";
        order.items[i].keyDeliveredAt = new Date();
      }
    }
    for (const doc of licenseKeyDocs) {
      const docKeyIds = doc.keys
        .filter((key) =>
          keyIds.some((id) => id.toString() === key._id.toString()),
        )
        .map((key) => key._id);
      if (docKeyIds.length > 0) {
        await LicenseKey.updateOne(
          { _id: doc._id },
          {
            $set: {
              "keys.$[key].emailSent": true,
              "keys.$[key].emailSentAt": new Date(),
            },
          },
          { arrayFilters: [{ "key._id": { $in: docKeyIds } }] },
        );
      }
    }
    await order.save();
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error("Failed to send license key email to guest", error);
    const orderIdForError =
      order && order._id && mongoose.Types.ObjectId.isValid(order._id)
        ? new mongoose.Types.ObjectId(order._id)
        : null;
    await EmailLog.create({
      recipient: guestEmail || "unknown",
      subject: `Your License Keys - Order #${order?._id || "unknown"}`,
      template: "licenseKey",
      status: "failed",
      orderId: orderIdForError,
      error: error.message,
    });
    throw error;
  }
};

export const sendOrderConfirmation = async (order, user) => {
  try {
    if (!order || !user) {
      throw new Error("Order and user are required");
    }

    if (!order._id || !mongoose.Types.ObjectId.isValid(order._id)) {
      throw new Error(`Invalid order ID: ${order._id}`);
    }

    if (order.items && order.items.length > 0) {
      const { Product } = await import("../models/product.model.js");
      for (const item of order.items) {
        if (item.productId && !item.productId.name) {
          const product = await Product.findById(item.productId)
            .select("name images productType")
            .lean();
          if (product) {
            item.productId = product;
          } else if (!item.name) {
            item.name = "Product name unavailable";
          }
        }
      }
    }

    const transporter = createTransporter();
    const html = orderConfirmationEmailTemplate(order, user);

    const mailOptions = {
      from: {
        name: process.env.EMAIL_FROM_NAME || "DG Marq",
        address: process.env.EMAIL_FROM || "noreply@dgmarq.com",
      },
      to: user.email,
      subject: `Order Confirmation - Order #${order._id}`,
      html,
    };

    const info = await transporter.sendMail(mailOptions);
    logger.info(
      `Order confirmation email sent to ${user.email} for order ${order._id}`,
    );

    const orderId = mongoose.Types.ObjectId.isValid(order._id)
      ? new mongoose.Types.ObjectId(order._id)
      : null;

    await EmailLog.create({
      recipient: user.email,
      subject: mailOptions.subject,
      template: "orderConfirmation",
      status: "sent",
      orderId: orderId,
      sentAt: new Date(),
    });

    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error("Failed to send order confirmation", error);

    const orderIdForError =
      order && order._id && mongoose.Types.ObjectId.isValid(order._id)
        ? new mongoose.Types.ObjectId(order._id)
        : null;

    await EmailLog.create({
      recipient: user?.email || "unknown",
      subject: `Order Confirmation - Order #${order?._id || "unknown"}`,
      template: "orderConfirmation",
      status: "failed",
      orderId: orderIdForError,
      error: error.message,
    }).catch((logError) => {
      logger.error(
        "Failed to create EmailLog for failed order confirmation",
        logError,
      );
    });

    throw error;
  }
};

export const sendPayoutNotification = async (payout, seller, user) => {
  try {
    const transporter = createTransporter();
    const html = payoutNotificationEmailTemplate(payout, seller);

    const mailOptions = {
      from: {
        name: process.env.EMAIL_FROM_NAME || "DG Marq",
        address: process.env.EMAIL_FROM || "noreply@dgmarq.com",
      },
      to: user.email,
      subject: `Payout Processed - $${payout.netAmount.toFixed(2)}`,
      html,
    };

    await transporter.sendMail(mailOptions);

    await EmailLog.create({
      recipient: user.email,
      subject: mailOptions.subject,
      template: "payoutNotification",
      status: "sent",
      sentAt: new Date(),
    });

    return { success: true };
  } catch (error) {
    logger.error("Failed to send payout notification", error);
    throw error;
  }
};

export const sendRefundRequestedEmailToSeller = async ({
  sellerUser,
  orderNumber,
  productName,
  refundAmount,
}) => {
  try {
    const transporter = createTransporter();
    const dashboardUrl = `${process.env.FRONTEND_URL || ""}/seller/return-refunds`;
    const html = refundRequestedSellerEmailTemplate(
      orderNumber,
      productName,
      refundAmount,
      dashboardUrl,
    );
    const mailOptions = {
      from: {
        name: process.env.EMAIL_FROM_NAME || "DG Marq",
        address: process.env.EMAIL_FROM || "noreply@dgmarq.com",
      },
      to: sellerUser.email,
      subject: `Refund Requested for Order #${orderNumber}`,
      html,
    };
    await transporter.sendMail(mailOptions);
    logger.info(
      `Refund requested email sent to seller ${sellerUser.email} for order #${orderNumber}`,
    );
    await EmailLog.create({
      recipient: sellerUser.email,
      subject: mailOptions.subject,
      template: "refundRequestedSeller",
      status: "sent",
      sentAt: new Date(),
    });
    return { success: true };
  } catch (error) {
    logger.error("Failed to send refund-requested email to seller", {
      orderNumber,
      err: error.message,
    });
    await EmailLog.create({
      recipient: sellerUser?.email || "unknown",
      subject: `Refund Requested for Order #${orderNumber}`,
      template: "refundRequestedSeller",
      status: "failed",
      error: error.message,
    });
    throw error;
  }
};

export const sendRefundIssuedEmailToSeller = async ({
  sellerUser,
  orderNumber,
  productName,
  buyerName,
  refundAmount,
  refundType,
  payoutStatus,
  refundMethod = "WALLET",
}) => {
  try {
    const transporter = createTransporter();
    const html = refundIssuedSellerEmailTemplate(
      orderNumber,
      productName,
      buyerName,
      refundAmount,
      refundType,
      payoutStatus,
      refundMethod,
    );

    const mailOptions = {
      from: {
        name: process.env.EMAIL_FROM_NAME || "DG Marq",
        address: process.env.EMAIL_FROM || "noreply@dgmarq.com",
      },
      to: sellerUser.email,
      subject: `Refund Issued for Order #${orderNumber}`,
      html,
    };

    await transporter.sendMail(mailOptions);
    logger.info(
      `Refund issued email sent to seller ${sellerUser.email} for order #${orderNumber}`,
    );

    await EmailLog.create({
      recipient: sellerUser.email,
      subject: mailOptions.subject,
      template: "refundIssuedSeller",
      status: "sent",
      sentAt: new Date(),
    });

    return { success: true };
  } catch (error) {
    logger.error("Failed to send refund-issued email to seller", {
      orderNumber,
      err: error.message,
    });
    await EmailLog.create({
      recipient: sellerUser?.email || "unknown",
      subject: `Refund Issued for Order #${orderNumber}`,
      template: "refundIssuedSeller",
      status: "failed",
      error: error.message,
    });
    throw error;
  }
};

export const sendSellerInputRequestEmailToSeller = async ({
  sellerUser,
  refundId,
  orderNumber,
  productName,
  customerName,
  adminMessage,
}) => {
  try {
    const transporter = createTransporter();
    const dashboardUrl = `${process.env.FRONTEND_URL || ""}/seller/return-refunds?refundId=${refundId}`;
    const html = refundSellerInputRequestEmailTemplate({
      refundId,
      orderNumber,
      productName,
      customerName,
      adminMessage,
      dashboardUrl,
    });

    const subject = `Admin Requested Your Input on Refund #${refundId}`;

    const mailOptions = {
      from: {
        name: process.env.EMAIL_FROM_NAME || "DG Marq",
        address: process.env.EMAIL_FROM || "noreply@dgmarq.com",
      },
      to: sellerUser.email,
      subject,
      html,
    };

    await transporter.sendMail(mailOptions);
    logger.info("Seller input request email sent to seller", {
      email: sellerUser.email,
      refundId,
      orderNumber,
    });

    await EmailLog.create({
      recipient: sellerUser.email,
      subject,
      template: "refundSellerInputRequest",
      status: "sent",
      sentAt: new Date(),
    });

    return { success: true };
  } catch (error) {
    logger.error("Failed to send seller-input-request email to seller", {
      refundId,
      orderNumber,
      err: error.message,
    });
    await EmailLog.create({
      recipient: sellerUser?.email || "unknown",
      subject: `Admin Requested Your Input on Refund #${refundId}`,
      template: "refundSellerInputRequest",
      status: "failed",
      error: error.message,
    });
    throw error;
  }
};

export const sendSellerNewOrderEmail = async ({
  order,
  sellerUser,
  seller,
  buyerName,
  sellerItems,
}) => {
  const recipient = sellerUser?.email;
  const orderId = order?._id;
  const subject = "New Order Received";

  if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
    throw new Error(`Invalid order ID for seller email: ${orderId}`);
  }
  if (!recipient) {
    throw new Error(
      `Missing seller email for seller ${seller?._id || "unknown"}`,
    );
  }
  if (!Array.isArray(sellerItems) || sellerItems.length === 0) {
    throw new Error(
      `No seller items found for seller ${seller?._id || "unknown"} in order ${orderId}`,
    );
  }

  const orderObjectId = new mongoose.Types.ObjectId(orderId);

  // Idempotency guard: one successful seller-order email per order/recipient.
  const existingSuccess = await EmailLog.findOne({
    recipient,
    orderId: orderObjectId,
    template: "sellerNewOrder",
    status: "sent",
  }).lean();
  if (existingSuccess) {
    return { success: true, skipped: true, reason: "already_sent" };
  }

  try {
    const normalizedItems = sellerItems.map((item) => ({
      productName: item.productName || "Product",
      quantity: Number(item.quantity) || 0,
    }));

    const shippingAddress =
      order?.shippingAddress ||
      order?.shipping?.address ||
      order?.shippingDetails ||
      order?.deliveryAddress ||
      null;

    const html = sellerNewOrderEmailTemplate({
      sellerName: seller?.shopName || sellerUser?.name || "Seller",
      orderId: String(orderId),
      orderDate:
        new Date(order.createdAt || Date.now()).toLocaleString("en-US", {
          timeZone: "UTC",
        }) + " UTC",
      buyerName: buyerName || "Guest Buyer",
      shippingAddress: shippingAddress || "Not applicable",
      dashboardUrl: `${process.env.FRONTEND_URL || ""}/seller/orders`,
      items: normalizedItems,
    });

    await sendAndLogEmail({
      to: recipient,
      subject,
      html,
      template: "sellerNewOrder",
    });

    // Ensure orderId is captured on the log for traceability
    await EmailLog.updateOne(
      {
        recipient,
        subject,
        template: "sellerNewOrder",
        status: "sent",
        orderId: { $exists: false },
      },
      {
        $set: {
          orderId: orderObjectId,
        },
      }
    );

    return { success: true };
  } catch (error) {
    logger.error("Failed to send new-order email to seller", {
      orderId: String(orderId),
      sellerId: seller?._id ? String(seller._id) : null,
      recipient,
      error: error.message,
    });

    await EmailLog.create({
      recipient,
      subject,
      template: "sellerNewOrder",
      status: "failed",
      orderId: orderObjectId,
      error: error.message,
    }).catch((logError) => {
      logger.error(
        "Failed to create EmailLog for seller new-order email failure",
        logError,
      );
    });

    throw error;
  }
};

export const sendSellerSubmissionToAdminEmail = async ({
  adminEmail,
  sellerFullName,
  sellerEmail,
  storeName,
  submittedDocuments = [],
  submittedAt,
}) => {
  try {
    const html = sellerProfileSubmissionAdminEmailTemplate({
      sellerFullName,
      sellerEmail,
      storeName,
      submittedDocuments,
      submittedAt,
    });

    await sendAndLogEmail({
      to: adminEmail,
      subject: `New Seller Profile Submission - ${storeName}`,
      html,
      template: "sellerProfileSubmissionAdmin",
    });
    return { success: true };
  } catch (error) {
    logger.error("Failed to send seller submission email to admin", error);
    throw error;
  }
};

export const sendSellerSubmissionConfirmationEmail = async ({
  sellerEmail,
  sellerName,
  storeName,
}) => {
  try {
    const html = sellerProfileSubmissionSellerEmailTemplate({
      sellerName,
      storeName,
    });

    await sendAndLogEmail({
      to: sellerEmail,
      subject: "Seller profile submitted successfully",
      html,
      template: "sellerProfileSubmissionConfirmation",
    });
    return { success: true };
  } catch (error) {
    logger.error("Failed to send seller submission confirmation email", error);
    throw error;
  }
};

export const sendSellerApprovedEmail = async ({
  sellerEmail,
  sellerName,
  storeName,
}) => {
  try {
    const html = sellerProfileApprovedEmailTemplate({
      sellerName,
      storeName,
      nextStepsUrl: `${process.env.FRONTEND_URL || ""}/seller/dashboard`,
    });

    await sendAndLogEmail({
      to: sellerEmail,
      subject: "Your Seller Profile Has Been Approved",
      html,
      template: "sellerProfileApproved",
    });
    return { success: true };
  } catch (error) {
    logger.error("Failed to send seller approved email", error);
    throw error;
  }
};

export const sendSellerRejectedEmail = async ({
  sellerEmail,
  sellerName,
  storeName,
  reason,
}) => {
  try {
    const html = sellerProfileRejectedEmailTemplate({
      sellerName,
      storeName,
      reason,
    });

    await sendAndLogEmail({
      to: sellerEmail,
      subject: "Your Seller Profile Has Been Rejected",
      html,
      template: "sellerProfileRejected",
    });
    return { success: true };
  } catch (error) {
    logger.error("Failed to send seller rejected email", error);
    throw error;
  }
};

export const sendSupportTicketCreatedToAdminEmail = async ({
  adminEmail,
  ticketId,
  userName,
  userEmail,
  subject,
  message,
  createdAt,
}) => {
  try {
    const html = supportTicketCreatedAdminEmailTemplate({
      ticketId,
      userName,
      userEmail,
      subject,
      message,
      createdAt,
    });

    await sendAndLogEmail({
      to: adminEmail,
      subject: `New Support Ticket #${ticketId}`,
      html,
      template: "supportTicketAdmin",
    });
    return { success: true };
  } catch (error) {
    logger.error("Failed to send support ticket email to admin", error);
    throw error;
  }
};

export const sendRefundRequestToAdminEmail = async ({
  adminEmail,
  details,
}) => {
  try {
    const html = refundRequestAdminEmailTemplate(details);
    await sendAndLogEmail({
      to: adminEmail,
      subject: `New Refund Request #${details.refundRequestId}`,
      html,
      template: "refundRequestAdmin",
    });
    return { success: true };
  } catch (error) {
    logger.error("Failed to send refund request email to admin", error);
    throw error;
  }
};

export const sendRefundDecisionCustomerEmail = async ({
  customerEmail,
  customerName,
  refundId,
  approved,
  amount,
  reason,
}) => {
  try {
    const html = refundDecisionCustomerEmailTemplate({
      approved,
      customerName,
      refundId,
      amount,
      reason,
    });

    await sendAndLogEmail({
      to: customerEmail,
      subject: approved
        ? "Your Refund Request Was Approved"
        : "Your Refund Request Was Rejected",
      html,
      template: "refundDecisionCustomer",
    });
    return { success: true };
  } catch (error) {
    logger.error("Failed to send refund decision email to customer", error);
    throw error;
  }
};

export const sendRefundDecisionSellerEmail = async ({
  sellerEmail,
  sellerName,
  refundId,
  approved,
  amount,
  reason,
}) => {
  try {
    const html = refundDecisionSellerEmailTemplate({
      approved,
      sellerName,
      refundId,
      amount,
      reason,
    });

    await sendAndLogEmail({
      to: sellerEmail,
      subject: approved
        ? "A Refund Request Was Approved"
        : "A Refund Request Was Rejected",
      html,
      template: "refundDecisionSeller",
    });
    return { success: true };
  } catch (error) {
    logger.error("Failed to send refund decision email to seller", error);
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
      from: {
        name: process.env.EMAIL_FROM_NAME || "DG Marq",
        address: process.env.EMAIL_FROM || "noreply@dgmarq.com",
      },
      to: user.email,
      subject: "Password Reset Request",
      html,
    });

    return { success: true };
  } catch (error) {
    logger.error("Failed to send password reset email", error);
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
      from: {
        name: process.env.EMAIL_FROM_NAME || "DG Marq",
        address: process.env.EMAIL_FROM || "noreply@dgmarq.com",
      },
      to: user.email,
      subject: "Email Verification OTP - DG Marq",
      html,
    });

    await EmailLog.create({
      recipient: user.email,
      subject: "Email Verification OTP - DG Marq",
      template: "emailVerificationOTP",
      status: "sent",
      sentAt: new Date(),
    });

    return { success: true };
  } catch (error) {
    logger.error("Failed to send email verification OTP", error);

    await EmailLog.create({
      recipient: user.email,
      subject: "Email Verification OTP - DG Marq",
      template: "emailVerificationOTP",
      status: "failed",
      error: error.message,
    });

    throw error;
  }
};
