import { getOrderDisplayId } from "./orderDisplay.js";

export const licenseKeyEmailTemplate = (order, keys, user, keyToItemMap = null) => {
  let keyIndex = 0;
  const keysList = [];
  
  for (const item of order.items) {
    const itemKeyCount = item.assignedKeyIds?.length || 0;
    const itemKeys = keys.slice(keyIndex, keyIndex + itemKeyCount);
    
    let productName = 'Product name unavailable';
    let isAccount = false;
    
    if (item.productId) {
      if (typeof item.productId === 'object' && item.productId.name) {
        productName = item.productId.name;
        isAccount = item.productId.productType === 'ACCOUNT_BASED';
      } else if (item.productId && typeof item.productId === 'object' && item.productId._id) {
        productName = item.productId.name || 'Product name unavailable';
        isAccount = item.productId.productType === 'ACCOUNT_BASED';
      } else {
        productName = 'Product name unavailable';
      }
    }
    
    for (const key of itemKeys) {
      let keyDisplay = key;
      let accountDetails = null;
      if (isAccount && typeof key === 'string') {
        try {
          accountDetails = JSON.parse(key);
        } catch (e) {
          accountDetails = null;
        }
      }
      
      keysList.push(`
        <div style="margin: 20px 0; padding: 15px; background: #f5f5f5; border-radius: 5px;">
          <h3 style="margin: 0 0 10px 0; color: #333;">${productName}</h3>
          ${isAccount && accountDetails ? `
            <p style="margin: 5px 0; font-size: 14px; color: #666;">Account Credentials:</p>
            <div style="padding: 10px; background: #fff; border: 1px solid #ddd; border-radius: 3px;">
              ${accountDetails.email ? `<p style="margin: 5px 0;"><strong>Email:</strong> <code style="padding: 4px 8px; background: #f8f9fa; border-radius: 3px; font-size: 14px;">${accountDetails.email}</code></p>` : ''}
              ${accountDetails.usernameId ? `<p style="margin: 5px 0;"><strong>Username ID:</strong> <code style="padding: 4px 8px; background: #f8f9fa; border-radius: 3px; font-size: 14px;">${accountDetails.usernameId}</code></p>` : ''}
              ${!accountDetails.usernameId && accountDetails.username ? `<p style="margin: 5px 0;"><strong>Username ID:</strong> <code style="padding: 4px 8px; background: #f8f9fa; border-radius: 3px; font-size: 14px;">${accountDetails.username}</code></p>` : ''}
              ${accountDetails.usernamePassword ? `<p style="margin: 5px 0;"><strong>Username Password:</strong> <code style="padding: 4px 8px; background: #f8f9fa; border-radius: 3px; font-size: 14px; font-weight: bold; color: #2c3e50;">${accountDetails.usernamePassword}</code></p>` : ''}
              ${!accountDetails.usernamePassword && accountDetails.password ? `<p style="margin: 5px 0;"><strong>Username Password:</strong> <code style="padding: 4px 8px; background: #f8f9fa; border-radius: 3px; font-size: 14px; font-weight: bold; color: #2c3e50;">${accountDetails.password}</code></p>` : ''}
              ${accountDetails.emailPassword ? `<p style="margin: 5px 0;"><strong>Email Password:</strong> <code style="padding: 4px 8px; background: #f8f9fa; border-radius: 3px; font-size: 14px; font-weight: bold; color: #2c3e50;">${accountDetails.emailPassword}</code></p>` : ''}
            </div>
          ` : `
            <p style="margin: 5px 0; font-size: 14px; color: #666;">License Key:</p>
            <code style="display: block; padding: 10px; background: #fff; border: 1px solid #ddd; border-radius: 3px; font-size: 16px; font-weight: bold; color: #2c3e50; word-break: break-all;">
              ${keyDisplay}
            </code>
          `}
        </div>
      `);
    }
    
    keyIndex += itemKeyCount;
  }
  
  const keysListHtml = keysList.join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4a90e2; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
        .content { background: #fff; padding: 20px; border: 1px solid #ddd; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Your Order Details</h1>
        </div>
        <div class="content">
          <p>Hello ${user.name},</p>
          <p>Thank you for your purchase! Your order has been completed.</p>
          <p style="margin: 10px 0; padding: 10px; background: #e8f4fd; border: 1px solid #bee5eb; border-radius: 4px;">
            <strong>Order ID:</strong> <code style="padding: 2px 6px; background: #fff; border-radius: 3px; font-size: 14px;">${getOrderDisplayId(order)}</code>
          </p>
          <p style="font-size: 12px; color: #666;">Save this Order ID — you will need it if you request a refund.</p>
          <p>Here are your order details:</p>
          ${keysListHtml}
          <p style="margin-top: 30px; padding: 15px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 3px;">
            <strong>Important:</strong> Please keep these keys secure and do not share them with anyone.
          </p>
          <p>If you have any questions, please contact our support team.</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} DGMARQ. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

export const orderConfirmationEmailTemplate = (order, user) => {
  const itemsList = order.items.map((item, index) => {
    let productName = 'Product name unavailable';
    
    if (item.productId) {
      if (typeof item.productId === 'object' && item.productId.name) {
        productName = item.productId.name;
      } else if (typeof item.productId === 'object' && item.productId._id) {
        productName = 'Product name unavailable';
      } else {
        productName = 'Product name unavailable';
      }
    }
    
    const qty = item.qty || 0;
    const unitPrice = item.unitPrice || 0;
    const lineTotal = item.lineTotal || (unitPrice * qty);
    
    return `
      <tr>
        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${productName}</td>
        <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: center;">${qty}</td>
        <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right;">$${unitPrice.toFixed(2)}</td>
        <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: right;">$${lineTotal.toFixed(2)}</td>
      </tr>
    `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #28a745; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
        .content { background: #fff; padding: 20px; border: 1px solid #ddd; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .total { font-size: 18px; font-weight: bold; color: #28a745; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Order Confirmation</h1>
        </div>
        <div class="content">
          <p>Hello ${user.name},</p>
          <p>Thank you for your order!</p>
          <p style="margin: 10px 0; padding: 10px; background: #e8f4fd; border: 1px solid #bee5eb; border-radius: 4px;">
            <strong>Order ID:</strong> <code style="padding: 2px 6px; background: #fff; border-radius: 3px; font-size: 14px;">${getOrderDisplayId(order)}</code>
          </p>
          <p style="font-size: 12px; color: #666;">Save this Order ID — you will need it if you request a refund.</p>
          <table>
            <thead>
              <tr style="background: #f5f5f5;">
                <th style="padding: 10px; text-align: left;">Product</th>
                <th style="padding: 10px; text-align: center;">Qty</th>
                <th style="padding: 10px; text-align: right;">Price</th>
                <th style="padding: 10px; text-align: right;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsList}
            </tbody>
          </table>
          <div style="text-align: right; margin-top: 20px;">
            <p><strong>Subtotal:</strong> $${(order.subtotal ?? order.totalAmount).toFixed(2)}</p>
            ${order.discount > 0 ? `<p><strong>Discount:</strong> -$${order.discount.toFixed(2)}</p>` : ''}
            ${(order.buyerHandlingFee ?? order.handlingFee ?? 0) > 0 ? `<p><strong>Handling fee:</strong> $${(order.buyerHandlingFee ?? order.handlingFee ?? 0).toFixed(2)}</p>` : ''}
            <p class="total">Total: $${(order.grandTotal ?? order.totalAmount).toFixed(2)}</p>
          </div>
          <p>Your license keys will be sent to this email address shortly.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

export const payoutNotificationEmailTemplate = (payout, seller) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #17a2b8; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
        .content { background: #fff; padding: 20px; border: 1px solid #ddd; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Payout Processed</h1>
        </div>
        <div class="content">
          <p>Hello ${seller.shopName || 'Seller'},</p>
          <p>Your payout has been processed successfully!</p>
          <p><strong>Amount:</strong> $${payout.netAmount.toFixed(2)}</p>
          <p><strong>Commission:</strong> $${payout.adminCommission.toFixed(2)}</p>
          <p><strong>Status:</strong> ${payout.status}</p>
          ${payout.paypalTransactionId ? `<p><strong>Transaction ID:</strong> ${payout.paypalTransactionId}</p>` : ''}
          <p>The funds should appear in your PayPal account within 1-2 business days.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

export const sellerNewOrderEmailTemplate = ({
  sellerName,
  orderId,
  orderDate,
  buyerName,
  shippingAddress,
  dashboardUrl,
  items,
}) => {
  const rowsHtml = (items || []).map((item) => `
    <tr>
      <td style="padding: 10px; border-bottom: 1px solid #ddd;">${item.productName}</td>
      <td style="padding: 10px; border-bottom: 1px solid #ddd; text-align: center;">${item.quantity}</td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 640px; margin: 0 auto; padding: 20px; }
        .header { background: #4a90e2; color: #fff; padding: 18px; text-align: center; border-radius: 5px 5px 0 0; }
        .content { background: #fff; padding: 20px; border: 1px solid #ddd; }
        table { width: 100%; border-collapse: collapse; margin: 16px 0; }
        .cta { display: inline-block; margin-top: 14px; padding: 10px 16px; background: #4a90e2; color: #fff; text-decoration: none; border-radius: 4px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1 style="margin: 0;">New Order Received</h1>
        </div>
        <div class="content">
          <p>Hello ${sellerName || 'Seller'},</p>
          <p>You have received a new order for your product(s).</p>
          <p><strong>Order ID:</strong> ${orderId}</p>
          <p><strong>Buyer Name:</strong> ${buyerName || 'Guest Buyer'}</p>
          <p><strong>Order Date:</strong> ${orderDate}</p>
          <p><strong>Shipping Address:</strong> ${shippingAddress || 'Not applicable'}</p>

          <table>
            <thead>
              <tr style="background: #f5f5f5;">
                <th style="padding: 10px; text-align: left;">Product Name</th>
                <th style="padding: 10px; text-align: center;">Quantity</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>

          <a href="${dashboardUrl}" class="cta">View Orders</a>
        </div>
      </div>
    </body>
    </html>
  `;
};

// refundMethod: WALLET | ORIGINAL_PAYMENT (processing method)
export const refundIssuedSellerEmailTemplate = (orderNumber, productName, buyerName, refundAmount, refundType, payoutStatus, refundMethod = 'WALLET') => {
  const refundTypeLabel = refundType === 'full' ? 'Full' : 'Partial';
  const refundMethodLabel = (refundMethod || 'WALLET').toUpperCase().replace(/_/g, ' ');
  const payoutNote = payoutStatus === 'HELD'
    ? 'Payout for this order was still held; the refund has been deducted from your pending balance.'
    : 'Payout for this order had already been released; the refund has been deducted from your available balance.';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #dc3545; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
        .content { background: #fff; padding: 20px; border: 1px solid #ddd; }
        .summary { margin: 16px 0; padding: 12px 0; border-bottom: 1px solid #eee; }
        .summary p { margin: 6px 0; }
        .highlight { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 16px 0; border-radius: 3px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Refund Issued</h1>
        </div>
        <div class="content">
          <p>A refund of <strong>$${Number(refundAmount).toFixed(2)}</strong> has been issued for your product <strong>${productName}</strong>.</p>
          <div class="summary">
            <p><strong>Order:</strong> #${orderNumber}</p>
            <p><strong>Refund type:</strong> ${refundTypeLabel}</p>
            <p><strong>Refund method:</strong> ${refundMethodLabel}</p>
            ${buyerName ? `<p><strong>Buyer:</strong> ${buyerName}</p>` : ''}
          </div>
          <div class="highlight">
            <p style="margin: 0;"><strong>Payout status:</strong> ${payoutNote}</p>
          </div>
          <p>Please review the updated order details in your <a href="${process.env.FRONTEND_URL || ''}/seller/orders">seller dashboard</a>.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

export const refundRequestedSellerEmailTemplate = (orderNumber, productName, refundAmount, dashboardUrl) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #fd7e14; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
        .content { background: #fff; padding: 20px; border: 1px solid #ddd; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Refund Requested</h1>
        </div>
        <div class="content">
          <p>A customer has requested a refund for your product <strong>${productName}</strong>.</p>
          <p><strong>Order:</strong> #${orderNumber}</p>
          <p><strong>Requested amount:</strong> $${Number(refundAmount).toFixed(2)}</p>
          <p>Admin will review the request. You can view and add feedback in your <a href="${dashboardUrl}">seller dashboard</a>.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

export const sellerProfileSubmissionAdminEmailTemplate = ({
  sellerFullName,
  sellerEmail,
  storeName,
  submittedDocuments = [],
  submittedAt,
}) => {
  const docsHtml = submittedDocuments.length
    ? `<ul>${submittedDocuments.map((doc) => `<li><a href="${doc}" target="_blank" rel="noopener noreferrer">${doc}</a></li>`).join("")}</ul>`
    : "<p>No documents were attached.</p>";

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 640px; margin: 0 auto; padding: 20px; }
        .header { background: #0d6efd; color: #fff; padding: 18px; border-radius: 6px 6px 0 0; }
        .content { border: 1px solid #ddd; border-top: none; padding: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header"><h2 style="margin:0;">New Seller Profile Submission</h2></div>
        <div class="content">
          <p><strong>Seller full name:</strong> ${sellerFullName}</p>
          <p><strong>Email:</strong> ${sellerEmail}</p>
          <p><strong>Store name:</strong> ${storeName}</p>
          <p><strong>Submission date/time:</strong> ${submittedAt}</p>
          <h4>Submitted documents</h4>
          ${docsHtml}
        </div>
      </div>
    </body>
    </html>
  `;
};

export const sellerProfileSubmissionSellerEmailTemplate = ({ sellerName, storeName }) => `
  <!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"></head>
  <body style="font-family: Arial, sans-serif; color:#333;">
    <div style="max-width:640px;margin:0 auto;padding:20px;">
      <h2>Seller Profile Submitted</h2>
      <p>Hello ${sellerName},</p>
      <p>We have received your seller profile for <strong>${storeName}</strong>.</p>
      <p>Our admin team will review your details and contact you after the review is complete.</p>
      <p>Thank you for joining DGMARQ.</p>
    </div>
  </body>
  </html>
`;

export const sellerProfileApprovedEmailTemplate = ({ sellerName, storeName, nextStepsUrl }) => `
  <!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"></head>
  <body style="font-family: Arial, sans-serif; color:#333;">
    <div style="max-width:640px;margin:0 auto;padding:20px;">
      <h2>Your Seller Profile Has Been Approved</h2>
      <p>Congratulations ${sellerName}!</p>
      <p>Your seller profile for <strong>${storeName}</strong> has been approved.</p>
      <p>Next steps: start adding products and set up your seller storefront.</p>
      <p><a href="${nextStepsUrl}">Go to Seller Dashboard</a></p>
    </div>
  </body>
  </html>
`;

export const sellerProfileRejectedEmailTemplate = ({ sellerName, storeName, reason }) => `
  <!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"></head>
  <body style="font-family: Arial, sans-serif; color:#333;">
    <div style="max-width:640px;margin:0 auto;padding:20px;">
      <h2>Your Seller Profile Has Been Rejected</h2>
      <p>Hello ${sellerName},</p>
      <p>Your seller profile for <strong>${storeName}</strong> was not approved at this time.</p>
      ${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : "<p>No specific reason was provided.</p>"}
      <p>You can update your details and submit again.</p>
    </div>
  </body>
  </html>
`;

export const supportTicketCreatedAdminEmailTemplate = ({
  ticketId,
  userName,
  userEmail,
  subject,
  message,
  createdAt,
}) => `
  <!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"></head>
  <body style="font-family: Arial, sans-serif; color:#333;">
    <div style="max-width:640px;margin:0 auto;padding:20px;">
      <h2>New Support Ticket Created</h2>
      <p><strong>Ticket ID:</strong> ${ticketId}</p>
      <p><strong>User name:</strong> ${userName}</p>
      <p><strong>User email:</strong> ${userEmail}</p>
      <p><strong>Subject:</strong> ${subject}</p>
      <p><strong>Message:</strong> ${message}</p>
      <p><strong>Created date:</strong> ${createdAt}</p>
    </div>
  </body>
  </html>
`;

export const refundRequestAdminEmailTemplate = (details) => `
  <!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"></head>
  <body style="font-family: Arial, sans-serif; color:#333;">
    <div style="max-width:700px;margin:0 auto;padding:20px;">
      <h2>New Refund/Return Request</h2>
      <p><strong>Refund Request ID:</strong> ${details.refundRequestId}</p>
      <p><strong>Order ID:</strong> ${details.orderId}</p>
      <p><strong>Product Name:</strong> ${details.productName}</p>
      <p><strong>Product ID:</strong> ${details.productId}</p>
      <p><strong>Seller Name:</strong> ${details.sellerName}</p>
      <p><strong>Seller ID:</strong> ${details.sellerId}</p>
      <p><strong>Customer Name:</strong> ${details.customerName}</p>
      <p><strong>Customer ID:</strong> ${details.customerId}</p>
      <p><strong>Refund Reason:</strong> ${details.refundReason}</p>
      <p><strong>Order Date:</strong> ${details.orderDate}</p>
      <p><strong>Refund Request Date:</strong> ${details.refundRequestDate}</p>
      <p><strong>Payment ID:</strong> ${details.paymentId || "N/A"}</p>
      <p><strong>Refund Amount:</strong> $${Number(details.refundAmount || 0).toFixed(2)}</p>
    </div>
  </body>
  </html>
`;

export const refundDecisionCustomerEmailTemplate = ({ approved, customerName, refundId, amount, reason }) => `
  <!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"></head>
  <body style="font-family: Arial, sans-serif; color:#333;">
    <div style="max-width:640px;margin:0 auto;padding:20px;">
      <h2>${approved ? "Your Refund Request Was Approved" : "Your Refund Request Was Rejected"}</h2>
      <p>Hello ${customerName},</p>
      <p>Refund Request ID: <strong>${refundId}</strong></p>
      <p>Status: <strong>${approved ? "Approved" : "Rejected"}</strong></p>
      ${approved ? `<p>Refund amount: <strong>$${Number(amount || 0).toFixed(2)}</strong></p>` : ""}
      ${!approved && reason ? `<p><strong>Rejection reason:</strong> ${reason}</p>` : ""}
    </div>
  </body>
  </html>
`;

export const refundDecisionSellerEmailTemplate = ({ approved, sellerName, refundId, amount, reason }) => `
  <!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"></head>
  <body style="font-family: Arial, sans-serif; color:#333;">
    <div style="max-width:640px;margin:0 auto;padding:20px;">
      <h2>${approved ? "A Refund Request Was Approved" : "A Refund Request Was Rejected"}</h2>
      <p>Hello ${sellerName},</p>
      <p>Refund Request ID: <strong>${refundId}</strong></p>
      <p>Status: <strong>${approved ? "Approved" : "Rejected"}</strong></p>
      ${approved ? `<p>Refund amount: <strong>$${Number(amount || 0).toFixed(2)}</strong></p>` : ""}
      ${!approved && reason ? `<p><strong>Rejection reason:</strong> ${reason}</p>` : ""}
    </div>
  </body>
  </html>
`;

export const refundSellerInputRequestEmailTemplate = ({
  refundId,
  orderNumber,
  productName,
  customerName,
  adminMessage,
  dashboardUrl,
}) => `
  <!DOCTYPE html>
  <html>
  <head><meta charset="utf-8"></head>
  <body style="font-family: Arial, sans-serif; color:#333;">
    <div style="max-width:640px;margin:0 auto;padding:20px;">
      <h2>Admin Requested Your Input on a Refund</h2>
      <p>Hello,</p>
      <p>An admin has requested your input on a refund request.</p>
      <p><strong>Refund ID:</strong> ${refundId}</p>
      <p><strong>Order:</strong> #${orderNumber}</p>
      <p><strong>Product:</strong> ${productName}</p>
      <p><strong>Customer:</strong> ${customerName}</p>
      ${
        adminMessage
          ? `<p><strong>Message from admin:</strong></p><p style="padding:10px;border-left:3px solid #ccc;background:#f9f9f9;">${adminMessage}</p>`
          : ""
      }
      <p>Please review this refund and reply in your <a href="${dashboardUrl}">seller dashboard</a> as soon as possible.</p>
    </div>
  </body>
  </html>
`;

