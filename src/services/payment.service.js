import paypal from '@paypal/checkout-server-sdk';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';

// Purpose: Configures and returns the PayPal environment based on settings
const environment = () => {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const paypalEnv = process.env.PAYPAL_ENV || 'sandbox'; 

  if (!clientId || clientId.trim() === '' || clientId === 'your_paypal_client_id') {
    throw new Error('PayPal CLIENT_ID is missing or not configured. Please set PAYPAL_CLIENT_ID in your .env file.');
  }

  if (!clientSecret || clientSecret.trim() === '' || clientSecret === 'your_paypal_client_secret') {
    throw new Error('PayPal CLIENT_SECRET is missing or not configured. Please set PAYPAL_CLIENT_SECRET in your .env file.');
  }

  const isProduction = paypalEnv.toLowerCase() === 'production';
  logger.info(`PayPal Environment: ${isProduction ? 'PRODUCTION' : 'SANDBOX'}`);
  logger.debug(`PayPal Client ID: ${clientId.substring(0, 10)}...${clientId.substring(clientId.length - 4)}`);

  if (isProduction) {
    return new paypal.core.LiveEnvironment(clientId, clientSecret);
  }
  return new paypal.core.SandboxEnvironment(clientId, clientSecret);
};

// Purpose: Creates and returns a PayPal HTTP client instance
const client = () => {
  return new paypal.core.PayPalHttpClient(environment());
};

// Purpose: Creates a PayPal order for payment processing using admin credentials
export const createPayPalOrder = async (orderData) => {
  try {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    
    if (!clientId || clientId.trim() === '' || clientId === 'your_paypal_client_id') {
      throw new Error('PayPal CLIENT_ID is missing or not configured. Please set PAYPAL_CLIENT_ID in your .env file.');
    }
    
    if (!clientSecret || clientSecret.trim() === '' || clientSecret === 'your_paypal_client_secret') {
      throw new Error('PayPal CLIENT_SECRET is missing or not configured. Please set PAYPAL_CLIENT_SECRET in your .env file.');
    }

    const currencyCode = orderData.currency && orderData.currency === 'USD' ? 'USD' : 'USD';
    if (orderData.currency && orderData.currency !== 'USD') {
      throw new Error(`Currency must be USD. Received: ${orderData.currency}`);
    }
    
    let itemTotalCents = 0;
    const items = orderData.items.map(item => {
      const unitAmount = typeof item.unit_amount === 'number' ? item.unit_amount : parseFloat(item.unit_amount);
      const quantity = typeof item.quantity === 'number' ? item.quantity : parseFloat(item.quantity);
      
      const unitAmountCents = Math.round(unitAmount * 100);
      const lineTotalCents = unitAmountCents * quantity;
      itemTotalCents += lineTotalCents;
      
      return {
        name: item.name,
        quantity: quantity.toString(),
        unit_amount: {
          currency_code: currencyCode,
          value: unitAmount.toFixed(2),
        },
      };
    });
    
    const itemTotal = (itemTotalCents / 100).toFixed(2);
    
    const taxTotal = orderData.tax_total ? parseFloat(orderData.tax_total).toFixed(2) : '0.00';
    const shipping = orderData.shipping ? parseFloat(orderData.shipping).toFixed(2) : '0.00';
    const handling = orderData.handling ? parseFloat(orderData.handling).toFixed(2) : '0.00';
    const discount = orderData.discount ? parseFloat(orderData.discount).toFixed(2) : '0.00';
    
    const finalAmountCents = 
      itemTotalCents + 
      Math.round(parseFloat(taxTotal) * 100) + 
      Math.round(parseFloat(shipping) * 100) + 
      Math.round(parseFloat(handling) * 100) - 
      Math.round(parseFloat(discount) * 100);
    
    const finalAmount = (finalAmountCents / 100).toFixed(2);
    
    const breakdown = {
      item_total: {
        currency_code: currencyCode,
        value: itemTotal,
      },
    };
    
    if (parseFloat(taxTotal) > 0) {
      breakdown.tax_total = {
        currency_code: currencyCode,
        value: taxTotal,
      };
    }
    
    if (parseFloat(shipping) > 0) {
      breakdown.shipping = {
        currency_code: currencyCode,
        value: shipping,
      };
    }
    
    if (parseFloat(handling) > 0) {
      breakdown.handling = {
        currency_code: currencyCode,
        value: handling,
      };
    }
    
    if (parseFloat(discount) > 0) {
      breakdown.discount = {
        currency_code: currencyCode,
        value: discount,
      };
    }

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: {
            currency_code: currencyCode,
            value: finalAmount,
            breakdown: breakdown,
          },
          items: items,
        },
      ],
      application_context: {
        brand_name: 'DGMARQ',
        landing_page: 'NO_PREFERENCE',
        user_action: 'PAY_NOW',
        return_url: `${process.env.FRONTEND_URL}/checkout/success`,
        cancel_url: `${process.env.FRONTEND_URL}/checkout/cancel`,
      },
    });

    const order = await client().execute(request);
    
    logger.info(`PayPal order created: ${order.result.id} - Payment will be captured to ADMIN account`);
    
    return {
      id: order.result.id,
      status: order.result.status,
      links: order.result.links,
      payerId: order.result.payer?.payer_id || null,
    };
  } catch (error) {
    logger.error('PayPal order creation failed', error);
    
    if (error.message?.includes('invalid_client') || error.message?.includes('Client Authentication failed')) {
      const paypalEnv = process.env.PAYPAL_ENV || 'sandbox';
      const isProduction = paypalEnv.toLowerCase() === 'production';
      
      throw new Error(
        `PayPal authentication failed. Please check:\n` +
        `1. PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are correct in your .env file\n` +
        `2. Credentials match the environment (${isProduction ? 'PRODUCTION' : 'SANDBOX'})\n` +
        `3. If using SANDBOX, get credentials from: https://developer.paypal.com/dashboard/\n` +
        `4. If using PRODUCTION, get credentials from: https://www.paypal.com/businessmanage/account/credentials\n` +
        `5. Current environment setting: PAYPAL_ENV=${paypalEnv}\n` +
        `Original error: ${error.message}`
      );
    }
    
    throw new Error(`PayPal order creation failed: ${error.message}`);
  }
};

// Purpose: Captures a PayPal payment for an approved order into admin account
export const capturePayPalPayment = async (orderId) => {
  try {
    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});

    const capture = await client().execute(request);
    const captureData = capture.result.purchase_units[0]?.payments?.captures[0];
    
    const payee = captureData?.payee;
    if (payee) {
      logger.info(`Payment captured - Receiver: ${payee.email || payee.merchant_id || 'Admin Account'}`);
    }
    
    return {
      id: capture.result.id,
      status: capture.result.status,
      captureId: captureData?.id,
      amount: captureData?.amount?.value,
      payerId: capture.result.payer?.payer_id || null,
      payee: payee || null,
    };
  } catch (error) {
    logger.error('PayPal payment capture failed', error);
    throw new Error(`PayPal payment capture failed: ${error.message}`);
  }
};

// Purpose: Retrieves PayPal order details by order ID
export const getPayPalOrder = async (orderId) => {
  try {
    const request = new paypal.orders.OrdersGetRequest(orderId);
    const order = await client().execute(request);
    return order.result;
  } catch (error) {
    logger.error('Failed to get PayPal order', error);
    throw new Error(`Failed to get PayPal order: ${error.message}`);
  }
};

// Purpose: Creates a PayPal order for advanced checkout using card fields
export const createPayPalOrderForCheckout = async (orderData) => {
  try {
    if (orderData.currency && orderData.currency !== 'USD') {
      throw new Error(`Currency must be USD. Received: ${orderData.currency}`);
    }
    
    const currencyCode = 'USD';
    let finalAmount;
    let breakdown;
    let items;

    // When explicit amount is provided (e.g. cardAmount when wallet is used), create order for that amount only
    const explicitAmount = orderData.amount != null && typeof orderData.amount === 'number' && orderData.amount > 0
      ? Number(Number(orderData.amount).toFixed(2))
      : null;

    if (explicitAmount !== null) {
      finalAmount = explicitAmount.toFixed(2);
      breakdown = {
        item_total: {
          currency_code: currencyCode,
          value: finalAmount,
        },
      };
      items = [
        {
          name: 'Order',
          quantity: '1',
          unit_amount: {
            currency_code: currencyCode,
            value: finalAmount,
          },
        },
      ];
      logger.debug('[PAYPAL ORDERS] Creating order with explicit amount', { amount: finalAmount });
    } else {
      let itemTotalCents = 0;
      items = orderData.items.map(item => {
        const unitAmount = typeof item.unit_amount === 'number' ? item.unit_amount : parseFloat(item.unit_amount);
        const quantity = typeof item.quantity === 'number' ? item.quantity : parseFloat(item.quantity);
        
        const unitAmountCents = Math.round(unitAmount * 100);
        const lineTotalCents = unitAmountCents * quantity;
        itemTotalCents += lineTotalCents;
        
        return {
          name: item.name,
          quantity: quantity.toString(),
          unit_amount: {
            currency_code: currencyCode,
            value: Number(unitAmount).toFixed(2),
          },
        };
      });
      
      const itemTotal = (itemTotalCents / 100).toFixed(2);
      
      const taxTotal = orderData.tax_total ? parseFloat(orderData.tax_total).toFixed(2) : '0.00';
      const shipping = orderData.shipping ? parseFloat(orderData.shipping).toFixed(2) : '0.00';
      const handling = orderData.handling ? parseFloat(orderData.handling).toFixed(2) : '0.00';
      const discount = orderData.discount ? parseFloat(orderData.discount).toFixed(2) : '0.00';
      
      const finalAmountCents = 
        itemTotalCents + 
        Math.round(parseFloat(taxTotal) * 100) + 
        Math.round(parseFloat(shipping) * 100) + 
        Math.round(parseFloat(handling) * 100) - 
        Math.round(parseFloat(discount) * 100);
      
      finalAmount = Number(finalAmountCents / 100).toFixed(2);
      
      breakdown = {
        item_total: {
          currency_code: currencyCode,
          value: itemTotal,
        },
      };
      
      if (parseFloat(taxTotal) > 0) {
        breakdown.tax_total = {
          currency_code: currencyCode,
          value: taxTotal,
        };
      }
      
      if (parseFloat(shipping) > 0) {
        breakdown.shipping = {
          currency_code: currencyCode,
          value: shipping,
        };
      }
      
      if (parseFloat(handling) > 0) {
        breakdown.handling = {
          currency_code: currencyCode,
          value: handling,
        };
      }
      
      if (parseFloat(discount) > 0) {
        breakdown.discount = {
          currency_code: currencyCode,
          value: discount,
        };
      }
    }

    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: {
            currency_code: currencyCode,
            value: finalAmount,
            breakdown: breakdown,
          },
          items: items,
        },
      ],
    });

    logger.debug('[PAYPAL ORDERS] Creating order', {
      currency: currencyCode,
      amount: finalAmount,
      itemCount: items.length,
    });
    
    const order = await client().execute(request);
    
    logger.info('[PAYPAL ORDERS] Order created', {
      orderId: order.result.id,
      status: order.result.status,
    });
    
    return {
      ok: true,
      orderId: order.result.id,
      status: order.result.status,
    };
  } catch (error) {
    logger.error('[PAYPAL ORDERS] Create order error', {
      error: error.message,
      statusCode: error.statusCode,
    });
    throw new Error(`PayPal order creation failed: ${error.message}`);
  }
};

// Purpose: Captures a PayPal order for checkout with validation checks
export const capturePayPalOrderForCheckout = async (orderId) => {
  try {
    if (!orderId) {
      throw new Error('Order ID is required');
    }

    logger.debug('[PAYPAL ORDERS] Capturing order', { orderId });

    try {
      const orderRequest = new paypal.orders.OrdersGetRequest(orderId);
      const orderResponse = await client().execute(orderRequest);
      const orderStatus = orderResponse.result.status;
      
      logger.debug('[PAYPAL ORDERS] Order status before capture', {
        orderId,
        status: orderStatus,
      });
      
      if (orderStatus !== 'APPROVED') {
        throw new Error(`Order is not in APPROVED state. Current status: ${orderStatus}`);
      }
    } catch (orderError) {
      logger.error('[PAYPAL ORDERS] Order verification failed before capture', {
        orderId,
        error: orderError.message,
      });
      throw new Error(`Order verification failed: ${orderError.message}`);
    }

    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});
    
    const capture = await client().execute(request);
    
    const captureData = capture.result.purchase_units?.[0]?.payments?.captures?.[0];
    
    if (!captureData) {
      logger.error('[PAYPAL ORDERS] Capture data not found in response', {
        orderId,
        fullResponse: JSON.stringify(capture.result, null, 2),
      });
      throw new Error('Capture data not found in PayPal response');
    }
    
    const capturedAmount = captureData.amount?.value ? parseFloat(captureData.amount.value) : null;
    const capturedCurrency = captureData.amount?.currency_code || 'USD';
    const captureStatus = captureData.status || capture.result.status;
    
    if (captureStatus !== 'COMPLETED') {
      logger.error('[PAYPAL ORDERS] Capture not completed', {
        orderId,
        status: captureStatus,
        captureId: captureData.id,
      });
      throw new Error(`Payment capture not completed. Status: ${captureStatus}`);
    }
    
    logger.info('[PAYPAL ORDERS] Order captured successfully', {
      orderId: capture.result.id,
      status: captureStatus,
      captureId: captureData.id,
      amount: capturedAmount,
      currency: capturedCurrency,
    });
    
    return {
      ok: true,
      captureId: captureData.id,
      status: captureStatus, // Use capture status, not order status
      amount: capturedAmount,
      currency: capturedCurrency,
      fullCaptureData: captureData,
    };
  } catch (error) {
    logger.error('[PAYPAL ORDERS] Capture error', {
      error: error.message,
      statusCode: error.statusCode,
      orderId,
      stack: error.stack,
    });
    
    if (error.statusCode === 422) {
      throw new Error('Order cannot be captured. It may have already been captured or is in an invalid state.');
    } else if (error.statusCode === 404) {
      throw new Error('Order not found. Please verify the order ID.');
    } else if (error.statusCode === 400) {
      throw new Error(`Invalid request: ${error.message}`);
    }
    
    throw new Error(`PayPal capture failed: ${error.message}`);
  }
};

// Purpose: Builds PayPal OAuth authorize URL for seller Connect flow (no email-only)
export const getPayPalOAuthAuthorizeUrl = (state, redirectUri) => {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  if (!clientId || clientId.trim() === '' || clientId === 'your_paypal_client_id') {
    throw new Error('PayPal CLIENT_ID is missing or not configured.');
  }
  const baseUrl = process.env.PAYPAL_ENV === 'production'
    ? 'https://www.paypal.com'
    : 'https://www.sandbox.paypal.com';
  const scope = encodeURIComponent('openid email profile');
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: redirectUri,
    state: state,
  });
  return `${baseUrl}/connect/oauth2/authorize?${params.toString()}`;
};

// Purpose: Exchanges PayPal OAuth authorization code for access token
export const exchangePayPalOAuthCode = async (code, redirectUri) => {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const paypalEnv = process.env.PAYPAL_ENV || 'sandbox';
  const baseUrl = paypalEnv.toLowerCase() === 'production'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

  if (!clientId || !clientSecret) {
    throw new Error('PayPal credentials not configured.');
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  }).toString();

  const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${auth}`,
    },
    body,
  });

  if (!response.ok) {
    const errText = await response.text();
    logger.error('PayPal OAuth token exchange failed', { status: response.status, body: errText });
    throw new Error(`PayPal OAuth failed: ${errText}`);
  }

  return await response.json();
};

// Purpose: Fetches PayPal user info (merchant id, email, verified) for seller onboarding
export const getPayPalUserInfo = async (accessToken) => {
  const paypalEnv = process.env.PAYPAL_ENV || 'sandbox';
  const baseUrl = paypalEnv.toLowerCase() === 'production'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';

  const response = await fetch(`${baseUrl}/v1/identity/oauth2/userinfo?schema=openid`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    logger.error('PayPal userinfo failed', { status: response.status, body: errText });
    throw new Error(`PayPal userinfo failed: ${errText}`);
  }

  const data = await response.json();
  const merchantId = data.user_id || data.sub || null;
  const email = data.email || null;
  const emailVerified = data.email_verified === true || data.verified === true;
  const accountStatus = emailVerified ? 'verified' : 'unverified';

  return {
    paypalMerchantId: merchantId,
    paypalEmail: email,
    emailVerified,
    accountStatus,
    paymentsReceivable: true, // OAuth-connected accounts can receive; PayPal will reject if limited
  };
};

// Purpose: Creates a PayPal payout. Use merchantId when available (never email-only for verified sellers).
// options: { useMerchantId: boolean } - when true, recipient is PayPal merchant/user ID (PAYPAL_ID).
export const createPayPalPayout = async (recipient, amount, currency = 'USD', options = {}) => {
  try {
    const accessToken = await getPayPalAccessToken();
    const batchId = `PAYOUT-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    const useMerchantId = options.useMerchantId === true && recipient;

    if (!recipient) {
      throw new Error('PayPal payout requires recipient (merchant ID or email). Missing paypalMerchantId.');
    }

    const item = {
      amount: {
        value: Number(amount).toFixed(2),
        currency: currency,
      },
      note: 'Payout from DGMARQ marketplace',
      sender_item_id: `ITEM-${Date.now()}`,
    };

    if (useMerchantId) {
      item.recipient_type = 'PAYPAL_ID';
      item.receiver = recipient;
    } else {
      item.recipient_type = 'EMAIL';
      item.receiver = recipient;
    }

    const payoutData = {
      sender_batch_header: {
        sender_batch_id: batchId,
        email_subject: 'You have a payout from DGMARQ',
        email_message: 'You have received a payout from DGMARQ marketplace.',
      },
      items: [item],
    };

    const baseUrl = process.env.PAYPAL_ENV === 'production'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com';

    const response = await fetch(`${baseUrl}/v1/payments/payouts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payoutData),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const msg = errorData.message || errorData.details?.[0]?.issue || JSON.stringify(errorData);
      throw new Error(`PayPal payout failed: ${msg}`);
    }

    const payout = await response.json();
    const batchHeader = payout.batch_header;

    return {
      batchId: batchHeader.payout_batch_id,
      itemId: payout.items?.[0]?.payout_item_id || null,
      status: batchHeader.batch_status,
      links: payout.links,
    };
  } catch (error) {
    logger.error('PayPal payout creation failed', error);
    throw new Error(`PayPal payout creation failed: ${error.message}`);
  }
};

// Purpose: Gets PayPal access token for Payouts API authentication
const getPayPalAccessToken = async () => {
  try {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    const paypalEnv = process.env.PAYPAL_ENV || 'sandbox';

    if (!clientId || clientId.trim() === '' || clientId === 'your_paypal_client_id') {
      throw new Error('PayPal CLIENT_ID is missing or not configured. Please set PAYPAL_CLIENT_ID in your .env file.');
    }

    if (!clientSecret || clientSecret.trim() === '' || clientSecret === 'your_paypal_client_secret') {
      throw new Error('PayPal CLIENT_SECRET is missing or not configured. Please set PAYPAL_CLIENT_SECRET in your .env file.');
    }

    const isProduction = paypalEnv.toLowerCase() === 'production';
    const baseUrl = isProduction
      ? 'https://api-m.paypal.com' 
      : 'https://api-m.sandbox.paypal.com';

    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await fetch(`${baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Language': 'en_US',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${auth}`,
      },
      body: 'grant_type=client_credentials',
    });

    if (!response.ok) {
      const errorData = await response.text();
      let errorMessage = `Failed to get PayPal access token: ${errorData}`;
      
      if (errorData.includes('invalid_client') || errorData.includes('Client Authentication failed')) {
        errorMessage = `PayPal authentication failed. Please check:\n` +
          `1. PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are correct\n` +
          `2. Credentials match the environment (${isProduction ? 'PRODUCTION' : 'SANDBOX'})\n` +
          `3. Current environment: PAYPAL_ENV=${paypalEnv}\n` +
          `4. Original error: ${errorData}`;
      }
      
      throw new Error(errorMessage);
    }

    const data = await response.json();
    return data.access_token;
  } catch (error) {
    logger.error('PayPal access token error', error);
    throw new Error(`Failed to get PayPal access token: ${error.message}`);
  }
};

// Purpose: Validates if an email has valid format for PayPal payouts
export const validatePayPalEmail = async (email) => {
  try {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        isValid: false,
        error: 'Invalid email format',
      };
    }
    
    return {
      isValid: true,
      message: 'Email format is valid. Account will be verified during first payout.',
    };
  } catch (error) {
    logger.error('PayPal email validation error', error);
    return {
      isValid: false,
      error: error.message,
    };
  }
};

// Purpose: Verifies PayPal webhook signature using PayPal's verification API
export const verifyPayPalWebhook = async (req) => {
  try {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) {
      logger.warn('PayPal webhook ID not configured - skipping verification');
      return process.env.NODE_ENV !== 'production';
    }

    const transmissionId = req.headers['paypal-transmission-id'] || req.headers['PAYPAL-TRANSMISSION-ID'];
    const transmissionTime = req.headers['paypal-transmission-time'] || req.headers['PAYPAL-TRANSMISSION-TIME'];
    const certUrl = req.headers['paypal-cert-url'] || req.headers['PAYPAL-CERT-URL'];
    const authAlgo = req.headers['paypal-auth-algo'] || req.headers['PAYPAL-AUTH-ALGO'];
    const transmissionSig = req.headers['paypal-transmission-sig'] || req.headers['PAYPAL-TRANSMISSION-SIG'];

    if (!transmissionId || !transmissionTime || !certUrl || !authAlgo || !transmissionSig) {
      logger.error('[WEBHOOK] Missing required PayPal webhook transmission headers', {
        transmissionId: !!transmissionId,
        transmissionTime: !!transmissionTime,
        certUrl: !!certUrl,
        authAlgo: !!authAlgo,
        transmissionSig: !!transmissionSig,
        webhookId: webhookId ? 'configured' : 'missing',
      });
      return false;
    }

    let webhookEvent;
    if (Buffer.isBuffer(req.body)) {
      webhookEvent = req.body.toString('utf8');
    } else if (typeof req.body === 'string') {
      webhookEvent = req.body;
    } else {
      webhookEvent = JSON.stringify(req.body);
    }

    let parsedWebhookEvent;
    try {
      parsedWebhookEvent = JSON.parse(webhookEvent);
    } catch (parseError) {
      logger.error('Invalid JSON in webhook body', parseError);
      return false;
    }

    const accessToken = await getPayPalAccessToken();

    const verificationPayload = {
      transmission_id: transmissionId,
      transmission_time: transmissionTime,
      cert_url: certUrl,
      auth_algo: authAlgo,
      transmission_sig: transmissionSig,
      webhook_id: webhookId,
      webhook_event: parsedWebhookEvent,
    };

    const baseUrl = process.env.PAYPAL_ENV === 'production' 
      ? 'https://api-m.paypal.com' 
      : 'https://api-m.sandbox.paypal.com';

    const response = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(verificationPayload),
    });

    if (!response.ok) {
      const errorData = await response.text();
      logger.error('PayPal webhook verification API error', {
        status: response.status,
        statusText: response.statusText,
        error: errorData,
      });
      return false;
    }

    const verificationResult = await response.json();

    if (verificationResult.verification_status === 'SUCCESS') {
      logger.info('[WEBHOOK] PayPal webhook signature verified successfully', {
        webhookId: webhookId,
        transmissionId: transmissionId,
      });
      return true;
    } else {
      logger.error('[WEBHOOK] PayPal webhook signature verification failed', {
        status: verificationResult.verification_status,
        webhookId: webhookId,
        transmissionId: transmissionId,
        details: verificationResult,
      });
      return false;
    }
  } catch (error) {
    logger.error('Error verifying PayPal webhook signature', error);
    return false;
  }
};

// Purpose: Processes a PayPal refund for a captured payment
export const processRefund = async (captureId, amount, currency = 'USD') => {
  try {
    const request = new paypal.payments.CapturesRefundRequest(captureId);
    request.requestBody({
      amount: {
        value: amount.toFixed(2),
        currency_code: currency,
      },
    });

    const refund = await client().execute(request);
    return {
      id: refund.result.id,
      status: refund.result.status,
      amount: refund.result.amount?.value,
    };
  } catch (error) {
    logger.error('PayPal refund failed', error);
    throw new Error(`PayPal refund failed: ${error.message}`);
  }
};

// Purpose: Creates a PayPal subscription plan for recurring billing
export const createPayPalSubscriptionPlan = async (planData) => {
  try {
    const accessToken = await getPayPalAccessToken();
    const baseUrl = process.env.PAYPAL_ENV === 'production' 
      ? 'https://api-m.paypal.com' 
      : 'https://api-m.sandbox.paypal.com';

    const plan = {
      product_id: planData.productId || 'DGMARQ_PLUS',
      name: planData.name || 'DGMARQ+ Monthly Subscription',
      description: planData.description || 'Monthly subscription to DGMARQ+ with 2% discount on all purchases',
      status: 'ACTIVE',
      billing_cycles: [
        {
          frequency: {
            interval_unit: 'MONTH',
            interval_count: 1,
          },
          tenure_type: 'REGULAR',
          sequence: 1,
          total_cycles: 0, // 0 = infinite
          pricing_scheme: {
            fixed_price: {
              value: planData.price.toFixed(2),
              currency_code: planData.currency || 'EUR',
            },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee: {
          value: '0',
          currency_code: planData.currency || 'EUR',
        },
        setup_fee_failure_action: 'CONTINUE',
        payment_failure_threshold: 3,
      },
    };

    const response = await fetch(`${baseUrl}/v1/billing/plans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(plan),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`PayPal plan creation failed: ${errorData.message || JSON.stringify(errorData)}`);
    }

    const result = await response.json();
    return {
      id: result.id,
      status: result.status,
    };
  } catch (error) {
    logger.error('PayPal subscription plan creation failed', error);
    throw new Error(`PayPal subscription plan creation failed: ${error.message}`);
  }
};

// Purpose: Creates a PayPal subscription for recurring billing
export const createPayPalSubscription = async (planId, returnUrl, cancelUrl) => {
  try {
    const accessToken = await getPayPalAccessToken();
    const baseUrl = process.env.PAYPAL_ENV === 'production' 
      ? 'https://api-m.paypal.com' 
      : 'https://api-m.sandbox.paypal.com';

    const subscription = {
      plan_id: planId,
      start_time: new Date(Date.now() + 60000).toISOString(),
      subscriber: {
        name: {
          given_name: 'DGMARQ',
          surname: 'User',
        },
      },
      application_context: {
        brand_name: 'DGMARQ',
        locale: 'en-US',
        shipping_preference: 'NO_SHIPPING',
        user_action: 'SUBSCRIBE_NOW',
        payment_method: {
          payer_selected: 'PAYPAL',
          payee_preferred: 'IMMEDIATE_PAYMENT_REQUIRED',
        },
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    };

    const response = await fetch(`${baseUrl}/v1/billing/subscriptions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(subscription),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`PayPal subscription creation failed: ${errorData.message || JSON.stringify(errorData)}`);
    }

    const result = await response.json();
    return {
      id: result.id,
      status: result.status,
      links: result.links,
    };
  } catch (error) {
    logger.error('PayPal subscription creation failed', error);
    throw new Error(`PayPal subscription creation failed: ${error.message}`);
  }
};

// Purpose: Retrieves PayPal subscription details by subscription ID
export const getPayPalSubscription = async (subscriptionId) => {
  try {
    const accessToken = await getPayPalAccessToken();
    const baseUrl = process.env.PAYPAL_ENV === 'production' 
      ? 'https://api-m.paypal.com' 
      : 'https://api-m.sandbox.paypal.com';

    const response = await fetch(`${baseUrl}/v1/billing/subscriptions/${subscriptionId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Failed to get PayPal subscription: ${errorData.message || JSON.stringify(errorData)}`);
    }

    return await response.json();
  } catch (error) {
    logger.error('Failed to get PayPal subscription', error);
    throw new Error(`Failed to get PayPal subscription: ${error.message}`);
  }
};

// Purpose: Cancels a PayPal subscription with reason
export const cancelPayPalSubscription = async (subscriptionId, reason = 'User requested cancellation') => {
  try {
    const accessToken = await getPayPalAccessToken();
    const baseUrl = process.env.PAYPAL_ENV === 'production' 
      ? 'https://api-m.paypal.com' 
      : 'https://api-m.sandbox.paypal.com';

    const response = await fetch(`${baseUrl}/v1/billing/subscriptions/${subscriptionId}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        reason,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`PayPal subscription cancellation failed: ${errorData.message || JSON.stringify(errorData)}`);
    }

    return { success: true };
  } catch (error) {
    logger.error('PayPal subscription cancellation failed', error);
    throw new Error(`PayPal subscription cancellation failed: ${error.message}`);
  }
};

