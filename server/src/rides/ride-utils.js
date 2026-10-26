const loadRide = (db, id) => {
  return db.prepare(`
    SELECT r.*,
           d.full_name AS driver_name, d.phone AS driver_phone, d.vehicle_type, d.vehicle_model,
           d.license_plate, d.rating AS driver_rating, d.trips AS driver_trips,
           u.name AS rider_name, u.phone AS rider_phone
    FROM rides r
    LEFT JOIN drivers d ON d.id = r.driver_id
    LEFT JOIN users u ON u.id = r.rider_id
    WHERE r.id=?
  `).get(id);
};

const rideEnvelope = (ride) => ({
  ride_id: ride.id,
  status: ride.status,
  ride,
});

// The rider's pickup code must never reach the driver's payload — the driver
// has to obtain it verbally from the rider and enter it to start the trip.
const rideForDriver = (ride) => {
  if (!ride) return ride;
  const out = { ...ride };
  delete out.pickup_code;
  return out;
};

module.exports = { loadRide, rideEnvelope, rideForDriver };