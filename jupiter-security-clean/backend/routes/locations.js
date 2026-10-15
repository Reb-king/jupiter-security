const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// POST update my live location (called periodically by guard app)
router.post('/update', authenticate, async (req, res) => {
  try {
    const { latitude, longitude, accuracy_m } = req.body;
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ success: false, message: 'latitude and longitude required.' });
    }

    await pool.query(
      `INSERT INTO guard_locations (guard_id, latitude, longitude, accuracy_m, recorded_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         latitude = VALUES(latitude),
         longitude = VALUES(longitude),
         accuracy_m = VALUES(accuracy_m),
         recorded_at = NOW()`,
      [req.user.id, latitude, longitude, accuracy_m || null]
    );

    res.json({ success: true, message: 'Location updated.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update location.' });
  }
});

// GET all live locations (management only)
router.get('/live', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT gl.guard_id, gl.latitude, gl.longitude, gl.accuracy_m, gl.recorded_at,
             u.employee_code, u.full_name,
             s.name AS site_name, s.site_code, s.latitude AS site_lat, s.longitude AS site_lng,
             a.clock_in_at, a.clock_out_at,
             CASE WHEN a.id IS NOT NULL AND a.clock_out_at IS NULL THEN 1 ELSE 0 END AS is_on_duty
      FROM guard_locations gl
      JOIN users u ON u.id = gl.guard_id
      LEFT JOIN guard_site_assignments gsa ON gsa.guard_id = u.id AND gsa.is_current = 1
      LEFT JOIN sites s ON s.id = gsa.site_id
      LEFT JOIN attendance a ON a.guard_id = u.id AND a.clock_out_at IS NULL
      WHERE u.role = 'guard' AND u.is_active = 1
      ORDER BY gl.recorded_at DESC
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch live locations.' });
  }
});

module.exports = router;