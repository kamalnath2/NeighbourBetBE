const { createClient } = require('redis');

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 50, 1000),
  },
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));
redisClient.on('connect', () => console.log('Connecting to Redis...'));
redisClient.on('ready', () => console.log('Redis client is ready.'));
redisClient.on('end', () => console.log('Redis connection closed.'));

const connectRedis = async () => {
  try {
    await redisClient.connect();
  } catch (err) {
    console.error('Failed to connect to Redis:', err);
    // Exit the process if Redis connection fails on startup
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, disconnecting Redis');
  if (redisClient.isOpen) {
    // Use quit for a graceful shutdown, allowing pending commands to complete
    await redisClient.quit();
  }
});

module.exports = { redisClient, connectRedis };
