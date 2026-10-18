// ───────────────
// SITE PHOTO UPLOAD MIDDLEWARE (§4) — memory storage for dimension validation
// Multer configured with memoryStorage so we can validate dimensions before
// committing to Cloudinary. Upload happens in service from buffer.
// ───────────────

import multer from "multer";
import type { Request } from "express";

const storage = multer.memoryStorage();

const fileFilter = (
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
): void => {
  const allowedTypes = ["image/jpeg", "image/jpg", "image/png"];

  if (!allowedTypes.includes(file.mimetype)) {
    cb(new Error("Only JPG and PNG images are allowed"));
    return;
  }

  cb(null, true);
};

const sitePhotoUpload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB (§4)
    files: 1,
  },
  fileFilter,
});

export default sitePhotoUpload;
