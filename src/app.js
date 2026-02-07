import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import session from "express-session";
import passport from "./config/passport.config.js";
import { errorHandler } from "./middlerwares/error.middlerware.js";
import { enforceHTTPS, securityHeaders } from "./middlerwares/https.middlerware.js";

// Purpose: Create and configure Express application instance
const app = express();

app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(enforceHTTPS);
const corsOrigin = process.env.FRONTEND_URL || 'http://localhost:5173';
const corsOrigins = [corsOrigin];

if (corsOrigin.startsWith('http://')) {
  const httpsOrigin = corsOrigin.replace('http://', 'https://');
  corsOrigins.push(httpsOrigin);
}

// Purpose: Remove trailing slash from URL for consistent origin comparison
const normalizeOrigin = (url) => {
  if (!url) return url;
  return url.replace(/\/$/, '');
};

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      
      if (origin.includes('paypal.com') || origin.includes('paypalobjects.com')) {
        return callback(null, true);
      }
      
      const normalizedOrigin = normalizeOrigin(origin);
      
      if (corsOrigins.some(allowed => {
        const normalizedAllowed = normalizeOrigin(allowed);
        return normalizedOrigin === normalizedAllowed || normalizedOrigin.startsWith(normalizedAllowed);
      })) {
        return callback(null, true);
      }
      if (process.env.NODE_ENV !== 'production') {
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
          return callback(null, true);
        }
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-PayPal-Webhook-Id'],
  })
);

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

let sessionStore = undefined;
if (process.env.NODE_ENV === 'production' && !sessionStore) {
}

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dgmarq-secret-key",
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      secure: process.env.NODE_ENV === "production" || process.env.USE_HTTPS === "true",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax',
    },
  })
);

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
import seoRouter from "./routes/seo.route.js";
import walletRouter from "./routes/wallet.route.js";

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
app.use("/api/v1/seo", seoRouter);
app.use("/api/v1/wallet", walletRouter);

app.use(errorHandler);

export { app };
