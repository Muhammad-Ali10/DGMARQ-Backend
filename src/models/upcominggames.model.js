import mongoose, { Schema } from "mongoose";

const upcomingGamesSchema = new Schema(
  {
    products: [
      {
        productId: {
          type: Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        order: {
          type: Number,
          default: 0,
        },
        addedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Purpose: Retrieves or creates the singleton upcoming games configuration document
upcomingGamesSchema.statics.getOrCreate = async function () {
  let config = await this.findOne();
  if (!config) {
    config = await this.create({
      products: [],
      updatedAt: new Date(),
    });
  }
  return config;
};

upcomingGamesSchema.index({ "products.productId": 1 });
upcomingGamesSchema.index({ "products.order": 1 });
upcomingGamesSchema.index({ updatedAt: -1 });

// Purpose: Stores a curated list of upcoming game products for homepage display
export const UpcomingGames = mongoose.model("UpcomingGames", upcomingGamesSchema);
