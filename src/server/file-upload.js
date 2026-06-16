const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Upload destination directory
const UPLOAD_DIR = path.join(os.homedir(), 'Downloads', 'PhoneUploads');

// Ensure upload directory exists
try {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  console.log(`[file-upload] Upload directory: ${UPLOAD_DIR}`);
} catch (err) {
  console.error('[file-upload] Failed to create upload directory:', err.message);
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Ensure directory exists at upload time as well
    try {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    } catch (err) {
      // ignore — directory likely already exists
    }
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // Avoid filename collisions by prepending timestamp if file exists
    const originalName = file.originalname;
    const targetPath = path.join(UPLOAD_DIR, originalName);

    if (fs.existsSync(targetPath)) {
      const ext = path.extname(originalName);
      const base = path.basename(originalName, ext);
      const uniqueName = `${base}_${Date.now()}${ext}`;
      cb(null, uniqueName);
    } else {
      cb(null, originalName);
    }
  },
});

// File size limit: 500MB
const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500 MB
  },
});

/**
 * Express route handler for file upload.
 * Expects multer middleware to have already processed the file.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
function handleUpload(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded',
      });
    }

    console.log(`[file-upload] File received: ${req.file.originalname} (${req.file.size} bytes)`);

    res.json({
      success: true,
      filename: req.file.filename,
      originalname: req.file.originalname,
      path: req.file.path,
      size: req.file.size,
    });
  } catch (err) {
    console.error('[file-upload] handleUpload error:', err.message);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
}

module.exports = {
  upload,
  handleUpload,
  UPLOAD_DIR,
};
