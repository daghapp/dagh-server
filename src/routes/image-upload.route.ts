import expres from 'express';
import { ImageUploadController } from '../Modules/common/image-upload.controller.js';
import upload from '../middleware/cloudinary-upload.js';

const router = expres.Router();
const imageUploadController = new ImageUploadController();

/**
 * @swagger
 * /upload:
 *   post:
 *     summary: Upload an image
 *     description: Uploads an image file to the server (e.g., to Cloudinary)
 *     tags: [Image Upload]
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
router.post('/', upload.single('image'), imageUploadController.uploadImage.bind(imageUploadController));


export {router}