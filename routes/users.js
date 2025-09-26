const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Request = require('../models/Request');
const ProximityService = require('../services/proximityService');

const router = express.Router();

// @desc    Get user profile
// @route   GET /api/users/profile
// @access  Private
router.get('/profile', async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    res.status(200).json({
      status: 'success',
      data: {
        user
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Update user profile
// @route   PUT /api/users/profile
// @access  Private
router.put('/profile', [
  body('name').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters'),
  body('phone').optional().isMobilePhone().withMessage('Please provide a valid phone number'),
  body('age').optional().isInt({ min: 13, max: 120 }).withMessage('Age must be between 13 and 120'),
  body('gender').optional().isIn(['male', 'female', 'other']).withMessage('Gender must be male, female, or other'),
  body('bio').optional().isLength({ max: 500 }).withMessage('Bio cannot be more than 500 characters')
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

    const allowedUpdates = ['name', 'phone', 'age', 'gender', 'bio'];
    const updates = {};
    
    Object.keys(req.body).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updates[key] = req.body[key];
      }
    });

    const user = await User.findByIdAndUpdate(
      req.user.id,
      updates,
      {
        new: true,
        runValidators: true
      }
    );

    res.status(200).json({
      status: 'success',
      message: 'Profile updated successfully',
      data: {
        user
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Update user location
// @route   PUT /api/users/location
// @access  Private
router.put('/location', [
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

    // Update location in the Redis grid for fast proximity searches
    await ProximityService.updateUserLocation(req.user.id, coordinates[1], coordinates[0]);

    res.status(200).json({
      status: 'success',
      message: 'Location updated successfully',
      data: {
        user
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

// @desc    Update user settings
// @route   PUT /api/users/settings
// @access  Private
router.put('/settings', async (req, res) => {
  try {
    const allowedSettings = [
      'emergencyNotifications',
      'helpNotifications', 
      'socialNotifications',
      'locationSharing',
      'showAge',
      'showGender',
      'searchRadius'
    ];

    const settingsUpdates = {};
    Object.keys(req.body).forEach(key => {
      if (allowedSettings.includes(key)) {
        settingsUpdates[`settings.${key}`] = req.body[key];
      }
    });

    if (Object.keys(settingsUpdates).length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No valid settings provided'
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      settingsUpdates,
      { new: true, runValidators: true }
    );

    res.status(200).json({
      status: 'success',
      message: 'Settings updated successfully',
      data: {
        user
      }
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Get user stats
// @route   GET /api/users/stats
// @access  Private
router.get('/stats', async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    
    // Get additional stats from requests
    const sentRequests = await Request.countDocuments({ requester: req.user.id });
    const acceptedRequests = await Request.countDocuments({ 
      'acceptedBy.user': req.user.id 
    });

    const stats = {
      ...user.stats.toObject(),
      requestsSent: sentRequests,
      requestsAccepted: acceptedRequests
    };

    res.status(200).json({
      status: 'success',
      data: {
        stats
      }
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Get nearby users
// @route   GET /api/users/nearby
// @access  Private
router.get('/nearby', async (req, res) => {
  try {
    const { radius = 5 } = req.query;
    const user = await User.findById(req.user.id);

    if (!user.location || !user.location.coordinates) {
      return res.status(400).json({
        status: 'error',
        message: 'Please update your location first'
      });
    }

    const nearbyUsers = await User.findNearby(
      user.location.coordinates,
      parseInt(radius)
    ).select('name age gender location profileImage lastSeen stats.helpfulRating');

    // Filter out current user
    const filteredUsers = nearbyUsers.filter(
      nearbyUser => nearbyUser._id.toString() !== req.user.id
    );

    res.status(200).json({
      status: 'success',
      results: filteredUsers.length,
      data: {
        users: filteredUsers
      }
    });
  } catch (error) {
    console.error('Get nearby users error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Deactivate account
// @route   PUT /api/users/deactivate
// @access  Private
router.put('/deactivate', async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { isActive: false });

    res.status(200).json({
      status: 'success',
      message: 'Account deactivated successfully'
    });
  } catch (error) {
    console.error('Deactivate account error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Delete account
// @route   DELETE /api/users/account
// @access  Private
router.delete('/account', async (req, res) => {
  try {
    // In a real app, you might want to anonymize data instead of deleting
    await User.findByIdAndDelete(req.user.id);

    res.status(200).json({
      status: 'success',
      message: 'Account deleted successfully'
    });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Register device token for push notifications
// @route   POST /api/users/device-token
// @access  Private
router.post('/device-token', [
  body('token').trim().isLength({ min: 100 }).withMessage('Device token is required'),
  body('platform').isIn(['ios', 'android']).withMessage('Platform must be ios or android')
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

    const { token, platform } = req.body;

    // Remove this token from other users (in case user logged in on different device)
    await User.updateMany(
      { 'deviceTokens.token': token },
      { $pull: { deviceTokens: { token } } }
    );

    // Add token to current user
    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        $push: {
          deviceTokens: {
            token,
            platform,
            lastUsed: new Date()
          }
        }
      },
      { new: true }
    );

    res.status(200).json({
      status: 'success',
      message: 'Device token registered successfully'
    });
  } catch (error) {
    console.error('Register device token error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Remove device token
// @route   DELETE /api/users/device-token
// @access  Private
router.delete('/device-token', [
  body('token').trim().isLength({ min: 100 }).withMessage('Device token is required')
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

    const { token } = req.body;

    await User.findByIdAndUpdate(
      req.user.id,
      { $pull: { deviceTokens: { token } } }
    );

    res.status(200).json({
      status: 'success',
      message: 'Device token removed successfully'
    });
  } catch (error) {
    console.error('Remove device token error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

module.exports = router;