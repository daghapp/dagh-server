import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "../config/cloudinary.js";
import { Request, Response, NextFunction } from "express";

const audioStorage = new CloudinaryStorage({
  cloudinary,
  params: async (_req, _file) => ({
    folder: "dagh/voice-notes",
    resource_type: "video",
    public_id: `voice-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
  }),
});

const upload = multer({
  storage: audioStorage,
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = [
      "audio/mpeg",
      "audio/mp3",
      "audio/m4a",
      "audio/mp4",
      "audio/wav",
      "audio/x-wav",
      "audio/aac",
      "audio/ogg",
      "audio/webm",
    ];

    if (allowedMimeTypes.includes(file.mimetype) || file.mimetype.startsWith("audio/")) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files (MP3, M4A, WAV, AAC, OGG, WEBM) are allowed for voice notes"));
    }
  },
});

export const audioUpload = upload;

export const handleAudioUploadError = (
  err: Error,
  _req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        success: false,
        error: "File too large. Maximum size is 15MB.",
      });
    }
    return res.status(400).json({
      success: false,
      error: `Upload error: ${err.message}`,
    });
  }

  if (err.message?.includes("audio files")) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }

  next(err);
};
