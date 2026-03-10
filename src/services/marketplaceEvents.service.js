import { queueEmail } from "../jobs/email.job.js";
import { Seller } from "../models/seller.model.js";
import { User } from "../models/user.model.js";
import { createNotification } from "./notification.service.js";
import { logger } from "../utils/logger.js";

const toUtcString = (dateValue = new Date()) =>
  new Date(dateValue).toLocaleString("en-US", { timeZone: "UTC" }) + " UTC";

const safeQueueEmail = async (type, data, jobId = null) => {
  try {
    await queueEmail(type, data, jobId ? { jobId } : {});
  } catch (error) {
    logger.error("[marketplaceEvents] Failed to queue email", { type, error: error.message });
  }
};

const safeCreateNotification = async (userId, type, title, message, data = null, actionUrl = null, priority = "medium") => {
  try {
    await createNotification(userId, type, title, message, data, actionUrl, priority);
  } catch (error) {
    logger.error("[marketplaceEvents] Failed to create notification", {
      userId: userId?.toString?.() || userId,
      type,
      error: error.message,
    });
  }
};

const getAdminRecipients = async () => {
  const admins = await User.find({
    roles: { $in: ["admin"] },
    isActive: true,
    email: { $exists: true, $ne: null },
  })
    .select("_id email name")
    .lean();

  return admins;
};

export const handleSellerProfileSubmitted = async ({ seller, sellerUser }) => {
  if (!seller || !sellerUser?.email) return;

  const admins = await getAdminRecipients();
  const submittedAt = toUtcString(seller.createdAt || new Date());
  const basePayload = {
    sellerFullName: sellerUser.name || "Seller",
    sellerEmail: sellerUser.email,
    storeName: seller.shopName || "N/A",
    submittedDocuments: Array.isArray(seller.kycDocs) ? seller.kycDocs : [],
    submittedAt,
  };

  await Promise.allSettled(
    admins.map(async (admin) => {
      await safeQueueEmail(
        "seller_submission_admin",
        { adminEmail: admin.email, ...basePayload },
        `seller_submission_admin:${seller._id}:${admin._id}`
      );
      await safeCreateNotification(
        admin._id,
        "system",
        "New Seller Submission",
        `${basePayload.sellerFullName} submitted seller profile for ${basePayload.storeName}.`,
        { sellerId: seller._id, userId: seller.userId },
        "/admin/sellers/pending",
        "high"
      );
    })
  );

  await safeQueueEmail(
    "seller_submission_confirmation",
    {
      sellerEmail: sellerUser.email,
      sellerName: sellerUser.name || "Seller",
      storeName: seller.shopName || "your store",
    },
    `seller_submission_confirmation:${seller._id}:${sellerUser._id}`
  );

  await safeCreateNotification(
    sellerUser._id,
    "system",
    "Seller Profile Submitted",
    "Your seller profile has been submitted successfully and is pending admin review.",
    { sellerId: seller._id },
    "/seller/profile",
    "medium"
  );
};

export const handleSellerProfileDecision = async ({ seller, sellerUser, approved, reason = null }) => {
  if (!seller || !sellerUser?.email) return;

  if (approved) {
    await safeQueueEmail(
      "seller_profile_approved",
      {
        sellerEmail: sellerUser.email,
        sellerName: sellerUser.name || "Seller",
        storeName: seller.shopName || "your store",
      },
      `seller_profile_approved:${seller._id}:${sellerUser._id}`
    );

    await safeCreateNotification(
      sellerUser._id,
      "system",
      "Seller Profile Approved",
      "Congratulations! Your seller profile has been approved. You can now start adding products.",
      { sellerId: seller._id },
      "/seller/products",
      "high"
    );
    return;
  }

  await safeQueueEmail(
    "seller_profile_rejected",
    {
      sellerEmail: sellerUser.email,
      sellerName: sellerUser.name || "Seller",
      storeName: seller.shopName || "your store",
      reason: reason || null,
    },
    `seller_profile_rejected:${seller._id}:${sellerUser._id}`
  );

  await safeCreateNotification(
    sellerUser._id,
    "system",
    "Seller Profile Rejected",
    reason ? `Your seller profile was rejected. Reason: ${reason}` : "Your seller profile was rejected.",
    { sellerId: seller._id, reason: reason || null },
    "/seller/profile",
    "high"
  );
};

export const handleSupportTicketCreated = async ({ chat, user, initialMessage }) => {
  if (!chat) return;

  const userName = user?.name || chat.guestName || "Guest User";
  const userEmail = user?.email || chat.guestEmail || "guest@unknown.local";
  const createdAt = toUtcString(chat.createdAt || new Date());
  const admins = await getAdminRecipients();

  await Promise.allSettled(
    admins.map(async (admin) => {
      await safeQueueEmail(
        "support_ticket_admin",
        {
          adminEmail: admin.email,
          ticketId: chat._id.toString(),
          userName,
          userEmail,
          subject: chat.subject || "General Inquiry",
          message: initialMessage || "",
          createdAt,
        },
        `support_ticket_admin:${chat._id}:${admin._id}`
      );

      await safeCreateNotification(
        admin._id,
        "system",
        "New Support Ticket",
        `Support ticket ${chat._id} created by ${userName}.`,
        { ticketId: chat._id, userEmail },
        "/admin/support",
        "high"
      );
    })
  );
};

/** Formatted order ID for display (dashboard/email): #orderNumber or fallback to _id. */
const formatOrderIdForDisplay = (order) => {
  if (!order) return "N/A";
  if (order.orderNumber) return `#${order.orderNumber}`;
  const id = order._id?.toString?.();
  return id || "N/A";
};

/** Formatted refund ID for display (dashboard/email): last 8 chars of _id. */
const formatRefundIdForDisplay = (refund) => {
  if (!refund?._id) return "N/A";
  const id = refund._id.toString();
  return id.length >= 8 ? id.slice(-8) : id;
};

export const handleRefundRequestCreated = async ({ refund, order, product, customer, seller }, app = null) => {
  if (!refund) return;
  const admins = await getAdminRecipients();

  const orderIdDisplay = formatOrderIdForDisplay(order) || order?._id?.toString?.() || refund.orderId?.toString?.() || "N/A";
  const refundRequestIdDisplay = formatRefundIdForDisplay(refund);

  const details = {
    refundRequestId: refundRequestIdDisplay,
    orderId: orderIdDisplay,
    productName: product?.name || "Product",
    productId: product?._id?.toString?.() || refund.productId?.toString?.() || "N/A",
    sellerName: seller?.shopName || "Seller",
    sellerId: seller?._id?.toString?.() || refund.sellerId?.toString?.() || "N/A",
    customerName: customer?.name || "Customer",
    customerId: customer?._id?.toString?.() || refund.userId?.toString?.() || "N/A",
    refundReason: refund.reason || "N/A",
    orderDate: toUtcString(order?.createdAt || new Date()),
    refundRequestDate: toUtcString(refund.createdAt || new Date()),
    paymentId: order?.paypalCaptureId || null,
    refundAmount: refund.refundAmount || 0,
  };

  await Promise.allSettled(
    admins.map(async (admin) => {
      await safeQueueEmail(
        "refund_request_admin",
        { adminEmail: admin.email, details },
        `refund_request_admin:${refund._id}:${admin._id}`
      );

      await safeCreateNotification(
        admin._id,
        "refund",
        "New Refund Request",
        `Refund request ${details.refundRequestId} was created for order ${details.orderId}.`,
        { refundId: refund._id, orderId: order?._id ?? refund.orderId },
        "/admin/return-refund",
        "high"
      );
    })
  );

  if (app && app.get("io")) {
    const io = app.get("io");
    admins.forEach((admin) => {
      io.to(`user:${admin._id}`).emit("notification_new", { type: "refund" });
    });
  }
};

export const handleRefundDecision = async ({
  refund,
  customer,
  seller,
  sellerUser,
  approved,
  rejectionReason = null,
}) => {
  if (!refund || !customer?.email || !sellerUser?.email) return;

  const refundIdDisplay = formatRefundIdForDisplay(refund);

  await Promise.allSettled([
    safeQueueEmail(
      "refund_decision_customer",
      {
        customerEmail: customer.email,
        customerName: customer.name || "Customer",
        refundId: refundIdDisplay,
        approved,
        amount: refund.refundAmount || 0,
        reason: rejectionReason || null,
      },
      `refund_decision_customer:${refund._id}:${customer._id}`
    ),
    safeQueueEmail(
      "refund_decision_seller",
      {
        sellerEmail: sellerUser.email,
        sellerName: seller?.shopName || sellerUser.name || "Seller",
        refundId: refundIdDisplay,
        approved,
        amount: refund.refundAmount || 0,
        reason: rejectionReason || null,
      },
      `refund_decision_seller:${refund._id}:${sellerUser._id}`
    ),
  ]);

  const refundIdDisplayForMessage = formatRefundIdForDisplay(refund);

  await Promise.allSettled([
    safeCreateNotification(
      customer._id,
      "refund",
      approved ? "Refund Approved" : "Refund Rejected",
      approved
        ? `Your refund request ${refundIdDisplayForMessage} has been approved.`
        : `Your refund request ${refundIdDisplayForMessage} was rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ""}`,
      { refundId: refund._id, approved, rejectionReason: rejectionReason || null },
      "/user/refunds",
      "high"
    ),
    safeCreateNotification(
      sellerUser._id,
      "refund",
      approved ? "Refund Approved" : "Refund Rejected",
      approved
        ? `Refund request ${refundIdDisplayForMessage} for your product has been approved.`
        : `Refund request ${refundIdDisplayForMessage} for your product was rejected.${rejectionReason ? ` Reason: ${rejectionReason}` : ""}`,
      { refundId: refund._id, approved, rejectionReason: rejectionReason || null },
      "/seller/return-refunds",
      "high"
    ),
  ]);
};

