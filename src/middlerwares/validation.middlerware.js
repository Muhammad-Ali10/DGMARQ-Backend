import { validationResult, body, param, query } from 'express-validator';
import { ApiError } from '../utils/ApiError.js';

/** Runs validations and throws ApiError on failure. */
export const validate = (validations) => {
  return async (req, res, next) => {
    await Promise.all(validations.map(validation => validation.run(req)));

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map(err => ({
        field: err.path || err.param,
        message: err.msg,
        value: err.value,
      }));
      
      throw new ApiError(400, 'Validation failed', errorMessages);
    }
    next();
  };
};

/** Param validation for Mongo ObjectId. */
export const mongoIdValidation = (field = 'id') => {
  return param(field).isMongoId().withMessage(`Invalid ${field} format`);
};

/** Body validation for Mongo ObjectId. */
export const mongoIdBodyValidation = (field = 'id') => {
  return body(field).isMongoId().withMessage(`Invalid ${field} format`);
};

export const emailValidation = () => {
  return body('email').isEmail().normalizeEmail().withMessage('Invalid email format');
};

export const passwordValidation = () => {
  return body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number');
};

export const ratingValidation = () => {
  return body('rating')
    .toInt()
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5');
};

export const priceValidation = () => {
  return body('price')
    .isFloat({ min: 0.01 })
    .withMessage('Price must be a positive number');
};

export const quantityValidation = () => {
  return body('qty')
    .isInt({ min: 1 })
    .withMessage('Quantity must be a positive integer');
};

export const registerValidation = [
  body('name').trim().isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters'),
  emailValidation(),
  passwordValidation(),
];

export const loginValidation = [
  emailValidation(),
  body('password').notEmpty().withMessage('Password is required'),
];

export const createProductValidation = [
  body('name').trim().isLength({ min: 3, max: 200 }).withMessage('Product name must be between 3 and 200 characters'),
  body('slug').trim().isLength({ min: 3 }).withMessage('Slug is required'),
  body('description').trim().isLength({ min: 10 }).withMessage('Description must be at least 10 characters'),
  priceValidation(),
  body('categoryId').isMongoId().withMessage('Invalid category ID'),
];

export const createReviewValidation = [
  mongoIdBodyValidation('productId'),
  mongoIdBodyValidation('orderId'),
  ratingValidation(),
  body('comment').trim().isLength({ min: 10, max: 1000 }).withMessage('Comment must be between 10 and 1000 characters'),
];

export const createCheckoutValidation = [
  body('couponCode').optional().trim().isLength({ min: 3, max: 20 }).withMessage('Invalid coupon code format'),
];

export const createGuestCheckoutValidation = [
  body('guestEmail').trim().isEmail().normalizeEmail().withMessage('Valid email is required for guest checkout'),
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.productId').isMongoId().withMessage('Invalid productId'),
  body('items.*.qty').optional().isInt({ min: 1 }).toInt().withMessage('Quantity must be at least 1'),
  body('couponCode').optional().trim().isLength({ min: 1, max: 50 }).withMessage('Invalid coupon code format'),
];

export const sendMessageValidation = [
  body('conversationId').isMongoId().withMessage('Invalid conversation ID'),
  body('messageText').trim().isLength({ min: 1, max: 2000 }).withMessage('Message must be between 1 and 2000 characters'),
  body('messageType').optional().isIn(['text', 'image', 'file']).withMessage('Invalid message type'),
];

export const sendImageMessageValidation = [
  body('conversationId').isMongoId().withMessage('Invalid conversation ID'),
  body('messageText').optional().trim().isLength({ max: 2000 }).withMessage('Message must be at most 2000 characters'),
];

