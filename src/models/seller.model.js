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
    // payout info: for PayPal we'll store email; for other methods store masked/identifier
    payoutAccount: {
        type: String,
        default: 'inactive'
    }, // store encrypted/masked; e.g., paypal email
    kycDocs: [String], // array of URLs (S3), optional
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
}, { timestamps: true });

sellerSchema.plugin(mongooseAggregatePaginate)

export const Seller = mongoose.model("Seller", sellerSchema)