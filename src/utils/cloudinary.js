import { v2 as cloudinary } from 'cloudinary'
import fs from 'fs'
import { Readable } from 'stream'

const getCloudinaryConfig = () => {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
};

const CHAT_IMAGE_LIMITS = {
  maxSize: 5 * 1024 * 1024,
  allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
};

const uploadChatImageFromBuffer = (buffer) => {
  return new Promise((resolve, reject) => {
    getCloudinaryConfig();
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'chat',
        resource_type: 'image',
        transformation: [{ quality: 'auto', fetch_format: 'auto' }],
      },
      (error, result) => {
        if (error) return reject(error);
        if (!result) return reject(new Error('Upload failed'));
        const url = result.secure_url || (result.url?.replace?.('http://', 'https://'));
        resolve({
          url,
          publicId: result.public_id,
          width: result.width,
          height: result.height,
        });
      }
    );
    Readable.from(buffer).pipe(stream);
  });
};

// Purpose: Uploads a file to Cloudinary and returns HTTPS URL
const fileUploader = async (localfilepath) => {
  getCloudinaryConfig();

  try {
    const response = await cloudinary.uploader.upload(localfilepath,
      {
        resource_type: "auto"
      }
    )
    fs.unlinkSync(localfilepath)
    
    if (response.secure_url) {
      response.url = response.secure_url;
    } else if (response.url && response.url.startsWith('http://')) {
      response.url = response.url.replace('http://', 'https://');
    }
    
    return response
  } catch (error) {
    fs.unlinkSync(localfilepath)
    throw error
  }

}

// Purpose: Converts HTTP URLs to HTTPS format
export const normalizeToHttps = (url) => {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('http://')) {
    return url.replace('http://', 'https://');
  }
  return url;
}

export { fileUploader, uploadChatImageFromBuffer, CHAT_IMAGE_LIMITS };