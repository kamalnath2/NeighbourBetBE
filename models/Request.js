const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Please provide a title'],
    trim: true,
    maxlength: [100, 'Title cannot be more than 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Please provide a description'],
    maxlength: [1000, 'Description cannot be more than 1000 characters']
  },
  type: {
    type: String,
    required: true,
    enum: ['emergency', 'help', 'social']
  },
  status: {
    type: String,
    enum: ['active', 'accepted', 'completed', 'expired', 'cancelled'],
    default: 'active'
  },
  requester: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      required: true
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true
    },
    address: {
      type: String,
      required: true
    }
  },
  radius: {
    type: Number,
    required: true,
    min: 1,
    max: 50, // maximum 50km radius
    default: 5
  },
  maxAcceptors: {
    type: Number,
    required: true,
    min: 1,
    max: 10,
    default: 3
  },
  acceptedBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    acceptedAt: {
      type: Date,
      default: Date.now
    },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'completed', 'cancelled'],
      default: 'pending'
    }
  }],
  filters: {
    ageRange: {
      min: {
        type: Number,
        default: 18
      },
      max: {
        type: Number,
        default: 65
      }
    },
    genderFilter: {
      type: String,
      enum: ['all', 'male', 'female'],
      default: 'all'
    },
    maxRecipients: {
      type: Number,
      default: 50,
      min: 1,
      max: 500
    }
  },
  attachments: [{
    type: String // File paths or URLs
  }],
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'emergency'],
    default: function() {
      return this.type === 'emergency' ? 'emergency' : 'medium';
    }
  },
  expiresAt: {
    type: Date,
    default: function() {
      // Emergency requests expire in 4 hours, others in 24 hours
      const hours = this.type === 'emergency' ? 4 : 24;
      return new Date(Date.now() + hours * 60 * 60 * 1000);
    }
  },
  responses: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    message: String,
    responseType: {
      type: String,
      enum: ['accept', 'decline', 'question'],
      default: 'accept'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  completedAt: Date,
  rating: {
    type: Number,
    min: 1,
    max: 5
  },
  feedback: String,
  viewCount: {
    type: Number,
    default: 0
  },
  shareCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index for geospatial queries
requestSchema.index({ location: '2dsphere' });
requestSchema.index({ status: 1 });
requestSchema.index({ type: 1 });
requestSchema.index({ requester: 1 });
requestSchema.index({ expiresAt: 1 });

// Virtual for accepted count
requestSchema.virtual('acceptedCount').get(function() {
  return this.acceptedBy.length;
});

// Virtual for available spots
requestSchema.virtual('availableSpots').get(function() {
  return this.maxAcceptors - this.acceptedBy.length;
});

// Virtual for time ago
requestSchema.virtual('timeAgo').get(function() {
  const now = new Date();
  const diff = now - this.createdAt;
  const minutes = Math.floor(diff / 60000);
  
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
});

// Find nearby requests
requestSchema.statics.findNearby = function(coordinates, radius = 5, filters = {}) {
  const query = {
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: coordinates
        },
        $maxDistance: radius * 1000 // Convert km to meters
      }
    },
    status: 'active',
    expiresAt: { $gt: new Date() }
  };

  // Apply additional filters
  if (filters.type) query.type = filters.type;
  if (filters.requester) query.requester = { $ne: filters.requester }; // Exclude own requests

  return this.find(query)
    .populate('requester', 'name age gender profileImage')
    .populate('acceptedBy.user', 'name profileImage')
    .sort({ priority: -1, createdAt: -1 });
};

// Auto-expire requests
requestSchema.pre('save', function(next) {
  if (this.expiresAt < new Date() && this.status === 'active') {
    this.status = 'expired';
  }
  next();
});

// Update request status when max acceptors reached
requestSchema.pre('save', function(next) {
  if (this.acceptedBy.length >= this.maxAcceptors && this.status === 'active') {
    this.status = 'accepted';
  }
  next();
});

module.exports = mongoose.model('Request', requestSchema);