import { Request, Response } from "express";
import { created, fail } from "../../helpers/response.js";

export class ImageUploadController {
  async uploadImage(req: Request, res: Response) {
    try {
      const file = req.file as Express.Multer.File | undefined;

      if (!file) {
        return fail(res, 400, "No file uploaded");
      }

      return created(
        res,
        {
          url: file.path,
          publicId: file.filename,
        },
        "Upload successful",
      );
    } catch (error) {
      console.error("Upload error:", error);
      return fail(res, 500, "Upload failed");
    }
  }
}
