const API_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3003'
  : window.location.origin;

let socket = null;
let assigningRideId = null;
let rides = [];
let drivers = [];
let liveRiders = [];
// "Keep me logged in" unticked: the admin sign-in only lasts for this browser session.
if (localStorage.getItem('pb_admin_keep') === '0' && !sessionStorage.getItem('pb_admin_sess')) {
  ['pb_admin_token', 'pb_admin_refresh', 'pb_admin_user'].forEach((k) => localStorage.removeItem(k));
}
let adminToken = localStorage.getItem('pb_admin_token') || null;
let adminUserName = localStorage.getItem('pb_admin_user') || null;

// Access tokens last 15 minutes: refresh silently on 401 so the dashboard keeps working.
const nativeFetch = window.fetch.bind(window);
let refreshing = null;
async function refreshAdminToken() {
  const refreshToken = localStorage.getItem('pb_admin_refresh');
  if (!refreshToken) return false;
  if (!refreshing) {
    refreshing = nativeFetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).then(async (res) => {
      if (!res.ok) return false;
      const data = await res.json().catch(() => ({}));
      if (!data.accessToken) return false;
      adminToken = data.accessToken;
      localStorage.setItem('pb_admin_token', adminToken);
      if (data.refreshToken) localStorage.setItem('pb_admin_refresh', data.refreshToken);
      return true;
    }).catch(() => false).finally(() => { setTimeout(() => { refreshing = null; }, 0); });
  }
  return refreshing;
}
window.fetch = async function (url, opts = {}) {
  const isAdminApi = typeof url === 'string' && url.includes('/api/admin/');
  if (!isAdminApi) return nativeFetch(url, opts);
  const withAuth = () => ({ ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + adminToken } });
  let res = await nativeFetch(url, withAuth());
  if (res.status === 401 && await refreshAdminToken()) res = await nativeFetch(url, withAuth());
  if (res.status === 401 && adminToken) {
    adminToken = null;
    localStorage.removeItem('pb_admin_token');
    localStorage.removeItem('pb_admin_refresh');
    renderAdminState();
  }
  return res;
};

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
    if (data.refreshToken) localStorage.setItem('pb_admin_refresh', data.refreshToken);
    localStorage.setItem('pb_admin_user', adminUserName);
    const keepBox = document.getElementById('adm-keep');
    localStorage.setItem('pb_admin_keep', keepBox && !keepBox.checked ? '0' : '1');
    sessionStorage.setItem('pb_admin_sess', '1');
    renderAdminState();
    loadCounts();
    document.getElementById('adm-phone').value = '';
    document.getElementById('adm-password').value = '';
  } catch (e) {
    status.textContent = 'Could not reach the server';
    status.className = 'register-status error';
  }
}

function toggleAdminPw() {
  const input = document.getElementById('adm-password');
  const eye = document.getElementById('adm-eye');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  eye.textContent = show ? '🙈' : '👁️';
  eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}

function adminLogout() {
  adminToken = null;
  adminUserName = null;
  localStorage.removeItem('pb_admin_token');
  localStorage.removeItem('pb_admin_refresh');
  localStorage.removeItem('pb_admin_user');
  renderAdminState();
}

async function loadNotices() {
  const box = document.getElementById('notice-list');
  if (!box || !adminToken) return;
  try {
    const res = await fetch(`${API_URL}/api/admin/notices`, { headers: { 'Authorization': 'Bearer ' + adminToken } });
    if (!res.ok) return;
    const { notices } = await res.json();
    box.innerHTML = notices.length
      ? '<strong>Recent notices</strong><br>' + notices.map(n =>
          `• <b>${escapeHtml(n.title)}</b> (${escapeHtml(n.audience)}) — ${escapeHtml(n.body)} ` +
          `<a href="#" onclick="deleteNotice('${escapeHtml(n.id)}');return false">remove</a>`).join('<br>')
      : 'No notices sent yet.';
  } catch (e) { /* ignore */ }
}

async function deleteNotice(id) {
  if (!adminToken || !confirm('Remove this notice from users\' bells?')) return;
  await fetch(`${API_URL}/api/admin/notices/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + adminToken } });
  loadNotices();
}

const NOTICE_TEMPLATES = [
  ['Weather warning', 'Heavy rain is expected. Please drive carefully and allow extra time for trips.'],
  ['Busy area', 'High demand right now. Drivers, head to busy areas to pick up more rides.'],
  ['Special offer', 'Ride with Pointbreak today and enjoy a special offer. Book your next ride now!'],
  ['Scheduled maintenance', 'Pointbreak will have a short maintenance break tonight. Thank you for your patience.'],
];
function noticeCount() {
  const el = document.getElementById('notice-count');
  if (el) el.textContent = `${document.getElementById('notice-body').value.length} / 500`;
}
function noticeTemplate(i) {
  document.getElementById('notice-title').value = NOTICE_TEMPLATES[i][0];
  document.getElementById('notice-body').value = NOTICE_TEMPLATES[i][1];
  noticeCount();
}

async function sendNotice() {
  const status = document.getElementById('notice-status');
  const btn = document.getElementById('notice-submit');
  if (!adminToken) { status.textContent = 'Sign in as admin first'; status.className = 'register-status error'; return; }
  const title = document.getElementById('notice-title').value.trim();
  const body = document.getElementById('notice-body').value.trim();
  const audience = document.getElementById('notice-audience').value;
  if (!title || !body) { status.textContent = 'Title and message are required'; status.className = 'register-status error'; return; }
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const res = await fetch(`${API_URL}/api/admin/notices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + adminToken },
      body: JSON.stringify({ title, body, audience }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { status.textContent = data.error || `Failed (${res.status})`; status.className = 'register-status error'; return; }
    status.textContent = `Sent to ${data.recipients} user(s); ${data.pushed} phone alert(s) delivered`;
    status.className = 'register-status ok';
    document.getElementById('notice-title').value = '';
    document.getElementById('notice-body').value = '';
    loadNotices();
  } catch (e) {
    status.textContent = 'Could not reach the server';
    status.className = 'register-status error';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send notification';
    noticeCount();
  }
}

let accounts = [];

async function acctApi(path, method, body) {
  const res = await fetch(`${API_URL}/api/admin${path}`, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + adminToken },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
  return data;
}

function acctMsg(text, ok) {
  const s = document.getElementById('acct-status');
  s.textContent = text;
  s.className = 'register-status ' + (ok ? 'ok' : 'error');
}

async function createRiderAccount(event) {
  event.preventDefault();
  const status = document.getElementById('new-rider-status');
  const button = document.getElementById('new-rider-submit');
  if (!adminToken) {
    status.textContent = 'Sign in as admin first';
    status.className = 'register-status error';
    return;
  }
  const name = document.getElementById('new-rider-name').value.trim();
  const phone = document.getElementById('new-rider-phone').value.trim();
  const password = document.getElementById('new-rider-password').value;
  button.disabled = true;
  status.textContent = 'Creating account…';
  status.className = 'register-status';
  try {
    const data = await acctApi('/users', 'POST', { name, phone, password });
    status.textContent = `Rider ${data.user.name} created. They can sign in with ${data.user.phone} and the password you set.`;
    status.className = 'register-status ok';
    event.target.reset();
    await loadAccounts();
    loadCounts();
  } catch (e) {
    status.textContent = e.message || 'Could not create account';
    status.className = 'register-status error';
  } finally {
    button.disabled = false;
  }
}

async function loadAccounts() {
  if (!adminToken) return;
  try {
    accounts = (await acctApi('/users')).users || [];
    renderAccounts();
    loadCodes();
  } catch (e) { acctMsg(e.message, false); }
}

function renderAccounts() {
  const box = document.getElementById('acct-list');
  if (!box) return;
  const q = document.getElementById('acct-search').value.trim().toLowerCase();
  const f = document.getElementById('acct-role').value;
  const list = accounts.filter(u => {
    if (f === 'suspended' ? !u.suspended : (f && u.role !== f)) return false;
    return !q || [u.name, u.phone, u.email, u.license_plate, u.vehicle_model].some(v => (v || '').toLowerCase().includes(q));
  });
  if (!list.length) { box.innerHTML = '<p class="empty">No accounts match.</p>'; return; }
  box.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
    '<tr style="text-align:left"><th>Name</th><th>Phone</th><th>Email</th><th>Role</th><th>Trips</th><th>Cancelled</th><th>Joined</th><th>Status</th><th></th></tr>' +
    list.map(u => {
      const trips = u.role === 'driver' ? u.rides_as_driver : u.rides_as_rider;
      const id = escapeHtml(u.id);
      return `<tr style="border-top:1px solid #2a2f3a">
        <td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.phone)}</td>
        <td>${u.email ? escapeHtml(u.email) + (u.email_verified ? ' ✓' : ' (unverified)') : '<span class="admin-hint">none</span>'}</td>
        <td>${escapeHtml(u.role)}${u.role === 'rider' ? (u.doc_count ? ' · 🪪 ' + u.doc_count + ' ID' : ' · <span class="admin-hint">no ID</span>') : ''}</td>
        <td>${trips || 0}</td><td>${u.cancelled_rides || 0}</td>
        <td>${escapeHtml((u.created_at || '').slice(0, 10))}</td>
        <td>${u.suspended ? '⛔ Suspended' : 'Active'}</td>
        <td><button class="reg-btn reg-btn-ghost" onclick="viewAccount('${id}')">View</button>
        <button class="reg-btn reg-btn-ghost" onclick="messageAccount('${id}')">Message</button>
        <button class="reg-btn reg-btn-ghost" onclick="setEmail('${id}')">Email</button>
        <button class="reg-btn reg-btn-ghost" onclick="resetPassword('${id}')">Reset password</button>
        <button class="reg-btn reg-btn-ghost" onclick="toggleSuspend('${id}')">${u.suspended ? 'Restore' : 'Suspend'}</button>
        <button class="reg-btn" style="background:#c0392b" onclick="deleteAccount('${id}')">Delete</button></td></tr>`;
    }).join('') + '</table>';
}

async function viewAccount(id) {
  const box = document.getElementById('acct-detail');
  try {
    const { user, driver, rides: rs } = await acctApi('/users/' + encodeURIComponent(id));
    box.innerHTML = `<div class="register-section" style="margin:0">
      <h3 style="margin:0 0 6px">${escapeHtml(user.name)} · ${escapeHtml(user.role)}</h3>
      <div class="admin-hint">${escapeHtml(user.phone)} · joined ${escapeHtml((user.created_at || '').slice(0, 10))}
      ${user.suspended ? ' · ⛔ Suspended: ' + escapeHtml(user.suspended_reason || 'no reason given') : ''}
      ${driver ? '<br>' + escapeHtml([driver.vehicle_type, driver.vehicle_model, driver.license_plate].filter(Boolean).join(' · ')) + ' · ★ ' + escapeHtml(Number(driver.rating || 5).toFixed(1)) : ''}</div>
      ${driver ? '<div style="margin-top:8px">Map icon: ' + ['🚗','🚘','🚙','🛻','🚐','🚌','🚕'].map(ic => `<button class="reg-btn reg-btn-ghost" style="font-size:20px;padding:2px 8px;${(driver.vehicle_icon || '🚗') === ic ? 'outline:2px solid #0af' : ''}" onclick="setVehicleIcon('${escapeHtml(driver.id)}','${ic}','${id}')">${ic}</button>`).join(' ') + '</div>' : ''}
      <h4 style="margin:10px 0 4px">Recent rides</h4>` +
      (rs.length ? rs.map(r => `<div class="admin-hint">${escapeHtml((r.requested_at || '').slice(0, 16))} · ${escapeHtml(r.pickup_place)} → ${escapeHtml(r.dropoff_place)} · ${escapeHtml(r.status)} · FJ$${escapeHtml(r.final_fare != null ? r.final_fare : r.fare)} · rider ${escapeHtml(r.rider_name || '?')} / driver ${escapeHtml(r.driver_name || '—')}${r.rating ? ' · ★' + escapeHtml(r.rating) : ''}</div>`).join('') : '<div class="admin-hint">No rides.</div>') +
      '<div id="acct-docs"></div></div>';
    loadDocs(id);
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) { acctMsg(e.message, false); }
}

const DOC_NAMES = { national_id: 'National ID', tin: 'TIN ID', voters_card: "Voter's card", passport: 'Passport', drivers_licence: "Driver's licence" };

async function loadDocs(userId) {
  const box = document.getElementById('acct-docs');
  if (!box) return;
  try {
    const { documents } = await acctApi('/users/' + encodeURIComponent(userId) + '/documents');
    if (!documents.length) { box.innerHTML = '<h4 style="margin:10px 0 4px">ID documents</h4><div class="admin-hint">None uploaded.</div>'; return; }
    box.innerHTML = '<h4 style="margin:10px 0 4px">ID documents</h4><div id="doc-grid" style="display:flex;flex-wrap:wrap;gap:10px"></div>';
    const grid = document.getElementById('doc-grid');
    for (const d of documents) {
      const res = await fetch(`${API_URL}/api/admin/documents/${encodeURIComponent(d.id)}`, { headers: { Authorization: 'Bearer ' + adminToken } });
      if (!res.ok) continue;
      const url = URL.createObjectURL(await res.blob());
      const cell = document.createElement('div');
      cell.style.cssText = 'max-width:220px';
      const isPdf = d.mime === 'application/pdf';
      cell.innerHTML = `<div class="admin-hint">${escapeHtml(DOC_NAMES[d.doc_type] || d.doc_type)} · ${escapeHtml((d.created_at || '').slice(0, 16))}</div>` +
        (isPdf ? '' : `<a href="${url}" target="_blank"><img src="${url}" style="max-width:220px;max-height:160px;border-radius:6px;border:1px solid #2a2f3a"></a>`) +
        `<div><a class="reg-btn reg-btn-ghost" href="${url}" target="_blank">Open</a> <a class="reg-btn reg-btn-ghost" href="${url}" download="${escapeHtml(d.doc_type)}-${escapeHtml(userId.slice(0, 6))}.${isPdf ? 'pdf' : 'jpg'}">Save</a></div>`;
      grid.appendChild(cell);
    }
  } catch (e) { box.innerHTML = '<div class="admin-hint">Could not load documents: ' + escapeHtml(e.message) + '</div>'; }
}

async function setVehicleIcon(driverId, icon, userId) {
  try {
    await acctApi('/drivers/' + encodeURIComponent(driverId), 'PATCH', { vehicle_icon: icon });
    acctMsg('Vehicle icon updated', true);
    viewAccount(userId);
  } catch (e) { acctMsg(e.message, false); }
}

async function setEmail(id) {
  const u = accounts.find(x => x.id === id);
  if (!u) return;
  const email = prompt(`Email for ${u.name} (${u.phone}):`, u.email || '');
  if (!email) return;
  try {
    await acctApi(`/users/${encodeURIComponent(id)}/email`, 'POST', { email });
    acctMsg('Email saved', true);
    await loadAccounts();
  } catch (e) { acctMsg(e.message, false); }
}

async function loadCodes() {
  const box = document.getElementById('code-list');
  if (!box || !adminToken) return;
  try {
    const r = await acctApi('/email-codes');
    if (r.mailConfigured) { box.innerHTML = '<span class="admin-hint">✉️ Email sending is on — codes go straight to users’ inboxes.</span>'; return; }
    box.innerHTML = '<div class="admin-hint">✉️ Email sending is not set up yet, so codes appear here. Pass them to the user (valid 15 min).</div>' +
      (r.codes.length ? r.codes.map(c => `<div style="margin-top:4px"><b style="font-size:16px;letter-spacing:2px">${escapeHtml(c.code)}</b> · ${escapeHtml(c.purpose === 'reset' ? 'password reset' : 'verify email')} · ${escapeHtml(c.name)} (${escapeHtml(c.phone)}) · ${escapeHtml(c.email)}</div>`).join('') : '<div class="admin-hint">No pending codes.</div>');
  } catch (e) {}
}

function globalFind() {
  document.getElementById('acct-search').value = document.getElementById('global-search').value;
  document.getElementById('acct-role').value = '';
  renderAccounts();
}

async function messageAccount(id) {
  const u = accounts.find(x => x.id === id);
  if (!u) return;
  const title = prompt(`Message to ${u.name} — title:`);
  if (!title || !title.trim()) return;
  const body = prompt('Message:');
  if (!body || !body.trim()) return;
  try {
    const r = await acctApi(`/users/${encodeURIComponent(id)}/message`, 'POST', { title, body });
    acctMsg(`Sent to ${u.name}${r.pushed ? ' (phone alert sent)' : ' (in their 🔔 bell)'}`, true);
  } catch (e) { acctMsg(e.message, false); }
}

async function resetPassword(id) {
  const u = accounts.find(x => x.id === id);
  if (!u) return;
  const custom = prompt(`Reset password for ${u.name}.\nType a new password (min 6 chars), or leave blank to generate one:`);
  if (custom === null) return;
  try {
    const r = await acctApi(`/users/${encodeURIComponent(id)}/reset-password`, 'POST', { password: custom });
    alert(`New password for ${u.name} (${u.phone}):\n\n${r.password}\n\nGive it to the user and ask them to sign in.`);
    acctMsg(`Password reset for ${u.name}`, true);
  } catch (e) { acctMsg(e.message, false); }
}

async function toggleSuspend(id) {
  const u = accounts.find(x => x.id === id);
  if (!u) return;
  let reason = '';
  if (!u.suspended) {
    reason = prompt(`Suspend ${u.name}? Enter a reason (optional):`);
    if (reason === null) return;
  } else if (!confirm(`Restore ${u.name}'s account?`)) return;
  try {
    await acctApi(`/users/${encodeURIComponent(id)}/suspend`, 'POST', { suspended: !u.suspended, reason });
    acctMsg(u.suspended ? 'Account restored' : 'Account suspended', true);
    await loadAccounts();
  } catch (e) { acctMsg(e.message, false); }
}

async function deleteAccount(id) {
  const u = accounts.find(x => x.id === id);
  if (!u) return;
  const typed = prompt(`Permanently delete ${u.name} (${u.role})? This cannot be undone.\nType DELETE to confirm:`);
  if (typed !== 'DELETE') return;
  try {
    await acctApi('/users/' + encodeURIComponent(id), 'DELETE');
    acctMsg(`Deleted ${u.name}`, true);
    document.getElementById('acct-detail').innerHTML = '';
    await Promise.all([loadAccounts(), loadInitialData()]);
  } catch (e) { acctMsg(e.message, false); }
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
  const vehicle_icon = document.getElementById('reg-vehicle-icon').value;
  const license_plate = document.getElementById('reg-plate').value.trim();
  const email = document.getElementById('reg-email').value.trim();

  if (!name || !phone || !password) { status.textContent = 'Name, phone and password are required'; status.className = 'register-status error'; return; }

  btn.disabled = true;
  btn.textContent = 'Creating…';
  try {
    const res = await fetch(`${API_URL}/api/admin/drivers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ name, phone, password, vehicle_type, vehicle_model, vehicle_icon, license_plate, email }),
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

async function refreshDashboard() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.textContent = 'Refreshing…';
  await Promise.all([loadCounts(), loadInitialData()]);
  btn.disabled = false;
  btn.textContent = '⟳ Refresh';
}

async function loadCounts() {
  if (!adminToken) return;
  try {
    const res = await fetch(`${API_URL}/api/admin/counts`, { headers: { 'Authorization': 'Bearer ' + adminToken } });
    if (!res.ok) return;
    const c = await res.json();
    document.getElementById('stat-riders').textContent = c.riders;
    document.getElementById('stat-drivers').textContent = c.drivers;
  } catch (e) {}
  try {
    const rr = await fetch(`${API_URL}/api/admin/riders/live`, { headers: { 'Authorization': 'Bearer ' + adminToken } });
    if (rr.ok) { liveRiders = (await rr.json()).riders || []; renderMap(); }
  } catch (e) {}
}

async function loadInitialData() {
  loadCounts();
  loadNotices();
  loadAccounts();
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
  loadCounts();
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

let roadsideSeen = null;
function showRoadsideAlert(msg) {
  let box = document.getElementById("roadside-alert");
  if (!box) {
    box = document.createElement("div");
    box.id = "roadside-alert";
    box.style.cssText = "position:fixed;top:12px;right:12px;z-index:9999;max-width:340px;display:flex;flex-direction:column;gap:8px";
    document.body.appendChild(box);
  }
  const item = document.createElement("div");
  item.style.cssText = "background:#fff3cd;color:#5c4400;border:2px solid #f0b400;border-radius:10px;padding:12px;font-weight:700;box-shadow:0 4px 12px rgba(0,0,0,.2)";
  item.textContent = msg;
  box.appendChild(item);
  setTimeout(() => item.remove(), 15000);
}

async function loadRoadside() {
  const list = document.getElementById("roadside-list");
  if (!list || !adminToken) return;
  try {
    const res = await fetch(`${API_URL}/api/admin/roadside`, { headers: { Authorization: "Bearer " + adminToken } });
    if (!res.ok) return;
    const { trips } = await res.json();
    document.getElementById("roadside-count").textContent = `${trips.length} trips`;
    const keys = trips.map(t => `${t.id}:${t.status}`);
    if (roadsideSeen === null) {
      roadsideSeen = new Set(keys);
    } else {
      trips.filter(t => !roadsideSeen.has(`${t.id}:${t.status}`)).forEach(t => {
        const who = t.driver_name || "A driver";
        const msg = t.status === "running"
          ? `🚕 ${who} started a roadside trip (${t.tariff_type.replace(/_/g, " ")})`
          : `🏁 ${who} ended a roadside trip — total FJ$ ${Number(t.total_fare).toFixed(2)}`;
        showRoadsideAlert(msg);
        beep();
        try { if (window.Notification && Notification.permission === "granted") new Notification("Roadside meter", { body: msg }); } catch {}
      });
      roadsideSeen = new Set(keys);
    }
    if (!trips.length) { list.innerHTML = `<p class="empty">No roadside trips yet.</p>`; return; }
    list.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="text-align:left"><th>When</th><th>Driver</th><th>Tariff</th><th>Distance</th><th>Time</th><th>Fare</th><th>Status</th></tr>` +
      trips.map(t => `<tr style="border-top:1px solid #ddd"><td>${escapeHtml(fmtFijiDateTime(parseDbUtc(t.created_at)))}</td><td>${escapeHtml(t.driver_name || "Driver")}<br><small>${escapeHtml(t.driver_phone || "")}</small></td><td>${escapeHtml(t.tariff_type)}</td><td>${Number(t.trip_distance_km).toFixed(2)} km</td><td>${Math.floor(t.trip_duration_seconds / 60)}m ${t.trip_duration_seconds % 60}s</td><td><b>${t.status === "running" ? "—" : "FJ$ " + Number(t.total_fare).toFixed(2)}</b></td><td>${t.status === "running" ? "🟢 Running" : "Finished"}</td></tr>`).join("") + `</table>`;
  } catch {}
}

function renderAll() {
  loadRoadside();
  renderScheduled();
  renderStats();
  renderRides();
  renderDrivers();
  renderMap();
}

const ACTIVE_RIDE_STATUSES = ['requested', 'accepted', 'arrived', 'picking_up', 'in_progress'];
let liveMap = null;
let mapLayer = null;
let mapFitted = false;
let openPopupKey = null;

function initMap() {
  if (liveMap || typeof L === 'undefined') return;
  liveMap = L.map('live-map').setView([-17.75, 177.9], 8);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 18,
    attribution: 'Tiles &copy; Esri',
  }).addTo(liveMap);
  mapLayer = L.layerGroup().addTo(liveMap);
}

function emojiIcon(emoji) {
  return L.divIcon({
    className: 'map-emoji',
    html: `<span>${emoji}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -16],
  });
}

function validPoint(lat, lng) {
  return typeof lat === 'number' && typeof lng === 'number' && isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0);
}

function renderMap() {
  initMap();
  if (!liveMap) return;
  const keepKey = openPopupKey;
  mapLayer.clearLayers();
  openPopupKey = keepKey;
  const points = [];
  let reopen = null;
  const addMarker = (key, lat, lng, emoji, html) => {
    const m = L.marker([lat, lng], { icon: emojiIcon(emoji) }).bindPopup(html).addTo(mapLayer);
    m.on('popupopen', () => { openPopupKey = key; });
    m.on('popupclose', () => { if (openPopupKey === key) openPopupKey = null; });
    if (openPopupKey === key) reopen = m;
  };
  const activeRides = rides.filter(r => ACTIVE_RIDE_STATUSES.includes(r.status));
  const rideByDriver = {};
  activeRides.forEach(r => { if (r.driver_id) rideByDriver[r.driver_id] = r; });

  drivers.filter(d => d.status !== 'offline' && validPoint(d.lat, d.lng)).forEach(d => {
    const ride = rideByDriver[d.id];
    const vehicle = [d.vehicle_type, d.vehicle_model].filter(Boolean).join(' ');
    const html = `
      <div class="map-popup">
        <strong>${escapeHtml(d.full_name || d.name || 'Driver')}</strong>
        <div>Status: ${escapeHtml(d.status || 'unknown')}</div>
        ${d.phone ? `<div>Phone: ${escapeHtml(d.phone)}</div>` : ''}
        ${vehicle ? `<div>Vehicle: ${escapeHtml(vehicle)}</div>` : ''}
        ${d.license_plate ? `<div>Plate: ${escapeHtml(d.license_plate)}</div>` : ''}
        <div>Rating: ${escapeHtml(d.rating != null ? Number(d.rating).toFixed(1) : '5.0')} &middot; ${d.trips || 0} trips</div>
        ${assigningRideId && d.status === 'online' ? `<button class="reg-btn" style="margin-top:6px;width:100%" onclick="assignDriver('${escapeHtml(d.id)}')">✅ Assign to booking</button>` : ''}
        ${ride ? `<div class="map-popup-ride">On ride: ${escapeHtml(ride.pickup_place || '')} &rarr; ${escapeHtml(ride.dropoff_place || '')} (${escapeHtml(statusLabel(ride.status))})</div>` : ''}
      </div>`;
    addMarker('d:' + d.id, d.lat, d.lng, '🚗', html);
    points.push([d.lat, d.lng]);
  });

  const assigning = assigningRideId && rides.find(x => x.id === assigningRideId);
  if (assigning && validPoint(assigning.pickup_lat, assigning.pickup_lng)) {
    addMarker('a:' + assigning.id, assigning.pickup_lat, assigning.pickup_lng, '🧍',
      `<div class="map-popup"><strong>Booking pickup</strong><div>${escapeHtml(assigning.rider_name || 'Rider')}</div><div>${escapeHtml(assigning.pickup_place || '')}</div></div>`);
    points.push([assigning.pickup_lat, assigning.pickup_lng]);
  }

  activeRides.forEach(r => {
    const info = `
      <div class="map-popup">
        <strong>Ride #${escapeHtml(String(r.id || '').slice(0, 8))}</strong>
        <div>Status: ${escapeHtml(statusLabel(r.status))}</div>
        <div>Rider: ${escapeHtml(r.rider_name || 'Unknown')}${r.rider_phone ? ' (' + escapeHtml(r.rider_phone) + ')' : ''}</div>
        <div>Driver: ${escapeHtml(r.driver_name || 'Unassigned')}</div>
        <div>From: ${escapeHtml(r.pickup_place || '')}</div>
        <div>To: ${escapeHtml(r.dropoff_place || '')}</div>
        <div>Fare: FJ$${(r.fare || 0).toFixed(2)}${r.distance_km ? ' &middot; ' + r.distance_km.toFixed(1) + ' km' : ''}</div>
      </div>`;
    if (validPoint(r.pickup_lat, r.pickup_lng)) {
      addMarker('p:' + r.id, r.pickup_lat, r.pickup_lng, '🧍', info);
      points.push([r.pickup_lat, r.pickup_lng]);
    }
    if (validPoint(r.dropoff_lat, r.dropoff_lng)) {
      addMarker('x:' + r.id, r.dropoff_lat, r.dropoff_lng, '🏁', info);
      if (validPoint(r.pickup_lat, r.pickup_lng)) {
        L.polyline([[r.pickup_lat, r.pickup_lng], [r.dropoff_lat, r.dropoff_lng]], {
          color: '#38bdf8', weight: 3, dashArray: '6 8', opacity: 0.8,
        }).addTo(mapLayer);
      }
    }
  });

  liveRiders.filter(p => validPoint(p.lat, p.lng)).forEach(p => {
    const html = `
      <div class="map-popup">
        <strong>${escapeHtml(p.name || 'Rider')}</strong>
        <div>Online rider</div>
        ${p.phone ? `<div>Phone: ${escapeHtml(p.phone)}</div>` : ''}
        <div>Last seen: ${escapeHtml(new Date(p.last_seen).toLocaleTimeString())}</div>
      </div>`;
    addMarker('r:' + p.id, p.lat, p.lng, '🙋', html);
    points.push([p.lat, p.lng]);
  });

  document.getElementById('map-count').textContent = `${points.length} on map`;
  if (reopen) reopen.openPopup();
  if (!mapFitted && points.length) {
    liveMap.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
    mapFitted = true;
  }
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
    scheduled: 'Booked',
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

// ---- Booked in advance ----
function parseDbUtc(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z'));
  return isNaN(d.getTime()) ? null : d;
}

function fmtFijiDateTime(d) {
  if (!d) return '�';
  return d.toLocaleString('en-FJ', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}

function getSeenSched() {
  try { return new Set(JSON.parse(localStorage.getItem('pb_seen_sched') || '[]')); } catch { return new Set(); }
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.25].forEach((t) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = 0.2;
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.18);
    });
  } catch {}
}

function ackSched() {
  const seen = getSeenSched();
  rides.filter(r => r.scheduled_at).forEach(r => seen.add(r.id));
  localStorage.setItem('pb_seen_sched', JSON.stringify([...seen]));
  const box = document.getElementById('sched-alert');
  if (box) box.style.display = 'none';
  renderScheduled();
}

let schedAlerted = new Set();
function renderScheduled() {
  const list = document.getElementById('sched-list');
  if (!list) return;
  const seen = getSeenSched();
  const sched = rides.filter(r => r.scheduled_at);
  const upcoming = sched.filter(r => r.status === 'scheduled' || r.status === 'requested')
    .sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at)));
  const past = sched.filter(r => r.status !== 'scheduled')
    .sort((a, b) => String(b.scheduled_at).localeCompare(String(a.scheduled_at))).slice(0, 10);
  const fresh = upcoming.filter(r => !seen.has(r.id));

  document.getElementById('sched-count').textContent = `${upcoming.length} upcoming`;

  const box = document.getElementById('sched-alert');
  if (fresh.length) {
    box.style.display = 'block';
    box.innerHTML = `?? ${fresh.length} new advance booking${fresh.length > 1 ? 's' : ''} � ` +
      fresh.map(r => `${escapeHtml(r.rider_name || 'Rider')} (${escapeHtml(fmtFijiDateTime(parseDbUtc(r.scheduled_at)))})`).join('; ') +
      ` <button class="reg-btn" style="margin-left:8px" onclick="ackSched()">Mark as seen</button>`;
    const brandNew = fresh.filter(r => !schedAlerted.has(r.id));
    if (brandNew.length) {
      brandNew.forEach(r => schedAlerted.add(r.id));
      beep();
      try {
        if (window.Notification && Notification.permission === 'granted') {
          const r = brandNew[0];
          new Notification('New advance booking', {
            body: `${r.rider_name || 'Rider'} � ${fmtFijiDateTime(parseDbUtc(r.scheduled_at))}\n${r.pickup_place} ? ${r.dropoff_place}`,
          });
        } else if (window.Notification && Notification.permission === 'default') {
          Notification.requestPermission();
        }
      } catch {}
    }
  } else {
    box.style.display = 'none';
  }

  const card = (r) => {
    const when = fmtFijiDateTime(parseDbUtc(r.scheduled_at));
    const booked = fmtFijiDateTime(parseDbUtc(r.requested_at));
    const map = (lat, lng) => (lat != null && lng != null)
      ? ` <a href="https://www.google.com/maps?q=${encodeURIComponent(lat + ',' + lng)}" target="_blank" rel="noopener">map</a>` : '';
    return `<div class="ride-card ${escapeHtml(r.status)}" style="margin-bottom:8px">
      <div class="ride-header">
        <span class="ride-id">#${escapeHtml(String(r.id).slice(0, 8))}${seen.has(r.id) ? '' : ' ??'}</span>
        <span class="status-badge ${escapeHtml(r.status)}">${statusLabel(r.status)}</span>
      </div>
      <div><strong>?? Pickup time:</strong> ${escapeHtml(when)}</div>
      <div><strong>?? Rider:</strong> ${escapeHtml(r.rider_name || 'Unknown')} � ?? ${escapeHtml(r.rider_phone || '�')}${r.rider_email ? ' � ?? ' + escapeHtml(r.rider_email) : ''}</div>
      <div><strong>?? Pick up from:</strong> ${escapeHtml(r.pickup_place || '�')}${map(r.pickup_lat, r.pickup_lng)}</div>
      <div><strong>?? Drop off:</strong> ${escapeHtml(r.dropoff_place || '�')}${map(r.dropoff_lat, r.dropoff_lng)}</div>
      ${(r.status === 'scheduled' || (r.status === 'requested' && r.scheduled_at)) ? `<div style="margin:6px 0">${r.driver_name ? `🚗 Offered to <strong>${escapeHtml(r.driver_name)}</strong> — waiting for them to accept. ` : ''}<button class="reg-btn" onclick="startAssign('${escapeHtml(r.id)}')">${assigningRideId === r.id ? 'Pick a car on the map…' : (r.driver_name ? 'Reassign driver' : '🚗 Assign a driver')}</button></div>` : ''}
      <div class="ride-details">
        <span>FJ$${Number(r.fare || 0).toFixed(2)}</span>
        ${r.distance_km ? `<span>${Number(r.distance_km).toFixed(1)} km</span>` : ''}
        <span>Driver: ${escapeHtml(r.driver_name || 'Unassigned')}</span>
        <span class="ride-time">Booked ${escapeHtml(booked)}</span>
      </div>
    </div>`;
  };

  list.innerHTML = (upcoming.length ? upcoming.map(card).join('') : '<p class="empty">No upcoming advance bookings.</p>') +
    (past.length ? '<h3 style="margin:14px 0 6px">Earlier bookings</h3>' + past.map(card).join('') : '');
}

// ---- Assign a driver to a booking ----

function startAssign(rideId) {
  assigningRideId = rideId;
  const r = rides.find(x => x.id === rideId);
  const bar = document.getElementById('assign-bar');
  if (bar) {
    bar.style.display = 'block';
    bar.innerHTML = `Assigning a driver to <strong>${escapeHtml((r && r.rider_name) || 'rider')}</strong> (${escapeHtml(r ? fmtFijiDateTime(parseDbUtc(r.scheduled_at)) : '')}). ` +
      `Click a free ?? on the map, then <em>Assign to booking</em>. <button class="reg-btn reg-btn-ghost" onclick="cancelAssign()">Cancel</button>`;
  }
  renderScheduled();
  renderMap();
  showTab('live');
  const m = document.querySelector('.map-section');
  if (m) m.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelAssign() {
  assigningRideId = null;
  const bar = document.getElementById('assign-bar');
  if (bar) bar.style.display = 'none';
  renderScheduled();
  renderMap();
}

async function assignDriver(driverId) {
  if (!assigningRideId) return;
  const d = drivers.find(x => x.id === driverId);
  const r = rides.find(x => x.id === assigningRideId);
  if (!confirm(`Assign ${d ? d.full_name : 'this driver'} to ${r ? r.rider_name : 'this booking'}?`)) return;
  try {
    const res = await fetch(`${API_URL}/api/admin/rides/${encodeURIComponent(assigningRideId)}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + adminToken },
      body: JSON.stringify({ driver_id: driverId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { alert(data.error || 'Could not assign driver'); return; }
    alert('Driver assigned. They have received the booking request and the rider can see them.');
    cancelAssign();
    pollData();
  } catch (e) {
    alert('Network error � try again.');
  }
}


// ---- Tabs ----
function showTab(name) {
  if (!['live','bookings','messaging','users','ai'].includes(name)) name = 'live';
  document.querySelectorAll('[data-tab]').forEach(el => el.classList.toggle('tab-hidden', el.dataset.tab !== name));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.go === name));
  try { localStorage.setItem('pb-admin-tab', name); } catch (e) {}
  if (name === 'live' && typeof liveMap !== 'undefined' && liveMap) setTimeout(() => liveMap.invalidateSize(), 50);
}
showTab((location.hash || '').slice(1) || (function () { try { return localStorage.getItem('pb-admin-tab'); } catch (e) { return null; } })() || 'live');
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h) showTab(h); });

// ---- AI assistant ----
const aiHistory = [];
function aiBubble(text, who) {
  const log = document.getElementById('ai-log');
  const d = document.createElement('div');
  d.style.cssText = 'padding:10px 12px;border-radius:10px;white-space:pre-wrap;max-width:90%;' +
    (who === 'user' ? 'align-self:flex-end;background:#33AADD;color:#04121f' : 'align-self:flex-start;background:#1A2B3D;border:1px solid #2A3B4D');
  d.textContent = text;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
  return d;
}

async function aiAsk(preset) {
  const input = document.getElementById('ai-input');
  const q = (preset || input.value || '').trim();
  if (!q) return;
  if (!adminToken) { aiBubble('Sign in with the admin account first.', 'ai'); return; }
  input.value = '';
  aiBubble(q, 'user');
  const wait = aiBubble('Thinking…', 'ai');
  const btn = document.getElementById('ai-send');
  btn.disabled = true;
  try {
    const res = await fetch(`${API_URL}/api/admin/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, history: aiHistory }),
    });
    const data = await res.json().catch(() => ({}));
    const answer = res.ok ? data.answer : (data.error || 'Something went wrong');
    wait.textContent = answer;
    if (res.ok) { aiHistory.push({ role: 'user', content: q }, { role: 'assistant', content: answer }); }
  } catch (e) {
    wait.textContent = 'Could not reach the server.';
  }
  btn.disabled = false;
}