const cron = require('node-cron');
const Request = require('../models/Request');

// Run every hour to clean up expired requests
const cleanupExpiredRequests = () => {
  cron.schedule('0 * * * *', async () => {
    try {
      const expiredRequests = await Request.updateMany(
        {
          expiresAt: { $lte: new Date() },
          status: 'active'
        },
        {
          status: 'expired'
        }
      );

      if (expiredRequests.modifiedCount > 0) {
        console.log(`Expired ${expiredRequests.modifiedCount} requests`);
      }
    } catch (error) {
      console.error('Error cleaning up expired requests:', error);
    }
  });
};

module.exports = {
  cleanupExpiredRequests
};