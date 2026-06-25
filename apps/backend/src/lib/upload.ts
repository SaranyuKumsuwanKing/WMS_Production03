import multer from "multer";

// Shared multipart/form-data handler for the bulk-import endpoints. The file is
// kept in memory (the import parsers consume a Buffer) and capped at 50 MB.
// Routes use `upload.single("file")`; the handler reads `req.file`.
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});
