import { Request, Response } from "express";
import { created, fail } from "../../helpers/response.js";
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

interface CloudinaryFile extends Express.Multer.File {
  format?: string;
}

export class ImageUploadController {
  async uploadImage(req: Request, res: Response) {
    try {
      const file = req.file as CloudinaryFile | undefined;

      if (!file) {
        return fail(res, 400, "No file uploaded");
      }

      // Client-side validation standards are enforced on the mobile app:
      // - Maximum file size: 10MB
      // - Accepted formats: JPEG, PNG
      // - Minimum resolution: 800x600 pixels
      // These are checked client-side before upload to prevent bloated storage.

      // Cloud function triggers on upload to:
      // 1. Compress the image
      // 2. Generate optimized thumbnails (WebP format) for fast mobile rendering
      // 3. Run automated image moderation to screen for inappropriate content

      return created(
        res,
        {
          url: file.path,
          publicId: file.filename,
          format: file.format || file.mimetype.split("/")[1],
          size: file.size,
        },
        "Upload successful - image will be processed automatically",
      );
    } catch (error) {
      console.error("Upload error:", error);
      return fail(res, 500, "Upload failed");
    }
  }
}
