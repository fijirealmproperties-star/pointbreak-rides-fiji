const { haversine, meterFareFor } = require('./fare');
const { loadRide, rideEnvelope, rideForDriver } = require('./ride-utils');
const { sendPush } = require('../push');

const MATCH_TIMEOUT_MS = 30000;
const MATCH_RETRY_MS = 8000;
const MAX_MATCH_ATTEMPTS = 3;

// A driver may wait for a no-show rider up to 13 hours before the trip lapses.
const MAX_WAIT_MINUTES = 13 * 60;
const DISPATCH_LEAD_MINUTES = 15;
const FREE_CANCEL_SECONDS = 120;
const CANCEL_FEE_ACCEPTED = 3;
const CANCEL_FEE_ARRIVED = 5;

// Fee a rider owes the driver for cancelling a ride in its current state.
function cancellationFee(ride, now = Date.now()) {
  if (!ride) return 0;
  if (ride.status === 'arrived') return CANCEL_FEE_ARRIVED;
  if (ride.status === 'accepted') {
    const t = ride.accepted_at ? Date.parse(String(ride.accepted_at).replace(' ', 'T') + 'Z') : NaN;
    if (Number.isFinite(t) && now - t <= FREE_CANCEL_SECONDS * 1000) return 0;
    return CANCEL_FEE_ACCEPTED;
  }
  return 0;
}

const ACTIVE_STATUSES = ['scheduled', 'requested', 'accepted', 'arrived', 'in_progress'];
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
  sweepStaleTrips() {
    const limits = { accepted: 120, arrived: MAX_WAIT_MINUTES, in_progress: 360 };
    let cleared = 0;
    for (const [status, minutes] of Object.entries(limits)) {
      const rows = this.db.prepare(
        `SELECT id FROM rides
         WHERE status=?
           AND COALESCE(pickup_at, arrived_at, accepted_at, requested_at)
               < datetime('now', ?)`
      ).all(status, `-${minutes} minutes`);
      for (const row of rows) {
        if (this.cancelRide(row.id, { by: 'system' })) cleared += 1;
      }
    }
    return cleared;
  }

  // Booked-ahead rides are assigned by an admin, who picks a free driver.
  // The driver receives the booking as a normal ride request.
  assignScheduled(rideId, driverId) {
    const ride = this.db.prepare('SELECT * FROM rides WHERE id=?').get(rideId);
    if (!ride || !ride.scheduled_at) return { error: 'Not a booked ride', code: 404 };
    const pending = this.pendingMatches.get(rideId);
    const reassign = ride.status === 'requested' && pending && pending.manual;
    if (ride.status !== 'scheduled' && !reassign) return { error: 'This booking can no longer be assigned', code: 409 };
    const driver = this.db.prepare('SELECT * FROM drivers WHERE id=?').get(driverId);
    if (!driver) return { error: 'Driver not found', code: 404 };
    if (driver.status !== 'online' || this.busyDrivers.has(driverId)) {
      return { error: 'That driver is not free right now', code: 409 };
    }
    if (reassign && pending.driverId && pending.driverId !== driverId) {
      this._emitToDriver(pending.driverId, 'ride_cancelled', { ride_id: rideId });
    }

    this.db.prepare("UPDATE rides SET status='requested', driver_id=?, driver_lat=?, driver_lng=?, requested_at=datetime('now') WHERE id=?")
      .run(driverId, driver.lat == null ? null : driver.lat, driver.lng == null ? null : driver.lng, rideId);
    this.pendingMatches.set(rideId, { driverId, timeout: null, attempt: 0, manual: true });

    const fresh = loadRide(this.db, rideId);
    this._emitToDriver(driverId, 'ride_request', rideEnvelope(rideForDriver(fresh)));
    this._pushRideRequest(driverId, fresh);
    this._emitToUser(ride.rider_id, 'ride_status', rideEnvelope(fresh));
    sendPush(this.db, ride.rider_id, {
      title: '✅ Driver assigned',
      body: `${driver.full_name || 'Your driver'} will pick you up for your booked ride.`,
      tag: `ride-${rideId}`,
    }).catch(() => {});
    return { ride: fresh };
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
    if (best || fallback) return best || fallback;

    // Nobody has the app open: fall back to drivers who are online but whose
    // app is closed, as long as they can be reached by push notification.
    const rows = this.db.prepare(
      `SELECT d.id, d.lat, d.lng FROM drivers d
       WHERE d.status='online'
         AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = d.user_id)`
    ).all();
    let away = null;
    for (const row of rows) {
      if (this.onlineDrivers.has(row.id) || this.busyDrivers.has(row.id) || declined.has(row.id)) continue;
      const distance = Number.isFinite(row.lat) && Number.isFinite(row.lng)
        ? haversine(pickupLat, pickupLng, row.lat, row.lng)
        : Infinity;
      if (!away || distance < away.distance) away = { driverId: row.id, distance, away: true };
    }
    return away;
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
    const dRow = info ? null : this.db.prepare('SELECT lat, lng FROM drivers WHERE id=?').get(best.driverId);
    const dLat = info ? info.lat : dRow && dRow.lat;
    const dLng = info ? info.lng : dRow && dRow.lng;
    this.db.prepare('UPDATE rides SET driver_id=?, driver_lat=?, driver_lng=? WHERE id=?')
      .run(best.driverId, dLat == null ? null : dLat, dLng == null ? null : dLng, rideId);

    this._emitToDriver(best.driverId, 'ride_request', rideEnvelope(rideForDriver(loadRide(this.db, rideId))));
    this._pushRideRequest(best.driverId, loadRide(this.db, rideId));

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

  _pushRideRequest(driverId, ride) {
    try {
      const d = this.db.prepare('SELECT user_id FROM drivers WHERE id=?').get(driverId);
      if (!d) return;
      const fare = ride.fare != null ? ` · FJ$${Number(ride.fare).toFixed(2)}` : '';
      sendPush(this.db, d.user_id, {
        title: '🚗 New ride request!',
        body: `${ride.pickup_place || 'Pickup'} → ${ride.dropoff_place || 'Dropoff'}${fare}`,
        tag: `ride-${ride.id}`,
        rideId: ride.id,
      }).catch(() => {});
    } catch (e) {
      console.error('Ride push failed:', e.message);
    }
  }

  // An app opened from a push alert reconnects after the offer was made, so
  // re-deliver any offer still waiting on this driver.
  resendPendingOffer(driverId) {
    for (const [rideId, pending] of this.pendingMatches) {
      if (pending.driverId !== driverId) continue;
      const ride = loadRide(this.db, rideId);
      if (ride && ride.status === 'requested') {
        this._emitToDriver(driverId, 'ride_request', rideEnvelope(rideForDriver(ride)));
      }
    }
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

    const declinedRide = this.db.prepare('SELECT * FROM rides WHERE id=?').get(rideId);
    if (declinedRide && declinedRide.scheduled_at && declinedRide.status === 'requested') {
      this.db.prepare("UPDATE rides SET status='scheduled', driver_id=NULL WHERE id=?").run(rideId);
      this._emitToUser(declinedRide.rider_id, 'ride_status', rideEnvelope(loadRide(this.db, rideId)));
      return;
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

  cancelRide(rideId, opts = {}) {
    const ride = this.db.prepare('SELECT * FROM rides WHERE id=?').get(rideId);
    if (!ride) return null;
    if (!ACTIVE_STATUSES.includes(ride.status)) return null;

    const pending = this.pendingMatches.get(rideId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingMatches.delete(rideId);
    }

    const fee = opts.by === 'rider' ? cancellationFee(ride) : 0;
    // Keep the driver on the record so the compensation can be shown to them.
    const keepDriver = fee > 0 ? ride.driver_id : null;
    this.db.prepare("UPDATE rides SET status='cancelled', driver_id=?, cancelled_at=datetime('now'), cancel_fee=?, cancelled_by=? WHERE id=?")
      .run(keepDriver, fee, opts.by || null, rideId);
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
      case 'in_progress': {
        // The meter starts the moment the rider's PIN is accepted, at the flag fall.
        const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
        const flag = meterFareFor({ ...ride, meter_started_at: nowStr }, 0, 0);
        this.db.prepare("UPDATE rides SET status='in_progress', pickup_at=datetime('now'), meter_started_at=datetime('now'), meter_last_at=datetime('now'), meter_distance_km=0, meter_wait_min=0, meter_fare=? WHERE id=?").run(flag.fare, rideId);
        break;
      }
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

    // Waiting minutes: measured when metered, otherwise ~15% of the quoted trip.
    const waitMin = metered
      ? Number(ride.meter_wait_min) || 0
      : (Number(ride.duration_min) || 0) * 0.15;

    const fare = meterFareFor(ride, distanceKm, waitMin);
    return { distanceKm: fare.distanceKm, durationMin: Number(ride.duration_min) || fare.durationMin, fare: fare.fare };
  }
}

module.exports = MatchingEngine;
module.exports.cancellationFee = cancellationFee;