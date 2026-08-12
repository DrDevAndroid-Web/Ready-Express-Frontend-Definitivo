import multer from "multer";

const MAX_SIZE_MB = parseFloat(process.env.MAX_FILE_SIZE) || 5;
const MAX_SIZE = MAX_SIZE_MB * 1024 * 1024;

const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten imágenes"));
    }
  }
});