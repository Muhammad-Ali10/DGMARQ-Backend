import mongoose, { Schema } from "mongoose";

const upcomingReleaseSchema = new Schema(
  {
    slots: [
      {
        slotNumber: {
          type: Number,
          required: true,
          enum: [1, 2],
        },
        productId: {
          type: Schema.Types.ObjectId,
          ref: "Product",
          default: null,
        },
        backgroundImageUrl: {
          type: String,
          default: "",
        },
        backgroundImagePublicId: {
          type: String,
          default: null,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
        updatedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  { timestamps: true }
);

upcomingReleaseSchema.statics.getOrCreate = async function () {
  let config = await this.findOne();
  if (!config) {
    config = await this.create({
      slots: [
        { slotNumber: 1, productId: null, backgroundImageUrl: "" },
        { slotNumber: 2, productId: null, backgroundImageUrl: "" },
      ],
    });
  }
  return config;
};

export const UpcomingRelease = mongoose.model("UpcomingRelease", upcomingReleaseSchema);

