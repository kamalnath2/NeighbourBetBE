const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  request: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Request',
    required: true
  },
  messages: [{
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    content: {
      text: String,
      type: {
        type: String,
        enum: ['text', 'image', 'location', 'voice', 'file'],
        default: 'text'
      },
      fileUrl: String,
      location: {
        type: {
          type: String,
          enum: ['Point']
        },
        coordinates: [Number],
        address: String
      }
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    readBy: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      readAt: {
        type: Date,
        default: Date.now
      }
    }],
    edited: {
      type: Boolean,
      default: false
    },
    editedAt: Date
  }],
  lastMessage: {
    content: String,
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  settings: {
    muted: [{
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      mutedUntil: Date
    }]
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index for faster queries
chatSchema.index({ participants: 1 });
chatSchema.index({ request: 1 });
chatSchema.index({ 'messages.timestamp': -1 });

// Virtual for unread count per user
chatSchema.methods.getUnreadCount = function(userId) {
  let unreadCount = 0;
  
  this.messages.forEach(message => {
    const hasRead = message.readBy.some(read => 
      read.user.toString() === userId.toString()
    );
    
    if (!hasRead && message.sender.toString() !== userId.toString()) {
      unreadCount++;
    }
  });
  
  return unreadCount;
};

// Mark messages as read
chatSchema.methods.markAsRead = function(userId, messageIds = []) {
  if (messageIds.length === 0) {
    // Mark all messages as read
    this.messages.forEach(message => {
      const hasRead = message.readBy.some(read => 
        read.user.toString() === userId.toString()
      );
      
      if (!hasRead && message.sender.toString() !== userId.toString()) {
        message.readBy.push({ user: userId });
      }
    });
  } else {
    // Mark specific messages as read
    this.messages.forEach(message => {
      if (messageIds.includes(message._id.toString())) {
        const hasRead = message.readBy.some(read => 
          read.user.toString() === userId.toString()
        );
        
        if (!hasRead) {
          message.readBy.push({ user: userId });
        }
      }
    });
  }
  
  return this.save();
};

// Add message to chat
chatSchema.methods.addMessage = function(senderId, content) {
  const message = {
    sender: senderId,
    content: content,
    timestamp: new Date()
  };
  
  this.messages.push(message);
  
  // Update last message
  this.lastMessage = {
    content: content.text || 'Media message',
    sender: senderId,
    timestamp: new Date()
  };
  
  return this.save();
};

// Find or create chat between users for a request
chatSchema.statics.findOrCreate = async function(participants, requestId) {
  // Sort participants to ensure consistent ordering
  const sortedParticipants = participants.sort();
  
  let chat = await this.findOne({
    participants: { $all: sortedParticipants },
    request: requestId
  }).populate('participants', 'name profileImage')
    .populate('request', 'title type status');
  
  if (!chat) {
    chat = new this({
      participants: sortedParticipants,
      request: requestId
    });
    
    await chat.save();
    
    chat = await chat.populate('participants', 'name profileImage')
      .populate('request', 'title type status');
  }
  
  return chat;
};

// Get chat preview for chat list
chatSchema.virtual('preview').get(function() {
  const lastMsg = this.messages[this.messages.length - 1];
  
  return {
    id: this._id,
    requestTitle: this.request?.title || 'Unknown Request',
    participants: this.participants,
    lastMessage: this.lastMessage?.content || 'No messages yet',
    lastMessageTime: this.lastMessage?.timestamp || this.createdAt,
    isActive: this.isActive && this.request?.status !== 'completed'
  };
});

module.exports = mongoose.model('Chat', chatSchema);