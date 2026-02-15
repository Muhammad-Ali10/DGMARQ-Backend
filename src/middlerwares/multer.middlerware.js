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

const chatImageFilter = (req, file, cb) => {
  if (!CHAT_IMAGE_LIMITS.allowedTypes.includes(file.mimetype)) {
    return cb(new ApiError(400, 'Invalid file type. Only JPEG, PNG, GIF, WebP allowed'), false);
  }
  cb(null, true);
};

export const upload = multer({ storage });
export const uploadChatImage = multer({
  storage: memoryStorage,
  limits: { fileSize: CHAT_IMAGE_LIMITS.maxSize },
  fileFilter: chatImageFilter,
}).single('image');
