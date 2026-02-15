import paypal from '@paypal/checkout-server-sdk';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';
import { getPayPalBaseUrl, validatePayPalEnvironment } from '../config/paypalEnv.js';

const PAYPAL_PLAN_ID_REGEX = /^P-[A-Z0-9]+$/;
const PAYPAL_PRODUCT_ID_REGEX = /^PROD-[A-Z0-9]+$/;

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

const client = () => {
  return new paypal.core.PayPalHttpClient(environment());
};

/**
 * Parses PayPal API error response. Safe for logging (no secrets).
 * @param {Response} response - fetch Response (not ok)
 * @param {string} context - e.g. 'create_subscription', 'get_plan'
 * @returns {{ message: string, code?: string, debug_id?: string, details?: unknown, statusCode: number }}
 */
export async function paypalErrorHandler(response, context = 'paypal_api') {
  const statusCode = response.status;
  let body = null;
  try {
    const text = await response.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (body && typeof body === 'object') {
    const debugId = body.debug_id ?? body.details?.[0]?.issue;
    const message = body.message || body.details?.[0]?.description || body.details?.[0]?.issue || 'Unknown PayPal error';
    const code = body.name || body.details?.[0]?.issue;
    logger.error(`[PayPal] ${context} failed`, {
      statusCode,
      debug_id: debugId,
      message,
      code,
    });
    return {
      message: String(message),
      code: code ? String(code) : undefined,
      debug_id: debugId ? String(debugId) : undefined,
      details: body.details,
      statusCode,
    };
  }
  logger.error(`[PayPal] ${context} failed (non-JSON)`, { statusCode });
  return {
    message: `PayPal API error: ${response.statusText || statusCode}`,
    statusCode,
  };
}

/**
 * Validates plan_id format. Plan IDs must be P-xxx, not PROD-xxx.
 */
export function validatePlanIdFormat(planId) {
  if (!planId || typeof planId !== 'string') {
    return { valid: false, error: 'Plan ID is required and must be a string.' };
  }
  const trimmed = planId.trim();
  if (PAYPAL_PRODUCT_ID_REGEX.test(trimmed)) {
    return { valid: false, error: 'Invalid plan ID: use a billing plan ID (P-...), not a product ID (PROD-...).' };
  }
  if (!PAYPAL_PLAN_ID_REGEX.test(trimmed)) {
    return { valid: false, error: 'Invalid plan ID format. Expected P- followed by alphanumeric characters.' };
  }
  return { valid: true, planId: trimmed };
}

/**
 * Fetches plan by ID, ensures it is ACTIVE (activates if CREATED/INACTIVE). Returns plan or throws structured error.
 */
export async function validatePlan(planId) {
  const baseUrl = getPayPalBaseUrl();
  const accessToken = await generateAccessToken();

  const getRes = await fetch(`${baseUrl}/v1/billing/plans/${encodeURIComponent(planId)}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  });

  if (!getRes.ok) {
    const err = await paypalErrorHandler(getRes, 'get_plan');
    if (getRes.status === 404) {
      throw Object.assign(new Error('PLAN_NOT_FOUND'), {
        code: 'PLAN_NOT_FOUND',
        debug_id: err.debug_id,
        statusCode: 404,
        details: { planId, hint: 'Plan may belong to another environment (sandbox vs live) or was deleted.' },
      });
    }
    throw Object.assign(new Error(err.message), { code: err.code, debug_id: err.debug_id, statusCode: err.statusCode });
  }

  const plan = await getRes.json();
  logger.debug('[PayPal] Plan fetched', { planId, status: plan.status });

  const status = (plan.status || '').toUpperCase();
  if (status === 'ACTIVE') {
    return plan;
  }

  if (status === 'CREATED' || status === 'INACTIVE') {
    const activateRes = await fetch(`${baseUrl}/v1/billing/plans/${encodeURIComponent(planId)}/activate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!activateRes.ok) {
      const err = await paypalErrorHandler(activateRes, 'activate_plan');
      throw Object.assign(new Error(`Plan is not ACTIVE and activation failed: ${err.message}`), {
        code: err.code,
        debug_id: err.debug_id,
        statusCode: err.statusCode,
      });
    }
    logger.info('[PayPal] Plan auto-activated', { planId });
    return { ...plan, status: 'ACTIVE' };
  }

  throw Object.assign(new Error(`Plan is not in a valid state for subscriptions: ${status}`), {
    code: 'PLAN_STATE_INVALID',
    statusCode: 400,
    details: { planId, status },
  });
}

/**
 * Validates that the product exists (e.g. for a plan's product_id). Throws if product not found.
 */
export async function validateProductForPlan(productId) {
  if (!productId || !PAYPAL_PRODUCT_ID_REGEX.test(String(productId).trim())) {
    return; // no product id or not PROD- format, skip
  }
  const baseUrl = getPayPalBaseUrl();
  const accessToken = await generateAccessToken();

  const res = await fetch(`${baseUrl}/v1/catalogs/products/${encodeURIComponent(productId)}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const err = await paypalErrorHandler(res, 'get_product');
    if (res.status === 404) {
      throw Object.assign(new Error('PRODUCT_NOT_FOUND'), {
        code: 'PRODUCT_NOT_FOUND',
        debug_id: err.debug_id,
        statusCode: 404,
        details: { productId, hint: 'Product may have been deleted.' },
      });
    }
    throw Object.assign(new Error(err.message), { code: err.code, debug_id: err.debug_id, statusCode: err.statusCode });
  }
  return await res.json();
}

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

export const createPayPalOrderForCheckout = async (orderData) => {
  try {
    if (orderData.currency && orderData.currency !== 'USD') {
      throw new Error(`Currency must be USD. Received: ${orderData.currency}`);
    }
    
    const currencyCode = 'USD';
    let finalAmount;
    let breakdown;
    let items;
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
    paymentsReceivable: true,
  };
};

/** Creates PayPal payout. options.useMerchantId: when true, recipient is merchant ID. */
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

    const baseUrl = getPayPalBaseUrl();

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

export async function generateAccessToken() {
  try {
    validatePayPalEnvironment();
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    const baseUrl = getPayPalBaseUrl();

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
      const err = await paypalErrorHandler(response, 'oauth2_token');
      const isAuthFailure = response.status === 401 || (err.message && (err.message.includes('invalid_client') || err.message.includes('Client Authentication')));
      if (isAuthFailure) {
        logger.error('[PayPal] Token generation failed: invalid credentials or wrong environment', {
          debug_id: err.debug_id,
          statusCode: err.statusCode,
        });
        throw new Error(
          `PayPal authentication failed. Check PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET and that they match PAYPAL_ENV (sandbox vs production). debug_id: ${err.debug_id || 'n/a'}`
        );
      }
      throw new Error(`PayPal token failed: ${err.message}`);
    }

    const data = await response.json();
    const token = data.access_token;
    if (!token) {
      logger.error('[PayPal] Token response missing access_token');
      throw new Error('PayPal token response missing access_token');
    }
    logger.debug('[PayPal] Access token obtained successfully');
    return token;
  } catch (error) {
    if (error.message && error.message.startsWith('PayPal')) throw error;
    logger.error('[PayPal] Access token error', error?.message || error);
    throw new Error(`Failed to get PayPal access token: ${error.message}`);
  }
}

const getPayPalAccessToken = generateAccessToken;

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

    const baseUrl = getPayPalBaseUrl();

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

export async function createPayPalSubscriptionPlan(planData) {
  const productId = planData.productId || planData.product_id;
  if (!productId || !PAYPAL_PRODUCT_ID_REGEX.test(String(productId).trim())) {
    throw new Error('createPayPalSubscriptionPlan requires product_id (PROD-xxx). Create a product via Catalog Products API first.');
  }
  const baseUrl = getPayPalBaseUrl();
  const accessToken = await generateAccessToken();

  const plan = {
    product_id: String(productId).trim(),
    name: planData.name || 'DGMARQ+ Monthly Subscription',
    description: planData.description || 'Monthly subscription to DGMARQ+ with 2% discount on all purchases',
    status: 'ACTIVE',
    billing_cycles: [
      {
        frequency: { interval_unit: 'MONTH', interval_count: 1 },
        tenure_type: 'REGULAR',
        sequence: 1,
        total_cycles: 0,
        pricing_scheme: {
          fixed_price: {
            value: Number(planData.price).toFixed(2),
            currency_code: planData.currency || 'EUR',
          },
        },
      },
    ],
    payment_preferences: {
      auto_bill_outstanding: true,
      setup_fee: { value: '0', currency_code: planData.currency || 'EUR' },
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
    const err = await paypalErrorHandler(response, 'create_plan');
    throw Object.assign(new Error(`PayPal plan creation failed: ${err.message}`), {
      code: err.code,
      debug_id: err.debug_id,
      statusCode: err.statusCode,
    });
  }

  const result = await response.json();
  logger.info('[PayPal] Plan created', { planId: result.id, status: result.status });
  return {
    id: result.id,
    status: result.status,
  };
}

export async function createPayPalSubscription(planId, returnUrl, cancelUrl) {
  const envLabel = (process.env.PAYPAL_ENV || 'sandbox').toLowerCase() === 'production' ? 'PRODUCTION' : 'SANDBOX';
  logger.info('[PayPal] createPayPalSubscription', { planId: planId ? `${planId.substring(0, 10)}...` : '(missing)', environment: envLabel });

  const formatCheck = validatePlanIdFormat(planId);
  if (!formatCheck.valid) {
    logger.warn('[PayPal] Invalid plan ID format', { planId: planId ? 'present' : 'missing', error: formatCheck.error });
    throw Object.assign(new Error(formatCheck.error), { code: 'INVALID_PLAN_ID_FORMAT', statusCode: 400 });
  }
  const validPlanId = formatCheck.planId;

  const plan = await validatePlan(validPlanId);
  const productId = plan.product_id;
  if (productId) {
    await validateProductForPlan(productId);
  }

  const baseUrl = getPayPalBaseUrl();
  const accessToken = await generateAccessToken();

  const subscription = {
    plan_id: validPlanId,
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
    const err = await paypalErrorHandler(response, 'create_subscription');
    const msg = err.message || 'The specified resource does not exist.';
    logger.error('[PayPal] Subscription creation failed', {
      planId: validPlanId,
      debug_id: err.debug_id,
      statusCode: err.statusCode,
    });
    const e = new Error(`PayPal subscription creation failed: ${msg}`);
    e.code = err.code;
    e.debug_id = err.debug_id;
    e.statusCode = err.statusCode;
    e.details = err.details;
    throw e;
  }

  const result = await response.json();
  logger.info('[PayPal] Subscription created', { subscriptionId: result.id, status: result.status });
  return {
    id: result.id,
    status: result.status,
    links: result.links,
  };
}

export async function getPayPalSubscription(subscriptionId) {
  const baseUrl = getPayPalBaseUrl();
  const accessToken = await generateAccessToken();

  const response = await fetch(`${baseUrl}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const err = await paypalErrorHandler(response, 'get_subscription');
    const e = new Error(`Failed to get PayPal subscription: ${err.message}`);
    e.code = err.code;
    e.debug_id = err.debug_id;
    e.statusCode = err.statusCode;
    throw e;
  }
  return await response.json();
}

export async function cancelPayPalSubscription(subscriptionId, reason = 'User requested cancellation') {
  const baseUrl = getPayPalBaseUrl();
  const accessToken = await generateAccessToken();

  const response = await fetch(`${baseUrl}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ reason }),
  });

  if (!response.ok) {
    const err = await paypalErrorHandler(response, 'cancel_subscription');
    throw Object.assign(new Error(`PayPal subscription cancellation failed: ${err.message}`), {
      code: err.code,
      debug_id: err.debug_id,
      statusCode: err.statusCode,
    });
  }
  return { success: true };
}

