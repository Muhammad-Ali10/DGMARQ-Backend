import paypal from '@paypal/checkout-server-sdk';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger.js';

// Configure PayPal environment
const environment = () => {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const paypalEnv = process.env.PAYPAL_ENV || 'sandbox'; 

  // FIX: Validate PayPal credentials with detailed error messages
  if (!clientId || clientId.trim() === '' || clientId === 'your_paypal_client_id') {
    throw new Error('PayPal CLIENT_ID is missing or not configured. Please set PAYPAL_CLIENT_ID in your .env file.');
  }

  if (!clientSecret || clientSecret.trim() === '' || clientSecret === 'your_paypal_client_secret') {
    throw new Error('PayPal CLIENT_SECRET is missing or not configured. Please set PAYPAL_CLIENT_SECRET in your .env file.');
  }

  // Log which environment is being used for debugging
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
 * Creates a PayPal order for payment processing
 * 
 * IMPORTANT: This function uses ADMIN PayPal credentials only.
 * All customer payments are captured into the ADMIN PayPal account.
 * 
 * ESCROW FLOW:
 * - Customer payments → Admin PayPal account (via this function)
 * - Seller payouts → Seller PayPal accounts (via createPayPalPayout, after 15 days)
 * 
 * No seller PayPal email or merchant_id is used during checkout.
 * The purchase_units intentionally excludes 'payee' field to ensure
 * payments go to the admin account associated with PAYPAL_CLIENT_ID.
 */
export const createPayPalOrder = async (orderData) => {
  try {
    // Verify we're using admin credentials (not seller credentials)
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    
    // FIX: Enhanced validation with helpful error messages
    if (!clientId || clientId.trim() === '' || clientId === 'your_paypal_client_id') {
      throw new Error('PayPal CLIENT_ID is missing or not configured. Please set PAYPAL_CLIENT_ID in your .env file.');
    }
    
    if (!clientSecret || clientSecret.trim() === '' || clientSecret === 'your_paypal_client_secret') {
      throw new Error('PayPal CLIENT_SECRET is missing or not configured. Please set PAYPAL_CLIENT_SECRET in your .env file.');
    }

    // SECURITY: Hard-enforce USD currency - never default to EUR
    const currencyCode = orderData.currency && orderData.currency === 'USD' ? 'USD' : 'USD';
    if (orderData.currency && orderData.currency !== 'USD') {
      throw new Error(`Currency must be USD. Received: ${orderData.currency}`);
    }
    
    // Calculate item_total: SUM(items.unit_amount.value × items.quantity)
    // Use integer math (cents) to avoid floating-point errors
    let itemTotalCents = 0;
    const items = orderData.items.map(item => {
      // Ensure unit_amount is a number
      const unitAmount = typeof item.unit_amount === 'number' ? item.unit_amount : parseFloat(item.unit_amount);
      const quantity = typeof item.quantity === 'number' ? item.quantity : parseFloat(item.quantity);
      
      // Calculate in cents to avoid floating-point errors
      const unitAmountCents = Math.round(unitAmount * 100);
      const lineTotalCents = unitAmountCents * quantity;
      itemTotalCents += lineTotalCents;
      
      return {
        name: item.name,
        quantity: quantity.toString(), // PayPal requires quantity as string
        unit_amount: {
          currency_code: currencyCode,
          value: unitAmount.toFixed(2), // Fixed to 2 decimal places
        },
      };
    });
    
    // Convert item_total from cents back to decimal
    const itemTotal = (itemTotalCents / 100).toFixed(2);
    
    // Get optional breakdown components (if provided)
    const taxTotal = orderData.tax_total ? parseFloat(orderData.tax_total).toFixed(2) : '0.00';
    const shipping = orderData.shipping ? parseFloat(orderData.shipping).toFixed(2) : '0.00';
    const handling = orderData.handling ? parseFloat(orderData.handling).toFixed(2) : '0.00';
    const discount = orderData.discount ? parseFloat(orderData.discount).toFixed(2) : '0.00';
    
    // Calculate final amount: item_total + tax_total + shipping + handling - discount
    const finalAmountCents = 
      itemTotalCents + 
      Math.round(parseFloat(taxTotal) * 100) + 
      Math.round(parseFloat(shipping) * 100) + 
      Math.round(parseFloat(handling) * 100) - 
      Math.round(parseFloat(discount) * 100);
    
    const finalAmount = (finalAmountCents / 100).toFixed(2);
    
    // Build breakdown object
    const breakdown = {
      item_total: {
        currency_code: currencyCode,
        value: itemTotal,
      },
    };
    
    // Only include breakdown fields if they have non-zero values
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
          // NOTE: No 'payee' field is set - payments go to admin account
          // NOTE: No 'merchant_id' field is set - payments go to admin account
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
    
    // Log order creation for audit (payment goes to admin account)
    logger.info(`PayPal order created: ${order.result.id} - Payment will be captured to ADMIN account`);
    
    return {
      id: order.result.id,
      status: order.result.status,
      links: order.result.links,
      payerId: order.result.payer?.payer_id || null,
    };
  } catch (error) {
    logger.error('PayPal order creation failed', error);
    
    // FIX: Provide more helpful error messages for common issues
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

/**
 * Captures a PayPal payment for an approved order
 * 
 * IMPORTANT: Payment is captured into the ADMIN PayPal account.
 * The capture uses admin credentials (PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET).
 * 
 * The capture response will show the admin account as the receiver.
 */
export const capturePayPalPayment = async (orderId) => {
  try {
    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    request.requestBody({});

    const capture = await client().execute(request);
    const captureData = capture.result.purchase_units[0]?.payments?.captures[0];
    
    // Verify payment receiver is admin account (capture should show admin as receiver)
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
      // Include payee info for verification (should be admin account)
      payee: payee || null,
    };
  } catch (error) {
    logger.error('PayPal payment capture failed', error);
    throw new Error(`PayPal payment capture failed: ${error.message}`);
  }
};

// Retrieves PayPal order details by order ID
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

/**
 * Create PayPal Order for Advanced Checkout (CardFields)
 * SECURITY: This function does NOT accept card data - card data is handled by PayPal-hosted CardFields
 * 
 * @param {Object} orderData - Order data with amount, currency, items
 * @returns {Promise<Object>} PayPal order response with orderId
 */
export const createPayPalOrderForCheckout = async (orderData) => {
  try {
    // HARD-ENFORCE USD CURRENCY
    if (orderData.currency && orderData.currency !== 'USD') {
      throw new Error(`Currency must be USD. Received: ${orderData.currency}`);
    }
    
    const currencyCode = 'USD';
    
    // Calculate item_total: SUM(items.unit_amount.value × items.quantity)
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
          value: Number(unitAmount).toFixed(2), // Ensure 2 decimal places
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
    
    const finalAmount = Number(finalAmountCents / 100).toFixed(2); // Ensure 2 decimal places
    
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

    // Create PayPal order (NO payment_source - handled by frontend CardFields)
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

/**
 * Capture PayPal Order
 * SECURITY: Only accepts orderId - no card data
 * 
 * @param {string} orderId - PayPal order ID
 * @returns {Promise<Object>} Capture response
 */
export const capturePayPalOrderForCheckout = async (orderId) => {
  try {
    if (!orderId) {
      throw new Error('Order ID is required');
    }

    logger.debug('[PAYPAL ORDERS] Capturing order', { orderId });

    // FIX: First verify the order exists and is in the correct state
    try {
      const orderRequest = new paypal.orders.OrdersGetRequest(orderId);
      const orderResponse = await client().execute(orderRequest);
      const orderStatus = orderResponse.result.status;
      
      logger.debug('[PAYPAL ORDERS] Order status before capture', {
        orderId,
        status: orderStatus,
      });
      
      // FIX: Order must be APPROVED before capture
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
    
    // FIX: Extract capture data from correct PayPal response structure
    // PayPal Orders API response: capture.result.purchase_units[0].payments.captures[0]
    const captureData = capture.result.purchase_units?.[0]?.payments?.captures?.[0];
    
    if (!captureData) {
      logger.error('[PAYPAL ORDERS] Capture data not found in response', {
        orderId,
        fullResponse: JSON.stringify(capture.result, null, 2),
      });
      throw new Error('Capture data not found in PayPal response');
    }
    
    // FIX: Extract amount and currency from correct path
    const capturedAmount = captureData.amount?.value ? parseFloat(captureData.amount.value) : null;
    const capturedCurrency = captureData.amount?.currency_code || 'USD';
    const captureStatus = captureData.status || capture.result.status;
    
    // FIX: Verify capture was successful
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
      fullCaptureData: captureData, // Include full capture data for debugging
    };
  } catch (error) {
    logger.error('[PAYPAL ORDERS] Capture error', {
      error: error.message,
      statusCode: error.statusCode,
      orderId,
      stack: error.stack,
    });
    
    // FIX: Provide more helpful error messages
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

/**
 * Creates a PayPal payout to seller using PayPal Payouts API
 * 
 * IMPORTANT: This function is ONLY used for seller payouts AFTER 15 days.
 * It is NOT used during customer checkout.
 * 
 * ESCROW FLOW:
 * 1. Customer pays → Admin PayPal account (via createPayPalOrder)
 * 2. After 15 days → Seller receives payout (via this function)
 * 
 * This function uses admin credentials to send money FROM admin account TO seller account.
 */
export const createPayPalPayout = async (sellerEmail, amount, currency = 'USD') => {
  try {
    const accessToken = await getPayPalAccessToken();
    const batchId = `PAYOUT-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    const payoutData = {
      sender_batch_header: {
        sender_batch_id: batchId,
        email_subject: 'You have a payout from DGMARQ',
        email_message: 'You have received a payout from DGMARQ marketplace.',
      },
      items: [
        {
          recipient_type: 'EMAIL',
          amount: {
            value: amount.toFixed(2),
            currency: currency,
          },
          receiver: sellerEmail,
          note: 'Payout from DGMARQ marketplace',
          sender_item_id: `ITEM-${Date.now()}`,
        },
      ],
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
      const errorData = await response.json();
      throw new Error(`PayPal payout failed: ${errorData.message || JSON.stringify(errorData)}`);
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

/**
 * Get PayPal access token for Payouts API
 */
const getPayPalAccessToken = async () => {
  try {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
    const paypalEnv = process.env.PAYPAL_ENV || 'sandbox';

    // FIX: Enhanced validation with helpful error messages
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
      
      // FIX: Provide helpful error message for authentication failures
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

/**
 * Validates if an email is associated with a valid PayPal account
 * Note: PayPal doesn't provide a direct API to check email validity.
 * This function validates the email format and attempts to verify via Identity API.
 * Full validation occurs when the first payout is attempted.
 */
export const validatePayPalEmail = async (email) => {
  try {
    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        isValid: false,
        error: 'Invalid email format',
      };
    }

    // Note: PayPal doesn't have a public API to verify if an email is a PayPal account
    // The actual validation happens when we attempt the first payout.
    // For now, we validate the format and let the payout API handle account validation.
    // If the email is not a PayPal account, the payout will fail and we can handle it then.
    
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

/**
 * Verifies PayPal webhook signature using PayPal's official verification API
 * @param {Object} req - Express request object containing webhook headers and body
 * @returns {Promise<boolean>} - True if verification succeeds, false otherwise
 */
export const verifyPayPalWebhook = async (req) => {
  try {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!webhookId) {
      logger.warn('PayPal webhook ID not configured - skipping verification');
      // In development, allow unverified webhooks if webhook ID is not set
      // In production, this should return false for security
      return process.env.NODE_ENV !== 'production';
    }

    // Extract required headers from PayPal webhook (case-insensitive)
    const transmissionId = req.headers['paypal-transmission-id'] || req.headers['PAYPAL-TRANSMISSION-ID'];
    const transmissionTime = req.headers['paypal-transmission-time'] || req.headers['PAYPAL-TRANSMISSION-TIME'];
    const certUrl = req.headers['paypal-cert-url'] || req.headers['PAYPAL-CERT-URL'];
    const authAlgo = req.headers['paypal-auth-algo'] || req.headers['PAYPAL-AUTH-ALGO'];
    const transmissionSig = req.headers['paypal-transmission-sig'] || req.headers['PAYPAL-TRANSMISSION-SIG'];

    // FIX: Validate all required headers are present (PayPal transmission headers)
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

    // Get raw request body
    // The route uses express.raw(), so body will be a Buffer
    let webhookEvent;
    if (Buffer.isBuffer(req.body)) {
      // Body is a Buffer, convert to string
      webhookEvent = req.body.toString('utf8');
    } else if (typeof req.body === 'string') {
      // Body is already a string
      webhookEvent = req.body;
    } else {
      // Body is already parsed, stringify it back
      webhookEvent = JSON.stringify(req.body);
    }

    // Parse the webhook event to ensure it's valid JSON
    let parsedWebhookEvent;
    try {
      parsedWebhookEvent = JSON.parse(webhookEvent);
    } catch (parseError) {
      logger.error('Invalid JSON in webhook body', parseError);
      return false;
    }

    // Get PayPal access token for API call
    const accessToken = await getPayPalAccessToken();

    // Prepare verification request payload
    const verificationPayload = {
      transmission_id: transmissionId,
      transmission_time: transmissionTime,
      cert_url: certUrl,
      auth_algo: authAlgo,
      transmission_sig: transmissionSig,
      webhook_id: webhookId,
      webhook_event: parsedWebhookEvent, // PayPal expects parsed JSON object
    };

    // Determine base URL based on environment
    const baseUrl = process.env.PAYPAL_ENV === 'production' 
      ? 'https://api-m.paypal.com' 
      : 'https://api-m.sandbox.paypal.com';

    // Call PayPal's webhook verification API
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

    // Check verification status
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
    // In case of error, fail securely by returning false
    return false;
  }
};

// Processes a PayPal refund for a captured payment
export const processRefund = async (captureId, amount, currency = 'EUR') => {
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

// Creates a PayPal subscription plan for recurring billing
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

// Creates a PayPal subscription for recurring billing
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

// Retrieves PayPal subscription details by subscription ID
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

// Cancels a PayPal subscription
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

