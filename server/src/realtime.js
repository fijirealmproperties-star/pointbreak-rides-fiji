const { verifyAccessToken } = require('./config/jwt');
const { loadRide } = require('./rides/ride-utils');
const { haversine, calculateFare } = require('./rides/fare');

const idOf = (data) => data && (data.ride_id || data.rideId);

const ACTIVE_STATUSES = ['requested', 'accepted', 'arrived', 'in_progress'];

function setupSocket(io, matchingEngine, db) {
  io.on('connection', (socket) => {
    socket.userId = null;
    socket.role = null;
    socket.driverId = null;

    socket.on('identify', (data) => {
      try {
        const token = data && data.token;
        if (!token) return socket.emit('identified', { ok: false, error: 'Token required' });

        const decoded = verifyAccessToken(token);
        const user = db.prepare('SELECT * FROM users WHERE id=?').get(decoded.userId);
        if (!user) return socket.emit('identified', { ok: false, error: 'User not found' });

        socket.userId = user.id;
        socket.role = user.role;
        socket.join(`user:${user.id}`);
        matchingEngine.setSocket(user.id, socket.id);

        if (user.role === 'rider') {
          socket.join('riders');
          socket.emit('drivers_nearby', { drivers: matchingEngine.getOnlineSnapshot() });
        }

        let driver = null;
        if (user.role === 'driver') {
          driver = db.prepare('SELECT * FROM drivers WHERE user_id=?').get(user.id);
          if (driver) {
            socket.driverId = driver.id;
            if (driver.status === 'online') {
              matchingEngine.registerDriver(socket.id, user.id, driver.id, driver.lat, driver.lng);
            }
          }
        }

        socket.emit('identified', {
          ok: true,
          user: { id: user.id, name: user.name, phone: user.phone, role: user.role },
          driver,
        });

        if (driver) {
          const active = matchingEngine.activeRideForDriver(driver.id);
          socket.emit('driver_state', {
            online: driver.status === 'online',
            active_ride_id: active ? active.id : null,
            driver,
          });
        }
      } catch (err) {
        socket.emit('identified', { ok: false, error: 'Invalid or expired token' });
      }
    });

    socket.on('rider_online', () => {
      if (socket.role === 'rider') {
        matchingEngine.broadcastDrivers();
        socket.emit('drivers_nearby', { drivers: matchingEngine.getOnlineSnapshot() });
      }
    });

    socket.on('driver_status', (data) => {
      if (socket.role !== 'driver' || !socket.driverId) return;
      const online = !!(data && data.online);
      const status = online ? 'online' : 'offline';
      const driver = db.prepare('SELECT * FROM drivers WHERE id=?').get(socket.driverId);
      if (!driver) return;

      db.prepare('UPDATE drivers SET status=? WHERE id=?').run(status, socket.driverId);
      if (online) {
        matchingEngine.registerDriver(socket.id, socket.userId, socket.driverId, driver.lat, driver.lng);
      } else {
        matchingEngine.unregisterDriverById(socket.driverId);
      }
      matchingEngine.broadcastDrivers();

      const active = matchingEngine.activeRideForDriver(socket.driverId);
      const fresh = db.prepare('SELECT * FROM drivers WHERE id=?').get(socket.driverId);
      socket.emit('driver_state', {
        online,
        active_ride_id: active ? active.id : null,
        driver: fresh,
      });
    });

    socket.on('driver_location', (data) => {
      const rideId = idOf(data);
      const lat = Number(data && data.lat);
      const lng = Number(data && data.lng);
      if (!socket.driverId || !rideId || !Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const prev = db.prepare('SELECT * FROM rides WHERE id=?').get(rideId);
      if (!prev || prev.driver_id !== socket.driverId) return;

      let meterDistanceKm = Number(prev.meter_distance_km) || 0;
      let meterFare = Number(prev.meter_fare) || 0;
      let meterDurationMin = 0;

      if (prev.status === 'in_progress') {
        // Accumulate the distance actually travelled; ignore GPS jitter (<5 m)
        // and teleports (>2 km in a single tick).
        if (Number.isFinite(prev.driver_lat) && Number.isFinite(prev.driver_lng)) {
          const delta = haversine(prev.driver_lat, prev.driver_lng, lat, lng);
          if (delta >= 0.005 && delta <= 2) meterDistanceKm += delta;
        }
        const row = db.prepare(
          "SELECT (julianday('now') - julianday(COALESCE(meter_started_at, pickup_at))) * 24 * 60 AS elapsed FROM rides WHERE id=?"
        ).get(rideId);
        meterDurationMin = row && row.elapsed != null ? Math.max(0, Number(row.elapsed)) : 0;
        meterFare = calculateFare(meterDistanceKm, meterDurationMin).fare;

        db.prepare('UPDATE rides SET driver_lat=?, driver_lng=?, meter_distance_km=?, meter_fare=? WHERE id=? AND driver_id=?')
          .run(lat, lng, meterDistanceKm, meterFare, rideId, socket.driverId);
      } else {
        db.prepare('UPDATE rides SET driver_lat=?, driver_lng=? WHERE id=? AND driver_id=?')
          .run(lat, lng, rideId, socket.driverId);
      }

      matchingEngine.updateLocation(socket.driverId, lat, lng);

      const payload = {
        ride_id: rideId,
        driver_lat: lat,
        driver_lng: lng,
        meter_distance_km: meterDistanceKm,
        meter_fare: meterFare,
        meter_duration_min: meterDurationMin,
      };
      matchingEngine._emitToUser(prev.rider_id, 'ride_location_update', payload);
      // The driver runs a live meter too, so echo the same reading back to them.
      socket.emit('ride_location_update', payload);
    });

    socket.on('driver_accept', (data) => {
      if (!socket.driverId) return;
      matchingEngine.acceptRide(socket.driverId, idOf(data));
    });

    socket.on('driver_decline', (data) => {
      if (!socket.driverId) return;
      matchingEngine.declineRide(socket.driverId, idOf(data));
    });

    socket.on('driver_arrived', (data) => {
      if (!socket.driverId) return;
      matchingEngine.transitionRide(socket.driverId, idOf(data), 'arrived');
    });

    socket.on('driver_start_trip', (data) => {
      if (!socket.driverId) return;
      const result = matchingEngine.transitionRide(socket.driverId, idOf(data), 'in_progress', {
        code: data && data.code,
      });
      if (result && result.error) {
        socket.emit('ride_error', {
          ride_id: idOf(data),
          error: result.error,
          message: result.error === 'invalid_code'
            ? 'Incorrect pickup code \u2014 ask your rider for their code'
            : 'Enter the rider\u2019s pickup code to start the trip',
        });
      }
    });

    socket.on('driver_complete_trip', (data) => {
      if (!socket.driverId) return;
      matchingEngine.transitionRide(socket.driverId, idOf(data), 'completed');
    });

    socket.on('rider_cancel', (data) => {
      if (socket.role !== 'rider') return;
      matchingEngine.cancelRide(idOf(data));
    });

    socket.on('disconnect', () => {
      matchingEngine.unregisterDriver(socket.id);
    });
  });
}

module.exports = { setupSocket };