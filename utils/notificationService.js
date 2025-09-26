const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
let firebaseApp;
try {
  // You need to add your Firebase service account key
  // For now, we'll initialize with environment variables
  if (process.env.FIREBASE_PROJECT_ID) {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }),
    });
  }
} catch (error) {
  console.warn('Firebase not initialized:', error.message);
}

class NotificationService {
  constructor() {
    this.messaging = firebaseApp ? admin.messaging() : null;
  }

  // Send notification to specific device
  async sendToDevice(token, title, body, data = {}) {
    if (!this.messaging) {
      console.warn('Firebase not initialized, skipping notification');
      return null;
    }

    const message = {
      token,
      notification: {
        title,
        body,
      },
      data: {
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'requests_channel',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    try {
      const response = await this.messaging.send(message);
      console.log('Notification sent successfully:', response);
      return response;
    } catch (error) {
      console.error('Error sending notification:', error);
      return null;
    }
  }

  // Send notification to multiple devices
  async sendToMultipleDevices(tokens, title, body, data = {}) {
    if (!this.messaging || !tokens.length) {
      console.warn('Firebase not initialized or no tokens, skipping notification');
      return [];
    }

    const message = {
      tokens,
      notification: {
        title,
        body,
      },
      data: {
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'requests_channel',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    try {
      const response = await this.messaging.sendMulticast(message);
      console.log(`Notifications sent: ${response.successCount} success, ${response.failureCount} failed`);
      return response;
    } catch (error) {
      console.error('Error sending multicast notification:', error);
      return null;
    }
  }

  // Send new request notification to nearby users
  async notifyNearbyUsersOfNewRequest(request, requester, nearbyUsers) {
    try {
      if (!nearbyUsers.length) {
        console.log('No nearby users found for notification');
        return;
      }

      // Filter users based on their notification preferences
      const eligibleUsers = nearbyUsers.filter(user => {
        const hasEnabledNotifications = user.settings[`${request.type}Notifications`];
        const hasDeviceTokens = user.deviceTokens && user.deviceTokens.length > 0;
        return hasEnabledNotifications && hasDeviceTokens;
      });

      if (!eligibleUsers.length) {
        console.log('No eligible users found for notification');
        return;
      }

      // Collect all device tokens
      const deviceTokens = [];
      eligibleUsers.forEach(user => {
        user.deviceTokens.forEach(deviceToken => {
          deviceTokens.push(deviceToken.token);
        });
      });

      if (!deviceTokens.length) {
        console.log('No device tokens found');
        return;
      }

      // Send notification
      const title = getNotificationTitle(request.type);
      const body = `${requester.name}: ${request.title}`;

      await this.sendToMultipleDevices(deviceTokens, title, body, {
        type: 'new_request',
        requestId: request._id.toString(),
        requestType: request.type,
        latitude: request.location.coordinates[1].toString(),
        longitude: request.location.coordinates[0].toString(),
      });

      console.log(`Sent new request notifications to ${deviceTokens.length} devices`);
    } catch (error) {
      console.error('Error notifying nearby users:', error);
    }
  }

  // Send notification when request is accepted
  async notifyRequestAccepted(request, acceptor) {
    try {
      const User = require('../models/User');

      // Notify the requester
      const requester = await User.findById(request.requester).select('deviceTokens name');

      if (requester && requester.deviceTokens && requester.deviceTokens.length > 0) {
        const tokens = requester.deviceTokens.map(dt => dt.token);

        await this.sendToMultipleDevices(
          tokens,
          'Request Accepted!',
          `${acceptor.name} has accepted your ${request.type} request`,
          {
            type: 'request_accepted',
            requestId: request._id.toString(),
            acceptorId: acceptor._id.toString(),
          }
        );
      }
    } catch (error) {
      console.error('Error notifying request acceptance:', error);
    }
  }

  // Send notification when request status changes
  async notifyRequestStatusChange(request, newStatus, changer) {
    try {
      const User = require('../models/User');

      // Get all acceptors
      const acceptors = await User.find({
        _id: { $in: request.acceptedBy.map(a => a.user) }
      }).select('deviceTokens name');

      const tokens = [];
      acceptors.forEach(acceptor => {
        if (acceptor.deviceTokens && acceptor.deviceTokens.length > 0) {
          acceptor.deviceTokens.forEach(dt => {
            tokens.push(dt.token);
          });
        }
      });

      if (tokens.length > 0) {
        const statusMessages = {
          completed: 'Request Completed',
          cancelled: 'Request Cancelled',
        };

        const title = statusMessages[newStatus] || 'Request Updated';
        const body = `Your ${request.type} request "${request.title}" has been ${newStatus}`;

        await this.sendToMultipleDevices(tokens, title, body, {
          type: 'request_status_change',
          requestId: request._id.toString(),
          status: newStatus,
        });
      }
    } catch (error) {
      console.error('Error notifying request status change:', error);
    }
  }
}

function getNotificationTitle(type) {
  const titles = {
    emergency: '🚨 Emergency Request Nearby!',
    help: '🤝 Help Request Nearby!',
    social: '👥 Social Request Nearby!',
  };
  return titles[type] || 'New Request Nearby!';
}

module.exports = new NotificationService();