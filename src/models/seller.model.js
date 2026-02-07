import mongoose from "mongoose";
import { SELLER_STATUS } from "../constants.js";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2"

const sellerSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true
    },
    shopName: {
        type: String,
        required: true,
        index: true
    },
    shopLogo: {
        type: String
    },
    shopBanner: {
        type: String
    },
    description: {
        type: String
    },
    country: {
        type: String
    },
    state: {
        type: String
    },
    city: {
        type: String
    },
    payoutAccount: {
        type: String,
        default: 'inactive'
    },
    kycDocs: [String],
    rating: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: SELLER_STATUS,
        default: 'pending',
        index: true

    },
    minPayoutAmount: {
        type: Number,
        default: 1.0
    },
    payoutAutoRelease: {
        type: Boolean,
        default: true
    },
    // PayPal OAuth onboarding (no manual email)
    paypalMerchantId: { type: String, default: null },
    paypalEmail: { type: String, default: null },
    paypalVerified: { type: Boolean, default: false },
    paypalOAuthConnected: { type: Boolean, default: false },
    paymentsReceivable: { type: Boolean, default: false },
    accountStatus: { type: String, enum: ['verified', 'unverified', 'limited'], default: null },
    oauthConnectedAt: { type: Date, default: null },
    accountBlocked: { type: Boolean, default: false },
    availableBalance: { type: Number, default: 0 },
    pendingBalance: { type: Number, default: 0 },
    lastPayoutAttempt: { type: Date, default: null },
}, { timestamps: true });

sellerSchema.plugin(mongooseAggregatePaginate)

// Purpose: Represents a seller account with shop details and payout settings
export const Seller = mongoose.model("Seller", sellerSchema)