import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import session from "express-session";
import passport from "./config/passport.config.js";
import { errorHandler } from "./middlerwares/error.middlerware.js";
import { enforceHTTPS, securityHeaders } from "./middlerwares/https.middlerware.js";
const app = express();

// Trust proxy - Required for accurate IP detection behind reverse proxy (Nginx, load balancer)
// This fixes the express-rate-limit X-Forwarded-For header warning
app.set('trust proxy', true);

// Note: Compression should be handled by reverse proxy (Nginx) in production
// For development, you can add compression middleware if needed

// Security headers for PayPal CardFields (must be before other middleware)
app.use(securityHeaders);

// HTTPS enforcement middleware (for PayPal CardFields compatibility)
app.use(enforceHTTPS);

// CORS Configuration - Support both HTTP and HTTPS origins in development
const corsOrigin = process.env.FRONTEND_URL || 'http://localhost:5173';
const corsOrigins = [corsOrigin];

// Add HTTPS version of frontend URL if HTTP is specified
if (corsOrigin.startsWith('http://')) {
  const httpsOrigin = corsOrigin.replace('http://', 'https://');
  corsOrigins.push(httpsOrigin);
}

// Normalize origins for comparison (remove trailing slashes)
const normalizeOrigin = (url) => {
  if (!url) return url;
  return url.replace(/\/$/, '');
};

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, webhooks, etc.)
      if (!origin) return callback(null, true);
      
      // Allow PayPal webhook origins
      if (origin.includes('paypal.com') || origin.includes('paypalobjects.com')) {
        return callback(null, true);
      }
      
      // Normalize origin for comparison
      const normalizedOrigin = normalizeOrigin(origin);
      
      // Check if origin is in allowed list (normalized comparison)
      if (corsOrigins.some(allowed => {
        const normalizedAllowed = normalizeOrigin(allowed);
        return normalizedOrigin === normalizedAllowed || normalizedOrigin.startsWith(normalizedAllowed);
      })) {
        return callback(null, true);
      }
      
      // In development, allow localhost with any protocol
      if (process.env.NODE_ENV !== 'production') {
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
          return callback(null, true);
        }
      }
      
      // Log rejected origin for debugging (only in development)
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[CORS] Rejected origin: ${origin}, Allowed origins: ${corsOrigins.join(', ')}`);
      }
      
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-PayPal-Webhook-Id'],
  })
);


// IMPORTANT: Register webhook route BEFORE JSON parser to preserve raw body for signature verification
// Webhooks need raw body for PayPal signature verification
import webhookRouter from "./routes/webhook.route.js";
app.use("/api/v1/webhook", webhookRouter);

app.use(
  express.json({
    limit: "16kb",
    strict: true,
    type: "application/json",
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "16kb",
  })
);

app.use(cookieParser());
app.use(express.static("public"));

// Session configuration for Passport
// NOTE: MemoryStore is not suitable for production as it leaks memory and doesn't scale
// For production, use MongoDB session store (connect-mongo)
// To fix: 
//   1. Install: npm install connect-mongo
//   2. Import at top: import MongoStore from 'connect-mongo';
//   3. Import mongoose connection: import mongoose from 'mongoose';
//   4. Replace store: undefined with: store: MongoStore.create({ client: mongoose.connection.getClient() })

let sessionStore = undefined;

// TODO: Configure MongoDB session store for production
// Uncomment and configure when connect-mongo is installed:
// if (process.env.NODE_ENV === 'production') {
//   import('connect-mongo').then(({ default: MongoStore }) => {
//     import('mongoose').then(({ default: mongoose }) => {
//       sessionStore = MongoStore.create({
//         client: mongoose.connection.getClient(),
//         collectionName: 'sessions',
//         ttl: 24 * 60 * 60, // 24 hours
//       });
//     });
//   }).catch(() => {
//     console.warn('⚠️  connect-mongo not installed. Using MemoryStore (not recommended for production).');
//   });
// }

if (process.env.NODE_ENV === 'production' && !sessionStore) {
  console.warn('⚠️  WARNING: Using MemoryStore for sessions in production!');
  console.warn('⚠️  This will leak memory and not scale. Install connect-mongo for production use.');
}

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dgmarq-secret-key",
    resave: false,
    saveUninitialized: false,
    store: sessionStore, // Use MongoDB store in production, MemoryStore in development
    cookie: {
      // FIX: Enable secure cookies when using HTTPS (even in development)
      secure: process.env.NODE_ENV === "production" || process.env.USE_HTTPS === "true",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'lax', // Required for PayPal CardFields
    },
  })
);

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

import userRouter from "./routes/user.route.js";
import sellerRouter from "./routes/seller.route.js";
import categoryRouter from "./routes/category.route.js";
import subCategoryRouter from "./routes/subcategory.route.js";
import platformRouter from "./routes/platform.route.js";
import deviceRouter from "./routes/device.route.js";
import regionRouter from "./routes/region.route.js";
import genreRouter from "./routes/genre.route.js";
import themeRouter from "./routes/theme.route.js";
import modeRouter from "./routes/mode.route.js";
import typeRouter from "./routes/type.route.js";
import productRouter from "./routes/product.route.js";
import cartRouter from "./routes/cart.router.js";
import wishlistRouter from "./routes/wishlist.router.js";
import reviewRouter from "./routes/review.router.js";
import checkoutRouter from "./routes/checkout.route.js";
import orderRouter from "./routes/order.route.js";
import payoutRouter from "./routes/payout.route.js";
import notificationRouter from "./routes/notification.route.js";
import chatRouter from "./routes/chat.route.js";
import adminRouter from "./routes/admin.route.js";
import disputeRouter from "./routes/dispute.route.js";
import couponRouter from "./routes/coupon.route.js";
import returnrefundRouter from "./routes/returnrefund.route.js";
import analyticsRouter from "./routes/analytics.route.js";
import bestsellerRouter from "./routes/bestseller.route.js";
import subscriptionRouter from "./routes/subscription.route.js";
import licensekeyRouter from "./routes/licensekey.route.js";
import supportRouter from "./routes/support.route.js";
import payoutAccountRouter from "./routes/payoutAccount.route.js";
import flashDealRouter from "./routes/flashdeal.route.js";
import homepageSliderRouter from "./routes/homepageslider.route.js";
import trendingCategoryRouter from "./routes/trendingcategory.route.js";
import bundleDealRouter from "./routes/bundledeal.route.js";
import paypalOrdersRouter from "./routes/paypalOrders.route.js";
import trendingOfferRouter from "./routes/trendingoffer.route.js";
import upcomingReleaseRouter from "./routes/upcomingrelease.route.js";
import upcomingGamesRouter from "./routes/upcominggames.route.js";

app.use("/api/v1/user", userRouter);
app.use("/api/v1/seller", sellerRouter);
app.use("/api/v1/category", categoryRouter);
app.use("/api/v1/subcategory", subCategoryRouter);
app.use("/api/v1/platform", platformRouter);
app.use("/api/v1/device", deviceRouter);
app.use("/api/v1/mode", modeRouter);
app.use("/api/v1/region", regionRouter);
app.use("/api/v1/genre", genreRouter);
app.use("/api/v1/theme", themeRouter);
app.use("/api/v1/type", typeRouter);
app.use("/api/v1/product", productRouter);
app.use("/api/v1/cart", cartRouter);
app.use("/api/v1/wishlist", wishlistRouter);
app.use("/api/v1/review", reviewRouter);
app.use("/api/v1/checkout", checkoutRouter);
app.use("/api/v1/order", orderRouter);
app.use("/api/v1/payout", payoutRouter);
app.use("/api/v1/notification", notificationRouter);
app.use("/api/v1/chat", chatRouter);
app.use("/api/v1/admin", adminRouter);
app.use("/api/v1/dispute", disputeRouter);
app.use("/api/v1/coupon", couponRouter);
app.use("/api/v1/return-refund", returnrefundRouter);
app.use("/api/v1/analytics", analyticsRouter);
app.use("/api/v1/bestseller", bestsellerRouter);
app.use("/api/v1/subscription", subscriptionRouter);
app.use("/api/v1/license-key", licensekeyRouter);
app.use("/api/v1/support", supportRouter);
app.use("/api/v1/payout-account", payoutAccountRouter);
app.use("/api/v1/flash-deal", flashDealRouter);
app.use("/api/v1/homepage-slider", homepageSliderRouter);
app.use("/api/v1/trending-category", trendingCategoryRouter);
app.use("/api/v1/bundle-deal", bundleDealRouter);
app.use("/api/v1/paypal", paypalOrdersRouter);
app.use("/api/v1/trending-offer", trendingOfferRouter);
app.use("/api/v1/upcoming-release", upcomingReleaseRouter);
app.use("/api/v1/upcoming-games", upcomingGamesRouter);

app.use(errorHandler);

export { app };
