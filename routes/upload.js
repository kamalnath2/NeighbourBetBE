const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Create subdirectories
const profileDir = path.join(uploadDir, 'profiles');
const requestDir = path.join(uploadDir, 'requests');
const chatDir = path.join(uploadDir, 'chat');

[profileDir, requestDir, chatDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadType = req.body.uploadType || 'general';
    let destDir = uploadDir;
    
    switch (uploadType) {
      case 'profile':
        destDir = profileDir;
        break;
      case 'request':
        destDir = requestDir;
        break;
      case 'chat':
        destDir = chatDir;
        break;
      default:
        destDir = uploadDir;
    }
    
    cb(null, destDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  // Check file type
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  }
});

// @desc    Upload image
// @route   POST /api/upload/image
// @access  Private
router.post('/image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'No image file provided'
      });
    }

    const { uploadType = 'general' } = req.body;
    
    // Generate the public URL for the uploaded file
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const relativePath = req.file.path.replace(path.join(__dirname, '../'), '').replace(/\\/g, '/');
    const imageUrl = `${baseUrl}/${relativePath}`;

    res.status(200).json({
      status: 'success',
      message: 'Image uploaded successfully',
      data: {
        imageUrl,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        uploadType
      }
    });
  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to upload image'
    });
  }
});

// @desc    Upload multiple images
// @route   POST /api/upload/images
// @access  Private
router.post('/images', upload.array('images', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No image files provided'
      });
    }

    const { uploadType = 'general' } = req.body;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    
    const uploadedImages = req.files.map(file => {
      const relativePath = file.path.replace(path.join(__dirname, '../'), '').replace(/\\/g, '/');
      return {
        imageUrl: `${baseUrl}/${relativePath}`,
        filename: file.filename,
        originalName: file.originalname,
        size: file.size
      };
    });

    res.status(200).json({
      status: 'success',
      message: 'Images uploaded successfully',
      data: {
        images: uploadedImages,
        uploadType,
        count: uploadedImages.length
      }
    });
  } catch (error) {
    console.error('Multiple images upload error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to upload images'
    });
  }
});

// @desc    Delete image
// @route   DELETE /api/upload/image/:filename
// @access  Private
router.delete('/image/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const { uploadType = 'general' } = req.query;
    
    let filePath;
    switch (uploadType) {
      case 'profile':
        filePath = path.join(profileDir, filename);
        break;
      case 'request':
        filePath = path.join(requestDir, filename);
        break;
      case 'chat':
        filePath = path.join(chatDir, filename);
        break;
      default:
        filePath = path.join(uploadDir, filename);
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        status: 'error',
        message: 'Image not found'
      });
    }

    // Delete the file
    fs.unlinkSync(filePath);

    res.status(200).json({
      status: 'success',
      message: 'Image deleted successfully'
    });
  } catch (error) {
    console.error('Image deletion error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete image'
    });
  }
});

// Error handling middleware for multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        status: 'error',
        message: 'File size too large. Maximum size is 5MB.'
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        status: 'error',
        message: 'Too many files. Maximum is 5 files.'
      });
    }
  }
  
  if (error.message === 'Only image files are allowed') {
    return res.status(400).json({
      status: 'error',
      message: 'Only image files are allowed'
    });
  }

  next(error);
});

module.exports = router;