import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: "churchify/uploads",
    resource_type: "auto",
    allowed_formats: ["jpg", "jpeg", "png", "pdf"],
    public_id: `${Date.now()}-${file.originalname.split(".")[0]}`,
  }),
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];

    if (!allowedTypes.includes(file.mimetype)) {
      cb(new Error("Only JPG, PNG images and PDFs are allowed"));
    } else {
      cb(null, true);
    }
  },
});

export default upload;
