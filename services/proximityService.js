const redisClient = require('../utils/redisClient');
const User = require('../models/User');

// Define the size of our grid cells in degrees. 1 degree is ~111km.
// 0.01 degrees is ~1.11km, which is a good starting point for cell size.
const CELL_SIZE_DEGREES = 0.01;

// Helper to calculate Haversine distance
function getDistanceInKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the Earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

class ProximityService {
  /**
   * Calculates the grid cell ID for a given set of coordinates.
   * @param {number} latitude
   * @param {number} longitude
   * @returns {string} The cell ID.
   */
  getCellId(latitude, longitude) {
    const cellX = Math.floor(longitude / CELL_SIZE_DEGREES);
    const cellY = Math.floor(latitude / CELL_SIZE_DEGREES);
    return `cell:${cellX}:${cellY}`;
  }

  /**
   * Updates a user's location in the Redis grid.
   * @param {string} userId
   * @param {number} latitude
   * @param {number} longitude
   */
  async updateUserLocation(userId, latitude, longitude) {
    if (!redisClient.isOpen) return;

    const newCellId = this.getCellId(latitude, longitude);
    const userKey = `user:${userId}`;

    try {
      // Get the user's old cell
      const oldCellId = await redisClient.get(userKey);

      // Use a transaction to ensure atomicity
      const multi = redisClient.multi();

      // 1. If the user was in an old cell and it's different, remove them.
      if (oldCellId && oldCellId !== newCellId) {
        multi.hDel(oldCellId, userId);
      }

      // 2. Add/update the user in the new cell. Store coords for distance check.
      multi.hSet(newCellId, userId, `${latitude},${longitude}`);

      // 3. Update the reverse lookup for the user's current cell.
      multi.set(userKey, newCellId);

      await multi.exec();
    } catch (error) {
      console.error('Error updating user location in Redis:', error);
    }
  }

  /**
   * Finds nearby users using the Redis grid system.
   * @param {number} latitude The latitude of the search origin.
   * @param {number} longitude The longitude of the search origin.
   * @param {number} radiusKm The search radius in kilometers.
   * @returns {Promise<Array<object>>} A promise that resolves to an array of nearby user objects.
   */
  async findNearbyUsers(latitude, longitude, radiusKm) {
    if (!redisClient.isOpen) {
      // Fallback to DB if Redis is down
      console.warn('Redis not connected. Falling back to database query for nearby users.');
      return User.findNearby([longitude, latitude], radiusKm);
    }

    const originCellX = Math.floor(longitude / CELL_SIZE_DEGREES);
    const originCellY = Math.floor(latitude / CELL_SIZE_DEGREES);
    const nearbyUserIds = new Set();

    try {
      // Search the 3x3 grid of cells around the origin
      for (let x = originCellX - 1; x <= originCellX + 1; x++) {
        for (let y = originCellY - 1; y <= originCellY + 1; y++) {
          const cellId = `cell:${x}:${y}`;
          const usersInCell = await redisClient.hGetAll(cellId);

          for (const userId in usersInCell) {
            const [userLat, userLon] = usersInCell[userId].split(',').map(Number);
            const distance = getDistanceInKm(latitude, longitude, userLat, userLon);

            if (distance <= radiusKm) {
              nearbyUserIds.add(userId);
            }
          }
        }
      }

      if (nearbyUserIds.size === 0) {
        return [];
      }

      // Fetch full user details from MongoDB for the identified nearby users
      const users = await User.find({
        _id: { $in: Array.from(nearbyUserIds) },
        isActive: true,
        'settings.locationSharing': true
      }).select('_id deviceTokens settings'); // Select only what's needed for notifications

      return users;
    } catch (error) {
      console.error('Error finding nearby users in Redis:', error);
      // Fallback to DB on error
      console.warn('Redis error occurred. Falling back to database query for nearby users.');
      return User.find({
        location: { $near: { $geometry: { type: 'Point', coordinates: [longitude, latitude] }, $maxDistance: radiusKm * 1000 } },
        isActive: true,
        'settings.locationSharing': true
      }).select('_id deviceTokens settings');
    }
  }
}

module.exports = new ProximityService();
