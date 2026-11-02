
/* Jupiter Security Management System - Frontend */
const API = '/api';
let token = localStorage.getItem('jupiter_token');
let currentUser = null;

// ---------- Helpers ----------
async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;

  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {})
  };

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
    currentUser.role || '';

  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display =
      (currentUser.role === 'admin' || currentUser.role === 'manager')
        ? ''
        : 'none';
  });

  document.querySelectorAll('.guard-only').forEach(el => {
    el.style.display = currentUser.role === 'guard' ? '' : 'none';
  });

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
  const content = document.getElementById('content');
  content.innerHTML = '<p>Loading...</p>';

  try {
    switch (page) {
      case 'dashboard': await renderDashboard(content); break;
      case 'guards': await renderGuards(content); break;
      case 'sites': await renderSites(content); break;
      case 'shifts': await renderShifts(content); break;
      case 'attendance': await renderAttendance(content); break;
      case 'location': await renderLocation(content); break;
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
  if (!currentUser || currentUser.role !== 'guard') {
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
      const [guards, sites, live] = await Promise.all([
        api('/users?role=guard&active=true'),
        api('/sites?status=approved'),
        api('/locations/live')
      ]);

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
      `;
    } catch (_) {}
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

// ---------- Shifts ----------
async function renderShifts(el) {
  const isManager = ['admin', 'manager'].includes(currentUser.role);
  let guards = [];
  let sites = [];

  if (isManager) {
    const [guardsResult, approvedSitesResult, terminatedSitesResult] = await Promise.all([
      api('/users?role=guard&active=true'),
      api('/sites?status=approved'),
      api('/sites?status=terminated')
    ]);

    guards = Array.isArray(guardsResult.data) ? guardsResult.data : [];
    const approvedSites = Array.isArray(approvedSitesResult.data) ? approvedSitesResult.data : [];
    const terminatedSites = Array.isArray(terminatedSitesResult.data) ? terminatedSitesResult.data : [];
    sites = [...approvedSites, ...terminatedSites];

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
    <td>${escapeHTML(s.site_name || '-')}${String(s.site_status || '').toLowerCase() === 'terminated' ? ' <span class="status-terminated">(Terminated)</span>' : ''}</td>
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
    const coverageSites = sites.filter(site => {
      const status = String(site.status || 'approved').trim().toLowerCase();
      return status === 'approved' || status === 'terminated';
    });
    if (!coverageSites.length) {
      coverageRows.innerHTML = '<tr><td colspan="5">No approved or terminated sites found.</td></tr>';
      return;
    }
    const scheduled = allShifts.filter(shift =>
      String(shift.shift_date || '').slice(0, 10) === date &&
      String(shift.status || '').trim().toLowerCase() === 'scheduled' &&
      ['day', 'night'].includes(String(shift.shift_type || '').trim().toLowerCase())
    );
    coverageRows.innerHTML = coverageSites.map(site => {
      const siteShifts = scheduled.filter(shift => Number(shift.site_id) === Number(site.id));
      const day = siteShifts.filter(shift => String(shift.shift_type || '').trim().toLowerCase() === 'day').length;

      const night = siteShifts.filter(shift => String(shift.shift_type || '').trim().toLowerCase() === 'night').length;
      const status = day === 0 && night === 0 ? 'No day or night guards' : day === 0 ? 'No day guards' : night === 0 ? 'No night guards' : 'Day and night covered';
      const dangerStyle = 'color:#c62828;font-weight:700;';
      return `<tr>
        <td>${escapeHTML(site.site_code || '-')}</td>
        <td style="${String(site.status || 'approved').trim().toLowerCase() === 'terminated' || day === 0 || night === 0 ? dangerStyle : ''}">${escapeHTML(site.name || site.site_name || '-')}${String(site.status || '').trim().toLowerCase() === 'terminated' ? ' <span class="status-terminated">(Terminated)</span>' : ''}</td>
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
      const expected = String(row.expected_shift || '').trim().toLowerCase();
      const finding = String(row.finding || '').trim().toLowerCase();

      if (finding === 'no rotation assigned') return true;

      return ['day', 'night'].includes(expected) &&
        (!row.shift_id || row.site_id == null);
    };
    const needsSite = allRows.filter(row => !isOff(row) && unassigned(row));
    const guardsById = new Map();
    needsSite.forEach(row => {
      const key = String(row.guard_id ?? row.id ?? row.employee_code ?? row.full_name ?? 'unknown');
      if (!guardsById.has(key)) guardsById.set(key, {key, guard: row, dates: new Set(), needsRotation: String(row.finding || '').trim().toLowerCase() === 'no rotation assigned'});
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
      guardList.innerHTML = '<p>No guards needing rotation, shift, or site assignment review were found in this period.</p>';
    } else {
      guardList.innerHTML = `<p>Select a guard to view their full ${days}-day schedule.</p><ul style="list-style:none;padding:0;margin:0;display:grid;gap:8px;">${guardItems.map((item,index) => `<li style="padding:10px 12px;border:1px solid var(--border, #ddd);border-radius:8px;"><button type="button" class="btn btn-missing-guard" data-guard-index="${index}" style="text-align:left;font-weight:700;">${escapeHTML(item.guard.full_name || item.guard.employee_code || 'Unknown guard')}</button> <span style="margin-left:8px;">(${escapeHTML(item.guard.employee_code || 'No employee code')}) — ${item.needsRotation ? 'No rotation / shifts generated' : `${item.dates.size} unassigned working day(s)`}</span></li>`).join('')}</ul>`;
      guardList.querySelectorAll('.btn-missing-guard').forEach(button => button.addEventListener('click', () => showGuardSchedule(guardItems[Number(button.dataset.guardIndex)])));
    }
    if (backButton) backButton.onclick = () => { detailWrap.hidden = true; guardList.hidden = false; backButton.hidden = true; rowsElement.innerHTML = '<tr><td colspan="8">Select a guard from the list above.</td></tr>'; messageElement.textContent = `${guardItems.length} guard(s) need scheduling review or site assignment. Report period: ${dates[0]} to ${dates[dates.length-1]}.`; };
    rowsElement.innerHTML = '<tr><td colspan="8">Select a guard from the list above to view their schedule.</td></tr>';
    messageElement.textContent = `${guardItems.length} guard(s) need scheduling review or site assignment. Report period: ${dates[0]} to ${dates[dates.length-1]}.`;
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
  const path = currentUser.role === 'guard'
    ? '/attendance/my'
    : '/attendance';

  const data = await api(path);

  el.innerHTML = `
    <div class="card">
      <h2>Attendance Records</h2>
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
}

// ---------- Live Locations ----------
async function renderLocation(el) {
  const data = await api('/locations/live');

  el.innerHTML = `
    <div class="card">
      <h2>Live Guard Locations</h2>
      <p style="color:var(--muted);margin-bottom:1rem">
        Last known GPS positions. Refresh the page to update.
      </p>
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th>Guard</th><th>On Duty?</th><th>Site</th>
              <th>Lat</th><th>Lng</th><th>Last Update</th>
            </tr>
          </thead>
          <tbody>
            ${(data.data || []).map(l => `
              <tr>
                <td>${escapeHTML(l.employee_code)} – ${escapeHTML(l.full_name)}</td>
                <td class="${l.is_on_duty ? 'status-on' : 'status-off'}">
                  ${l.is_on_duty ? 'YES' : 'No'}
                </td>
                <td>${escapeHTML(l.site_name || '-')}</td>
                <td>${escapeHTML(l.latitude)}</td>
                <td>${escapeHTML(l.longitude)}</td>
                <td>${escapeHTML(l.recorded_at ? String(l.recorded_at).replace('T', ' ').slice(0, 19) : '-')}</td>
              </tr>
            `).join('') || '<tr><td colspan="6">No location data yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

 // ---------- Incident Reports ----------
async function renderIncidents(el) {
  const isManagement = ['admin', 'manager'].includes(currentUser.role);

  if (!isManagement) {
    el.innerHTML = `
      <div class="card incident-report-card">
        <h2>Submit Incident Report</h2>
        <p>Complete the details below and submit your incident report to management.</p>

        <form id="incident-form" class="incident-report-form">
          <div class="form-row">
            <div>
              <label for="incident-date">Incident Date *</label>
              <input type="date" id="incident-date" name="incident_date"
                value="${localDateString()}" required />
            </div>

            <div>
              <label for="incident-time">Incident Time *</label>
              <input type="time" id="incident-time" name="incident_time" required />
            </div>
          </div>

          <div>
            <label for="incident-location">Location *</label>
            <input type="text" id="incident-location" name="location"
              maxlength="255" required placeholder="Where did the incident happen?" />
          </div>

          <div>
            <label for="incident-type">Incident Type *</label>
            <select id="incident-type" name="incident_type" required>
              <option value="">Select incident type</option>
              <option value="Theft">Theft</option>
              <option value="Security Breach">Security Breach</option>
              <option value="Accident">Accident</option>
              <option value="Property Damage">Property Damage</option>
              <option value="Suspicious Activity">Suspicious Activity</option>
              <option value="Violence or Threat">Violence or Threat</option>
              <option value="Fire or Emergency">Fire or Emergency</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div>
            <label for="incident-people">People Involved</label>
            <textarea id="incident-people" name="people_involved"
              maxlength="10000" rows="2"
              placeholder="Names or descriptions, if known"></textarea>
          </div>

          <div>
            <label for="incident-description">What Happened? *</label>
            <textarea id="incident-description" name="description"
              maxlength="20000" rows="5" required
              placeholder="Describe the incident in detail"></textarea>
          </div>

          <div>
            <label for="incident-actions">Actions Taken</label>
            <textarea id="incident-actions" name="actions_taken"
              maxlength="10000" rows="3"
              placeholder="Describe the actions taken"></textarea>
          </div>

          <div>
            <label for="incident-witness">Witnesses</label>
            <textarea id="incident-witness" name="witness"
              maxlength="10000" rows="2"
              placeholder="Witness names or contact details, if known"></textarea>
          </div>

          <div>
            <label for="incident-attachments">Photos or Documents</label>
            <input type="file" id="incident-attachments" name="attachments"
              accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
              multiple />
            <small>Maximum 5 files, 10 MB each. JPG, PNG, WebP and PDF only.</small>
          </div>

          <div style="margin-top:1rem">
            <button type="submit" class="btn" id="incident-submit">
              Submit Incident Report
            </button>
          </div>

          <p id="incident-message" role="status" aria-live="polite"></p>
        </form>
      </div>
    `;

    const form = document.getElementById('incident-form');
    const message = document.getElementById('incident-message');
    const submitButton = document.getElementById('incident-submit');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      const fileInput = document.getElementById('incident-attachments');
      const files = Array.from(fileInput.files || []);

      if (files.length > 5) {
        message.textContent = 'You can attach a maximum of 5 files.';
        return;
      }

      if (files.some(file => file.size > 10 * 1024 * 1024)) {
        message.textContent = 'Each attachment must be 10 MB or smaller.';
        return;
      }

      const formData = new FormData(form);

      submitButton.disabled = true;
      submitButton.textContent = 'Submitting...';
      message.textContent = '';

      try {
        const result = await api('/incidents', {
          method: 'POST',
          body: formData
        });

        form.reset();
        document.getElementById('incident-date').value = localDateString();

        message.textContent = result.message || 'Incident report submitted successfully.';
      } catch (error) {
        message.textContent = error.message;
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = 'Submit Incident Report';
      }
    });

    return;
  }

  async function renderManagement(selectedGuardId = null) {
    el.innerHTML = `
      <div class="card">
        <h2>Incident Reports</h2>
        <p>Uncleared incident reports submitted by guards.</p>
        <div id="incident-management-content">Loading reports...</div>
      </div>
    `;

    const content = document.getElementById('incident-management-content');

    try {
      const result = await api('/incidents');
      const reports = result.reports || [];

      if (!reports.length) {
        content.innerHTML = '<p>No uncleared incident reports.</p>';
        return;
      }

      const groups = new Map();

      for (const report of reports) {
        const guardId = String(report.guard_id);

        if (!groups.has(guardId)) {
          groups.set(guardId, {
            guardId,
            name: report.full_name || 'Unknown Guard',
            code: report.employee_code || '',
            reports: []
          });
        }

        groups.get(guardId).reports.push(report);
      }

      const guardGroups = Array.from(groups.values());

      guardGroups.sort((a, b) => {
        const aDate = a.reports[0]?.submitted_at || '';
        const bDate = b.reports[0]?.submitted_at || '';
        return String(bDate).localeCompare(String(aDate));
      });

      content.innerHTML = guardGroups.map(group => `
        <div style="margin-top:1rem">
          <button type="button" class="btn"
            data-guard-toggle="${escapeHTML(group.guardId)}"
            style="width:100%;text-align:left">
            ${escapeHTML(group.name)}
            ${group.code ? ` (${escapeHTML(group.code)})` : ''}
            — ${group.reports.length} uncleared report(s)
          </button>

          <div id="incident-guard-panel-${escapeHTML(group.guardId)}"
            style="display:${selectedGuardId === group.guardId ? 'block' : 'none'};padding:1rem 0">

            ${group.reports.map(report => `
              <div class="card" style="margin-bottom:1rem;border:1px solid #ddd">
                <h3>Incident #${escapeHTML(report.id)}</h3>

                <p><strong>Incident Date:</strong>
                  ${escapeHTML(report.incident_date || '')}</p>

                <p><strong>Incident Time:</strong>
                  ${escapeHTML(report.incident_time || '')}</p>

                <p><strong>Location:</strong>
                  ${escapeHTML(report.location || '')}</p>

                <p><strong>Incident Type:</strong>
                  ${escapeHTML(report.incident_type || '')}</p>

                <p><strong>People Involved:</strong>
                  ${escapeHTML(report.people_involved || 'Not specified')}</p>

                <p><strong>What Happened:</strong></p>
                <p style="white-space:pre-wrap">${escapeHTML(report.description || '')}</p>

                <p><strong>Actions Taken:</strong></p>
                <p style="white-space:pre-wrap">${escapeHTML(report.actions_taken || 'Not specified')}</p>

                <p><strong>Witnesses:</strong></p>
                <p style="white-space:pre-wrap">${escapeHTML(report.witness || 'Not specified')}</p>

                <p><strong>Submitted:</strong>
                  ${escapeHTML(report.submitted_at || '')}</p>

                ${(report.attachments || []).length ? `
                  <div>
                    <strong>Attachments:</strong>
                    <ul>
                      ${report.attachments.map(attachment => `
                        <li>
                          <button type="button" class="btn"
                            data-incident-download="${escapeHTML(report.id)}"
                            data-attachment-id="${escapeHTML(attachment.id)}" data-attachment-name="${escapeHTML(attachment.file_name)}">
                            Download ${escapeHTML(attachment.file_name)}
                          </button>
                          <small>${escapeHTML(attachment.file_type || '')}</small>
                        </li>
                      `).join('')}
                    </ul>
                  </div>
                ` : '<p>No attachments.</p>'}

                <button type="button" class="btn"
                  data-clear-incident="${escapeHTML(report.id)}"
                  data-guard-id="${escapeHTML(group.guardId)}">
                  Clear Report
                </button>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('');

    } catch (error) {
      content.innerHTML = `
        <p>Could not load incident reports: ${escapeHTML(error.message)}</p>
        <button type="button" class="btn" id="incident-retry">Retry</button>
      `;

      document.getElementById('incident-retry').onclick = () => renderManagement(selectedGuardId);
    }
  }

  el.onclick = async (event) => {
    const toggleButton = event.target.closest('[data-guard-toggle]');

    if (toggleButton) {
      const guardId = toggleButton.dataset.guardToggle;
      const panel = document.getElementById(`incident-guard-panel-${guardId}`);

      if (panel) {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      }

      return;
    }

    const clearButton = event.target.closest('[data-clear-incident]');

    if (clearButton) {
      const incidentId = clearButton.dataset.clearIncident;
      const guardId = clearButton.dataset.guardId;

      if (!confirm('Clear this incident report? It will no longer appear in the uncleared reports list.')) {
        return;
      }

      clearButton.disabled = true;

      try {
        const result = await api(`/incidents/${incidentId}/clear`, {
          method: 'PUT'
        });

        alert(result.message || 'Incident report cleared.');
        await renderManagement(guardId);
      } catch (error) {
        alert(error.message);
        clearButton.disabled = false;
      }

      return;
    }

    const downloadButton = event.target.closest('[data-incident-download]');

    if (downloadButton) {
      const incidentId = downloadButton.dataset.incidentDownload;
      const attachmentId = downloadButton.dataset.attachmentId;
      const attachmentName = downloadButton.dataset.attachmentName;

      downloadButton.disabled = true;

      try {
        const response = await fetch(
          `${API}/incidents/${incidentId}/attachments/${attachmentId}`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
          }
        );

        if (!response.ok) {
          let errorMessage = 'Attachment download failed.';

          try {
            const data = await response.json();
            errorMessage = data.message || errorMessage;
          } catch (_) {}

          throw new Error(errorMessage);
        }

        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = objectUrl;
        link.download = attachmentName || 'incident-attachment';
        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

      } catch (error) {
        alert(error.message);
      } finally {
        downloadButton.disabled = false;
      }
    }
  };

  await renderManagement();
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
