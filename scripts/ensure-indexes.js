/**
 * MongoDB Index Optimization Script
 * Run: node scripts/ensure-indexes.js
 *
 * Creates compound indexes for common query patterns to support 10M+ users.
 * Safe to run multiple times — createIndex is idempotent.
 */
import 'dotenv/config';
import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const DB_NAME = process.env.DB_Name;

async function ensureIndexes() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
  const db = mongoose.connection.db;

  const indexes = [
    // Users — login lookup, OAuth lookup
    { collection: 'users', index: { email: 1 }, options: { unique: true } },
    { collection: 'users', index: { oauthProvider: 1, oauthId: 1 }, options: { sparse: true } },

    // Products — homepage queries, search, seller listings
    { collection: 'products', index: { status: 1, isFeatured: -1, rating: -1 } },
    { collection: 'products', index: { sellerId: 1, status: 1 } },
    { collection: 'products', index: { categoryId: 1, status: 1, rating: -1 } },
    { collection: 'products', index: { slug: 1 }, options: { unique: true } },
    { collection: 'products', index: { name: 'text', description: 'text' } },
    { collection: 'products', index: { status: 1, createdAt: -1 } },

    // Orders — user order history, seller orders, order number lookup
    { collection: 'orders', index: { userId: 1, createdAt: -1 } },
    { collection: 'orders', index: { 'items.sellerId': 1, createdAt: -1 } },
    { collection: 'orders', index: { orderNumber: 1 }, options: { unique: true } },
    { collection: 'orders', index: { checkoutId: 1 } },
    { collection: 'orders', index: { paymentStatus: 1, orderStatus: 1 } },

    // License Keys — key assignment lookup
    { collection: 'licensekeys', index: { productId: 1 } },
    { collection: 'licensekeys', index: { productId: 1, 'keys.status': 1 } },

    // Reviews — product reviews listing
    { collection: 'reviews', index: { productId: 1, createdAt: -1 } },
    { collection: 'reviews', index: { userId: 1 } },

    // Notifications — user notifications
    { collection: 'notifications', index: { userId: 1, read: 1, createdAt: -1 } },

    // Cart — user cart lookup
    { collection: 'carts', index: { userId: 1 }, options: { unique: true } },

    // Wishlists
    { collection: 'wishlists', index: { userId: 1 } },

    // Sellers — user-seller mapping
    { collection: 'sellers', index: { userId: 1 }, options: { unique: true } },
    { collection: 'sellers', index: { status: 1 } },

    // Payouts — seller payout history
    { collection: 'payouts', index: { sellerId: 1, status: 1, createdAt: -1 } },
    { collection: 'payouts', index: { orderId: 1 } },

    // Conversations — chat lookups
    { collection: 'conversations', index: { participants: 1, updatedAt: -1 } },

    // Messages — conversation messages
    { collection: 'messages', index: { conversationId: 1, createdAt: -1 } },

    // Coupons — code lookup
    { collection: 'coupons', index: { code: 1 }, options: { unique: true } },

    // Sessions — cleanup, user sessions
    { collection: 'sessions', index: { userId: 1, isActive: 1 } },
    { collection: 'sessions', index: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },

    // Bestsellers
    { collection: 'bestsellers', index: { salesCount: -1 } },

    // Checkouts — TTL for abandoned checkouts
    { collection: 'checkouts', index: { createdAt: 1 }, options: { expireAfterSeconds: 86400 } },
    { collection: 'checkouts', index: { userId: 1, status: 1 } },
  ];

  let created = 0;
  let skipped = 0;

  for (const { collection, index, options = {} } of indexes) {
    try {
      const col = db.collection(collection);
      await col.createIndex(index, { background: true, ...options });
      created++;
      console.log(`  [OK] ${collection}: ${JSON.stringify(index)}`);
    } catch (err) {
      if (err.code === 85 || err.code === 86) {
        // Index already exists with different options — skip
        skipped++;
        console.log(`  [SKIP] ${collection}: ${JSON.stringify(index)} — already exists`);
      } else {
        console.error(`  [ERR] ${collection}: ${JSON.stringify(index)} — ${err.message}`);
      }
    }
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped`);
  await mongoose.disconnect();
}

ensureIndexes().catch((err) => {
  console.error('Index creation failed:', err);
  process.exit(1);
});
