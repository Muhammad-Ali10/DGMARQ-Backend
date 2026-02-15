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
              ${accountDetails.username ? `<p style="margin: 5px 0;"><strong>Username:</strong> <code style="padding: 4px 8px; background: #f8f9fa; border-radius: 3px; font-size: 14px;">${accountDetails.username}</code></p>` : ''}
              ${accountDetails.password ? `<p style="margin: 5px 0;"><strong>Password:</strong> <code style="padding: 4px 8px; background: #f8f9fa; border-radius: 3px; font-size: 14px; font-weight: bold; color: #2c3e50;">${accountDetails.password}</code></p>` : ''}
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
          <p>Thank you for your purchase! Your order #${order._id} has been completed.</p>
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
          <p>Thank you for your order! Your order #${order._id} has been received.</p>
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

