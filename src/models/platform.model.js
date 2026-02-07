import mongoose from "mongoose";

const schema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },
        isActive: {
            type: Boolean,
            default: true
        }
    },
    { timestamps: true },
)

// Purpose: Stores gaming platform types for product classification
export const Platform = mongoose.model("Platform", schema)

const platformSettingsSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        value: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
        },
        description: String,
        updatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },
    },
    { timestamps: true }
);

// Purpose: Stores global platform configuration settings with key-value pairs
export const PlatformSettings = mongoose.model("PlatformSettings", platformSettingsSchema);