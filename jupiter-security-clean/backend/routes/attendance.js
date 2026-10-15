const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Haversine formula – distance in metres
function distanceMetres(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// POST Clock In
router.post('/clock-in', authenticate, async (req, res) => {
  try {
    const guardId = req.user.id;
    const { latitude, longitude, notes } = req.body;

    // Check if already clocked in (no clock-out yet)
    const [open] = await pool.query(
      `SELECT id FROM attendance WHERE guard_id = ? AND clock_out_at IS NULL`,
      [guardId]
    );
    if (open.length > 0) {
      return res.status(400).json({ success: false, message: 'You are already clocked in. Please clock out first.' });
    }

    // Get current site assignment
    const [assign] = await pool.query(
      `SELECT a.site_id, s.latitude AS site_lat, s.longitude AS site_lng, s.geo_radius_m, s.name AS site_name
       FROM guard_site_assignments a
       JOIN sites s ON s.id = a.site_id
       WHERE a.guard_id = ? AND a.is_current = 1 AND s.status = 'approved'
       LIMIT 1`,
      [guardId]
    );

    if (assign.length === 0) {
      return res.status(400).json({ success: false, message: 'No active site assignment found.' });
    }

    const site = assign[0];
    let withinGeofence = null;

    if (latitude && longitude && site.site_lat && site.site_lng) {
      const dist = distanceMetres(latitude, longitude, site.site_lat, site.site_lng);
      withinGeofence = dist <= (site.geo_radius_m || 150) ? 1 : 0;
    }

    // Find matching scheduled shift for today
    const today = new Date().toISOString().slice(0, 10);
    const [shifts] = await pool.query(
      `SELECT id FROM scheduled_shifts
       WHERE guard_id = ? AND shift_date = ? AND shift_type != 'off' AND status = 'scheduled'
       LIMIT 1`,
      [guardId, today]
    );
    const scheduledShiftId = shifts.length ? shifts[0].id : null;

    const [result] = await pool.query(
      `INSERT INTO attendance
       (guard_id, site_id, scheduled_shift_id, clock_in_at, clock_in_lat, clock_in_lng, clock_in_within_geofence, notes)
       VALUES (?, ?, ?, NOW(), ?, ?, ?, ?)`,
      [guardId, site.site_id, scheduledShiftId, latitude || null, longitude || null, withinGeofence, notes || null]
    );

    // Update live location
    if (latitude && longitude) {
      await pool.query(
        `INSERT INTO guard_locations (guard_id, latitude, longitude, recorded_at)
         VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE latitude = VALUES(latitude), longitude = VALUES(longitude), recorded_at = NOW()`,
        [guardId, latitude, longitude]
      );
    }

    res.status(201).json({
      success: true,
      message: 'Clocked in successfully.',
      data: {
        attendance_id: result.insertId,
        site_name: site.site_name,
        within_geofence: withinGeofence === 1,
        clock_in_at: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Clock-in failed.' });
  }
});

// POST Clock Out
router.post('/clock-out', authenticate, async (req, res) => {
  try {
    const guardId = req.user.id;
    const { latitude, longitude, notes } = req.body;

    const [open] = await pool.query(
      `SELECT a.*, s.latitude AS site_lat, s.longitude AS site_lng, s.geo_radius_m
       FROM attendance a
       JOIN sites s ON s.id = a.site_id
       WHERE a.guard_id = ? AND a.clock_out_at IS NULL
       ORDER BY a.clock_in_at DESC LIMIT 1`,
      [guardId]
    );

    if (open.length === 0) {
      return res.status(400).json({ success: false, message: 'You are not currently clocked in.' });
    }

    const record = open[0];
    let withinGeofence = null;

    if (latitude && longitude && record.site_lat && record.site_lng) {
      const dist = distanceMetres(latitude, longitude, record.site_lat, record.site_lng);
      withinGeofence = dist <= (record.geo_radius_m || 150) ? 1 : 0;
    }

    // Calculate hours worked
    const clockIn = new Date(record.clock_in_at);
    const clockOut = new Date();
    const hoursWorked = Math.round(((clockOut - clockIn) / 3600000) * 100) / 100;

    await pool.query(
      `UPDATE attendance SET
         clock_out_at = NOW(),
         clock_out_lat = ?,
         clock_out_lng = ?,
         clock_out_within_geofence = ?,
         hours_worked = ?,
         notes = CONCAT(IFNULL(notes,''), IFNULL(?, ''))
       WHERE id = ?`,
      [latitude || null, longitude || null, withinGeofence, hoursWorked, notes ? ' | ' + notes : null, record.id]
    );

    // Mark scheduled shift as completed if linked
    if (record.scheduled_shift_id) {
      await pool.query(
        `UPDATE scheduled_shifts SET status = 'completed' WHERE id = ?`,
        [record.scheduled_shift_id]
      );
    }

    // Update live location
    if (latitude && longitude) {
      await pool.query(
        `INSERT INTO guard_locations (guard_id, latitude, longitude, recorded_at)
         VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE latitude = VALUES(latitude), longitude = VALUES(longitude), recorded_at = NOW()`,
        [guardId, latitude, longitude]
      );
    }

    res.json({
      success: true,
      message: 'Clocked out successfully.',
      data: {
        hours_worked: hoursWorked,
        within_geofence: withinGeofence === 1,
        clock_out_at: clockOut.toISOString()
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Clock-out failed.' });
  }
});

// GET my attendance history (guard)
router.get('/my', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT a.*, s.name AS site_name, s.site_code
       FROM attendance a
       JOIN sites s ON s.id = a.site_id
       WHERE a.guard_id = ?
       ORDER BY a.clock_in_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch attendance.' });
  }
});

// GET all attendance (management)
router.get('/', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { from, to, guard_id } = req.query;
    let sql = `
      SELECT a.*, u.full_name AS guard_name, u.employee_code, s.name AS site_name
      FROM attendance a
      JOIN users u ON u.id = a.guard_id
      JOIN sites s ON s.id = a.site_id
      WHERE 1=1
    `;
    const params = [];
    if (guard_id) { sql += ' AND a.guard_id = ?'; params.push(guard_id); }
    if (from) { sql += ' AND DATE(a.clock_in_at) >= ?'; params.push(from); }
    if (to)   { sql += ' AND DATE(a.clock_in_at) <= ?'; params.push(to); }
    sql += ' ORDER BY a.clock_in_at DESC LIMIT 200';

    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch attendance.' });
  }
});

module.exports = router;