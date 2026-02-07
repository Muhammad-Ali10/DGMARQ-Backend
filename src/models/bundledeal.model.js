import mongoose, { Schema } from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const bundleDealSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      default: "Exclusive Bundle Deals",
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    products: {
      type: [Schema.Types.ObjectId],
      ref: "Product",
      validate: {
        validator: function (products) {
          if (!products || products.length !== 2) return false;
          return products[0].toString() !== products[1].toString();
        },
        message: "Bundle must contain exactly 2 unique products",
      },
      required: true,
    },
    discountType: {
      type: String,
      enum: ["percentage", "fixed"],
      required: true,
    },
    discountValue: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: function (value) {
          if (this.discountType === "percentage") {
            return value > 0 && value <= 100;
          }
          return value > 0;
        },
        message: "Invalid discount value for selected discount type",
      },
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
      validate: {
        validator: function (value) {
          return value > this.startDate;
        },
        message: "End date must be after start date",
      },
    },
    bannerImage: {
      type: String,
      required: true,
    },
    bannerImagePublicId: {
      type: String,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

bundleDealSchema.index({ isActive: 1, startDate: 1, endDate: 1 });
bundleDealSchema.index({ "products": 1 });

// Purpose: Returns whether the bundle deal is currently active based on dates and status
bundleDealSchema.virtual("isCurrentlyActive").get(function () {
  const now = new Date();
  return (
    this.isActive &&
    this.startDate <= now &&
    this.endDate >= now
  );
});

// Purpose: Auto-generates slug from title before saving if not provided
bundleDealSchema.pre("save", function (next) {
  if (!this.slug && this.title) {
    this.slug = this.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }
  next();
});

bundleDealSchema.plugin(mongooseAggregatePaginate);

// Purpose: Represents promotional bundle deals combining two products with discounts
export const BundleDeal = mongoose.model("BundleDeal", bundleDealSchema);

