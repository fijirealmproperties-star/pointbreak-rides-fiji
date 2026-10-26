const { haversine, calculateFare } = require('./fare');
const { loadRide, rideEnvelope, rideForDriver } = require('./ride-utils');

const MATCH_TIMEOUT_MS = 30000;
const MATCH_RETRY_MS = 8000;
const MAX_MATCH_ATTEMPTS = 3;

const ACTIVE_STATUSES = ['requested', 'accepted', 'arrived', 'in_progress'];
// Statuses where the driver is genuinely committed to a trip. 'requested' is
// only a pending offer, so it must never block a driver from going online.
const COMMITTED_STATUSES = ['accepted', 'arrived', 'in_progress'];

class MatchingEngine {
  constructor(io, db) {
    this.io = io;
    this.db = db;
    this.onlineDrivers = new Map();
    this.userSockets = new Map();
    this.busyDrivers = new Set();
    this.pendingMatches = new Map();
    this.declinedRides = new Map();
    this.broadcastTimer = null;
    this.sweepTimer = null;
  }

  setSocket(userId, socketId) {
    if (userId) this.userSockets.set(userId, socketId);
  }

  socketIdFor(userId) {
    return this.userSockets.get(userId) || null;
  }

  removeSocket(socketId) {
    for (const [userId, sid] of this.userSockets) {
      if (sid === socketId) this.userSockets.delete(userId);
    }
  }

  registerDriver(socketId, userId, driverId, lat, lng) {
    if (!driverId) return;
    const row = this.db.prepare('SELECT full_name FROM drivers WHERE id=?').get(driverId);
    const entry = {
      userId,
      socketId,
      lat,
      lng,
      name: (row && row.full_name) || 'Driver',
    };
    if (entry.socketId) this.setSocket(userId, entry.socketId);
    this.onlineDrivers.set(driverId, entry);
    this.broadcastDrivers();
  }

  unregisterDriver(socketId) {
    for (const [driverId, info] of this.onlineDrivers) {
      if (info.socketId === socketId) {
        this.onlineDrivers.delete(driverId);
      }
    }
    this.removeSocket(socketId);
  }

  unregisterDriverById(driverId) {
    const info = this.onlineDrivers.get(driverId);
    if (info) {
      this.onlineDrivers.delete(driverId);
      if (info.socketId) this.removeSocket(info.socketId);
    }
  }

  updateLocation(driverId, lat, lng) {
    const info = this.onlineDrivers.get(driverId);
    if (info) {
      info.lat = lat;
      info.lng = lng;
      this.broadcastSoon();
    }
  }

  // Coalesce rapid position updates (e.g. a driver streaming during a trip) so
  // riders get live locations without one broadcast per tick per driver.
  broadcastSoon() {
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      this.broadcastDrivers();
    }, 900);
  }

  setDriverBusy(driverId) {
    if (driverId) this.busyDrivers.add(driverId);
  }

  setDriverFree(driverId) {
    if (driverId) this.busyDrivers.delete(driverId);
  }

  getOnlineSnapshot() {
    const out = [];
    for (const [driverId, info] of this.onlineDrivers) {
      out.push({ id: driverId, name: info.name || 'Driver', lat: info.lat, lng: info.lng });
    }
    return out;
  }

  broadcastDrivers() {
    this.io.to('riders').emit('drivers_nearby', { drivers: this.getOnlineSnapshot() });
  }

  activeRideForDriver(driverId) {
    const placeholders = COMMITTED_STATUSES.map(() => '?').join(',');
    return this.db.prepare(
      `SELECT id FROM rides WHERE driver_id=? AND status IN (${placeholders}) ORDER BY requested_at DESC`
    ).all(...[driverId, ...COMMITTED_STATUSES])[0] || null;
  }

  // A 'requested' ride that is no longer in pendingMatches can never be
  // accepted again (its match timers died, e.g. across a server restart).
  // Cancel it so the rider isn't left "finding a driver" forever and the
  // driver isn't stuck holding a dead offer.
  sweepStaleRequests() {
    const rows = this.db.prepare("SELECT id FROM rides WHERE status='requested'").all();
    let cleared = 0;
    for (const row of rows) {
      if (this.pendingMatches.has(row.id)) continue;
      const ride = this.db.prepare('SELECT * FROM rides WHERE id=?').get(row.id);
      if (ride) {
        this._noDrivers(ride);
        cleared += 1;
      }
    }
    return cleared;
  }

  // Bring availability back in line with reality after a (re)start.
  recoverFromRestart() {
    const committed = COMMITTED_STATUSES.map(() => '?').join(',');
    this.db.prepare(
      `UPDATE drivers SET status='online' WHERE status='busy' AND id NOT IN (
         SELECT driver_id FROM rides WHERE driver_id IS NOT NULL AND status IN (${committed})
       )`
    ).run(...COMMITTED_STATUSES);

    const cleared = this.sweepStaleRequests();
    const staleTrips = this.sweepStaleTrips();
    if (cleared || staleTrips) {
      console.log(`Recovered ${cleared} orphaned request(s) and ${staleTrips} idle trip(s) from the previous run.`);
    }
  }

  // A committed trip that nobody has touched in a while is abandoned (the
  // driver app closed or the server restarted mid-trip). Cancel it so the
  // driver isn't locked out of new rides forever.
  sweepStaleTrips(maxIdleMinutes = 5) {
    const rows = this.db.prepare(
      `SELECT id FROM rides
       WHERE status IN ('accepted','arrived','in_progress')
         AND COALESCE(pickup_at, arrived_at, accepted_at, requested_at)
             < datetime('now', ?)`
    ).all(`-${maxIdleMinutes} minutes`);
    let cleared = 0;
    for (const row of rows) {
      if (this.cancelRide(row.id)) cleared += 1;
    }
    return cleared;
  }

  startSweeper(intervalMs = 15000) {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => {
      try {
        this.sweepStaleRequests();
        this.sweepStaleTrips();
      } catch (e) {
        console.error('Request sweep failed:', e.message);
      }
    }, intervalMs);
    if (this.sweepTimer.unref) this.sweepTimer.unref();
  }

  _emitToUser(userId, event, payload) {
    if (!userId) return;
    this.io.to(`user:${userId}`).emit(event, payload);
  }

  _emitToDriver(driverId, event, payload) {
    const info = this.onlineDrivers.get(driverId);
    if (info && info.socketId) {
      this.io.to(info.socketId).emit(event, payload);
    }
  }

  findNearestDriver(pickupLat, pickupLng, rideId) {
    const declined = rideId ? this.declinedRides.get(rideId) || new Set() : new Set();
    let best = null;
    let fallback = null;
    for (const [driverId, info] of this.onlineDrivers) {
      if (this.busyDrivers.has(driverId)) continue;
      if (declined.has(driverId)) continue;
      if (!fallback) fallback = { driverId, distance: Infinity };
      // Prefer drivers with a known position; remember any online driver so a
      // request is still delivered if nobody has reported a location yet.
      if (!Number.isFinite(info.lat) || !Number.isFinite(info.lng)) continue;
      const distance = haversine(pickupLat, pickupLng, info.lat, info.lng);
      if (!best || distance < best.distance) {
        best = { driverId, distance };
      }
    }
    return best || fallback;
  }

  matchRide(rideId, pickupLat, pickupLng) {
    return this._attemptMatch(rideId, 1, pickupLat, pickupLng);
  }

  _attemptMatch(rideId, attempt, pickupLat, pickupLng) {
    if (this.pendingMatches.has(rideId)) return null;
    const ride = this.db.prepare('SELECT * FROM rides WHERE id=?').get(rideId);
    if (!ride) return null;
    if (ride.status !== 'requested') return null;
    if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) {
      pickupLat = ride.pickup_lat;
      pickupLng = ride.pickup_lng;
    }

    const best = this.findNearestDriver(pickupLat, pickupLng, rideId);
    if (!best) {
      if (attempt >= MAX_MATCH_ATTEMPTS) {
        this._noDrivers(ride);
      } else {
        this._retrySoon(rideId, attempt, ride);
      }
      return null;
    }

    const info = this.onlineDrivers.get(best.driverId);
    this.db.prepare('UPDATE rides SET driver_id=?, driver_lat=?, driver_lng=? WHERE id=?')
      .run(best.driverId, info.lat, info.lng, rideId);

    this._emitToDriver(best.driverId, 'ride_request', rideEnvelope(rideForDriver(loadRide(this.db, rideId))));

    const timeout = setTimeout(() => {
      const pending = this.pendingMatches.get(rideId);
      if (pending && pending.driverId === best.driverId && !this.busyDrivers.has(best.driverId)) {
        this.pendingMatches.delete(rideId);
        this._attemptMatch(rideId, attempt + 1);
      }
    }, MATCH_TIMEOUT_MS);

    this.pendingMatches.set(rideId, { driverId: best.driverId, timeout, attempt });
    return best;
  }

  _retrySoon(rideId, attempt, ride) {
    this._emitToUser(ride.rider_id, 'ride_searching', {
      rideId,
      message: 'Still searching for a nearby driver...',
    });
    const timeout = setTimeout(() => {
      this.pendingMatches.delete(rideId);
      this._attemptMatch(rideId, attempt + 1);
    }, MATCH_RETRY_MS);
    this.pendingMatches.set(rideId, { driverId: null, timeout, attempt });
  }

  _noDrivers(ride) {
    this.db.prepare("UPDATE rides SET status='cancelled', driver_id=NULL, cancelled_at=datetime('now') WHERE id=?")
      .run(ride.id);
    this.declinedRides.delete(ride.id);
    const truth = rideEnvelope(loadRide(this.db, ride.id));
    this._emitToUser(ride.rider_id, 'ride_status', { ...truth, status: 'no_driver' });
  }

  acceptRide(driverId, rideId) {
    const pending = this.pendingMatches.get(rideId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingMatches.delete(rideId);
    }

    const ride = this.db.prepare('SELECT * FROM rides WHERE id=?').get(rideId);
    if (!ride) return null;
    if (ride.status !== 'requested') return ride;
    if (ride.driver_id && ride.driver_id !== driverId) return null;

    this.db.prepare("UPDATE rides SET status='accepted', driver_id=?, accepted_at=datetime('now') WHERE id=?")
      .run(driverId, rideId);
    this.db.prepare("UPDATE drivers SET status='busy' WHERE id=?").run(driverId);
    this.setDriverBusy(driverId);

    const fresh = loadRide(this.db, rideId);
    const driver = this.db.prepare('SELECT * FROM drivers WHERE id=?').get(driverId);
    this._emitToDriver(driverId, 'driver_state', {
      online: true,
      active_ride_id: rideId,
      driver,
    });
    this._emitToUser(ride.rider_id, 'ride_status', rideEnvelope(fresh));
    this.broadcastDrivers();
    return fresh;
  }

  declineRide(driverId, rideId) {
    const pending = this.pendingMatches.get(rideId);
    if (pending && pending.driverId === driverId) {
      clearTimeout(pending.timeout);
      this.pendingMatches.delete(rideId);
    }

    if (!this.declinedRides.has(rideId)) {
      this.declinedRides.set(rideId, new Set());
    }
    this.declinedRides.get(rideId).add(driverId);

    const ride = this.db.prepare('SELECT * FROM rides WHERE id=?').get(rideId);
    if (ride && ride.status === 'requested') {
      this.db.prepare('UPDATE rides SET driver_id=NULL WHERE id=?').run(rideId);
      this.matchRide(rideId, ride.pickup_lat, ride.pickup_lng);
    }
  }

  cancelRide(rideId) {
    const ride = this.db.prepare('SELECT * FROM rides WHERE id=?').get(rideId);
    if (!ride) return null;
    if (!ACTIVE_STATUSES.includes(ride.status)) return null;

    const pending = this.pendingMatches.get(rideId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingMatches.delete(rideId);
    }

    this.db.prepare("UPDATE rides SET status='cancelled', driver_id=NULL, cancelled_at=datetime('now') WHERE id=?")
      .run(rideId);
    const fresh = loadRide(this.db, rideId);

    const cancelledEnvelope = rideEnvelope(fresh);
    this._emitToUser(ride.rider_id, 'ride_status', cancelledEnvelope);
    if (ride.driver_id) {
      this.setDriverFree(ride.driver_id);
      this.db.prepare("UPDATE drivers SET status='online' WHERE id=?").run(ride.driver_id);
      this._emitToDriver(ride.driver_id, 'ride_cancelled', fresh);
      this._emitToDriver(ride.driver_id, 'ride_status', cancelledEnvelope);
      this.broadcastDrivers();
    }
    return fresh;
  }

  transitionRide(driverId, rideId, nextStatus, opts = {}) {
    // 'completed' can be reached straight from any active state so a driver can
    // end a trip early ("Stop ride") instead of driving the whole route.
    const required = {
      arrived: ['accepted'],
      in_progress: ['arrived'],
      completed: ['in_progress', 'arrived', 'accepted'],
    };
    const allowedFrom = required[nextStatus];
    if (!allowedFrom) return null;

    const ride = this.db.prepare('SELECT * FROM rides WHERE id=?').get(rideId);
    if (!ride || ride.driver_id !== driverId) return null;
    if (ride.status === nextStatus) return ride;
    if (!allowedFrom.includes(ride.status)) return null;

    // The rider holds a pickup code; the driver must enter it to start the trip.
    if (nextStatus === 'in_progress' && ride.pickup_code) {
      const provided = opts && opts.code != null ? String(opts.code).trim() : '';
      if (!provided) return { error: 'code_required' };
      if (provided !== String(ride.pickup_code)) return { error: 'invalid_code' };
    }

    switch (nextStatus) {
      case 'arrived':
        this.db.prepare("UPDATE rides SET status='arrived', arrived_at=datetime('now') WHERE id=?").run(rideId);
        break;
      case 'in_progress':
        this.db.prepare("UPDATE rides SET status='in_progress', pickup_at=datetime('now'), meter_started_at=datetime('now') WHERE id=?").run(rideId);
        break;
      case 'completed': {
        const final = this._finalizeFare(ride);
        this.db.prepare(
          `UPDATE rides SET status='completed', completed_at=datetime('now'),
             final_fare=?, final_distance_km=?, final_duration_min=?,
             fare=?, distance_km=?, duration_min=? WHERE id=?`
        ).run(final.fare, final.distanceKm, final.durationMin, final.fare, final.distanceKm, final.durationMin, rideId);
        this.db.prepare("UPDATE drivers SET status='online', trips=trips+1 WHERE id=?").run(driverId);
        this.setDriverFree(driverId);
        this.broadcastDrivers();
        const fresh = this.db.prepare('SELECT * FROM rides WHERE id=?').get(rideId);
        this._emitToUser(ride.rider_id, 'ride_completed', {
          ride_id: rideId,
          fare: fresh.fare,
          distance_km: fresh.distance_km,
          duration_min: fresh.duration_min,
          currency: fresh.currency,
        });
        break;
      }
      default:
        return null;
    }

    const fresh = loadRide(this.db, rideId);
    this._emitToUser(ride.rider_id, 'ride_status', rideEnvelope(fresh));
    return fresh;
  }

  // Final fare from the metered distance travelled; falls back to the quoted
  // estimate when no usable meter reading was recorded.
  _finalizeFare(ride) {
    const meterKm = Number(ride.meter_distance_km) || 0;
    const metered = meterKm >= 0.1;
    const distanceKm = metered ? meterKm : Number(ride.distance_km) || 0;

    let durationMin = Number(ride.duration_min) || 0;
    if (metered) {
      const row = this.db.prepare(
        "SELECT (julianday('now') - julianday(COALESCE(meter_started_at, pickup_at, accepted_at, requested_at))) * 24 * 60 AS elapsed FROM rides WHERE id=?"
      ).get(ride.id);
      const elapsed = row && row.elapsed != null ? Number(row.elapsed) : NaN;
      if (Number.isFinite(elapsed) && elapsed > 0) durationMin = elapsed;
    }

    const fare = calculateFare(distanceKm, durationMin);
    return { distanceKm: fare.distanceKm, durationMin: fare.durationMin, fare: fare.fare };
  }
}

module.exports = MatchingEngine;