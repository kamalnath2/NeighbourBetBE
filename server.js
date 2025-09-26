const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { connectRedis } = require('./utils/redisClient');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const requestRoutes = require('./routes/requests');
const chatRoutes = require('./routes/chat');
const locationRoutes = require('./routes/location');
const uploadRoutes = require('./routes/upload');

// Import middleware
const { protect } = require('./middleware/auth');
const errorHandler = require('./middleware/error');

const app = express();
const server = http.createServer(app);

// Socket.io setup
const io = socketIo(server, {
  cors: {
    origin: true, // Allow all origins for development
    methods: ['GET', 'POST']
  }
});

// Make io accessible to our router
app.set('io', io);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500 // limit each IP to 500 requests per windowMs for development
});

// Middleware
app.use(helmet());
app.use(morgan('combined'));
app.use(limiter);
app.use(cors({
  origin: true, // Allow all origins for development
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', protect, userRoutes);
app.use('/api/requests', protect, requestRoutes);
app.use('/api/chat', protect, chatRoutes);
app.use('/api/location', protect, locationRoutes);
app.use('/api/upload', protect, uploadRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'HelpMate API is running',
    timestamp: new Date().toISOString()
  });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join user to their room
  socket.on('join', (userId) => {
    socket.join(userId);
    console.log(`User ${userId} joined room`);
  });

  // Handle chat messages
  socket.on('sendMessage', (data) => {
    const { chatId, message, senderId, receiverId } = data;
    
    // Emit to both sender and receiver
    io.to(senderId).emit('newMessage', {
      chatId,
      message,
      senderId,
      timestamp: new Date()
    });
    
    io.to(receiverId).emit('newMessage', {
      chatId,
      message,
      senderId,
      timestamp: new Date()
    });
  });

  // Handle joining/leaving request-specific rooms for location tracking
  socket.on('joinRequestRoom', (data) => {
    const { requestId } = data;
    socket.join(`request-${requestId}`);
    console.log(`User ${socket.id} joined room request-${requestId}`);
  });

  socket.on('leaveRequestRoom', (data) => {
    const { requestId } = data;
    socket.leave(`request-${requestId}`);
    console.log(`User ${socket.id} left room request-${requestId}`);
  });

  // Handle location updates
  socket.on('updateLocation', async (data) => {
    const { requestId, userId, location } = data;
    // Broadcast to the specific request room, excluding the sender
    socket.to(`request-${requestId}`).emit('locationUpdate', { userId, location });
  });

  // Handle request status updates
  socket.on('requestUpdate', (data) => {
    const { requestId, status, userId } = data;
    socket.broadcast.emit('requestStatusUpdate', { requestId, status, userId });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Error handler middleware
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Route not found'
  });
});

// Database connection
const startServer = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Connect to Redis
    await connectRedis();

    // Start Express server
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    mongoose.connection.close();
    process.exit(0);
  });
});

module.exports = { app, io };