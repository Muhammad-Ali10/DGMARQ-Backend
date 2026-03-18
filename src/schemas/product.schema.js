import { z } from "zod";

const mongoIdRegex = /^[0-9a-fA-F]{24}$/;
const mongoId = z.string().regex(mongoIdRegex, "Invalid ID format");
const optionalMongoId = z.string().regex(mongoIdRegex, "Invalid ID format").optional().or(z.literal(""));

export const createProductSchema = z.object({
  body: z.object({
    name: z.string().min(2, "Name must be at least 2 characters").max(200),
    slug: z.string().min(2, "Slug is required").max(200),
    description: z.string().min(10, "Description must be at least 10 characters").max(5000),
    price: z.coerce.number().positive("Price must be positive"),
    stock: z.coerce.number().int().min(0).optional(),
    categoryId: mongoId,
    subCategoryId: optionalMongoId,
    platform: mongoId,
    region: mongoId,
    type: mongoId,
    genre: mongoId,
    mode: mongoId,
    device: optionalMongoId,
    theme: optionalMongoId,
    discount: z.coerce.number().min(0).max(100).optional(),
    isFeatured: z.coerce.boolean().optional(),
    productType: z.enum(["LICENSE_KEY", "ACCOUNT_BASED", "license_key", "account_based"]).optional(),
    metaTitle: z.string().max(70).optional(),
    metaDescription: z.string().max(160).optional(),
  }),
});

export const productIdParamSchema = z.object({
  params: z.object({
    id: mongoId,
  }),
});
