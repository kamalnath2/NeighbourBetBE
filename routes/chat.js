const express = require('express');
const { body, validationResult } = require('express-validator');
const Chat = require('../models/Chat');
const Request = require('../models/Request');

const router = express.Router();

// @desc    Get user's chats
// @route   GET /api/chat
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { limit = 20, page = 1 } = req.query;

    const chats = await Chat.find({
      participants: req.user.id
    })
      .populate('participants', 'name profileImage lastSeen')
      .populate('request', 'title type status')
      .sort({ 'lastMessage.timestamp': -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    // Add unread count and other user info for each chat
    const chatsWithInfo = chats.map(chat => {
      const otherUser = chat.participants.find(
        participant => participant._id.toString() !== req.user.id
      );

      return {
        id: chat._id,
        requestTitle: chat.request?.title || 'Unknown Request',
        otherUser: {
          name: otherUser?.name || 'Unknown User',
          age: otherUser?.age,
          gender: otherUser?.gender,
          profileImage: otherUser?.profileImage,
          lastSeen: otherUser?.lastSeen
        },
        lastMessage: chat.lastMessage?.content || 'No messages yet',
        lastMessageTime: chat.lastMessage?.timestamp || chat.createdAt,
        unreadCount: chat.getUnreadCount(req.user.id),
        isActive: chat.isActive && chat.request?.status !== 'completed'
      };
    });

    res.status(200).json({
      status: 'success',
      results: chatsWithInfo.length,
      data: {
        chats: chatsWithInfo
      }
    });
  } catch (error) {
    console.error('Get chats error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Get single chat
// @route   GET /api/chat/:id
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.id)
      .populate('participants', 'name profileImage lastSeen')
      .populate('request', 'title type status')
      .populate('messages.sender', 'name profileImage');

    if (!chat) {
      return res.status(404).json({
        status: 'error',
        message: 'Chat not found'
      });
    }

    // Check if user is a participant
    const isParticipant = chat.participants.some(
      participant => participant._id.toString() === req.user.id
    );

    if (!isParticipant) {
      return res.status(403).json({
        status: 'error',
        message: 'You are not a participant in this chat'
      });
    }

    // Mark messages as read
    await chat.markAsRead(req.user.id);

    const otherUser = chat.participants.find(
      participant => participant._id.toString() !== req.user.id
    );

    res.status(200).json({
      status: 'success',
      data: {
        chat: {
          id: chat._id,
          request: chat.request,
          otherUser: {
            name: otherUser?.name || 'Unknown User',
            profileImage: otherUser?.profileImage,
            lastSeen: otherUser?.lastSeen
          },
          messages: chat.messages.map(message => ({
            id: message._id,
            text: message.content.text,
            type: message.content.type,
            fileUrl: message.content.fileUrl,
            location: message.content.location,
            timestamp: message.timestamp,
            isFromUser: message.sender._id.toString() === req.user.id,
            sender: message.sender
          })),
          isActive: chat.isActive
        }
      }
    });
  } catch (error) {
    console.error('Get chat error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Send message
// @route   POST /api/chat/:id/messages
// @access  Private
router.post('/:id/messages', [
  body('text').optional().trim().isLength({ min: 1, max: 1000 }).withMessage('Message text must be between 1 and 1000 characters'),
  body('type').optional().isIn(['text', 'image', 'location', 'voice', 'file']).withMessage('Invalid message type'),
  body('fileUrl').optional().isURL().withMessage('File URL must be valid'),
  body('location.coordinates').optional().isArray({ min: 2, max: 2 }).withMessage('Location coordinates must be an array of [longitude, latitude]')
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

    const { text, type = 'text', fileUrl, location } = req.body;

    const chat = await Chat.findById(req.params.id);

    if (!chat) {
      return res.status(404).json({
        status: 'error',
        message: 'Chat not found'
      });
    }

    // Check if user is a participant
    const isParticipant = chat.participants.some(
      participant => participant._id.toString() === req.user.id
    );

    if (!isParticipant) {
      return res.status(403).json({
        status: 'error',
        message: 'You are not a participant in this chat'
      });
    }

    // Prepare message content
    const messageContent = {
      type,
      text: text || '',
      fileUrl: fileUrl || '',
      location: location || null
    };

    // Add message to chat
    await chat.addMessage(req.user.id, messageContent);

    // Get updated chat with populated message
    const updatedChat = await Chat.findById(req.params.id)
      .populate('messages.sender', 'name profileImage');

    const newMessage = updatedChat.messages[updatedChat.messages.length - 1];

    res.status(201).json({
      status: 'success',
      message: 'Message sent successfully',
      data: {
        message: {
          id: newMessage._id,
          text: newMessage.content.text,
          type: newMessage.content.type,
          fileUrl: newMessage.content.fileUrl,
          location: newMessage.content.location,
          timestamp: newMessage.timestamp,
          isFromUser: true,
          sender: newMessage.sender
        }
      }
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Mark messages as read
// @route   PUT /api/chat/:id/read
// @access  Private
router.put('/:id/read', async (req, res) => {
  try {
    const { messageIds = [] } = req.body;

    const chat = await Chat.findById(req.params.id);

    if (!chat) {
      return res.status(404).json({
        status: 'error',
        message: 'Chat not found'
      });
    }

    // Check if user is a participant
    const isParticipant = chat.participants.some(
      participant => participant._id.toString() === req.user.id
    );

    if (!isParticipant) {
      return res.status(403).json({
        status: 'error',
        message: 'You are not a participant in this chat'
      });
    }

    await chat.markAsRead(req.user.id, messageIds);

    res.status(200).json({
      status: 'success',
      message: 'Messages marked as read'
    });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

// @desc    Get chat between users for a specific request
// @route   GET /api/chat/request/:requestId/user/:userId
// @access  Private
router.get('/request/:requestId/user/:userId', async (req, res) => {
  try {
    const { requestId, userId } = req.params;

    // Verify request exists and user has access
    const request = await Request.findById(requestId);
    
    if (!request) {
      return res.status(404).json({
        status: 'error',
        message: 'Request not found'
      });
    }

    // Check if user is involved in this request (requester or acceptor)
    const isRequester = request.requester.toString() === req.user.id;
    const hasAccepted = request.acceptedBy.some(
      acceptance => acceptance.user.toString() === req.user.id
    );

    if (!isRequester && !hasAccepted) {
      return res.status(403).json({
        status: 'error',
        message: 'You are not authorized to access this chat'
      });
    }

    // Find or create chat
    const chat = await Chat.findOrCreate([req.user.id, userId], requestId);

    res.status(200).json({
      status: 'success',
      data: {
        chatId: chat._id
      }
    });
  } catch (error) {
    console.error('Get/create chat error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Server error'
    });
  }
});

module.exports = router;