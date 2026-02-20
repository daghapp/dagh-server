import { Request, Response } from "express";

export class ImageUploadController {
  async uploadImage(req: Request, res: Response) {
    try {
      const file = req.file as any;

      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      return res.status(201).json({
        message: "Upload successful",
        url: file.path, // Cloudinary secure URL
        publicId: file.filename, // Cloudinary public_id
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Upload failed",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}
