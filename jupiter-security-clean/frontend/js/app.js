
/* Jupiter Security Management System - Frontend */
const API = '/api';
let token = localStorage.getItem('jupiter_token');
let currentUser = null;
// ---------- Login Password Visibility ----------
document.addEventListener('DOMContentLoaded', () => {
  const passwordInput = document.getElementById('login-password');
  const showPassword = document.getElementById('show-login-password');

  if (!passwordInput || !showPassword) return;

  showPassword.addEventListener('change', () => {
    passwordInput.type = showPassword.checked ? 'text' : 'password';
  });
});

// ---------- Live Location Map ----------
let jupiterLiveLocationTimer = null;
let jupiterLiveLocationMap = null;
let jupiterLiveLocationMarkers = null;

// ---------- Background Guard GPS Tracking ----------
let jupiterGpsWatchId = null;
let jupiterGpsLastSentAt = 0;
let jupiterGpsLastPosition = null;
let jupiterGpsSending = false;

function getGpsDistanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = value => value * Math.PI / 180;
  const earthRadius = 6371000;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;

  return earthRadius * 2 *
    Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function startGuardGpsTracking() {
  if (!currentUser || currentUser.role !== 'guard') return;
  if (jupiterGpsWatchId !== null) return;

  if (!navigator.geolocation) {
    console.warn('GPS tracking is not supported by this browser.');
    return;
  }

  jupiterGpsWatchId = navigator.geolocation.watchPosition(
    async position => {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      const accuracy_m = position.coords.accuracy;

      const now = Date.now();

      const distance = jupiterGpsLastPosition
        ? getGpsDistanceMeters(
            jupiterGpsLastPosition.latitude,
            jupiterGpsLastPosition.longitude,
            latitude,
            longitude
          )
        : Infinity;

      // Update after 25 metres of movement or 60 seconds.
      if (
        jupiterGpsLastSentAt > 0 &&
        distance < 25 &&
        now - jupiterGpsLastSentAt < 60000
      ) {
        return;
      }

      if (jupiterGpsSending) return;

      jupiterGpsSending = true;

      try {
        await api('/locations/update', {
          method: 'POST',
          body: JSON.stringify({
            latitude,
            longitude,
            accuracy_m
          })
        });

        jupiterGpsLastSentAt = Date.now();
        jupiterGpsLastPosition = {
          latitude,
          longitude
        };

      } catch (err) {
        if (err.message === 'Account is deactivated. Contact management.') {
          console.warn('GPS tracking stopped because this guard is On Access.');
          stopGuardGpsTracking();
          return;
        }

        console.error('Background GPS update failed:', err.message);

      } finally {
        jupiterGpsSending = false;
      }
    },

    error => {
      console.warn('GPS tracking error:', error.message);

      if (error.code === error.PERMISSION_DENIED) {
        stopGuardGpsTracking();
      }
    },

    {
      enableHighAccuracy: true,
      maximumAge: 15000,
      timeout: 20000
    }
  );

  console.log('Background GPS tracking started.');
}

function stopGuardGpsTracking() {
  if (jupiterGpsWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(jupiterGpsWatchId);
  }

  jupiterGpsWatchId = null;
  jupiterGpsLastSentAt = 0;
  jupiterGpsLastPosition = null;
  jupiterGpsSending = false;

  console.log('Background GPS tracking stopped.');
}

async function api(path, options = {}) {
  const headers = {
    ...(options.headers || {})
  };

  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(API + path, { ...options, headers });
  const data = await res.json();

  if (!res.ok) throw new Error(data.message || 'Request failed');

  return data;
}


function show(el) {
  el.classList.remove('hidden');
}

function hide(el) {
  el.classList.add('hidden');
}

function formatNAD(n) {
  return 'N$ ' + Number(n || 0).toLocaleString('en-NA', {
    minimumFractionDigits: 2
  });
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function localDateString(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

async function syncGuardGpsTracking() {
  if (!currentUser || currentUser.role !== 'guard') {
    stopGuardGpsTracking();
    return;
  }

  try {
    const attendance = await api('/attendance/my');
    const latestRecord = Array.isArray(attendance.data)
      ? attendance.data[0]
      : null;

    if (latestRecord && !latestRecord.clock_out_at) {
      startGuardGpsTracking();
    } else {
      stopGuardGpsTracking();
    }
  } catch (err) {
    stopGuardGpsTracking();
    console.warn('Could not verify attendance status for GPS tracking:', err.message);
  }
}
// ---------- Auth ----------
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('login-code').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');

  errEl.textContent = '';

  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    token = data.token;
    currentUser = data.user;

    localStorage.setItem('jupiter_token', token);
    localStorage.setItem('jupiter_user', JSON.stringify(currentUser));

    enterApp();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('btn-logout').addEventListener('click', () => {
    stopGuardGpsTracking();
  token = null;
  currentUser = null;

  localStorage.removeItem('jupiter_token');
  localStorage.removeItem('jupiter_user');

  hide(document.getElementById('main-screen'));
  show(document.getElementById('login-screen'));
});

function enterApp() {
  hide(document.getElementById('login-screen'));
  show(document.getElementById('main-screen'));

  document.getElementById('user-name').textContent =
    currentUser.full_name || '';

  document.getElementById('user-role').textContent =
    currentUser.employee_code === 'JUP-ADMIN-001'
      ? 'Managing Director'
      : (currentUser.role || '');

  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display =
      (currentUser.role === 'admin' || currentUser.role === 'manager')
        ? ''
        : 'none';
  });

  document.querySelectorAll('.admin-guard-only').forEach(el => {
    el.style.display =
      (currentUser.role === 'admin' || currentUser.role === 'guard')
        ? ''
        : 'none';
  });
  document.querySelectorAll('.guard-only').forEach(el => {
    el.style.display = currentUser.role === 'guard' ? '' : 'none';
  });
  if (currentUser.role === 'guard') {
    syncGuardGpsTracking();
  } else {
    stopGuardGpsTracking();
  }

  loadPage('dashboard');
}

// ---------- Navigation ----------
document.getElementById('sidebar').addEventListener('click', (e) => {
  const button = e.target.closest('.nav-btn');
  if (!button) return;

  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.remove('active');
  });

  button.classList.add('active');
  loadPage(button.dataset.page);
});

async function loadPage(page) {
  if (jupiterLiveLocationTimer !== null) {
    clearInterval(jupiterLiveLocationTimer);
    jupiterLiveLocationTimer = null;
  }

  if (jupiterLiveLocationMap) {
    jupiterLiveLocationMap.remove();
    jupiterLiveLocationMap = null;
    jupiterLiveLocationMarkers = null;
  }
  const content = document.getElementById('content');
  content.innerHTML = '<p>Loading...</p>';

  try {
    switch (page) {
      case 'dashboard': await renderDashboard(content); break;
      case 'guards': await renderGuards(content); break;
      case 'sites': await renderSites(content); break;
      case 'assignments': await renderAssignments(content); break;
      case 'shifts': await renderShifts(content); break;
      case 'attendance': await renderAttendance(content); break;
           case 'location': await renderLocation(content); break;
      case 'payroll': await renderPayroll(content); break;
      case 'incidents': await renderIncidents(content); break;
      case 'clock': await renderClock(content); break;
      case 'password': await renderChangePassword(content); break;
      default: content.innerHTML = '<p>Page not found</p>';
    }
  } catch (err) {
    content.innerHTML =
      `<p class="error">${escapeHTML(err.message)}</p>`;
  }
}

// ---------- Change Password ----------
async function renderChangePassword(el) {
  if (!currentUser || !['admin', 'guard'].includes(currentUser.role)) {
    el.innerHTML = '<p class="error">Access denied.</p>';
    return;
  }

  el.innerHTML = `
    <div class="card">
      <h2>Change Password</h2>
      <p>Choose a new password of at least 4 characters.</p>

      <form id="change-password-form">
        <label for="current-password">Current Password</label>
        <input type="password" id="current-password"
          autocomplete="current-password" required />

        <label for="new-password">New Password</label>
        <input type="password" id="new-password"
          autocomplete="new-password" minlength="4"
          maxlength="128" required />

        <label for="confirm-password">Confirm New Password</label>
        <input type="password" id="confirm-password"
          autocomplete="new-password" minlength="4"
          maxlength="128" required />

        <p id="change-password-message" role="status"></p>
        <button type="submit" id="change-password-submit">
          Change Password
        </button>
      </form>
    </div>
  `;

  const form = document.getElementById('change-password-form');
  const message = document.getElementById('change-password-message');
  const submit = document.getElementById('change-password-submit');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = '';

    const currentPassword =
      document.getElementById('current-password').value;
    const newPassword =
      document.getElementById('new-password').value;
    const confirmPassword =
      document.getElementById('confirm-password').value;

    if (newPassword !== confirmPassword) {
      message.textContent = 'The new passwords do not match.';
      return;
    }

    submit.disabled = true;

    try {
      const result = await api('/users/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword })
      });

      message.textContent = result.message || 'Password changed.';
      form.reset();
    } catch (err) {
      message.textContent = err.message;
    } finally {
      submit.disabled = false;
    }
  });
}

// ---------- Dashboard ----------
async function renderDashboard(el) {
  el.innerHTML = `
    <h2 style="margin-bottom:1rem">Dashboard</h2>
    <div class="grid" id="dash-stats"></div>
    <div class="card" style="margin-top:1.5rem">
      <h2>Welcome to Jupiter Security Management System</h2>
      <p style="color:var(--muted);margin-top:0.5rem">
        Namibia · Currency: NAD · Shift pattern: 7 Day → 7 Night → 1 Off
      </p>
    </div>
  `;

  if (currentUser.role !== 'guard') {
    try {
      const today = localDateString();

      const [guards, sites, live, missingResult] = await Promise.all([
        api('/users?role=guard&active=true'),
        api('/sites?status=approved'),
        api('/locations/live'),
        api(`/shifts/missing?date=${encodeURIComponent(today)}`)
      ]);

      const missingGuards = new Map();

      (Array.isArray(missingResult.data) ? missingResult.data : [])
        .filter(row =>
          String(row.finding || '').trim().toLowerCase() === 'no rotation assigned'
        )
        .forEach(row => {
          const id = String(row.guard_id ?? row.id ?? '');
          if (id) missingGuards.set(id, row);
        });

      document.getElementById('dash-stats').innerHTML = `
        <div class="stat">
          <div class="value">${guards.data.length}</div>
          <div class="label">Active Guards</div>
        </div>
        <div class="stat">
          <div class="value">${sites.data.length}</div>
          <div class="label">Approved Sites</div>
        </div>
        <div class="stat">
          <div class="value">
            ${live.data.filter(l => l.is_on_duty).length}
          </div>
          <div class="label">Currently On Duty</div>
        </div>
        <div class="stat" id="dash-missing-cycles"
          role="button" tabindex="0"
          style="cursor:pointer;"
          title="Open Missing Shift Report">
          <div class="value">${missingGuards.size}</div>
          <div class="label">Missing 15-Day Cycles</div>
        </div>
      `;

      const missingCard = document.getElementById('dash-missing-cycles');

      const openMissingReport = () => {
        document.querySelector('[data-page="shifts"]')?.click();
        setTimeout(() => {
          document.getElementById('btn-toggle-missing')?.click();
          document.getElementById('btn-load-missing')?.click();
        }, 150);
      };

      missingCard.addEventListener('click', openMissingReport);
      missingCard.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openMissingReport();
        }
      });

    } catch (err) {
      console.error('Dashboard statistics error:', err);
    }
  }
}

// ---------- Guards ----------
async function renderGuards(el) {
  el.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;
        align-items:center;gap:12px;flex-wrap:wrap;">
        <h2>Security Guards</h2>
        <button class="btn" id="btn-refresh-guards" type="button">
          ↻ Refresh
        </button>
      </div>

      ${currentUser && currentUser.role === 'admin' ? `
        <div style="border:1px solid var(--border);padding:16px;margin:16px 0;border-radius:8px;">
          <h3>Create Administrator</h3>
          <div class="form-row" style="flex-wrap:wrap;gap:8px;">
            <input id="admin-name" placeholder="Full Name" required />
            <input id="admin-phone" placeholder="Phone (+264...)" required />
            <input id="admin-email" type="email" placeholder="Email Address" required />
            <button class="btn" id="btn-create-admin" type="button">
              Create Administrator
            </button>
          </div>
          <p id="admin-create-status" role="status" style="color:var(--muted);"></p>
        </div>
      ` : ''}
      <div class="form-row" style="flex-wrap:wrap;gap:8px;">
        <input id="g-name" placeholder="Full Name" required />
        <input id="g-phone" placeholder="Phone (+264...)" required />
        <input id="g-email" type="email"
          placeholder="Email Address (Optional)" />
        <input id="g-dob" type="date" title="Date of Birth" />
        <input id="g-hired" type="date" title="Date Hired" />
        <input id="g-rate" type="number" step="0.01" min="0"
          placeholder="Hourly Rate (NAD)" />
        <button class="btn" id="btn-add-guard" type="button">
          Register Guard
        </button>
      </div>

      <div style="display:flex;gap:10px;align-items:center;
        flex-wrap:wrap;margin:16px 0;">
        <input id="guard-search" type="search"
          placeholder="Search name, employee code or username..."
          aria-label="Search guards"
          style="flex:1;min-width:240px;" />
        <span id="guard-count" aria-live="polite"></span>
      </div>

      <p id="guard-list-status" role="status"
        style="color:var(--muted);"></p>

      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th>Code</th><th>Name</th><th>Phone</th><th>Email</th>
              <th>DOB</th><th>Hired</th><th>Rate</th><th>Status</th>
              <th>On Access Since</th><th>Actions</th>
            </tr>
          </thead>
          <tbody id="guards-table-body"></tbody>
        </table>
      </div>
    </div>
  `;

  const searchInput = document.getElementById('guard-search');
  const tbody = document.getElementById('guards-table-body');
  const countEl = document.getElementById('guard-count');
  const statusEl = document.getElementById('guard-list-status');
  const refreshButton = document.getElementById('btn-refresh-guards');

  let guards = [];
  let isRefreshing = false;

  const dateOnly = value => value ? String(value).slice(0, 10) : '-';

  function renderGuardRows() {
    const query = searchInput.value.trim().toLowerCase();

    const filtered = guards.filter(guard =>
      [
        guard.full_name, guard.first_name, guard.last_name,
        guard.employee_code, guard.username, guard.user_name
      ].some(value => String(value ?? '').toLowerCase().includes(query))
    );

    countEl.textContent =
      `Showing ${filtered.length} of ${guards.length} guards`;

    if (!filtered.length) {
      tbody.innerHTML = `
        <tr><td colspan="10">
          ${query ? 'No guards match your search.' : 'No guards found.'}
        </td></tr>
      `;
      return;
    }

    tbody.innerHTML = filtered.map(guard => {
      const id = Number(guard.id);
      const active = [
        true, 1, '1'
      ].includes(guard.is_active);

      const actions = active
        ? `<button class="btn"
             style="background:#f59e0b;color:#000;margin:2px"
             onclick="suspendGuard(${id}, '${escapeHTML(guard.full_name)}')">
             Put on Access
           </button>`
        : `<button class="btn-success" style="margin:2px"
             onclick="reinstateGuard(${id}, '${escapeHTML(guard.full_name)}')">
             Reinstate
           </button>
           <button class="btn-danger" style="margin:2px"
             onclick="fireGuard(${id}, '${escapeHTML(guard.full_name)}')">
             Fire
           </button>`;

      return `
        <tr>
          <td>${escapeHTML(guard.employee_code)}</td>
          <td>${escapeHTML(guard.full_name)}</td>
          <td>${escapeHTML(guard.phone || '-')}</td>
          <td>${escapeHTML(guard.email || '-')}</td>
          <td>${escapeHTML(dateOnly(guard.date_of_birth))}</td>
          <td>${escapeHTML(dateOnly(guard.hired_at))}</td>
          <td>${formatNAD(guard.hourly_rate)}</td>
          <td>${active
            ? '<span class="status-on">Active</span>'
            : '<span class="status-off">On Access</span>'}</td>
          <td>${!active && guard.suspended_at
            ? escapeHTML(dateOnly(guard.suspended_at)) : '-'}</td>
          <td style="white-space:nowrap;">
            ${actions}
            <button class="btn" style="margin:2px"
              onclick="resetPassword(${id}, '${escapeHTML(guard.full_name)}')">
              Reset Password
            </button>
            <button class="btn" style="margin:2px"
              onclick="editGuard(${id})">Edit</button>
          </td>
        </tr>`;
    }).join('');
  }

  async function refreshGuards() {
    if (isRefreshing) return;

    isRefreshing = true;
    refreshButton.disabled = true;
    refreshButton.textContent = 'Refreshing...';
    statusEl.textContent = 'Loading the latest guard records...';

    try {
      const data = await api('/users?role=guard');

      if (!data || !Array.isArray(data.data)) {
        throw new Error('The server returned an unexpected guard list.');
      }

      guards = data.data;
      renderGuardRows();
      statusEl.textContent =
        `Guard list refreshed at ${new Date().toLocaleTimeString()}.`;
    } catch (err) {
      statusEl.textContent = `Could not refresh guards: ${err.message}`;
    } finally {
      isRefreshing = false;
      refreshButton.disabled = false;
      refreshButton.textContent = '↻ Refresh';
    }
  }

  searchInput.addEventListener('input', renderGuardRows);
  refreshButton.addEventListener('click', refreshGuards);

  document.getElementById('btn-add-guard').onclick = async () => {
    const full_name = document.getElementById('g-name').value.trim();
    const phone = document.getElementById('g-phone').value.trim();
    const email = document.getElementById('g-email').value.trim();
    const rateValue = document.getElementById('g-rate').value;

    if (!full_name || !phone) {
      alert('Please enter the guard’s full name and phone number.');
      return;
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      alert('Please enter a valid email address, or leave it blank.');
      return;
    }

    if (rateValue !== '' &&
        (!Number.isFinite(Number(rateValue)) || Number(rateValue) < 0)) {
      alert('Please enter a valid, non-negative hourly rate.');
      return;
    }

    const addButton = document.getElementById('btn-add-guard');
    addButton.disabled = true;

    try {
      const res = await api('/users', {
        method: 'POST',
        body: JSON.stringify({
          full_name,
          phone,
          email: email || null,
          date_of_birth: document.getElementById('g-dob').value || null,
          hired_at: document.getElementById('g-hired').value || null,
          hourly_rate: rateValue === '' ? 0 : Number(rateValue),
          role: 'guard'
        })
      });

      if (res.data.email_sent) {
        alert(
          `Guard registered successfully!\n\nEmployee Code: ${res.data.employee_code}\n` +
          `Login details emailed to: ${res.data.email}\n\n` +
          `The guard should check their inbox and spam folder.`
        );
      } else {
        alert(
          `Guard account created successfully.\n\nEmployee Code: ${res.data.employee_code}\n` +
          `Email Address: ${res.data.email || 'Not provided'}\n` +
          `Temporary Password: ${res.data.temp_password}\n\n` +
          `Please provide these login details securely to the guard.`
        );
      }

      ['g-name', 'g-phone', 'g-email', 'g-dob', 'g-hired', 'g-rate']
        .forEach(id => { document.getElementById(id).value = ''; });

      await refreshGuards();
    } catch (err) {
      alert(err.message);
    } finally {
      addButton.disabled = false;
    }
  };
  
  // Create a second administrator (admin only).
  const createAdminButton =
    document.getElementById('btn-create-admin');

  if (createAdminButton) {
    createAdminButton.onclick = async () => {
      const full_name =
        document.getElementById('admin-name').value.trim();

      const phone =
        document.getElementById('admin-phone').value.trim();

      const email =
        document.getElementById('admin-email').value.trim();

      const adminStatus =
        document.getElementById('admin-create-status');

      if (!full_name || !phone || !email) {
        alert('Please complete all administrator fields.');
        return;
      }

      if (full_name.length > 120) {
        alert('Full name cannot exceed 120 characters.');
        return;
      }

      if (phone.length > 20) {
        alert('Phone number cannot exceed 20 characters.');
        return;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          email.length > 120) {
        alert('Please enter a valid email address.');
        return;
      }

      createAdminButton.disabled = true;
      createAdminButton.textContent = 'Creating...';
      adminStatus.textContent = 'Creating administrator account...';

      try {
        const res = await api('/users/create-admin', {
          method: 'POST',
          body: JSON.stringify({
            full_name,
            phone,
            email
          })
        });

        document.getElementById('admin-name').value = '';
        document.getElementById('admin-phone').value = '';
        document.getElementById('admin-email').value = '';

        adminStatus.textContent =
          'Administrator created successfully. Login details emailed.';

        alert(
          `Administrator created successfully!\n\n` +
          `Employee Code: ${res.data.employee_code}\n` +
          `Name: ${res.data.full_name}\n` +
          `Email: ${res.data.email}\n\n` +
          `Login details have been emailed to the new administrator.`
        );

      } catch (err) {
        adminStatus.textContent =
          `Administrator creation failed: ${err.message}`;

        alert(err.message);

      } finally {
        createAdminButton.disabled = false;
        createAdminButton.textContent = 'Create Administrator';
      }
    };
  }


  await refreshGuards();
}

// ---------- Edit Guard ----------
window.editGuard = async (id) => {
  try {
    const res = await api(`/users/${id}`);
    const guard = res.data;

    if (!guard) {
      alert('Guard details could not be found.');
      return;
    }

    const full_name = prompt('Full Name:', guard.full_name || '');
    if (full_name === null) return;
    if (!full_name.trim()) return alert('Full name cannot be empty.');

    const phone = prompt('Phone:', guard.phone || '');
    if (phone === null) return;
    if (!phone.trim()) return alert('Phone number is required.');

    const email = prompt('Email (optional):', guard.email || '');
    if (email === null) return;
    if (email.trim() &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return alert('Please enter a valid email address, or leave it blank.');
    }

    const hourly_rate = prompt(
      'Hourly Rate (NAD):', guard.hourly_rate ?? '0.00'
    );
    if (hourly_rate === null) return;
    if (hourly_rate.trim() === '' ||
        !Number.isFinite(Number(hourly_rate)) ||
        Number(hourly_rate) < 0) {
      return alert('Please enter a valid, non-negative hourly rate.');
    }

    const date_of_birth = prompt(
      'Date of Birth (YYYY-MM-DD, leave blank to clear):',
      guard.date_of_birth ? String(guard.date_of_birth).slice(0, 10) : ''
    );
    if (date_of_birth === null) return;

    const hired_at = prompt(
      'Date Hired (YYYY-MM-DD, leave blank to clear):',
      guard.hired_at ? String(guard.hired_at).slice(0, 10) : ''
    );
    if (hired_at === null) return;

    const validDate = value =>
      value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value);

    if (!validDate(date_of_birth) || !validDate(hired_at)) {
      return alert('Please enter dates in YYYY-MM-DD format, or leave them blank.');
    }

    if (!confirm(`Save the updated details for ${full_name.trim()}?`)) return;

    const update = await api(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        full_name: full_name.trim(),
        phone: phone.trim(),
        email: email.trim() || null,
        hourly_rate: Number(hourly_rate),
        date_of_birth: date_of_birth || null,
        hired_at: hired_at || null
      })
    });

    alert(update.message || 'Guard details updated successfully.');
    loadPage('guards');
  } catch (err) {
    alert(err.message || 'Failed to update guard details.');
  }
};

// ---------- Guard Actions ----------
window.suspendGuard = async (id, name = '') => {
  const password = prompt(
    `Put "${name}" On Access?\n\nThey will not be able to get a site or shifts.\n\nEnter your password to confirm:`
  );
  if (!password) return;

  try {
    const res = await api(`/users/${id}/suspend`, {
      method: 'PUT',
      body: JSON.stringify({ password })
    });
    alert(res.message);
    loadPage('guards');
  } catch (err) {
    alert(err.message);
  }
};

window.reinstateGuard = async (id, name = '') => {
  const password = prompt(
    `Reinstate "${name}"?\n\nThey will become Active again.\n\nEnter your password to confirm:`
  );
  if (!password) return;

  try {
    const res = await api(`/users/${id}/reinstate`, {
      method: 'PUT',
      body: JSON.stringify({ password })
    });
    alert(res.message);
    loadPage('guards');
  } catch (err) {
    alert(err.message);
  }
};

window.fireGuard = async (id, name = '') => {
  const password = prompt(
    `FIRE "${name}"?\n\nThis will permanently delete the guard.\n\nEnter your password to confirm:`
  );
  if (!password) return;

  if (!confirm(`Are you sure you want to permanently fire ${name}?`)) return;

  try {
    const res = await api(`/users/${id}/fire`, {
      method: 'DELETE',
      body: JSON.stringify({ password })
    });
    alert(res.message);
    loadPage('guards');
  } catch (err) {
    alert(err.message);
  }
};

// ---------- Reset Guard Password ----------
window.resetPassword = async (id, name = '') => {
  const password = prompt(
    `Reset the temporary password for "${name}"?\n\nEnter your management password to continue:`
  );
  if (!password) return;

  try {
    const res = await api(`/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password })
    });

    let message = res.message || 'Password reset completed.';

    if (res.email_sent) {
      message += '\n\nLogin details have been emailed to the guard.';
    } else {
      message +=
        `\n\nEmployee Code: ${res.employee_code}\n` +
        `Temporary Password: ${res.temp_password}\n\n` +
        `Please provide these login details securely to the guard.`;
    }

    if (!res.is_active) {
      message +=
        '\n\nWARNING: This guard is suspended and cannot log in until reinstated.';
    }

    alert(message);
  } catch (err) {
    alert(err.message || 'Password reset failed.');
  }
};

// ---------- Sites ----------
async function renderSites(el) {
  let allSites = [];
  let editingSiteId = null;

  const formatDate = value => {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? escapeHTML(value)
      : escapeHTML(date.toLocaleDateString());
  };

  el.innerHTML = `
    <div class="card">
      <h2>Sites</h2>

      <div class="form-row">
        <input id="s-code-preview" placeholder="Automatic site code"
          readonly title="Generated automatically" />
        <input id="s-name" placeholder="Site Name" required />
        <input id="s-town" placeholder="Town" />
        <input id="s-address" placeholder="Address" />
        <button class="btn" id="btn-add-site">Add Approved Site</button>
      </div>

      <div id="site-edit-panel" style="display:none;margin:12px 0;">
        <h3>Edit Site</h3>
        <input id="edit-site-code" placeholder="Site Code" readonly />
        <input id="edit-site-name" placeholder="Site Name" required />
        <input id="edit-site-town" placeholder="Town" />

        <input id="edit-site-address" placeholder="Address" />
        <button class="btn" id="btn-save-site-edit">Save Changes</button>
        <button class="btn" id="btn-cancel-site-edit">Cancel</button>
      </div>

      <div class="form-row">
        <input id="s-search" type="search" placeholder="Search by site name..." />
        <button class="btn" id="btn-refresh-sites">Refresh Sites</button>
      </div>

      <p id="sites-message"></p>

      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th>Code</th><th>Site Name</th><th>Town</th><th>Status</th>
              <th>Approval Date</th><th>Termination Date</th><th>Actions</th>
            </tr>
          </thead>
          <tbody id="sites-table-body"></tbody>
        </table>
      </div>
    </div>
  `;

  const tableBody = document.getElementById('sites-table-body');
  const searchInput = document.getElementById('s-search');
  const message = document.getElementById('sites-message');
  const addButton = document.getElementById('btn-add-site');
  const editPanel = document.getElementById('site-edit-panel');

  function renderSiteRows() {
    const query = searchInput.value.trim().toLowerCase();
    const filtered = allSites.filter(site =>
      String(site.name || '').toLowerCase().includes(query)
    );

    if (!filtered.length) {
      tableBody.innerHTML = '<tr><td colspan="7">No sites found.</td></tr>';
      return;
    }

    tableBody.innerHTML = filtered.map(site => {
      const id = Number(site.id);
      const status = String(site.status || '').toLowerCase();

      let actions = `<button class="btn" onclick="editSite(${id})">Edit</button>`;

      if (status === 'approved') {
        actions += `<button class="btn-danger" onclick="terminateSite(${id})">Terminate</button>`;
      } else if (status === 'terminated') {
        actions += `<button class="btn" onclick="approveSite(${id})">Restore / Approve</button>`;
      }

      actions += `<button class="btn-danger" style="margin-left:5px"
        onclick="permanentlyRemoveSite(${id})">Permanently Remove</button>`;

      return `
        <tr>
          <td>${escapeHTML(site.site_code)}</td>
          <td>${escapeHTML(site.name)}</td>
          <td>${escapeHTML(site.town || '-')}</td>
          <td class="status-${escapeHTML(status)}">${escapeHTML(status)}</td>
          <td>${formatDate(site.approved_at)}</td>
          <td>${formatDate(site.terminated_at)}</td>
          <td>${actions}</td>
        </tr>`;
    }).join('');
  }

  async function loadSites() {
    try {
      message.textContent = 'Loading sites...';
      const result = await api('/sites');
      allSites = Array.isArray(result.data) ? result.data : [];
      renderSiteRows();
      message.textContent = `${allSites.length} site(s) loaded.`;
    } catch (err) {
      message.textContent = `Could not load sites: ${err.message}`;
      tableBody.innerHTML = '<tr><td colspan="7">Failed to load sites.</td></tr>';
    }
  }

  async function loadNextCode() {
    try {
      const result = await api('/sites/next-code/preview');
      document.getElementById('s-code-preview').value =
        result.data?.site_code || result.site_code || '';
    } catch (err) {
      document.getElementById('s-code-preview').value = '';
      message.textContent = `Could not load next site code: ${err.message}`;
    }
  }

  window.editSite = id => {
    const site = allSites.find(item => Number(item.id) === Number(id));
    if (!site) {
      message.textContent = 'Site not found. Please refresh the list.';
      return;
    }

    editingSiteId = Number(site.id);
    document.getElementById('edit-site-code').value = site.site_code || '';
    document.getElementById('edit-site-name').value = site.name || '';
    document.getElementById('edit-site-town').value = site.town || '';
    document.getElementById('edit-site-address').value = site.address || '';
    editPanel.style.display = 'block';
    message.textContent = `Editing site ${site.site_code}.`;
    editPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  document.getElementById('btn-cancel-site-edit').onclick = () => {
    editingSiteId = null;
    editPanel.style.display = 'none';
    message.textContent = 'Editing cancelled.';
  };

  document.getElementById('btn-save-site-edit').onclick = async () => {
    if (editingSiteId === null) return;

    const name = document.getElementById('edit-site-name').value.trim();
    const town = document.getElementById('edit-site-town').value.trim();
    const address = document.getElementById('edit-site-address').value.trim();
    const saveButton = document.getElementById('btn-save-site-edit');

    if (!name) return alert('Please enter the site name.');

    const password = prompt('Enter your current password to save these site changes:');
    if (password === null || password.length === 0) return;

    saveButton.disabled = true;

    try {
      await api(`/sites/${editingSiteId}`, {
        method: 'PUT',
        body: JSON.stringify({
          password, name, town: town || null, address: address || null
        })
      });

      editingSiteId = null;
      editPanel.style.display = 'none';
      message.textContent = 'Site updated successfully.';
      await loadSites();
    } catch (err) {
      message.textContent = `Could not edit site: ${err.message}`;
    } finally {
      saveButton.disabled = false;
    }
  };

  searchInput.addEventListener('input', renderSiteRows);

  document.getElementById('btn-refresh-sites').onclick = async () => {
    await loadSites();
    await loadNextCode();
  };

  addButton.onclick = async () => {
    const name = document.getElementById('s-name').value.trim();
    const town = document.getElementById('s-town').value.trim();
    const address = document.getElementById('s-address').value.trim();

    if (!name) return alert('Please enter the site name.');

    addButton.disabled = true;

    try {
      await api('/sites', {
        method: 'POST',
        body: JSON.stringify({
          name, town: town || null, address: address || null
        })
      });

      alert('Site added successfully. The site code was generated automatically.');
      await loadSites();
      await loadNextCode();

      ['s-name', 's-town', 's-address'].forEach(id => {
        document.getElementById(id).value = '';
      });
    } catch (err) {
      alert(`Could not add site: ${err.message}`);
    } finally {
      addButton.disabled = false;
    }
  };

  await loadSites();
  await loadNextCode();
}

window.approveSite = async id => {
  if (!confirm('Approve this site and record the approval date?')) return;
  try {
    await api(`/sites/${id}/approve`, { method: 'POST' });
    alert('Site approved successfully.');
    loadPage('sites');
  } catch (err) {
    alert(`Could not approve site: ${err.message}`);
  }
};

window.terminateSite = async id => {
  if (!confirm('Terminate this site? Its record will be retained.')) return;

  const password = prompt('Enter your current password to terminate this site:');
  if (password === null || password.length === 0) return;

  try {
    await api(`/sites/${id}/terminate`, {
      method: 'POST',
      body: JSON.stringify({ password })
    });
    alert('Site terminated successfully.');
    loadPage('sites');
  } catch (err) {
    alert(`Could not terminate site: ${err.message}`);
  }
};

window.permanentlyRemoveSite = async id => {
  if (!confirm(
    `PERMANENTLY REMOVE site ID ${id}?\n\nThis cannot be undone. Sites with linked attendance, assignments, or scheduled shifts should not be removed.`
  )) return;

  const password = prompt('Enter your current password to permanently remove this site:');
  if (password === null || password.length === 0) return;

  try {
    await api(`/sites/${id}/permanent`, {
      method: 'DELETE',
      body: JSON.stringify({ password })
    });
    alert('Site permanently removed.');
    loadPage('sites');
  } catch (err) {
    alert(`Could not permanently remove site:\n${err.message}\n\nIf it has linked records, terminate it instead.`);
  }
};

// ---------- Assignments ----------
async function renderAssignments(el) {
  if (!currentUser ||
      !['admin', 'manager'].includes(currentUser.role)) {
    el.innerHTML = '<p class="error">Access denied.</p>';
    return;
  }

  el.innerHTML = `
    <div class="card">
      <h2>Guard Site Assignments</h2>

      <div class="form-row">
        <select id="as-guard" required>
          <option value="">Select Guard</option>
        </select>
        <select id="as-site" required>
          <option value="">Select Site</option>
        </select>
        <input type="date" id="as-from" required />
        <button class="btn" id="as-add">Assign Guard</button>
      </div>

      <p id="as-message" role="status"></p>

      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th>Employee Code</th><th>Guard</th><th>Site</th>
              <th>Town</th><th>Assigned From</th><th>Assigned To</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="as-rows"></tbody>
        </table>
      </div>
    </div>
  `;

  const guardSelect = document.getElementById('as-guard');
  const siteSelect = document.getElementById('as-site');
  const message = document.getElementById('as-message');
  const rows = document.getElementById('as-rows');

  const [guardsResult, sitesResult] = await Promise.all([
    api('/users?role=guard&active=true'),
    api('/sites?status=approved')
  ]);

  guardSelect.innerHTML += (guardsResult.data || []).map(g =>
    `<option value="${Number(g.id)}">${escapeHTML(g.employee_code)} – ${escapeHTML(g.full_name)}</option>`
  ).join('');

  siteSelect.innerHTML += (sitesResult.data || []).map(s =>
    `<option value="${Number(s.id)}">${escapeHTML(s.site_code)} – ${escapeHTML(s.name)}</option>`
  ).join('');

  async function refreshAssignments() {
    try {
      const result = await api('/assignments');
      const assignments = Array.isArray(result.data) ? result.data : [];

      rows.innerHTML = assignments.map(a => `
        <tr>
          <td>${escapeHTML(a.employee_code)}</td>
          <td>${escapeHTML(a.guard_name)}</td>
          <td>${escapeHTML(a.site_name)}</td>
          <td>${escapeHTML(a.town || '-')}</td>
          <td>${escapeHTML(String(a.assigned_from || '').slice(0, 10))}</td>
          <td>${escapeHTML(a.assigned_to ? String(a.assigned_to).slice(0, 10) : '-')}</td>
          <td>${a.is_current ? 'Current' : 'Ended'}</td>
        </tr>
      `).join('') || '<tr><td colspan="7">No current assignments.</td></tr>';
    } catch (err) {
      message.textContent = `Could not load assignments: ${err.message}`;
    }
  }

  document.getElementById('as-add').onclick = async () => {
    const guard_id = guardSelect.value;
    const site_id = siteSelect.value;
    const assigned_from = document.getElementById('as-from').value;

    if (!guard_id || !site_id || !assigned_from) {
      alert('Please select a guard, site and start date.');
      return;
    }

    const button = document.getElementById('as-add');
    button.disabled = true;

    try {
      const result = await api('/assignments', {
        method: 'POST',
        body: JSON.stringify({ guard_id, site_id, assigned_from })
      });
      message.textContent = result.message || 'Assignment saved.';
      await refreshAssignments();
    } catch (err) {
      message.textContent = `Could not assign guard: ${err.message}`;
    } finally {
      button.disabled = false;
    }
  };

  await refreshAssignments();
}

// ---------- Shifts ----------
async function renderShifts(el) {
  const isManager = ['admin', 'manager'].includes(currentUser.role);
  let guards = [];
  let sites = [];

  if (isManager) {
    const [guardsResult, sitesResult] = await Promise.all([
      api('/users?role=guard&active=true'),
      api('/sites?status=approved')
    ]);

    guards = Array.isArray(guardsResult.data) ? guardsResult.data : [];
    sites = Array.isArray(sitesResult.data) ? sitesResult.data : [];

  }

  const shiftsResult = await api('/shifts');
  const allShifts = Array.isArray(shiftsResult.data) ? shiftsResult.data : [];
  const today = localDateString();

  el.innerHTML = `
    <div class="card">
      ${isManager ? `
        
<div class="sh-report-actions" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:22px;">
  <button class="btn" id="btn-toggle-shifts" type="button" aria-expanded="true" style="text-align:left;white-space:normal;min-height:100px;padding:20px;border-radius:12px;">
    <strong style="display:block;font-size:16px;margin-bottom:8px;">Shifts</strong>
    <span>7 Day → 7 Night → 1 Off</span>
    <span style="display:block;margin-top:8px;font-size:12px;">Assign guards and manage duties</span>
  </button>

  <button class="btn" id="btn-toggle-coverage" type="button" aria-expanded="false" style="text-align:left;white-space:normal;min-height:100px;padding:20px;border-radius:12px;">
    <strong style="display:block;font-size:16px;margin-bottom:8px;">Site Coverage</strong>
    <span>Check day and night coverage</span>
    <span style="display:block;margin-top:8px;font-size:12px;">View coverage by site</span>
  </button>

  <button class="btn" id="btn-toggle-missing" type="button" aria-expanded="false" style="text-align:left;white-space:normal;min-height:100px;padding:20px;border-radius:12px;">
    <strong style="display:block;font-size:16px;margin-bottom:8px;">Missing Shift Report</strong>
    <span>Find guards without site assignments</span>
    <span style="display:block;margin-top:8px;font-size:12px;">Review individual schedules</span>
  </button>
</div>

      ` : ''}
      <h2 style="margin-top:0;">Shifts ${isManager ? '(7 Day → 7 Night → 1 Off)' : ''}</h2>

      ${isManager ? `
        <div class="form-row">
          <select id="sh-guard">
            <option value="">All Guards</option>
            ${guards.map(g => `
              <option value="${Number(g.id)}">
                ${escapeHTML(g.employee_code)} – ${escapeHTML(g.full_name)}
              </option>
            `).join('')}
          </select>

          <select id="sh-site">
            <option value="">All Sites</option>
            ${sites.map(s => `
              <option value="${Number(s.id)}">
                ${escapeHTML(s.site_code)} – ${escapeHTML(s.name)}
              </option>
            `).join('')}
          </select>

          <input type="date" id="sh-start" />

          <input type="number" id="sh-cycles" value="1"
            min="1" max="12" style="width:80px"
            title="Number of 15-day cycles" />

          <button class="btn" id="btn-gen-shifts" type="button">
            Generate 7-7-1 Shifts
          </button>
        </div>

        <div class="form-row" style="align-items:center;gap:12px;flex-wrap:wrap;">
          <strong style="flex-basis:100%;">Manual Shift Assignment</strong>

          <select id="sh-manual-guard" required>
            <option value="">Select Guard</option>
            ${guards.map(g => `
              <option value="${Number(g.id)}">
                ${escapeHTML(g.employee_code)} – ${escapeHTML(g.full_name)}
              </option>
            `).join('')}
          </select>

          <select id="sh-manual-site" required>
            <option value="">Select Approved Site</option>
            ${sites.map(s => `
              <option value="${Number(s.id)}">
                ${escapeHTML(s.site_code)} – ${escapeHTML(s.name)}
              </option>
            `).join('')}
          </select>

          <input type="date" id="sh-manual-date" required />

          <select id="sh-manual-type" required>
            <option value="">Select Shift</option>
            <option value="day">Day (06:00–18:00)</option>
            <option value="night">Night (18:00–06:00)</option>
          </select>

          <button class="btn" id="btn-manual-shift" type="button">
            Save Manual Shift
          </button>
        </div>

        <p id="sh-manual-message" aria-live="polite"></p>
        <div class="form-row" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <input id="sh-search" type="search" style="flex:1 1 560px;width:100%;min-width:min(360px, 100%);max-width:100%;box-sizing:border-box;"
            placeholder="Search by guard name or employee code..."
            aria-label="Search shifts by guard" />
          <input type="date" id="sh-date-search" style="flex:0 1 180px;min-width:160px;"
            aria-label="Search shifts by date" title="Filter shifts by date" />
          <label>
            <input type="checkbox" id="sh-show-old" />
            Show older shifts
          </label>
        </div>
      ` : ''}

      <p id="sh-count" aria-live="polite"></p>
       
      
${isManager ? `
  <div style="margin:12px 0;padding:0 0 12px;border-bottom:1px solid var(--border, #ddd);">
    <div id="sh-coverage-panel" hidden style="margin-top:16px;padding:16px;border:1px solid var(--border, #ddd);border-radius:10px;">
      <h3>Site Coverage</h3>
      <p>Counts include scheduled day and night shifts only.</p>

      <div class="form-row" style="gap:12px;margin:16px 0;flex-wrap:wrap;">
        <label for="sh-coverage-date">Coverage date:</label>
        <input type="date" id="sh-coverage-date" value="${today}" />
        <button class="btn" id="btn-load-coverage" type="button">
          Refresh Coverage
        </button>
      </div>

      <p id="sh-coverage-message" aria-live="polite"></p>

      <div style="overflow-x:auto;margin-top:12px;">
        <table>
          <thead>
            <tr>
              <th>Site Code</th>
              <th>Site Name</th>
              <th>Day Guards</th>
              <th>Night Guards</th>
              <th>Coverage</th>
            </tr>
          </thead>
          <tbody id="sh-coverage-rows">
            <tr><td colspan="5">Open Site Coverage to load the report.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <div style="margin:12px 0;padding:12px 0 0;">
    <div id="sh-missing-panel" hidden style="margin-top:16px;padding:16px;border:1px solid var(--border, #ddd);border-radius:10px;">
      <h3>Missing Shift Report</h3>
      <p>
        This list includes guards who have no site assignment on a working day. Select a guard to view their full schedule for the next 15 or 30 days.
      </p>

      <div class="form-row" style="gap:12px;margin:16px 0;flex-wrap:wrap;">
        <label for="sh-missing-days">Reporting period:</label>
        <select id="sh-missing-days">
          <option value="15">Next 15 days</option>
          <option value="30">Next 30 days</option>
        </select>
        <button class="btn" id="btn-load-missing" type="button">
          Refresh Report
        </button>
      </div>

      <p id="sh-missing-message" aria-live="polite"></p>
      <div id="sh-missing-guard-list" style="margin-top:12px;"></div>
      <button class="btn" id="sh-missing-back" type="button" hidden style="margin:8px 0;">Back to guard list</button>

      <div id="sh-missing-detail-wrap" style="overflow-x:auto;margin-top:12px;" hidden>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Employee Code</th>
              <th>Guard</th>
              <th>Expected Shift</th>
              <th>Actual Shift</th>
              <th>Site</th>
              <th>Status</th>
              <th>Finding</th>
            </tr>
          </thead>
          <tbody id="sh-missing-rows">
            <tr><td colspan="8">Select Refresh Report to find guards without a site assignment.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
` : ''}

    
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Guard</th><th>Site Name</th>
              <th>Type</th><th>Start</th><th>End</th><th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="sh-rows"></tbody>
        </table>
      </div>
    </div>
  `;

  
  // Organize the Shifts page into three selectable sections.
  if (isManager) {
    const shiftCard = el.querySelector('.card');
    const actionBar = shiftCard.querySelector('.sh-report-actions');

    const scheduleHeading = [...shiftCard.children].find(
      node => node.matches('h2') &&
        node.textContent.includes('Shifts')
    );

    const scheduleControls = [...shiftCard.children].filter(
      node => node.classList.contains('form-row')
    );

    const scheduleCount = shiftCard.querySelector('#sh-count');
    const scheduleTable = shiftCard.querySelector('#sh-rows').parentElement;

    const coveragePanel = shiftCard.querySelector('#sh-coverage-panel');
    const missingPanel = shiftCard.querySelector('#sh-missing-panel');

    const coverageSection = coveragePanel.parentElement;
    const missingSection = missingPanel.parentElement;

    const schedulePanel = document.createElement('section');
    schedulePanel.id = 'sh-schedule-panel';
    schedulePanel.style.marginTop = '16px';

    // Move the shift heading, controls, count and table into one section.
    [
      scheduleHeading,
      ...scheduleControls,
      scheduleCount,
      scheduleTable
    ].forEach(node => {
      if (node) schedulePanel.appendChild(node);
    });

    // Place all three sections beneath the dashboard-style cards.
    actionBar.insertAdjacentElement('afterend', schedulePanel);
    shiftCard.appendChild(coverageSection);
    shiftCard.appendChild(missingSection);

    // Show the shift section by default.
    schedulePanel.hidden = false;
    coverageSection.hidden = true;
    missingSection.hidden = true;
  }


  const rowsElement = document.getElementById('sh-rows');
  const countElement = document.getElementById('sh-count');

  function renderShiftRows() {
    const showOld = isManager &&
      document.getElementById('sh-show-old').checked;

    const selectedGuard = isManager
      ? document.getElementById('sh-guard').value
      : '';

    const selectedSite = isManager
      ? document.getElementById('sh-site').value
      : '';

    const query = isManager
      ? document.getElementById('sh-search').value.trim().toLowerCase()
      : '';
    const selectedDate = isManager
     ? document.getElementById('sh-date-search').value
     : '';

    const filtered = allShifts.filter(s => {
      const shiftDate = String(s.shift_date || '').slice(0, 10);
      const status = String(s.status || '').trim().toLowerCase();

      const isCurrentOrFuture = shiftDate >= today;
      const isOlder = shiftDate < today;

// Show older shifts when the checkbox is selected,
// regardless of whether their status is scheduled or completed.
if (!isCurrentOrFuture && !(showOld && isOlder)) {
  return false;
}
if (selectedDate &&
    String(s.shift_date || '').slice(0, 10) !== selectedDate) {
  return false;
}

      if (selectedSite && String(s.site_id) !== selectedSite) {
        return false;
      }

      if (query) {
        const guardName = String(s.guard_name || '').toLowerCase();
        const employeeCode = String(s.employee_code || '').toLowerCase();

        if (!guardName.includes(query) && !employeeCode.includes(query)) {
          return false;
        }
      }

      return true;
    });

    filtered.sort((a, b) => {
      const dateCompare = String(a.shift_date || '')
        .localeCompare(String(b.shift_date || ''));

      if (dateCompare !== 0) return dateCompare;

      return String(a.start_time || '').localeCompare(String(b.start_time || ''));
    });

    const oldCount = filtered.filter(s =>
      String(s.shift_date || '').slice(0, 10) < today
    ).length;

    countElement.textContent =
      `Showing ${filtered.length} shift(s)` +
      (showOld ? `, including ${oldCount} older shift(s)` : '') +
      `. Today's date: ${today}.`;

    rowsElement.innerHTML = filtered.map(s => `
  <tr>
    <td>${escapeHTML(String(s.shift_date || '').slice(0, 10))}</td>
    <td>${escapeHTML(s.guard_name || s.employee_code || '-')}</td>
    <td>${escapeHTML(s.site_name || '-')}</td>
    <td><strong>${escapeHTML(String(s.shift_type || '').toUpperCase())}</strong></td>
    <td>${escapeHTML(s.start_time ? String(s.start_time).replace('T', ' ').slice(0, 16) : '-')}</td>
    <td>${escapeHTML(s.end_time ? String(s.end_time).replace('T', ' ').slice(0, 16) : '-')}</td>
    <td>${escapeHTML(s.status || '-')}</td>
    <td>
      ${isManager ? `
        <button
          type="button"
          class="btn btn-edit-shift-site"
          data-shift-id="${Number(s.id)}"
          data-site-id="${Number(s.site_id)}">
          Edit Site
        </button>
      ` : '-'}
    </td>
  </tr>
`).join('') || `
      <tr>
        <td colspan="8">
          ${showOld
            ? 'No current, future or older completed shifts match these filters.'
            : 'No current or future shifts match these filters. Select "Show older completed shifts" to include completed past shifts.'}
        </td>
      </tr>
    `;
  }

  if (isManager) {
    document.getElementById('sh-guard')
      .addEventListener('change', renderShiftRows);

    document.getElementById('sh-site')
      .addEventListener('change', renderShiftRows);

    document.getElementById('sh-search')
      .addEventListener('input', renderShiftRows);

    document.getElementById('sh-date-search')
       .addEventListener('change', renderShiftRows);

    document.getElementById('sh-show-old')
      .addEventListener('change', renderShiftRows);

    document.getElementById('btn-manual-shift').onclick = async () => {
      const guard_id = document.getElementById('sh-manual-guard').value;
      const site_id = document.getElementById('sh-manual-site').value;
      const shift_date = document.getElementById('sh-manual-date').value;
      const shift_type = document.getElementById('sh-manual-type').value;
      const message = document.getElementById('sh-manual-message');
      const button = document.getElementById('btn-manual-shift');

      message.textContent = '';

      if (!guard_id) {
        message.textContent = 'Please select a guard.';
        return;
      }

      if (!site_id) {
        message.textContent = 'Please select an approved site.';
        return;
      }

      if (!shift_date) {
        message.textContent = 'Please select a shift date.';
        return;
      }

      if (!['day', 'night'].includes(shift_type)) {
        message.textContent = 'Please select Day or Night.';
        return;
      }

      button.disabled = true;

      try {
        const res = await api('/shifts/manual', {
          method: 'POST',
          body: JSON.stringify({
            guard_id,
            site_id,
            shift_date,
            shift_type
          })
        });

        message.textContent = res.message || 'Manual shift assigned successfully.';
        await loadPage('shifts');
      } catch (err) {
        message.textContent = err.message || 'Could not assign the manual shift.';
      } finally {
        button.disabled = false;
      }
    };
    document.getElementById('btn-gen-shifts').onclick = async () => {
      const guard_id = document.getElementById('sh-guard').value;
      const site_id = document.getElementById('sh-site').value;
      const cycle_start_date = document.getElementById('sh-start').value;
      const number_of_cycles = Number(
        document.getElementById('sh-cycles').value
      );

      if (!guard_id) return alert('Please select a guard.');
      if (!site_id) return alert('Please select a site.');
      if (!cycle_start_date) return alert('Please select a start date.');

      if (!Number.isInteger(number_of_cycles) ||
          number_of_cycles < 1 || number_of_cycles > 12) {
        return alert('Please choose between 1 and 12 cycles.');
      }

      const button = document.getElementById('btn-gen-shifts');
      button.disabled = true;

      try {
        const res = await api('/shifts/generate', {
          method: 'POST',
          body: JSON.stringify({
            guard_id,
            site_id,
            cycle_start_date,
            number_of_cycles
          })
        });

        alert(res.message || 'Shifts generated.');
        await loadPage('shifts');
      } catch (err) {
        alert(err.message);
      } finally {
        button.disabled = false;
      }
    };
  }
  
async function loadSiteCoverage() {
  if (!isManager) return;
  const coverageRows = document.getElementById('sh-coverage-rows');
  const coverageMessage = document.getElementById('sh-coverage-message');
  const dateInput = document.getElementById('sh-coverage-date');
  const refreshButton = document.getElementById('btn-load-coverage');
  if (!coverageRows || !coverageMessage || !dateInput) return;

  const date = dateInput.value || today;
  coverageRows.innerHTML = '<tr><td colspan="5">Calculating site coverage...</td></tr>';
  coverageMessage.textContent = '';
  if (refreshButton) refreshButton.disabled = true;
  try {
    const approvedSites = sites.filter(site => {
      const status = String(site.status || 'approved').trim().toLowerCase();
      return status === 'approved';
    });
    if (!approvedSites.length) {
      coverageRows.innerHTML = '<tr><td colspan="5">No approved sites found.</td></tr>';
      return;
    }
    const scheduled = allShifts.filter(shift =>
      String(shift.shift_date || '').slice(0, 10) === date &&
      String(shift.status || '').trim().toLowerCase() === 'scheduled' &&
      ['day', 'night'].includes(String(shift.shift_type || '').trim().toLowerCase())
    );
    coverageRows.innerHTML = approvedSites.map(site => {
      const siteShifts = scheduled.filter(shift => Number(shift.site_id) === Number(site.id));
      const day = siteShifts.filter(shift => String(shift.shift_type || '').trim().toLowerCase() === 'day').length;

      const night = siteShifts.filter(shift => String(shift.shift_type || '').trim().toLowerCase() === 'night').length;
      const status = day === 0 && night === 0 ? 'No day or night guards' : day === 0 ? 'No day guards' : night === 0 ? 'No night guards' : 'Day and night covered';
      const dangerStyle = 'color:#c62828;font-weight:700;';
      return `<tr>
        <td>${escapeHTML(site.site_code || '-')}</td>
        <td style="${day === 0 || night === 0 ? dangerStyle : ''}">${escapeHTML(site.name || site.site_name || '-')}</td>
        <td style="${day === 0 ? dangerStyle : ''}">${day}</td>
        <td style="${night === 0 ? dangerStyle : ''}">${night}</td>
        <td>${escapeHTML(status)}</td>
      </tr>`;
    }).join('');
    coverageMessage.textContent = `Coverage for ${date}. Only scheduled day and night shifts are counted.`;
  } catch (err) {
    coverageRows.innerHTML = '<tr><td colspan="5">Unable to calculate site coverage.</td></tr>';
    coverageMessage.textContent = err.message || 'Failed to calculate site coverage.';
  } finally {
    if (refreshButton) refreshButton.disabled = false;
  }
}


async function loadMissingShiftReport() {
  if (!isManager) return;
  const rowsElement = document.getElementById('sh-missing-rows');
  const messageElement = document.getElementById('sh-missing-message');
  const daysInput = document.getElementById('sh-missing-days');
  const refreshButton = document.getElementById('btn-load-missing');
  const guardList = document.getElementById('sh-missing-guard-list');
  const detailWrap = document.getElementById('sh-missing-detail-wrap');
  const backButton = document.getElementById('sh-missing-back');
  if (!rowsElement || !messageElement || !daysInput || !guardList || !detailWrap) return;
  const days = Number(daysInput.value);
  if (![15, 30].includes(days)) { messageElement.textContent = 'Please select 15 or 30 days.'; return; }

  const formatLocalDate = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const startDate = new Date(); startDate.setHours(12,0,0,0);
  const dates = Array.from({length: days}, (_, i) => { const d = new Date(startDate); d.setDate(startDate.getDate()+i); return formatLocalDate(d); });
  rowsElement.innerHTML = '<tr><td colspan="8">Loading report...</td></tr>';
  guardList.innerHTML = '';
  detailWrap.hidden = true;
  if (backButton) backButton.hidden = true;
  messageElement.textContent = '';
  if (refreshButton) refreshButton.disabled = true;
  try {
    const results = await Promise.all(dates.map(async date => {
      const result = await api(`/shifts/missing?date=${encodeURIComponent(date)}`);
      return (Array.isArray(result.data) ? result.data : []).map(guard => ({...guard, report_date: date}));
    }));
    const allRows = results.flat();
    const isOff = row => {
      const finding = String(row.finding || '').trim().toLowerCase();
      const expected = String(row.expected_shift || '').trim().toLowerCase();
      const actual = String(row.shift_type || '').trim().toLowerCase();
      return ['off','scheduled off','scheduled day off','day off','rest day'].includes(finding) || expected === 'off' || actual === 'off';
    };
    const unassigned = row => {
      const site = String(row.site_name || '').trim().toLowerCase();
      return !site || ['-','unassigned','none','null'].includes(site) || row.site_id == null;
    };
    const needsSite = allRows.filter(row => !isOff(row) && unassigned(row));
    const guardsById = new Map();
    needsSite.forEach(row => {
      const key = String(row.guard_id ?? row.id ?? row.employee_code ?? row.full_name ?? 'unknown');
      if (!guardsById.has(key)) guardsById.set(key, {key, guard: row, dates: new Set()});
      guardsById.get(key).dates.add(row.report_date);
    });
    const guardItems = [...guardsById.values()].sort((a,b) => String(a.guard.full_name||'').localeCompare(String(b.guard.full_name||'')));
    const showGuardSchedule = item => {
      const guard = item.guard;
      const guardId = String(guard.guard_id ?? guard.id ?? '');
      const employeeCode = String(guard.employee_code || '');
      const belongsToGuard = row => {
        const rowGuardId = String(row.guard_id ?? row.id ?? '');
        const sameId = guardId && rowGuardId === guardId;
        const sameCode = employeeCode && String(row.employee_code || '') === employeeCode;
        return Boolean(sameId || sameCode);
      };
      // Use the full shifts collection for the selected guard, then overlay the
      // report findings so assigned shifts and scheduled off days are also shown.
      const scheduleRows = allShifts
        .filter(row => belongsToGuard(row) && dates.includes(String(row.shift_date || '').slice(0, 10)))
        .map(row => ({
          ...row,
          report_date: String(row.shift_date || '').slice(0, 10),
          expected_shift: row.expected_shift || row.shift_type || '',
          shift_status: row.shift_status || row.status || '',
          finding: row.finding || (isOff(row) ? 'Scheduled off' : (row.site_id == null ? 'No site assigned' : 'Scheduled'))
        }));
      const reportRows = allRows.filter(belongsToGuard);
      const rowsByDate = new Map(scheduleRows.map(row => [row.report_date, row]));
      reportRows.forEach(row => rowsByDate.set(row.report_date, { ...(rowsByDate.get(row.report_date) || {}), ...row }));
      const detailRows = [...rowsByDate.values()].sort((a,b) => a.report_date.localeCompare(b.report_date));
      guardList.hidden = true;
      detailWrap.hidden = false;
      if (backButton) backButton.hidden = false;
      rowsElement.innerHTML = detailRows.map(row => `<tr>
        <td>${escapeHTML(row.report_date)}</td><td>${escapeHTML(row.employee_code || '-')}</td>
        <td>${escapeHTML(row.full_name || '-')}</td><td>${escapeHTML(row.expected_shift ? String(row.expected_shift).toUpperCase() : 'Unknown')}</td>
        <td>${escapeHTML(row.shift_type ? String(row.shift_type).toUpperCase() : '-')}</td><td>${escapeHTML(row.site_name || 'Unassigned')}</td>
        <td>${escapeHTML(row.shift_status || row.status || '-')}</td><td>${escapeHTML(row.finding || (isOff(row) ? 'Scheduled off' : 'Needs review'))}</td>
      </tr>`).join('') || '<tr><td colspan="8">No schedule rows found for this guard in the selected period.</td></tr>';
      messageElement.textContent = `${guard.full_name || employeeCode || 'Guard'} — schedule for ${dates[0]} to ${dates[dates.length-1]}.`;
    };
    if (!guardItems.length) {
      guardList.innerHTML = '<p>No guards without a site assignment were found on working days in this period.</p>';
    } else {
      guardList.innerHTML = `<p>Select a guard to view their full ${days}-day schedule.</p><ul style="list-style:none;padding:0;margin:0;display:grid;gap:8px;">${guardItems.map((item,index) => `<li style="padding:10px 12px;border:1px solid var(--border, #ddd);border-radius:8px;"><button type="button" class="btn btn-missing-guard" data-guard-index="${index}" style="text-align:left;font-weight:700;">${escapeHTML(item.guard.full_name || item.guard.employee_code || 'Unknown guard')}</button> <span style="margin-left:8px;">(${escapeHTML(item.guard.employee_code || 'No employee code')}) — ${item.dates.size} unassigned working day(s)</span></li>`).join('')}</ul>`;
      guardList.querySelectorAll('.btn-missing-guard').forEach(button => button.addEventListener('click', () => showGuardSchedule(guardItems[Number(button.dataset.guardIndex)])));
    }
    if (backButton) backButton.onclick = () => { detailWrap.hidden = true; guardList.hidden = false; backButton.hidden = true; rowsElement.innerHTML = '<tr><td colspan="8">Select a guard from the list above.</td></tr>'; messageElement.textContent = `${guardItems.length} guard(s) have at least one unassigned working day. Report period: ${dates[0]} to ${dates[dates.length-1]}.`; };
    rowsElement.innerHTML = '<tr><td colspan="8">Select a guard from the list above to view their schedule.</td></tr>';
    messageElement.textContent = `${guardItems.length} guard(s) have at least one unassigned working day. Report period: ${dates[0]} to ${dates[dates.length-1]}.`;
  } catch (err) {
    rowsElement.innerHTML = '<tr><td colspan="8">Unable to load the report. Please refresh and try again.</td></tr>';
    messageElement.textContent = err.message || 'Failed to load the missing shift report.';
  } finally { if (refreshButton) refreshButton.disabled = false; }
}



if (isManager) {
  const shiftsToggle = document.getElementById('btn-toggle-shifts');
  const coverageToggle = document.getElementById('btn-toggle-coverage');
  const missingToggle = document.getElementById('btn-toggle-missing');

  const schedulePanel = document.getElementById('sh-schedule-panel');
  const coveragePanel = document.getElementById('sh-coverage-panel');
  const missingPanel = document.getElementById('sh-missing-panel');

  const coverageSection = coveragePanel.parentElement;
  const missingSection = missingPanel.parentElement;

  // Keep the report refresh buttons working.
  document.getElementById('btn-load-coverage')
    .addEventListener('click', loadSiteCoverage);

  document.getElementById('btn-load-missing')
    .addEventListener('click', loadMissingShiftReport);

  function showShiftSection(section) {
    schedulePanel.hidden = section !== 'shifts';
    coverageSection.hidden = section !== 'coverage';
    missingSection.hidden = section !== 'missing';

    coveragePanel.hidden = section !== 'coverage';
    missingPanel.hidden = section !== 'missing';

    shiftsToggle.setAttribute(
      'aria-expanded', String(section === 'shifts')
    );

    coverageToggle.setAttribute(
      'aria-expanded', String(section === 'coverage')
    );

    missingToggle.setAttribute(
      'aria-expanded', String(section === 'missing')
    );
  }

  shiftsToggle.addEventListener('click', () => {
    showShiftSection('shifts');
  });

  coverageToggle.addEventListener('click', () => {
    showShiftSection('coverage');
  });

  missingToggle.addEventListener('click', () => {
    showShiftSection('missing');
  });

  // Show Shifts when the page first opens.
  showShiftSection('shifts');
}




  renderShiftRows();

// Handle Edit Site buttons
if (isManager) {
  rowsElement.addEventListener('click', async (event) => {
    const button = event.target.closest('.btn-edit-shift-site');

    if (!button) return;

    const shiftId = Number(button.dataset.shiftId);
    const currentSiteId = String(button.dataset.siteId || '');

    const options = sites.map(site =>
      `${site.id}: ${site.site_code} – ${site.name}`
    ).join('\n');

    const choice = prompt(
      `Enter the ID of the approved site for shift #${shiftId}:\n\n${options}`,
      currentSiteId
    );

    if (choice === null) return;

    const siteId = Number(choice.trim());

    if (!Number.isInteger(siteId) ||
        !sites.some(site => Number(site.id) === siteId)) {
      alert('Please enter a valid approved site ID from the list.');
      return;
    }

    if (siteId === Number(currentSiteId)) {
      alert('This shift already uses that site.');
      return;
    }

    button.disabled = true;

    try {
      const result = await api(`/shifts/${shiftId}/site`, {
        method: 'PUT',
        body: JSON.stringify({ site_id: siteId })
      });

      alert(result.message || 'Shift site updated successfully.');

      await loadPage('shifts');
    } catch (err) {
      alert(err.message || 'Failed to update shift site.');
    } finally {
      button.disabled = false;
    }
  });
}
}

// ---------- Attendance ----------
async function renderAttendance(el) {
  const isGuard = currentUser.role === 'guard';
  const path = isGuard ? '/attendance/my' : '/attendance';

  const data = await api(path);

  el.innerHTML = `
    <div class="card">
      <h2>Attendance Records</h2>

      ${!isGuard ? `
        <div style="margin-bottom:1rem;">
          <button id="clear-attendance-button" class="btn btn-primary">
            Clear Older Attendance
          </button>
          <p style="color:var(--muted);margin-top:0.5rem;">
            Hides attendance records before today. Records are not deleted.
          </p>
        </div>
      ` : ''}

      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th>Guard</th><th>Site</th><th>Clock In</th><th>Clock Out</th>
              <th>Hours</th><th>In Geo?</th><th>Out Geo?</th>
            </tr>
          </thead>
          <tbody>
            ${(data.data || []).map(a => `
              <tr>
                <td>${escapeHTML(a.guard_name || a.employee_code || '-')}</td>
                <td>${escapeHTML(a.site_name || '-')}</td>
                <td>${escapeHTML(a.clock_in_at ? String(a.clock_in_at).replace('T', ' ').slice(0, 19) : '-')}</td>
                <td>${a.clock_out_at
                  ? escapeHTML(String(a.clock_out_at).replace('T', ' ').slice(0, 19))
                  : '<em>Still on duty</em>'}</td>
                <td>${escapeHTML(a.hours_worked ?? '-')}</td>
                <td>${a.clock_in_within_geofence == 1 ? '✓' : a.clock_in_within_geofence == 0 ? '✗' : '-'}</td>
                <td>${a.clock_out_within_geofence == 1 ? '✓' : a.clock_out_within_geofence == 0 ? '✗' : '-'}</td>
              </tr>
            `).join('') || '<tr><td colspan="7">No records</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (!isGuard) {
    const clearButton = document.getElementById('clear-attendance-button');

    if (clearButton) {
      clearButton.onclick = async () => {
        const confirmed = confirm(
          'Hide attendance records dated before today? This affects management and guard attendance views. No records will be deleted.'
        );

        if (!confirmed) return;

        try {
          const result = await api('/attendance/clear', {
            method: 'POST'
          });

          alert(result.message || 'Older attendance has been hidden.');
          await renderAttendance(el);
        } catch (err) {
          alert(err.message || 'Failed to clear older attendance.');
        }
      };
    }
  }
}
async function renderLocation(el) {
  if (jupiterLiveLocationTimer !== null) {
    clearInterval(jupiterLiveLocationTimer);
    jupiterLiveLocationTimer = null;
  }

  if (jupiterLiveLocationMap) {
    jupiterLiveLocationMap.remove();
    jupiterLiveLocationMap = null;
    jupiterLiveLocationMarkers = null;
  }

  el.innerHTML = `
    <div class="card">
      <h2>Live Guard Locations</h2>

      <p style="color:var(--muted);margin-bottom:1rem">
        Showing the last recorded GPS position of each guard.
        Map refreshes automatically every 30 seconds.
      </p>

      <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1rem">
        <span>🟢 On Duty</span>
        <span>🔴 Off Duty</span>
        <span>🔵 My Location</span>
      </div>

      <div style="margin-bottom:1rem">
        <button id="my-location-button" class="btn btn-primary">
          📍 My Location
        </button>

        <div id="live-location-my-status"
          style="color:var(--muted);margin-top:0.75rem">
          Click My Location to display your current GPS position.
        </div>

        <div id="live-location-coordinates"
          style="margin-top:0.5rem;font-size:0.9rem">
        </div>
      </div>

      <div id="live-location-map"
        style="width:100%;height:500px;border-radius:10px;z-index:1">
      </div>

      <p id="live-location-status"
        style="color:var(--muted);margin-top:0.75rem">
        Loading guard locations...
      </p>
    </div>
  `;

  if (typeof L === 'undefined') {
    throw new Error('Map library could not be loaded. Please check your internet connection.');
  }

  jupiterLiveLocationMap = L.map('live-location-map')
    .setView([-22.5609, 17.0658], 6);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(jupiterLiveLocationMap);

  jupiterLiveLocationMarkers = L.layerGroup().addTo(jupiterLiveLocationMap);

  // Separate layer for the logged-in admin/manager.
  const myLocationLayer = L.layerGroup().addTo(jupiterLiveLocationMap);

  // Prevent automatic guard refresh from moving away
  // after the user has selected My Location.
  let userHasCenteredMap = false;

  const myLocationButton =
    document.getElementById('my-location-button');

  const myLocationStatus =
    document.getElementById('live-location-my-status');

  const myLocationCoordinates =
    document.getElementById('live-location-coordinates');

  myLocationButton.addEventListener('click', () => {

    if (!navigator.geolocation) {
      myLocationStatus.textContent =
        'Your browser does not support GPS location.';

      return;
    }

    myLocationButton.disabled = true;
    myLocationButton.textContent = 'Getting GPS location...';

    myLocationStatus.textContent =
      'Requesting your current GPS position...';

    myLocationCoordinates.textContent = '';

    navigator.geolocation.getCurrentPosition(
      position => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        const accuracy = position.coords.accuracy;

        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          !Number.isFinite(accuracy)
        ) {
          myLocationStatus.textContent =
            'Invalid GPS coordinates received.';

          myLocationButton.disabled = false;
          myLocationButton.textContent = '📍 My Location';

          return;
        }

        // Keep the map centred on the user's position.
        userHasCenteredMap = true;

        // Remove the previous personal GPS marker and circle.
        myLocationLayer.clearLayers();

        // GPS accuracy circle.
        const accuracyCircle = L.circle(
          [latitude, longitude],
          {
            radius: accuracy,
            color: '#2563eb',
            fillColor: '#3b82f6',
            fillOpacity: 0.12,
            weight: 2
          }
        );

        accuracyCircle.addTo(myLocationLayer);

        // Blue marker showing current position.
        const myMarker = L.circleMarker(
          [latitude, longitude],
          {
            radius: 10,
            color: '#1d4ed8',
            fillColor: '#3b82f6',
            fillOpacity: 1,
            weight: 3
          }
        );

        myMarker.bindPopup(
          '<strong>My Current Location</strong>'
        );

        myMarker.addTo(myLocationLayer);

        // Display the coordinates on the page.
        myLocationCoordinates.innerHTML = `
          <strong>Latitude:</strong> ${latitude.toFixed(6)}<br>
          <strong>Longitude:</strong> ${longitude.toFixed(6)}<br>
          <strong>GPS Accuracy:</strong> ±${Math.round(accuracy)} metres
        `;

        myLocationStatus.textContent =
          'Your current GPS position is displayed on the map.';

        // Zoom into your current location.
        jupiterLiveLocationMap.setView(
          [latitude, longitude],
          16
        );

        myMarker.openPopup();

        myLocationButton.disabled = false;
        myLocationButton.textContent = '📍 My Location';

      },

      error => {
        let message = 'Unable to obtain your GPS position.';

        if (error.code === 1) {
          message =
            'Location permission denied. Allow location access in Microsoft Edge site settings.';
        } else if (error.code === 2) {
          message =
            'GPS position unavailable. Check Windows Location Services.';
        } else if (error.code === 3) {
          message =
            'GPS request timed out. Please try again.';
        }

        myLocationStatus.textContent = message;

        myLocationButton.disabled = false;
        myLocationButton.textContent = '📍 My Location';

        console.error('My Location GPS error:', error);
      },

      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0
      }
    );
  });

  // Existing guard location loading.
  const loadLocations = async () => {
    try {
      const data = await api('/locations/live');
      const locations = data.data || [];

      jupiterLiveLocationMarkers.clearLayers();

      const bounds = [];

      locations.forEach(l => {
        const latitude = Number(l.latitude);
        const longitude = Number(l.longitude);

        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          latitude < -90 ||
          latitude > 90 ||
          longitude < -180 ||
          longitude > 180
        ) {
          return;
        }

        const onDuty = Boolean(Number(l.is_on_duty));

        const marker = L.circleMarker([latitude, longitude], {
          radius: 9,
          color: onDuty ? '#15803d' : '#b91c1c',
          fillColor: onDuty ? '#22c55e' : '#ef4444',
          fillOpacity: 0.9,
          weight: 2
        });

        const recordedAt = l.recorded_at
          ? String(l.recorded_at).replace('T', ' ').slice(0, 19)
          : '-';

        marker.bindPopup(`
          <strong>${escapeHTML(l.full_name || 'Unknown guard')}</strong><br>
          Employee Code: ${escapeHTML(l.employee_code || '-')}<br>
          Status: ${onDuty ? 'On Duty' : 'Off Duty'}<br>
          Site: ${escapeHTML(l.site_name || '-')}<br>
          Last Update: ${escapeHTML(recordedAt)}
        `);

        marker.addTo(jupiterLiveLocationMarkers);

        bounds.push([latitude, longitude]);
      });

      const status =
        document.getElementById('live-location-status');

      if (status) {
        status.textContent =
          `Last refreshed: ${new Date().toLocaleTimeString()} | ${bounds.length} guard location(s) found.`;
      }

      // Only fit guard bounds if the user has not selected
      // their own GPS position.
      if (bounds.length > 0 && !userHasCenteredMap) {
        jupiterLiveLocationMap.fitBounds(bounds, {
          padding: [35, 35],
          maxZoom: 15
        });
      }

    } catch (err) {
      console.error('Live location refresh failed:', err);

      const status =
        document.getElementById('live-location-status');

      if (status) {
        status.textContent =
          'Could not refresh locations: ' + err.message;
      }
    }
  };

  await loadLocations();

  setTimeout(() => {
    if (jupiterLiveLocationMap) {
      jupiterLiveLocationMap.invalidateSize();
    }
  }, 200);

  jupiterLiveLocationTimer = setInterval(loadLocations, 30000);
}

// ---------- Payroll ----------
async function renderPayroll(el) {
  const isManager = ['admin', 'manager'].includes(currentUser.role);

  if (isManager) {
    el.innerHTML = `
      <div class="card">
        <h2>Payroll (NAD)</h2>
        <div class="form-row">
          <input type="date" id="p-start" />
          <input type="date" id="p-end" />
          <button class="btn" id="btn-calc">Calculate Payroll</button>
        </div>
        <div id="payroll-result"></div>
      </div>
    `;

    document.getElementById('btn-calc').onclick = async () => {
      const period_start = document.getElementById('p-start').value;
      const period_end = document.getElementById('p-end').value;

      if (!period_start || !period_end) {
        return alert('Please select both payroll dates.');
      }

      if (period_start > period_end) {
        return alert('The start date must not be after the end date.');
      }

      try {
        const res = await api('/payroll/calculate', {
          method: 'POST',
          body: JSON.stringify({ period_start, period_end })
        });

        document.getElementById('payroll-result').innerHTML = `
          <div style="overflow-x:auto;">
            <table style="margin-top:1rem">
              <thead>
                <tr>
                  <th>Guard</th><th>Hours</th><th>Rate</th>
                  <th>Gross (NAD)</th><th>Net (NAD)</th>
                </tr>
              </thead>
              <tbody>
                ${(res.data || []).map(r => `
                  <tr>
                    <td>${escapeHTML(r.employee_code)} – ${escapeHTML(r.full_name)}</td>
                    <td>${escapeHTML(r.total_hours)}</td>
                    <td>${formatNAD(r.hourly_rate)}</td>
                    <td>${formatNAD(r.gross_amount)}</td>
                    <td><strong>${formatNAD(r.net_amount)}</strong></td>
                  </tr>
                `).join('') || '<tr><td colspan="5">No payroll results.</td></tr>'}
              </tbody>
            </table>
          </div>
        `;
      } catch (err) {
        alert(err.message);
      }
    };
  } else {
    const data = await api('/payroll/my');

    el.innerHTML = `
      <div class="card">
        <h2>My Payslips (NAD)</h2>
        <table>
          <thead>
            <tr><th>Period</th><th>Hours</th><th>Rate</th><th>Net Pay</th></tr>
          </thead>
          <tbody>
            ${(data.data || []).map(r => `
              <tr>
                <td>${escapeHTML(r.period_start)} → ${escapeHTML(r.period_end)}</td>
                <td>${escapeHTML(r.total_hours)}</td>
                <td>${formatNAD(r.hourly_rate)}</td>
                <td><strong>${formatNAD(r.net_amount)}</strong></td>
              </tr>
            `).join('') || '<tr><td colspan="4">No payslips yet</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  }
}


// ---------- Incident Reports ----------
async function renderIncidents(el) {
  const isGuard = currentUser.role === 'guard';

  // GUARD: INCIDENT SUBMISSION FORM
  if (isGuard) {
    const now = new Date();

    el.innerHTML = `
      <div class="card">
        <h2>Submit Incident Report</h2>
        <p>Complete the details below and submit your incident report to management.</p>

        <form id="incident-report-form" enctype="multipart/form-data">

          <div class="form-group">
            <label for="incident-date">Incident Date *</label>
            <input type="date" id="incident-date"
              name="incident_date"
              value="${localDateString()}"
              required>
          </div>

          <div class="form-group">
            <label for="incident-time">Incident Time *</label>
            <input type="time" id="incident-time"
              name="incident_time"
              value="${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}"
              required>
          </div>

          <div class="form-group">
            <label for="incident-location">Location *</label>
            <input type="text" id="incident-location"
              name="location"
              maxlength="255"
              placeholder="Where did the incident happen?"
              required>
            <small id="incident-location-hint">Checking your current site assignment...</small>
          </div>

          <div class="form-group">
            <label for="incident-type">Incident Type *</label>
            <input type="text" id="incident-type"
              name="incident_type"
              maxlength="120"
              placeholder="e.g. Theft, Accident, Suspicious Activity"
              required>
          </div>

          <div class="form-group">
            <label for="people-involved">People Involved</label>
            <textarea id="people-involved"
              name="people_involved"
              maxlength="10000"
              rows="3"
              placeholder="Names or descriptions of people involved"></textarea>
          </div>

          <div class="form-group">
            <label for="incident-description">What Happened? *</label>
            <textarea id="incident-description"
              name="description"
              maxlength="20000"
              rows="5"
              placeholder="Describe exactly what happened..."
              required></textarea>
          </div>

          <div class="form-group">
            <label for="actions-taken">Actions Taken</label>
            <textarea id="actions-taken"
              name="actions_taken"
              maxlength="10000"
              rows="3"
              placeholder="What action did you take?"></textarea>
          </div>

          <div class="form-group">
            <label for="incident-witness">Witness</label>
            <textarea id="incident-witness"
              name="witness"
              maxlength="10000"
              rows="2"
              placeholder="Witness names or contact details"></textarea>
          </div>

          <div class="form-group">
            <label for="incident-attachments">Photos / Documents (Optional)</label>
            <input type="file"
              id="incident-attachments"
              name="attachments"
              accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
              multiple>
            <small>Accepted formats: JPG, PNG, WebP and PDF.</small>
          </div>

          <div id="incident-form-message" role="status"></div>

          <button type="submit" class="btn-success" id="submit-incident">
            SEND INCIDENT REPORT
          </button>

        </form>
      </div>
    `;

    const form = el.querySelector('#incident-report-form');
    const message = el.querySelector('#incident-form-message');
    const submitButton = el.querySelector('#submit-incident');

    const locationInput = el.querySelector('#incident-location');
    const locationHint = el.querySelector('#incident-location-hint');

    api('/incidents/my-location')
      .then(locationResult => {
        const assignedSite = locationResult.data;

        if (assignedSite && !locationInput.value.trim()) {
          const siteName = assignedSite.name || '';
          const siteAddress = assignedSite.address || '';
          locationInput.value = siteAddress ? siteName + ' - ' + siteAddress : siteName;
          locationHint.textContent = 'Automatically filled from your current assigned site. You can edit this location if needed.';
        } else if (!assignedSite) {
          locationHint.textContent = 'No current site assignment found. Please enter the incident location manually.';
        }
      })
      .catch(() => {
        locationHint.textContent = 'Could not retrieve your assigned site. Please enter the incident location manually.';
      });

    form.addEventListener('submit', async event => {
      event.preventDefault();

      message.textContent = '';
      submitButton.disabled = true;
      submitButton.textContent = 'Submitting...';

      try {
        const formData = new FormData(form);

        const result = await api('/incidents', {
          method: 'POST',
          body: formData
        });

        message.textContent = result.message || 'Incident report submitted successfully.';
        form.reset();

        const currentDate = new Date();

        form.elements.incident_date.value = localDateString();
        form.elements.incident_time.value =
          String(currentDate.getHours()).padStart(2, '0') + ':' +
          String(currentDate.getMinutes()).padStart(2, '0');

      } catch (err) {
        message.textContent = 'Submission failed: ' + err.message;
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'SEND INCIDENT REPORT';
      }
    });

    return;
  }

  // ADMIN / MANAGER: VIEW UNCLEARED INCIDENT REPORTS
  try {
    const result = await api('/incidents');
    const reports = Array.isArray(result.reports) ? result.reports : [];

    if (reports.length === 0) {
      el.innerHTML = `
        <div class="card">
          <h2>Incident Reports</h2>
          <p>No uncleared incident reports at the moment.</p>
        </div>
      `;
      return;
    }

    // Sort newest submitted reports first.
    reports.sort((a, b) =>
      String(b.submitted_at || '').localeCompare(
        String(a.submitted_at || '')
      )
    );

    // Group reports by guard.
    const grouped = new Map();

    reports.forEach(report => {
      const guardId = String(report.guard_id);

      if (!grouped.has(guardId)) {
        grouped.set(guardId, {
          id: guardId,
          name: report.full_name || 'Unknown Guard',
          code: report.employee_code || '',
          reports: []
        });
      }

      grouped.get(guardId).reports.push(report);
    });

    const guards = Array.from(grouped.values());

    // Guards with the newest reports appear first.
    guards.sort((a, b) =>
      String(b.reports[0].submitted_at || '').localeCompare(
        String(a.reports[0].submitted_at || '')
      )
    );

    const formatReportText = value =>
      escapeHTML(value || 'Not provided');

    const reportHTML = guards.map(guard => {
      const guardReports = guard.reports.map(report => {
        const submitted = String(report.submitted_at || '')
          .replace('T', ' ')
          .slice(0, 19);

        const attachments = Array.isArray(report.attachments)
          ? report.attachments
          : [];

        return `
          <div class="card incident-report-card">

            <h4>Incident #${escapeHTML(report.id)}</h4>

            <p><strong>Submitted:</strong> ${escapeHTML(submitted || 'Unknown')}</p>
            <p><strong>Incident Date:</strong> ${formatReportText(report.incident_date)}</p>
            <p><strong>Incident Time:</strong> ${formatReportText(report.incident_time)}</p>
            <p><strong>Location:</strong> ${formatReportText(report.location)}</p>
            <p><strong>Incident Type:</strong> ${formatReportText(report.incident_type)}</p>

            <p><strong>People Involved:</strong></p>
            <div style="white-space:pre-wrap">${formatReportText(report.people_involved)}</div>

            <p><strong>What Happened:</strong></p>
            <div style="white-space:pre-wrap">${formatReportText(report.description)}</div>

            <p><strong>Actions Taken:</strong></p>
            <div style="white-space:pre-wrap">${formatReportText(report.actions_taken)}</div>

            <p><strong>Witness:</strong></p>
            <div style="white-space:pre-wrap">${formatReportText(report.witness)}</div>

            ${
              attachments.length
                ? `
                  <div class="incident-attachments">
                    <strong>Attachments:</strong>
                    ${attachments.map(file => `
                      <div class="incident-attachment-item">

                        <p><strong>${escapeHTML(file.file_name)}</strong></p>

                        ${
                          file.file_type === 'image'
                            ? `
                              <img
                                class="incident-image-preview"
                                data-incident-id="${escapeHTML(report.id)}"
                                data-attachment-id="${escapeHTML(file.id)}"
                                alt="${escapeHTML(file.file_name)}"
                                style="display:block;max-width:100%;max-height:350px;object-fit:contain;border:1px solid var(--border);border-radius:8px;margin:10px 0;"
                              >
                              <p class="incident-preview-status">Loading image preview...</p>
                              <button
                                type="button"
                                class="incident-view-image"
                                data-incident-id="${escapeHTML(report.id)}"
                                data-attachment-id="${escapeHTML(file.id)}">
                                VIEW IMAGE
                              </button>
                            `
                            : file.file_type === 'document'
                              ? `
                                <p>PDF document</p>
                                <button
                                  type="button"
                                  class="incident-view-pdf"
                                  data-incident-id="${escapeHTML(report.id)}"
                                  data-attachment-id="${escapeHTML(file.id)}">
                                  VIEW PDF
                                </button>
                              `
                              : '<p>Preview unavailable for this file type.</p>'
                        }

                        <p>
                          <button
                            type="button"
                            class="incident-download"
                            data-incident-id="${escapeHTML(report.id)}"
                            data-attachment-id="${escapeHTML(file.id)}"
                            data-file-name="${escapeHTML(file.file_name)}">
                            Download: ${escapeHTML(file.file_name)}
                          </button>
                        </p>

                      </div>
                    `).join('')}
                  </div>
                `
                : '<p><strong>Attachments:</strong> None</p>'
            }

            <button
              type="button"
              class="btn-success"
              data-clear-incident="${escapeHTML(report.id)}">
              CLEAR THIS REPORT
            </button>

          </div>
        `;
      }).join('');

      return `
        <div class="card incident-guard-group">

          <button
            type="button"
            class="btn-success"
            data-guard-toggle="${escapeHTML(guard.id)}"
            aria-expanded="false">
            ${escapeHTML(guard.name)}
            (${escapeHTML(guard.code)})
            — ${guard.reports.length} uncleared report(s)
          </button>

          <div id="incident-guard-panel-${escapeHTML(guard.id)}" hidden>
            ${guardReports}
          </div>

        </div>
      `;
    }).join('');

       el.innerHTML = `
      <div class="card">
        <h2>Incident Reports</h2>

        <p>Uncleared reports: <strong>${reports.length}</strong></p>
        <p>Guards with reports: <strong>${guards.length}</strong></p>

        <div class="form-group">
          <label for="incident-guard-search">
            Search Guard by Name or Employee Code
          </label>

          <input
            type="search"
            id="incident-guard-search"
            placeholder="Type guard name or employee code..."
            autocomplete="off"
          >
        </div>

        <p id="incident-search-count">
          Showing ${guards.length} guards.
        </p>

        <p id="incident-search-empty" hidden>
          No guards found matching your search.
        </p>

        <p>Select a guard to view their incident reports.</p>
      </div>

      ${reportHTML}
    `;

    // Search guards by name or employee code.
    const guardSearch = el.querySelector('#incident-guard-search');
    const searchCount = el.querySelector('#incident-search-count');
    const searchEmpty = el.querySelector('#incident-search-empty');

    guardSearch.addEventListener('input', () => {
      const searchTerm = guardSearch.value.trim().toLowerCase();

      const guardGroups = el.querySelectorAll('.incident-guard-group');
      let visibleGuards = 0;

      guardGroups.forEach(group => {
        const guardButton = group.querySelector('[data-guard-toggle]');

        const guardNameAndCode = guardButton
          ? guardButton.textContent.toLowerCase()
          : '';

        const matches = guardNameAndCode.includes(searchTerm);

        group.hidden = !matches;

        if (matches) {
          visibleGuards++;
        }
      });

      searchCount.textContent =
        `Showing ${visibleGuards} of ${guards.length} guards.`;

      searchEmpty.hidden = visibleGuards !== 0;
    });

    // Expand or collapse each guard's reports.
    el.querySelectorAll('[data-guard-toggle]').forEach(button => {
      button.addEventListener('click', () => {
        const guardId = button.dataset.guardToggle;
        const panel = el.querySelector(
          '#incident-guard-panel-' + guardId
        );

        if (!panel) return;

        panel.hidden = !panel.hidden;
        button.setAttribute('aria-expanded', String(!panel.hidden));
      });
    });

    // Clear individual reports.
    el.querySelectorAll('[data-clear-incident]').forEach(button => {
      button.addEventListener('click', async () => {
        const incidentId = button.dataset.clearIncident;

        if (!confirm('Are you sure you want to clear this incident report?')) {
          return;
        }

        button.disabled = true;

        try {
          await api(`/incidents/${incidentId}/clear`, {
            method: 'PUT'
          });

          alert('Incident report cleared successfully.');

          await renderIncidents(el);

        } catch (err) {
          alert('Could not clear report: ' + err.message);
          button.disabled = false;
        }
      });
    });

    // LOAD IMAGE PREVIEWS USING AUTHENTICATED REQUESTS.
    el.querySelectorAll('.incident-image-preview').forEach(async img => {
      const incidentId = img.dataset.incidentId;
      const attachmentId = img.dataset.attachmentId;
      const status = img.nextElementSibling;

      try {
        const response = await fetch(
          API + '/incidents/' + incidentId +
          '/attachments/' + attachmentId + '?view=1',
          {
            headers: token
              ? { Authorization: 'Bearer ' + token }
              : {}
          }
        );

        if (!response.ok) {
          throw new Error('Image preview could not be loaded.');
        }

        const blob = await response.blob();

        if (!blob.type.startsWith('image/')) {
          throw new Error('Unsupported image format.');
        }

        const url = URL.createObjectURL(blob);
        img.src = url;
        img.onload = () => URL.revokeObjectURL(url);

        if (status) status.remove();

      } catch (err) {
        if (status) status.textContent = err.message;
      }
    });

    // VIEW FULL-SIZE INCIDENT IMAGES.
    el.querySelectorAll('.incident-view-image').forEach(button => {
      button.addEventListener('click', async () => {
        const incidentId = button.dataset.incidentId;
        const attachmentId = button.dataset.attachmentId;

        button.disabled = true;

        try {
          const response = await fetch(
            API + '/incidents/' + incidentId +
            '/attachments/' + attachmentId + '?view=1',
            {
              headers: token
                ? { Authorization: 'Bearer ' + token }
                : {}
            }
          );

          if (!response.ok) {
            throw new Error('Image viewing failed.');
          }

          const blob = await response.blob();

          if (!blob.type.startsWith('image/')) {
            throw new Error('Invalid image attachment.');
          }

          const url = URL.createObjectURL(blob);
          window.open(url, '_blank', 'noopener');

          setTimeout(() => URL.revokeObjectURL(url), 300000);

        } catch (err) {
          alert(err.message);
        } finally {
          button.disabled = false;
        }
      });
    });
    // VIEW PDF DOCUMENTS USING AUTHENTICATED REQUESTS.
    el.querySelectorAll('.incident-view-pdf').forEach(button => {
      button.addEventListener('click', async () => {
        const incidentId = button.dataset.incidentId;
        const attachmentId = button.dataset.attachmentId;

        const previewWindow = window.open('about:blank', '_blank');

        if (!previewWindow) {
          alert('Please allow pop-ups to view PDF documents.');
          return;
        }

        previewWindow.opener = null;
        button.disabled = true;

        try {
          const response = await fetch(
            API + '/incidents/' + incidentId +
            '/attachments/' + attachmentId + '?view=1',
            {
              headers: token
                ? { Authorization: 'Bearer ' + token }
                : {}
            }
          );

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || 'PDF viewing failed.');
          }

          const blob = await response.blob();

          if (blob.type !== 'application/pdf') {
            throw new Error('The attachment is not a valid PDF.');
          }

          const url = URL.createObjectURL(blob);
          previewWindow.location.href = url;

          setTimeout(() => URL.revokeObjectURL(url), 300000);

        } catch (err) {
          previewWindow.close();
          alert(err.message);
        } finally {
          button.disabled = false;
        }
      });
    });
    // Download attachments using authenticated requests.
    el.querySelectorAll('.incident-download').forEach(button => {
      button.addEventListener('click', async () => {
        const incidentId = button.dataset.incidentId;
        const attachmentId = button.dataset.attachmentId;
        const fileName = button.dataset.fileName;

        button.disabled = true;

        try {
          const response = await fetch(
            API + '/incidents/' + incidentId +
            '/attachments/' + attachmentId,
            {
              headers: token
                ? { Authorization: 'Bearer ' + token }
                : {}
            }
          );

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || 'Attachment download failed.');
          }

          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');

          link.href = url;
          link.download = fileName || 'incident-attachment';
          document.body.appendChild(link);
          link.click();
          link.remove();

          setTimeout(() => URL.revokeObjectURL(url), 1000);

        } catch (err) {
          alert(err.message);
        } finally {
          button.disabled = false;
        }
      });
    });

  } catch (err) {
    el.innerHTML = `
      <div class="card">
        <h2>Incident Reports</h2>
        <p>Could not load incident reports: ${escapeHTML(err.message)}</p>
        <button type="button" id="reload-incidents" class="btn-success">
          TRY AGAIN
        </button>
      </div>
    `;

    el.querySelector('#reload-incidents').addEventListener('click', () => {
      renderIncidents(el);
    });
  }
}

// ---------- Clock In / Out ----------
async function renderClock(el) {
  el.innerHTML = `
    <div class="card clock-panel">
      <h2>Clock In / Out</h2>
      <div class="time" id="clock-time"></div>
      <p id="clock-status">Checking status...</p>
      <div class="clock-actions">
        <button class="btn-success" id="btn-clock-in">CLOCK IN</button>
        <button class="btn-danger" id="btn-clock-out">CLOCK OUT</button>
      </div>
      <p style="margin-top:1.5rem;font-size:0.85rem;color:var(--muted)">
        Your browser will request location permission for geofence checks.
      </p>
    </div>
  `;

  const clockElement = document.getElementById('clock-time');
  const updateTime = () => {
    if (clockElement && clockElement.isConnected) {
      clockElement.textContent = new Date().toLocaleTimeString('en-NA');
    }
  };

  updateTime();

  // Keep only one clock timer alive when switching pages.
  if (window.jupiterClockTimer) clearInterval(window.jupiterClockTimer);
  window.jupiterClockTimer = setInterval(updateTime, 1000);

  function getPosition() {
    return new Promise(resolve => {
      if (!navigator.geolocation) return resolve({});

      navigator.geolocation.getCurrentPosition(
        pos => resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude
        }),
        () => resolve({}),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  }

  document.getElementById('btn-clock-in').onclick = async () => {
    try {
      const coords = await getPosition();
      const res = await api('/attendance/clock-in', {
        method: 'POST',
        body: JSON.stringify(coords)
      });

      document.getElementById('clock-status').textContent =
        `Clocked in at ${res.data.site_name} ` +
        `${res.data.within_geofence ? '(inside geofence ✓)' : '(outside geofence ✗)'}`;

      startGuardGpsTracking();
      alert(res.message);
    } catch (err) {
      alert(err.message);
    }
  };

  document.getElementById('btn-clock-out').onclick = async () => {
    try {
      const coords = await getPosition();
      const res = await api('/attendance/clock-out', {
        method: 'POST',
        body: JSON.stringify(coords)
      });

      document.getElementById('clock-status').textContent =
        `Clocked out – ${res.data.hours_worked} hours worked`;

      stopGuardGpsTracking();
      alert(res.message);
    } catch (err) {
      alert(err.message);
    }
  };
}

// ---------- Boot ----------
(async function init() {
  if (token) {
    try {
      const data = await api('/auth/me');
      currentUser = data.user;
      enterApp();
    } catch {
      localStorage.removeItem('jupiter_token');
      localStorage.removeItem('jupiter_user');
      token = null;
    }
  }
})();











