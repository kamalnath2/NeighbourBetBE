const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');

const router = express.Router();

// @desc    Update user location
// @route   PUT /api/location
// @access  Private
router.put('/', [
  body('coordinates').isArray({ min: 2, max: 2 }).withMessage('Coordinates must be an array of [longitude, latitude]'),
  body('address').optional().trim().isLength({ max: 255 }).withMessage('Address cannot be more than 255 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { coordinates, address } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        location: {
          type: 'Point',
          coordinates: coordinates,
          address: address || ''
        }
      },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      status: 'success',
      message: 'Location updated successfully',
      data: {
        location: user.location
      }
    });
  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Get user's current location
// @route   GET /api/location
// @access  Private
router.get('/', async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('location');

    res.status(200).json({
      status: 'success',
      data: {
        location: user.location
      }
    });
  } catch (error) {
    console.error('Get location error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Share location temporarily
// @route   POST /api/location/share
// @access  Private
router.post('/share', [
  body('coordinates').isArray({ min: 2, max: 2 }).withMessage('Coordinates must be an array of [longitude, latitude]'),
  body('address').optional().trim().isLength({ max: 255 }).withMessage('Address cannot be more than 255 characters'),
  body('duration').optional().isInt({ min: 1, max: 1440 }).withMessage('Duration must be between 1 and 1440 minutes')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { coordinates, address, duration = 60 } = req.body; // Default 1 hour

    // In a real app, you might store temporary location shares separately
    // For now, we'll just update the user's location
    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        location: {
          type: 'Point',
          coordinates: coordinates,
          address: address || ''
        },
        lastSeen: new Date()
      },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      status: 'success',
      message: 'Location shared successfully',
      data: {
        location: user.location,
        sharedUntil: new Date(Date.now() + duration * 60 * 1000)
      }
    });
  } catch (error) {
    console.error('Share location error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

module.exports = router;