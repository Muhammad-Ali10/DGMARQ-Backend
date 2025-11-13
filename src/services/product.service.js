import mongoose from "mongoose";
import { ApiError } from "../utils/ApiError.js";
import { fileUploader } from "../utils/cloudinary.js";

export const validateIds = (ids) => {
  ids.forEach(({ id, name, optional }) => {
    if ((!optional && !id) || (id && !mongoose.Types.ObjectId.isValid(id))) {
      throw new ApiError(400, `Invalid ${name} ID`);
    }
  });
};

export const checkRefs = async (refs) => {
  const checks = refs.map(async ({ model, id, name, optional }) => {
    if (!id && optional) return;
    const exists = await model.exists({ _id: id });
    if (!exists) throw new ApiError(400, `${name} not found`);
  });
  await Promise.all(checks);
};

export const checkDuplicate = async (model, filters, excludeId = null) => {
  const query = excludeId ? { _id: { $ne: excludeId }, ...filters } : filters;
  const exists = await model.findOne(query);
  if (exists) throw new ApiError(409, "Duplicate record exists");
};

export const uploadFiles = async (files) => {
  if (!files || Object.keys(files).length === 0) throw new ApiError(400, "Images are required");

  const paths = Array.isArray(files) ? files.map(f => f.path) : Object.values(files).flat().map(f => f.path);
  const urls = await Promise.all(paths.map(async path => (await fileUploader(path)).url));
  if (!urls.length) throw new ApiError(500, "File upload failed");
  return urls;
};

export const handleLicenseStock = async (typeId, TypeModel, LicenseKeyModel) => {
  if (!typeId) return null;
  const typeDoc = await TypeModel.findById(typeId);
  if (typeDoc?.name?.toLowerCase() === "licensekey") {
    return await LicenseKeyModel.countDocuments({ productId: null });
  }
  return null;
};
