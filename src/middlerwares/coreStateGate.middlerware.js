import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { CoreState } from "../models/coreState.model.js";

/**
 * Gate middleware: when core state mode is "restricted", responds with 403.
 * Use only on routes that must be blocked in that state (e.g. admin dashboard).
 * Does not affect public APIs, webhooks, refund, or payout flows.
 */
export const coreStateGate = asyncHandler(async (req, res, next) => {
  const doc = await CoreState.findOne().select("mode").lean();
  const mode = doc?.mode ?? "active";

  if (mode === "restricted") {
    throw new ApiError(403, "Access temporarily unavailable");
  }

  next();
});
