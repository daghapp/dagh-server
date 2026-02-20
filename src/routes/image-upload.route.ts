import expres from 'express';
import { ImageUploadController } from '../Modules/common/image-upload.controller.js';

const router = expres.Router();
const imageUploadController = new ImageUploadController();

router.post('/upload', imageUploadController.uploadImage.bind(imageUploadController));


export {router}