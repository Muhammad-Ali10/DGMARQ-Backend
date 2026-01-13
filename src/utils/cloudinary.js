import { v2 as cloudinary } from 'cloudinary'
import fs from 'fs'


const fileUploader = async (localfilepath) => {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });

  try {
    const respone = await cloudinary.uploader.upload(localfilepath,
      {
        resource_type: "auto"
      }
    )
    console.log(localfilepath)
    fs.unlinkSync(localfilepath)
    return respone
  } catch (error) {
    fs.unlinkSync(localfilepath)
    console.log(error)
  }

}

export { fileUploader };