import multer from "multer";
import path from "path";
import fs from "fs";
import { ApiError } from "../utils/ApiError.js";
import { CHAT_IMAGE_LIMITS } from "../utils/cloudinary.js";

const tempDir = path.join(process.cwd(), "public", "temp");

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        fs.mkdirSync(tempDir, { recursive: true });
        cb(null, tempDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const memoryStorage = multer.memoryStorage();
const REFUND_CHAT_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const REFUND_CHAT_ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const REFUND_CHAT_MAX_FILES = 5;

const chatImageFilter = (req, file, cb) => {
  if (!CHAT_IMAGE_LIMITS.allowedTypes.includes(file.mimetype)) {
    return cb(new ApiError(400, 'Invalid file type. Only JPEG, PNG, GIF, WebP allowed'), false);
  }
  cb(null, true);
};

const refundChatImageFilter = (req, file, cb) => {
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (!REFUND_CHAT_ALLOWED_MIME_TYPES.includes(file.mimetype) || !REFUND_CHAT_ALLOWED_EXTENSIONS.includes(extension)) {
    return cb(new ApiError(400, 'Invalid file type. Only JPG, PNG, and WebP are allowed'), false);
  }
  cb(null, true);
};

export const upload = multer({ storage });
export const uploadChatImage = multer({
  storage: memoryStorage,
  limits: { fileSize: CHAT_IMAGE_LIMITS.maxSize },
  fileFilter: chatImageFilter,
}).single('image');
export const uploadRefundChatImages = multer({
  storage: memoryStorage,
  limits: {
    fileSize: CHAT_IMAGE_LIMITS.maxSize,
    files: REFUND_CHAT_MAX_FILES,
  },
  fileFilter: refundChatImageFilter,
}).array('images', REFUND_CHAT_MAX_FILES);
