import mongoose from "mongoose";
import { ApiError } from "../utils/ApiError.js";

// Purpose: Validates MongoDB ObjectIDs for update operations
export const updateValidateMongoIds = (items) => {
  for (const { id, name, optional } of items) {
    if ((!optional && !id) || (id && !mongoose.Types.ObjectId.isValid(id))) {
      throw new ApiError(400, `Invalid ${name} ID`);
    }
  }
};