import mongoose, { Schema } from "mongoose";

const seoSettingsSchema = new Schema(
  {
    page: {
      type: String,
      required: true,
      enum: ['home'],
      default: 'home',
    },
    metaTitle: {
      type: String,
      required: true,
      maxlength: 60,
      trim: true,
    },
    metaDescription: {
      type: String,
      required: true,
      maxlength: 160,
      trim: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

seoSettingsSchema.index({ page: 1 }, { unique: true });

export const SeoSettings = mongoose.model("SeoSettings", seoSettingsSchema);
