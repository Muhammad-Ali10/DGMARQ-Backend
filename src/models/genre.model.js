import mongoose from "mongoose";

const schema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },
    },
    { timestamps: true },
)

export const Genre = mongoose.model("Genre", schema)
