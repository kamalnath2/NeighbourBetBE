const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a name'],
    trim: true,
    maxlength: [50, 'Name cannot be more than 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Please provide an email'],
    unique: true,
    lowercase: true,
    match: [
      /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
      'Please provide a valid email'
    ]
  },
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: 6,
    select: false
  },
  phone: {
    type: String,
    required: [true, 'Please provide a phone number']
  },
  age: {
    type: Number,
    required: [true, 'Please provide your age'],
    min: [13, 'You must be at least 13 years old'],
    max: [120, 'Please provide a valid age']
  },
  gender: {
    type: String,
    required: true,
    enum: ['male', 'female', 'other']
  },
  bio: {
    type: String,
    maxlength: [500, 'Bio cannot be more than 500 characters'],
    default: ''
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      default: [0, 0] // Default to [0, 0] coordinates if not provided
    },
    address: {
      type: String,
      default: ''
    }
  },
  profileImage: {
    type: String,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  settings: {
    emergencyNotifications: {
      type: Boolean,
      default: true
    },
    helpNotifications: {
      type: Boolean,
      default: true
    },
    socialNotifications: {
      type: Boolean,
      default: true
    },
    locationSharing: {
      type: Boolean,
      default: true
    },
    showAge: {
      type: Boolean,
      default: true
    },
    showGender: {
      type: Boolean,
      default: true
    },
    searchRadius: {
      type: Number,
      default: 5, // kilometers
      min: 1,
      max: 50
    }
  },
  deviceTokens: [{
    token: {
      type: String,
      required: true
    },
    platform: {
      type: String,
      enum: ['ios', 'android'],
      required: true
    },
    lastUsed: {
      type: Date,
      default: Date.now
    }
  }],
  stats: {
    requestsSent: {
      type: Number,
      default: 0
    },
    requestsAccepted: {
      type: Number,
      default: 0
    },
    helpfulRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    totalRatings: {
      type: Number,
      default: 0
    },
    averageResponseTime: {
      type: Number,
      default: 0 // in minutes
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index for geospatial queries
userSchema.index({ location: '2dsphere' });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Update last seen
userSchema.methods.updateLastSeen = function() {
  this.lastSeen = new Date();
  return this.save();
};

// Get users within radius
userSchema.statics.findNearby = function(coordinates, radius = 5) {
  return this.find({
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: coordinates
        },
        $maxDistance: radius * 1000 // Convert km to meters
      }
    },
    isActive: true,
    'settings.locationSharing': true
  });
};

module.exports = mongoose.model('User', userSchema);