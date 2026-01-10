/**
 * Email templates for the marketplace
 */

export const licenseKeyEmailTemplate = (order, keys, user) => {
  const keysList = keys.map((key, index) => {
    // FIX: Handle populated productId (object) or direct ObjectId
    const product = order.items[index]?.productId;
    const productName = product?.name || 
                       (typeof product === 'object' && product?.name) || 
                       'Product';
    const isAccount = product?.productType === 'ACCOUNT_BASED' || 
                     (typeof product === 'object' && product?.productType === 'ACCOUNT_BASED');
    
    // Parse account credentials if it's an account product
    let keyDisplay = key;
    let accountDetails = null;
    if (isAccount && typeof key === 'string') {
      try {
        accountDetails = JSON.parse(key);
      } catch (e) {
        // If parsing fails, display as string
        accountDetails = null;
      }
    }
    
    return `
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
          ${keysList}
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
  // FIX: Handle populated productId (object) or direct ObjectId
  const itemsList = order.items.map(item => {
    const productName = item.productId?.name || 
                       (typeof item.productId === 'object' && item.productId?.name) || 
                       'Product';
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
            <p><strong>Subtotal:</strong> $${order.subtotal.toFixed(2)}</p>
            ${order.discount > 0 ? `<p><strong>Discount:</strong> -$${order.discount.toFixed(2)}</p>` : ''}
            <p class="total">Total: $${order.totalAmount.toFixed(2)}</p>
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

