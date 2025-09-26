const express = require('express');
const { body, validationResult } = require('express-validator');
const Request = require('../models/Request');
const User = require('../models/User');
const Chat = require('../models/Chat');
const ProximityService = require('../services/proximityService');
const NotificationService = require('../utils/notificationService');

const router = express.Router();

// Helper function to broadcast new request to nearby users
async function broadcastNewRequestToNearbyUsers(request, nearbyUsers, io) {
  try {
    if (!nearbyUsers.length) {
      console.log('No nearby users found for broadcasting');
      return;
    }

    // Populate requester info for the payload
    await request.populate('requester', 'name age gender profileImage');

    const requestData = {
      id: request._id,
      title: request.title,
      description: request.description,
      type: request.type,
      location: request.location,
      radius: request.radius,
      maxAcceptors: request.maxAcceptors,
      createdAt: request.createdAt,
      requester: {
        _id: request.requester._id,
        name: request.requester.name,
        age: request.requester.age,
        gender: request.requester.gender,
        profileImage: request.requester.profileImage,
      },
      acceptedCount: request.acceptedCount,
      timeAgo: request.timeAgo,
    };

    // Broadcast to each nearby user's socket room
    nearbyUsers.forEach(user => {
      io.to(user._id.toString()).emit('newNearbyRequest', requestData);
    });

    console.log(`Broadcasted new request to ${nearbyUsers.length} nearby users`);
  } catch (error) {
    console.error('Error broadcasting new request:', error);
  }
}

// @desc    Create a new request
// @route   POST /api/requests
// @access  Private
router.post('/', [
  body('title').trim().isLength({ min: 5, max: 100 }).withMessage('Title must be between 5 and 100 characters'),
  body('description').trim().isLength({ min: 10, max: 1000 }).withMessage('Description must be between 10 and 1000 characters'),
  body('type').isIn(['emergency', 'help', 'social']).withMessage('Type must be emergency, help, or social'),
  body('coordinates').isArray({ min: 2, max: 2 }).withMessage('Coordinates must be an array of [longitude, latitude]'),
  body('address').trim().isLength({ min: 1, max: 255 }).withMessage('Address is required and must be less than 255 characters'),
  body('radius').optional().isInt({ min: 1, max: 50 }).withMessage('Radius must be between 1 and 50 km'),
  body('maxAcceptors').optional().isInt({ min: 1, max: 10 }).withMessage('Max acceptors must be between 1 and 10'),
  body('attachments').optional().isArray().withMessage('Attachments must be an array of strings'),
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

    const {
      title,
      description,
      type,
      coordinates,
      address,
      radius = 5,
      maxAcceptors = 3,
      filters = {},
      attachments = []
    } = req.body;

    const request = await Request.create({
      title,
      description,
      type,
      requester: req.user.id,
      location: {
        type: 'Point',
        coordinates,
        address
      },
      radius,
      maxAcceptors,
      filters,
      attachments
    });

    // Populate requester info
    await request.populate('requester', 'name age gender profileImage');

    // Update user stats
    await User.findByIdAndUpdate(req.user.id, {
      $inc: { 'stats.requestsSent': 1 }
    });

    // --- ADVANCED PROXIMITY SEARCH ---
    // 1. Find nearby users using the advanced Redis-based proximity service
    const nearbyUsers = await ProximityService.findNearbyUsers(
      coordinates[1], // latitude
      coordinates[0], // longitude
      radius
    );

    // 2. Broadcast to sockets using the list of nearby users
    broadcastNewRequestToNearbyUsers(request, nearbyUsers, req.app.get('io'));

    // 3. Send push notifications using the SAME list of nearby users
    NotificationService.notifyNearbyUsersOfNewRequest(request, req.user, nearbyUsers);

    res.status(201).json({
      status: 'success',
      message: 'Request created successfully',
      data: {
        request
      }
    });
  } catch (error) {
    console.error('Create request error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Get nearby requests
// @route   GET /api/requests/nearby
// @access  Private
router.get('/nearby', async (req, res) => {
  try {
    const { radius = 5, type, limit = 20, page = 1 } = req.query;
    
    const user = await User.findById(req.user.id);
    
    if (!user.location || !user.location.coordinates) {
      return res.status(400).json({
        status: 'error',
        message: 'Please update your location first'
      });
    }

    const filters = {
      requester: req.user.id // Exclude own requests
    };
    
    if (type) filters.type = type;

    const requests = await Request.findNearby(
      user.location.coordinates,
      parseInt(radius),
      filters
    ).limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    res.status(200).json({
      status: 'success',
      results: requests.length,
      data: {
        requests
      }
    });
  } catch (error) {
    console.error('Get nearby requests error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Get user's own requests
// @route   GET /api/requests/my-requests
// @access  Private
router.get('/my-requests', async (req, res) => {
  try {
    const { status, limit = 20, page = 1 } = req.query;
    
    const query = { requester: req.user.id };
    if (status) query.status = status;

    const requests = await Request.find(query)
      .populate('requester', 'name age gender profileImage')
      .populate('acceptedBy.user', 'name profileImage')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    res.status(200).json({
      status: 'success',
      results: requests.length,
      data: {
        requests
      }
    });
  } catch (error) {
    console.error('Get my requests error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Get requests user has accepted
// @route   GET /api/requests/accepted
// @access  Private
router.get('/accepted', async (req, res) => {
  try {
    const { limit = 20, page = 1 } = req.query;

    const requests = await Request.find({
      'acceptedBy.user': req.user.id
    })
      .populate('requester', 'name age gender profileImage')
      .populate('acceptedBy.user', 'name profileImage')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    res.status(200).json({
      status: 'success',
      results: requests.length,
      data: {
        requests
      }
    });
  } catch (error) {
    console.error('Get accepted requests error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Get single request
// @route   GET /api/requests/:id
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    const request = await Request.findById(req.params.id)
      .populate('requester', 'name age gender profileImage location')
      .populate('acceptedBy.user', 'name profileImage')
      .populate('responses.user', 'name profileImage');

    if (!request) {
      return res.status(404).json({
        status: 'error',
        message: 'Request not found'
      });
    }

    // Increment view count if not the requester
    if (request.requester._id.toString() !== req.user.id) {
      request.viewCount += 1;
      await request.save();
    }

    res.status(200).json({
      status: 'success',
      data: {
        request
      }
    });
  } catch (error) {
    console.error('Get request error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Accept a request
// @route   POST /api/requests/:id/accept
// @access  Private
router.post('/:id/accept', [
  body('message').optional().trim().isLength({ max: 500 }).withMessage('Message cannot be more than 500 characters')
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

    const { message } = req.body;
    const request = await Request.findById(req.params.id);

    if (!request) {
      return res.status(404).json({
        status: 'error',
        message: 'Request not found'
      });
    }

    // Check if user is trying to accept their own request
    if (request.requester.toString() === req.user.id) {
      return res.status(400).json({
        status: 'error',
        message: 'You cannot accept your own request'
      });
    }

    // Check if request is still active
    if (request.status !== 'active') {
      return res.status(400).json({
        status: 'error',
        message: 'Request is no longer active'
      });
    }

    // Check if user has already accepted
    const hasAccepted = request.acceptedBy.some(
      acceptance => acceptance.user.toString() === req.user.id
    );

    if (hasAccepted) {
      return res.status(400).json({
        status: 'error',
        message: 'You have already accepted this request'
      });
    }

    // Check if max acceptors reached
    if (request.acceptedBy.length >= request.maxAcceptors) {
      return res.status(400).json({
        status: 'error',
        message: 'Request has reached maximum acceptors'
      });
    }

    // Add user to acceptedBy array
    request.acceptedBy.push({
      user: req.user.id,
      acceptedAt: new Date()
    });

    // Add response if message provided
    if (message) {
      request.responses.push({
        user: req.user.id,
        message,
        responseType: 'accept'
      });
    }

    await request.save();

    // Update user stats
    await User.findByIdAndUpdate(req.user.id, {
      $inc: { 'stats.requestsAccepted': 1 }
    });

    // Create or get chat between requester and acceptor
    const chat = await Chat.findOrCreate([request.requester, req.user.id], request._id);

    // Populate the updated request
    await request.populate('requester', 'name age gender profileImage');
    await request.populate('acceptedBy.user', 'name profileImage');

    // Send push notification to requester
    const NotificationService = require('../utils/notificationService');
    const acceptor = await User.findById(req.user.id).select('name');
    NotificationService.notifyRequestAccepted(request, acceptor);

    // Broadcast status update via socket
    req.app.get('io').emit('requestStatusUpdate', {
      requestId: request._id,
      status: request.status,
      acceptedCount: request.acceptedBy.length
    });

    res.status(200).json({
      status: 'success',
      message: 'Request accepted successfully',
      data: {
        request,
        chatId: chat._id
      }
    });
  } catch (error) {
    console.error('Accept request error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Cancel acceptance of a request
// @route   DELETE /api/requests/:id/accept
// @access  Private
router.delete('/:id/accept', async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);

    if (!request) {
      return res.status(404).json({
        status: 'error',
        message: 'Request not found'
      });
    }

    // Remove user from acceptedBy array
    request.acceptedBy = request.acceptedBy.filter(
      acceptance => acceptance.user.toString() !== req.user.id
    );

    await request.save();

    // Update user stats
    await User.findByIdAndUpdate(req.user.id, {
      $inc: { 'stats.requestsAccepted': -1 }
    });

    res.status(200).json({
      status: 'success',
      message: 'Request acceptance cancelled successfully'
    });
  } catch (error) {
    console.error('Cancel acceptance error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Update request status
// @route   PUT /api/requests/:id/status
// @access  Private
router.put('/:id/status', [
  body('status').isIn(['completed', 'cancelled']).withMessage('Status must be completed or cancelled'),
  body('rating').optional().isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('feedback').optional().trim().isLength({ max: 500 }).withMessage('Feedback cannot be more than 500 characters')
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

    const { status, rating, feedback } = req.body;
    const request = await Request.findById(req.params.id);

    if (!request) {
      return res.status(404).json({
        status: 'error',
        message: 'Request not found'
      });
    }

    // Check if user is the requester
    if (request.requester.toString() !== req.user.id) {
      return res.status(403).json({
        status: 'error',
        message: 'Only the requester can update request status'
      });
    }

    request.status = status;
    
    if (status === 'completed') {
      request.completedAt = new Date();
      if (rating) request.rating = rating;
      if (feedback) request.feedback = feedback;
    }

    await request.save();

    // Send push notifications to acceptors about status change
    const NotificationService = require('../utils/notificationService');
    const changer = await User.findById(req.user.id).select('name');
    NotificationService.notifyRequestStatusChange(request, status, changer);

    // Broadcast status update via socket
    req.app.get('io').emit('requestStatusUpdate', {
      requestId: request._id,
      status: status,
      acceptedCount: request.acceptedBy.length
    });

    res.status(200).json({
      status: 'success',
      message: 'Request status updated successfully',
      data: {
        request
      }
    });
  } catch (error) {
    console.error('Update request status error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Delete request
// @route   DELETE /api/requests/:id
// @access  Private
router.delete('/:id', async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);

    if (!request) {
      return res.status(404).json({
        status: 'error',
        message: 'Request not found'
      });
    }

    // Check if user is the requester
    if (request.requester.toString() !== req.user.id) {
      return res.status(403).json({
        status: 'error',
        message: 'Only the requester can delete their request'
      });
    }

    // Check if request can be deleted (only if no one has accepted yet)
    if (request.acceptedBy.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot delete request that has been accepted by someone'
      });
    }

    await Request.findByIdAndDelete(req.params.id);

    res.status(200).json({
      status: 'success',
      message: 'Request deleted successfully'
    });
  } catch (error) {
    console.error('Delete request error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

module.exports = router;