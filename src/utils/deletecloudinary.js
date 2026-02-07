import { v2 as cloudinary } from "cloudinary"
import { logger } from "./logger.js"

// Purpose: Deletes a file from Cloudinary by public ID
const fileDelete = async (publicId, resource_type) => {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    })  
    
   const response = await cloudinary.uploader.destroy(publicId,{
    resource_type: resource_type
   })
   logger.debug('Cloudinary file delete response', response)
   return response
}

export { fileDelete }