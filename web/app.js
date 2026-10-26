const API_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3003'
  : window.location.origin;

let socket = null;
let rides = [];
let drivers = [];
let adminToken = localStorage.getItem('pb_admin_token') || null;
let adminUserName = localStorage.getItem('pb_admin_user') || null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  renderAdminState();
  await loadInitialData();
  connectSocket();
  setInterval(pollData, 5000);
}

function renderAdminState() {
  const auth = document.getElementById('admin-auth');
  const bar = document.getElementById('admin-bar');
  const nameEl = document.getElementById('admin-name');
  const status = document.getElementById('admin-status');

  if (adminToken && adminUserName) {
    if (auth) auth.style.display = 'none';
    if (bar) { bar.style.display = 'flex'; nameEl.textContent = adminUserName; }
    if (status) { status.textContent = 'Signed in as admin'; status.className = 'register-status ok'; }
  } else {
    if (auth) auth.style.display = 'flex';
    if (bar) bar.style.display = 'none';
    if (status) { status.textContent = 'Sign in with the admin account first'; status.className = 'register-status'; }
  }
}

async function adminLogin() {
  const phone = document.getElementById('adm-phone').value.trim();
  const password = document.getElementById('adm-password').value;
  const status = document.getElementById('admin-status');

  if (!phone || !password) { status.textContent = 'Enter admin phone and password'; status.className = 'register-status error'; return; }

  try {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { status.textContent = data.error || 'Login failed'; status.className = 'register-status error'; return; }
    if (data.user.role !== 'admin') { status.textContent = 'That is not an admin account'; status.className = 'register-status error'; return; }
    adminToken = data.accessToken;
    adminUserName = data.user.name || 'Admin';
    localStorage.setItem('pb_admin_token', adminToken);
    localStorage.setItem('pb_admin_user', adminUserName);
    renderAdminState();
    document.getElementById('adm-phone').value = '';
    document.getElementById('adm-password').value = '';
  } catch (e) {
    status.textContent = 'Could not reach the server';
    status.className = 'register-status error';
  }
}

function adminLogout() {
  adminToken = null;
  adminUserName = null;
  localStorage.removeItem('pb_admin_token');
  localStorage.removeItem('pb_admin_user');
  renderAdminState();
}

async function registerDriver() {
  const status = document.getElementById('reg-status');
  const btn = document.getElementById('reg-submit');

  if (!adminToken) { status.textContent = 'Sign in as admin first'; status.className = 'register-status error'; return; }

  const name = document.getElementById('reg-name').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const password = document.getElementById('reg-password').value;
  const vehicle_type = document.getElementById('reg-vehicle-type').value.trim();
  const vehicle_model = document.getElementById('reg-vehicle-model').value.trim();
  const license_plate = document.getElementById('reg-plate').value.trim();

  if (!name || !phone || !password) { status.textContent = 'Name, phone and password are required'; status.className = 'register-status error'; return; }

  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const res = await fetch(`${API_URL}/api/admin/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ name, phone, password, vehicle_type, vehicle_model, license_plate }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { adminToken = null; localStorage.removeItem('pb_admin_token'); renderAdminState(); status.textContent = 'Admin session expired — sign in again'; status.className = 'register-status error'; return; }
    if (!res.ok) { status.textContent = data.error || `Failed (${res.status})`; status.className = 'register-status error'; return; }

    status.textContent = `Created ${data.driver.full_name} (${data.driver.vehicle_type})`;
    status.className = 'register-status ok';
    document.getElementById('reg-name').value = '';
    document.getElementById('reg-phone').value = '';
    document.getElementById('reg-password').value = '';
    document.getElementById('reg-vehicle-type').value = '';
    document.getElementById('reg-vehicle-model').value = '';
    document.getElementById('reg-plate').value = '';
    await loadInitialData();
  } catch (e) {
    status.textContent = 'Could not reach the server';
    status.className = 'register-status error';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create driver';
  }
}

async function loadInitialData() {
  try {
    const headers = adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {};
    const [ridesRes, driversRes] = await Promise.all([
      fetch(`${API_URL}/api/admin/rides/all`, { headers }).catch(() => null),
      fetch(`${API_URL}/api/admin/drivers/all`, { headers }).catch(() => null),
    ]);

    if (ridesRes && ridesRes.ok) {
      const r = await ridesRes.json();
      rides = r.rides || r || [];
    }

    if (driversRes && driversRes.ok) {
      const d = await driversRes.json();
      drivers = d.drivers || d || [];
    }

    renderAll();
  } catch (e) {
    console.error('Failed to load initial data:', e);
  }
}

function connectSocket() {
  socket = io(API_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionAttempts: Infinity,
  });

  socket.on('connect', () => {
    socket.emit('identify', { role: 'admin' });
    const el = document.getElementById('connection-status');
    el.textContent = 'Connected';
    el.className = 'badge connected';
  });

  socket.on('disconnect', () => {
    const el = document.getElementById('connection-status');
    el.textContent = 'Disconnected';
    el.className = 'badge disconnected';
  });

  socket.on('reconnect_attempt', () => {
    const el = document.getElementById('connection-status');
    el.textContent = 'Reconnecting...';
    el.className = 'badge';
  });

  socket.on('ride_update', (ride) => {
    updateRideInList(ride);
    renderAll();
  });

  socket.on('driver_update', (driver) => {
    updateDriverInList(driver);
    renderAll();
  });

  socket.on('rides_list', (data) => {
    rides = data.rides || data || [];
    renderAll();
  });

  socket.on('drivers_list', (data) => {
    drivers = data.drivers || data || [];
    renderAll();
  });

  socket.on('connect_error', (err) => {
    console.warn('Socket connection error:', err.message);
  });
}

async function pollData() {
  try {
    const headers = adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {};
    const [ridesRes, driversRes] = await Promise.all([
      fetch(`${API_URL}/api/admin/rides/all`, { headers }).catch(() => null),
      fetch(`${API_URL}/api/admin/drivers/all`, { headers }).catch(() => null),
    ]);

    if (ridesRes && ridesRes.ok) {
      const r = await ridesRes.json();
      if (r.rides) rides = r.rides;
      else if (Array.isArray(r)) rides = r;
    }

    if (driversRes && driversRes.ok) {
      const d = await driversRes.json();
      if (d.drivers) drivers = d.drivers;
      else if (Array.isArray(d)) drivers = d;
    }

    renderAll();
  } catch (e) {
    // Silent fail for polling — socket is the primary channel
  }
}

function updateRideInList(ride) {
  const idx = rides.findIndex(r => r.id === ride.id);
  if (idx >= 0) {
    rides[idx] = { ...rides[idx], ...ride };
  } else {
    rides.unshift(ride);
  }
}

function updateDriverInList(driver) {
  const idx = drivers.findIndex(d => d.id === driver.id);
  if (idx >= 0) {
    drivers[idx] = { ...drivers[idx], ...driver };
  } else {
    drivers.push(driver);
  }
}

function renderAll() {
  renderStats();
  renderRides();
  renderDrivers();
}

function renderStats() {
  const onlineDrivers = drivers.filter(d => d.status === 'online').length;
  const activeRides = rides.filter(r =>
    ['requested', 'accepted', 'arrived', 'picking_up', 'in_progress'].includes(r.status)
  ).length;
  const totalRides = rides.length;
  const revenue = rides
    .filter(r => r.status === 'completed')
    .reduce((sum, r) => sum + (r.fare || 0), 0);

  document.getElementById('stat-online').textContent = onlineDrivers;
  document.getElementById('stat-active').textContent = activeRides;
  document.getElementById('stat-total').textContent = totalRides;
  document.getElementById('stat-revenue').textContent = `FJ$${revenue.toFixed(2)}`;

  document.getElementById('ride-count').textContent = `${totalRides} ride${totalRides !== 1 ? 's' : ''}`;
  document.getElementById('driver-count').textContent = `${drivers.length} driver${drivers.length !== 1 ? 's' : ''}`;
}

function renderRides() {
  const container = document.getElementById('rides-list');

  if (rides.length === 0) {
    container.innerHTML = '<p class="empty">No rides yet. Open the app to start a ride.</p>';
    return;
  }

  const sorted = [...rides].sort((a, b) => {
    const ta = a.requested_at || a.created_at || '';
    const tb = b.requested_at || b.created_at || '';
    return tb.localeCompare(ta);
  });

  container.innerHTML = sorted.map(ride => {
    const pickup = ride.pickup_place || ride.pickup_address || 'Unknown pickup';
    const dropoff = ride.dropoff_place || ride.dropoff_address || 'Unknown dropoff';
    const fare = (ride.fare || 0).toFixed(2);
    const dist = ride.distance_km ? `${ride.distance_km.toFixed(1)} km` : '';
    const driver = ride.driver_name || ride.driver_full_name || 'Unassigned';
    const time = formatTime(ride.requested_at || ride.created_at);
    const shortId = ride.id ? ride.id.toString().slice(0, 8) : '—';

    return `
      <div class="ride-card ${escapeHtml(ride.status || '')}">
        <div class="ride-header">
          <span class="ride-id">#${escapeHtml(shortId)}</span>
          <span class="status-badge ${escapeHtml(ride.status || '')}">${statusLabel(ride.status)}</span>
        </div>
        <div class="ride-route">${escapeHtml(pickup)} &rarr; ${escapeHtml(dropoff)}</div>
        <div class="ride-details">
          <span>FJ$${fare}</span>
          ${dist ? `<span>${escapeHtml(dist)}</span>` : ''}
          <span>${escapeHtml(driver)}</span>
          <span class="ride-time">${escapeHtml(time)}</span>
        </div>
      </div>`;
  }).join('');
}

function renderDrivers() {
  const container = document.getElementById('drivers-list');

  if (drivers.length === 0) {
    container.innerHTML = '<p class="empty">No drivers registered.</p>';
    return;
  }

  const sorted = [...drivers].sort((a, b) => {
    const order = { online: 0, busy: 1, offline: 2 };
    return (order[a.status] ?? 3) - (order[b.status] ?? 3);
  });

  container.innerHTML = sorted.map(d => {
    const name = d.full_name || d.name || 'Unknown';
    const vehicle = [d.vehicle_type, d.vehicle_model].filter(Boolean).join(' ');
    const plate = d.license_plate || '';
    const rating = d.rating != null ? d.rating.toFixed(1) : '5.0';
    const trips = d.trips || 0;

    return `
      <div class="driver-card">
        <div class="driver-status ${escapeHtml(d.status || 'offline')}"></div>
        <div class="driver-info">
          <div class="driver-name">${escapeHtml(name)}</div>
          <div class="driver-vehicle">${escapeHtml(vehicle)}${plate ? ' — ' + escapeHtml(plate) : ''}</div>
        </div>
        <div class="driver-stats">
          <span class="rating">\u2605 ${escapeHtml(rating)}</span>
          <span class="trips">${trips} trip${trips !== 1 ? 's' : ''}</span>
        </div>
      </div>`;
  }).join('');
}

function statusLabel(status) {
  const labels = {
    requested: 'Searching',
    accepted: 'En Route',
    arrived: 'Waiting',
    picking_up: 'Picking Up',
    in_progress: 'On Trip',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };
  return labels[status] || status || 'Unknown';
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-FJ', { hour: '2-digit', minute: '2-digit', hour12: true });
  } catch {
    return '';
  }
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(String(str)));
  return div.innerHTML;
}
