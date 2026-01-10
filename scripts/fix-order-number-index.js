/**
 * Script to fix orderNumber index issue
 * 
 * This script:
 * 1. Drops the existing non-sparse orderNumber_1 index
 * 2. Creates a new sparse index that allows multiple null values
 * 3. Optionally generates orderNumbers for existing orders with null orderNumber
 * 
 * Run with: node scripts/fix-order-number-index.js
 */

import mongoose from 'mongoose';
import { Order } from '../src/models/order.model.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
const envPath = join(__dirname, '../.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn(`⚠️  Warning: Could not load .env file from ${envPath}`);
  console.warn('   Trying to use environment variables from system...');
} else {
  console.log(`✅ Loaded environment variables from ${envPath}`);
}

const generateOrderNumber = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let orderNumber = '';
  for (let i = 0; i < 8; i++) {
    orderNumber += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return orderNumber;
};

const fixOrderNumberIndex = async () => {
  try {
    // Check if MONGODB_URI exists, otherwise use MONGO_URI + DB_Name
    const mongoUri = process.env.MONGODB_URI || 
                     (process.env.MONGO_URI && process.env.DB_Name 
                      ? `${process.env.MONGO_URI}/${process.env.DB_Name}` 
                      : null);
    
    if (!mongoUri) {
      console.error('\n❌ MongoDB connection string not found!');
      console.error('   Please set one of the following in your .env file:');
      console.error('   - MONGODB_URI=mongodb://localhost:27017/dgmarq');
      console.error('   OR');
      console.error('   - MONGO_URI=mongodb://localhost:27017');
      console.error('   - DB_Name=dgmarq');
      console.error('\n   Current environment variables:');
      console.error(`   - MONGODB_URI: ${process.env.MONGODB_URI ? '✅ Set' : '❌ Not set'}`);
      console.error(`   - MONGO_URI: ${process.env.MONGO_URI ? '✅ Set' : '❌ Not set'}`);
      console.error(`   - DB_Name: ${process.env.DB_Name ? '✅ Set' : '❌ Not set'}`);
      throw new Error('MongoDB connection string not found');
    }
    
    console.log(`Using MongoDB URI: ${mongoUri.replace(/\/\/.*@/, '//***:***@')}`); // Hide credentials in log
    
    console.log('Connecting to MongoDB...');
    // Connect to MongoDB
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Get the collection
    const collection = mongoose.connection.db.collection('orders');

    // Drop existing orderNumber_1 index if it exists
    try {
      await collection.dropIndex('orderNumber_1');
      console.log('✅ Dropped existing orderNumber_1 index');
    } catch (error) {
      if (error.code === 27) {
        console.log('ℹ️  orderNumber_1 index does not exist, skipping drop');
      } else {
        throw error;
      }
    }

    // Create new sparse index
    await collection.createIndex({ orderNumber: 1 }, { unique: true, sparse: true });
    console.log('✅ Created new sparse orderNumber index');

    // Find orders with null orderNumber
    const ordersWithoutNumber = await Order.find({ orderNumber: null }).lean();
    console.log(`Found ${ordersWithoutNumber.length} orders without orderNumber`);

    // Generate orderNumbers for existing orders
    if (ordersWithoutNumber.length > 0) {
      console.log('Generating orderNumbers for existing orders...');
      for (const order of ordersWithoutNumber) {
        let orderNumber;
        let attempts = 0;
        const maxAttempts = 10;
        
        do {
          orderNumber = generateOrderNumber();
          const existing = await Order.findOne({ orderNumber });
          if (!existing) break;
          attempts++;
          if (attempts >= maxAttempts) {
            orderNumber = `ORD${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
            break;
          }
        } while (attempts < maxAttempts);

        await Order.updateOne(
          { _id: order._id },
          { $set: { orderNumber } }
        );
        console.log(`  ✅ Updated order ${order._id} with orderNumber: ${orderNumber}`);
      }
      console.log(`✅ Updated ${ordersWithoutNumber.length} orders with orderNumbers`);
    }

    console.log('✅ All done!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

fixOrderNumberIndex();
