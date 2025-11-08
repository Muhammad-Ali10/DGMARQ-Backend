import mongoose, { Schema } from "mongoose";
import { ORDER_STATUS, PAYMENT_STATUS } from "../constants.js";



const orderItemSubSchema = new Schema(
    {
        productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
        sellerId: { type: Schema.Types.ObjectId, ref: "Seller", required: true },
        qty: { type: Number, required: true },
        unitPrice: { type: Number, required: true },
        lineTotal: { type: Number, required: true }, // qty * unitPrice - item discounts
        assignedKeyId: { type: Schema.Types.ObjectId, ref: "LicenseKey", default: null },
        sellerEarning: { type: Number, default: 0 }, // price after commission
        commissionAmount: { type: Number, default: 10 },
    },
    { _id: false },
)

const orderSchema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
        items: [orderItemSubSchema],
        currency: { type: String, default: "EUR" },
        totalAmount: { type: Number, required: true },
        couponId: { type: Schema.Types.ObjectId, ref: "Coupon", default: null },
        paymentMethod: { type: String, enum: ["PayPal"], default: "PayPal" },
        paymentStatus: { type: String, enum: PAYMENT_STATUS, default: "pending", index: true },
        // PayPal fields
        paypalOrderId: String,
        paypalCaptureId: String,
        receiptUrl: String,
        orderStatus: { type: String, enum: ORDER_STATUS, default: "pending", index: true },
    },
    { timestamps: true },
)

orderSchema.index({ userId: 1, paymentStatus: 1, orderStatus: 1 })

export const Order = mongoose.model("Order", orderSchema)
