import mongoose from "mongoose";
import { ApiError } from "../utils/ApiError.js";

export const updateValidateMongoIds = (items) => {
  for (const { id, name, optional } of items) {
    if ((!optional && !id) || (id && !mongoose.Types.ObjectId.isValid(id))) {
      throw new ApiError(400, `Invalid ${name} ID`);
    }
  }
};