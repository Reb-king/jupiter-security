/* Jupiter Security Management System - Frontend */
const API = '/api';
let token = localStorage.getItem('jupiter_token');
let currentUser = null;

// ---------- Helpers ----------
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(API + path, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Request failed');
  return data;
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function formatNAD(n) {
  return 'N$ ' + Number(n).toLocaleString('en-NA', { minimumFractionDigits: 2 });
}

// ---------- Auth ----------
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = document.getElementById('login-code').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    const data = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ employee_code: code, password })
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
  document.getElementById('user-name').textContent = currentUser.full_name;
  document.getElementById('user-role').textContent = currentUser.role;

  // Show/hide nav buttons by role
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = (currentUser.role === 'admin' || currentUser.role === 'manager') ? '' : 'none';
  });
  document.querySelectorAll('.guard-only').forEach(el => {
    el.style.display = currentUser.role === 'guard' ? '' : 'none';
  });

  loadPage('dashboard');
}

// ---------- Navigation ----------
document.getElementById('sidebar').addEventListener('click', (e) => {
  if (e.target.classList.contains('nav-btn')) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    loadPage(e.target.dataset.page);
  }
});

async function loadPage(page) {
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
      case 'clock': await renderClock(content); break;
      default: content.innerHTML = '<p>Page not found</p>';
    }
  } catch (err) {
    content.innerHTML = `<p class="error">${err.message}</p>`;
  }
}

// ---------- Pages ----------
async function renderDashboard(el) {
  el.innerHTML = `
    <h2 style="margin-bottom:1rem">Dashboard</h2>
    <div class="grid" id="dash-stats"></div>
    <div class="card" style="margin-top:1.5rem">
      <h2>Welcome to Jupiter Security Management System</h2>
      <p style="color:var(--muted);margin-top:0.5rem">Namibia · Currency: NAD · Shift pattern: 7 Day → 7 Night → 1 Off</p>
    </div>
  `;
  // Simple stats for managers
  if (currentUser.role !== 'guard') {
    try {
      const [guards, sites, live] = await Promise.all([
        api('/users?role=guard&active=true'),
        api('/sites?status=approved'),
        api('/locations/live')
      ]);
      document.getElementById('dash-stats').innerHTML = `
        <div class="stat"><div class="value">${guards.data.length}</div><div class="label">Active Guards</div></div>
        <div class="stat"><div class="value">${sites.data.length}</div><div class="label">Approved Sites</div></div>
        <div class="stat"><div class="value">${live.data.filter(l => l.is_on_duty).length}</div><div class="label">Currently On Duty</div></div>
      `;
    } catch (_) {}
  }
}

async function renderGuards(el) {
  const data = await api('/users?role=guard');
  
  el.innerHTML = `
    <div class="card">
      <h2>Security Guards</h2>
      
      <div class="form-row" style="flex-wrap: wrap; gap: 8px;">
        <input id="g-code" placeholder="Employee Code (JUP-SEC-001)" />
        <input id="g-name" placeholder="Full Name" />
        <input id="g-phone" placeholder="Phone (+264...)" />
        <input id="g-dob" type="date" title="Date of Birth" />
        <input id="g-hired" type="date" title="Date Hired" />
        <input id="g-rate" type="number" step="0.01" placeholder="Hourly Rate (NAD)" />
        <input id="g-pass" type="password" placeholder="Temp Password" />
        <button class="btn" id="btn-add-guard">Register Guard</button>
      </div>

      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Phone</th>
            <th>DOB</th>
            <th>Hired</th>
            <th>Rate</th>
            <th>Status</th>
            <th>On Access Since</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${data.data.map(u => `
            <tr>
              <td>${u.employee_code}</td>
              <td>${u.full_name}</td>
              <td>${u.phone || '-'}</td>
              <td>${u.date_of_birth ? u.date_of_birth.slice(0,10) : '-'}</td>
              <td>${u.hired_at ? u.hired_at.slice(0,10) : '-'}</td>
              <td>${formatNAD(u.hourly_rate)}</td>
              <td>
                ${u.is_active 
                  ? '<span class="status-on">Active</span>' 
                  : '<span class="status-off">On Access</span>'}
              </td>
              <td>${!u.is_active && u.suspended_at ? u.suspended_at.slice(0,10) : '-'}</td>
              <td style="white-space: nowrap;">
                ${u.is_active 
                  ? `<button class="btn" style="background:#f59e0b;color:#000;margin:2px" onclick="suspendGuard(${u.id}, '${u.full_name}')">Put on Access</button>`
                  : `
                    <button class="btn-success" style="margin:2px" onclick="reinstateGuard(${u.id}, '${u.full_name}')">Reinstate</button>
                    <button class="btn-danger" style="margin:2px" onclick="fireGuard(${u.id}, '${u.full_name}')">Fire</button>
                  `}
                <button class="btn" style="background:#3b82f6;color:white;margin:2px" onclick="resetPassword(${u.id}, '${u.full_name}')">Show/Reset Password</button>
                <button class="btn" style="background:#0d9488;color:white;margin:2px" onclick="editGuard(${u.id})">Edit</button>
                </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('btn-add-guard').onclick = async () => {
    try {
      const res = await api('/users', {
        method: 'POST',
        body: JSON.stringify({
          employee_code: document.getElementById('g-code').value,
          full_name: document.getElementById('g-name').value,
          phone: document.getElementById('g-phone').value,
          date_of_birth: document.getElementById('g-dob').value || null,
          hired_at: document.getElementById('g-hired').value || null,
          hourly_rate: document.getElementById('g-rate').value,
          password: document.getElementById('g-pass').value,
          role: 'guard'
        })
      });
      alert(`Guard registered successfully!\n\nTemporary Password: ${res.data.temp_password}`);
      loadPage('guards');
    } catch (err) { 
      alert(err.message); 
    }
  };
}

window.editGuard = async (id) => {
  try {
    // Get the guard's current details.
    const res = await api(`/users/${id}`);
    const guard = res.data;

    if (!guard) {
      alert('Guard details could not be found.');
      return;
    }

    const full_name = prompt('Full Name:', guard.full_name || '');
    if (full_name === null) return;

    if (!full_name.trim()) {
      alert('Full name cannot be empty.');
      return;
    }

    const phone = prompt('Phone:', guard.phone || '');
    if (phone === null) return;

    const email = prompt('Email:', guard.email || '');
    if (email === null) return;

    const hourly_rate = prompt(
      'Hourly Rate (NAD):',
      guard.hourly_rate ?? '0.00'
    );
    if (hourly_rate === null) return;

    if (hourly_rate.trim() === '' || !Number.isFinite(Number(hourly_rate)) || Number(hourly_rate) < 0) {
      alert('Please enter a valid, non-negative hourly rate.');
      return;
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
      alert('Please enter dates in YYYY-MM-DD format, or leave them blank.');
      return;
    }

    if (!confirm(`Save the updated details for ${full_name.trim()}?`)) {
      return;
    }

    const update = await api(`/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        full_name: full_name.trim(),
        phone: phone.trim(),
        email: email.trim(),
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


// ========== Guard Actions ==========

window.suspendGuard = async (id, name) => {
  const password = prompt(`Put "${name}" On Access?\n\nThey will not be able to get a site or shifts.\n\nEnter your password to confirm:`);
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

window.reinstateGuard = async (id, name) => {
  const password = prompt(`Reinstate "${name}"?\n\nThey will become Active again.\n\nEnter your password to confirm:`);
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

window.fireGuard = async (id, name) => {
  const password = prompt(`FIRE "${name}"?\n\nThis will permanently delete the guard.\n\nEnter your password to confirm:`);
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

window.resetPassword = async (id, name) => {
  const password = prompt(`Reset temporary password for "${name}"?\n\nEnter your admin password to continue:`);
  if (!password) return;

  try {
    const res = await api(`/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password })
    });

    let message = `New Temporary Password for ${res.guard_name}:\n\n${res.temp_password}\n\n`;

    if (!res.is_active) {
      message += `WARNING: This guard is currently ON ACCESS (suspended).\nThey will NOT be able to log in until you Reinstate them.`;
    } else {
      message += `The guard can now log in with this password.`;
    }

    alert(message);
  } catch (err) {
    alert(err.message);
  }
};

async function renderSites(el) {
  const data = await api('/sites');
  el.innerHTML = `
    <div class="card">
      <h2>Sites</h2>
      <div class="form-row">
        <input id="s-code" placeholder="Site Code (JUP-SITE-01)" />
        <input id="s-name" placeholder="Site Name" />
        <input id="s-town" placeholder="Town" />
        <input id="s-address" placeholder="Address" />
        <button class="btn" id="btn-add-site">Add Approved Site</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Town</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${data.data.map(s => `
            <tr>
              <td>${s.site_code}</td>
              <td>${s.name}</td>
              <td>${s.town || '-'}</td>
              <td class="status-${s.status}">${s.status}</td>
              <td>
                ${s.status === 'approved'
                  ? `<button class="btn-danger" onclick="terminateSite(${s.id})">Terminate</button>`
                  : '-'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('btn-add-site').onclick = async () => {
    try {
      await api('/sites', {
        method: 'POST',
        body: JSON.stringify({
          site_code: document.getElementById('s-code').value,
          name: document.getElementById('s-name').value,
          town: document.getElementById('s-town').value,
          address: document.getElementById('s-address').value
        })
      });
      alert('Site added successfully');
      loadPage('sites');
    } catch (err) {
      alert(err.message);
    }
  };
}

window.terminateSite = async (id) => {
  if (!confirm('Terminate this site?')) return;
  try {
    await api(`/sites/${id}`, { method: 'DELETE' });
    loadPage('sites');
  } catch (err) {
    alert(err.message);
  }
};

async function renderAssignments(el) {
  const [assigns, guards, sites] = await Promise.all([
    api('/assignments'),
    api('/users?role=guard&active=true'),
    api('/sites?status=approved')
  ]);
  el.innerHTML = `
    <div class="card">
      <h2>Guard → Site Assignments</h2>
      <div class="form-row">
        <select id="a-guard">
          <option value="">Select Guard</option>
          ${guards.data.map(g => `<option value="${g.id}">${g.employee_code} – ${g.full_name}</option>`).join('')}
        </select>
        <select id="a-site">
          <option value="">Select Site</option>
          ${sites.data.map(s => `<option value="${s.id}">${s.site_code} – ${s.name}</option>`).join('')}
        </select>
        <button class="btn" id="btn-assign">Assign</button>
      </div>
      <table>
        <thead><tr><th>Guard</th><th>Site</th><th>From</th></tr></thead>
        <tbody>
          ${assigns.data.map(a => `
            <tr>
              <td>${a.employee_code} – ${a.guard_name}</td>
              <td>${a.site_code} – ${a.site_name}</td>
              <td>${a.assigned_from}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  document.getElementById('btn-assign').onclick = async () => {
    try {
      await api('/assignments', {
        method: 'POST',
        body: JSON.stringify({
          guard_id: document.getElementById('a-guard').value,
          site_id: document.getElementById('a-site').value
        })
      });
      alert('Assigned successfully');
      loadPage('assignments');
    } catch (err) { alert(err.message); }
  };
}

async function renderShifts(el) {
  const isManager = currentUser.role !== 'guard';
  let extra = '';
  if (isManager) {
    const [guards, sites] = await Promise.all([
      api('/users?role=guard&active=true'),
      api('/sites?status=approved')
    ]);
    extra = `
      <div class="form-row">
        <select id="sh-guard">
          <option value="">Select Guard</option>
          ${guards.data.map(g => `<option value="${g.id}">${g.employee_code} – ${g.full_name}</option>`).join('')}
        </select>
        <select id="sh-site">
          <option value="">Select Site</option>
          ${sites.data.map(s => `<option value="${s.id}">${s.site_code} – ${s.name}</option>`).join('')}
        </select>
        <input type="date" id="sh-start" />
        <input type="number" id="sh-cycles" value="1" min="1" max="12" style="width:80px" title="Number of 15-day cycles" />
        <button class="btn" id="btn-gen-shifts">Generate 7-7-1 Shifts</button>
      </div>
    `;
  }

  const shifts = await api('/shifts');
  el.innerHTML = `
    <div class="card">
      <h2>Shifts ${isManager ? '(Generate 7 Day → 7 Night → 1 Off)' : ''}</h2>
      ${extra}
      <table>
        <thead><tr><th>Date</th><th>Guard</th><th>Site</th><th>Type</th><th>Start</th><th>End</th><th>Status</th></tr></thead>
        <tbody>
          ${shifts.data.slice(0, 60).map(s => `
            <tr>
              <td>${s.shift_date}</td>
              <td>${s.employee_code || ''}</td>
              <td>${s.site_code || ''}</td>
              <td><strong>${s.shift_type.toUpperCase()}</strong></td>
              <td>${s.start_time ? s.start_time.replace('T', ' ').slice(0, 16) : '-'}</td>
              <td>${s.end_time ? s.end_time.replace('T', ' ').slice(0, 16) : '-'}</td>
              <td>${s.status}</td>
            </tr>
          `).join('') || '<tr><td colspan="7">No shifts yet</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
  if (isManager) {
    document.getElementById('btn-gen-shifts').onclick = async () => {
      try {
        const res = await api('/shifts/generate', {
          method: 'POST',
          body: JSON.stringify({
            guard_id: document.getElementById('sh-guard').value,
            site_id: document.getElementById('sh-site').value,
            cycle_start_date: document.getElementById('sh-start').value,
            number_of_cycles: document.getElementById('sh-cycles').value
          })
        });
        alert(res.message);
        loadPage('shifts');
      } catch (err) { alert(err.message); }
    };
  }
}

async function renderAttendance(el) {
  const path = currentUser.role === 'guard' ? '/attendance/my' : '/attendance';
  const data = await api(path);
  el.innerHTML = `
    <div class="card">
      <h2>Attendance Records</h2>
      <table>
        <thead>
          <tr>
            <th>Guard</th><th>Site</th><th>Clock In</th><th>Clock Out</th>
            <th>Hours</th><th>In Geo?</th><th>Out Geo?</th>
          </tr>
        </thead>
        <tbody>
          ${data.data.map(a => `
            <tr>
              <td>${a.guard_name || a.employee_code || '-'}</td>
              <td>${a.site_name || '-'}</td>
              <td>${a.clock_in_at ? a.clock_in_at.replace('T', ' ').slice(0, 19) : '-'}</td>
              <td>${a.clock_out_at ? a.clock_out_at.replace('T', ' ').slice(0, 19) : '<em>Still on duty</em>'}</td>
              <td>${a.hours_worked != null ? a.hours_worked : '-'}</td>
              <td>${a.clock_in_within_geofence == 1 ? '✓' : a.clock_in_within_geofence == 0 ? '✗' : '-'}</td>
              <td>${a.clock_out_within_geofence == 1 ? '✓' : a.clock_out_within_geofence == 0 ? '✗' : '-'}</td>
            </tr>
          `).join('') || '<tr><td colspan="7">No records</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

async function renderLocation(el) {
  const data = await api('/locations/live');
  el.innerHTML = `
    <div class="card">
      <h2>Live Guard Locations</h2>
      <p style="color:var(--muted);margin-bottom:1rem">Last known GPS positions. Refresh the page to update.</p>
      <table>
        <thead>
          <tr><th>Guard</th><th>On Duty?</th><th>Site</th><th>Lat</th><th>Lng</th><th>Last Update</th></tr>
        </thead>
        <tbody>
          ${data.data.map(l => `
            <tr>
              <td>${l.employee_code} – ${l.full_name}</td>
              <td class="${l.is_on_duty ? 'status-on' : 'status-off'}">${l.is_on_duty ? 'YES' : 'No'}</td>
              <td>${l.site_name || '-'}</td>
              <td>${l.latitude}</td>
              <td>${l.longitude}</td>
              <td>${l.recorded_at ? l.recorded_at.replace('T', ' ').slice(0, 19) : '-'}</td>
            </tr>
          `).join('') || '<tr><td colspan="6">No location data yet</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

async function renderPayroll(el) {
  const isManager = currentUser.role !== 'guard';
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
      try {
        const res = await api('/payroll/calculate', {
          method: 'POST',
          body: JSON.stringify({
            period_start: document.getElementById('p-start').value,
            period_end: document.getElementById('p-end').value
          })
        });
        document.getElementById('payroll-result').innerHTML = `
          <table style="margin-top:1rem">
            <thead><tr><th>Guard</th><th>Hours</th><th>Rate</th><th>Gross (NAD)</th><th>Net (NAD)</th></tr></thead>
            <tbody>
              ${res.data.map(r => `
                <tr>
                  <td>${r.employee_code} – ${r.full_name}</td>
                  <td>${r.total_hours}</td>
                  <td>${formatNAD(r.hourly_rate)}</td>
                  <td>${formatNAD(r.gross_amount)}</td>
                  <td><strong>${formatNAD(r.net_amount)}</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      } catch (err) { alert(err.message); }
    };
  } else {
    const data = await api('/payroll/my');
    el.innerHTML = `
      <div class="card">
        <h2>My Payslips (NAD)</h2>
        <table>
          <thead><tr><th>Period</th><th>Hours</th><th>Rate</th><th>Net Pay</th></tr></thead>
          <tbody>
            ${data.data.map(r => `
              <tr>
                <td>${r.period_start} → ${r.period_end}</td>
                <td>${r.total_hours}</td>
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

  const updateTime = () => {
    document.getElementById('clock-time').textContent = new Date().toLocaleTimeString('en-NA');
  };
  updateTime();
  setInterval(updateTime, 1000);

  function getPosition() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({});
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        () => resolve({}),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  }

  document.getElementById('btn-clock-in').onclick = async () => {
    try {
      const coords = await getPosition();
      const res = await api('/attendance/clock-in', { method: 'POST', body: JSON.stringify(coords) });
      document.getElementById('clock-status').textContent =
        `Clocked in at ${res.data.site_name} ${res.data.within_geofence ? '(inside geofence ✓)' : '(outside geofence ✗)'}`;
      alert(res.message);
    } catch (err) { alert(err.message); }
  };

  document.getElementById('btn-clock-out').onclick = async () => {
    try {
      const coords = await getPosition();
      const res = await api('/attendance/clock-out', { method: 'POST', body: JSON.stringify(coords) });
      document.getElementById('clock-status').textContent =
        `Clocked out – ${res.data.hours_worked} hours worked`;
      alert(res.message);
    } catch (err) { alert(err.message); }
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
      token = null;
    }
  }
})();