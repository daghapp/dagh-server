import expres from "express";
import multer from "multer";
import { ImageUploadController } from "../modules/common/image-upload.controller.js";
import upload from "../middleware/cloudinary-upload.js";
import protectedRoute from "../middleware/protected.js";
import { fail } from "../helpers/response.js";

const router = expres.Router();
const imageUploadController = new ImageUploadController();

const handleUploadError: expres.ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return fail(res, 413, "File too large. Maximum size is 10MB.");
    }
    return fail(res, 400, `Upload error: ${err.message}`);
  }
  if (err instanceof Error && err.message?.includes("Only JPG, PNG images and PDFs are allowed")) {
    return fail(res, 400, err.message);
  }
  if (err instanceof Error && err.message?.includes("cloudinary")) {
    return fail(res, 400, "Upload failed. Please provide a valid image or PDF.");
  }
  next(err);
};

/**
 * @swagger
 * /upload:
 *   post:
 *     summary: Upload an image
 *     description: Uploads an image file to the server (e.g., to Cloudinary)
 *     tags: [Image Upload]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - image
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Image file to upload (JPEG, PNG, GIF, etc.)
 *     responses:
 *       200:
 *         description: Image uploaded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Image uploaded successfully
 *                 url:
 *                   type: string
 *                   format: uri
 *                   description: URL of the uploaded image
 *                   example: https://res.cloudinary.com/demo/image/upload/sample.jpg
 *                 publicId:
 *                   type: string
 *                   description: Public ID of the uploaded image
 *                   example: sample
 *       400:
 *         description: Invalid request - No image provided or invalid file format
 *       500:
 *         description: Internal server error - Upload failed
 */
// Phase 1.3 — Added protectedRoute middleware to prevent unauthenticated uploads to Cloudinary
router.post(
  "/",
  protectedRoute,
  upload.single("image"),
  handleUploadError,
  imageUploadController.uploadImage.bind(imageUploadController),
);

export { router };
