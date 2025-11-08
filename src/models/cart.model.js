import mongoose from "mongoose";


const cartItemSchema = new mongoose.Schema(
    {
        productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
        qty: { type: Number, default: 1 },
        unitPrice: { type: Number, required: true },
    },
    { _id: false },
)

const cartSchema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
        items: [cartItemSchema],
    },
    { timestamps: true },
)

cartSchema.index({ userId: 1 })

export const Cart = mongoose.model("Cart", cartSchema)
