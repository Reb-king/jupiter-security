
const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// POST update my live location and save GPS history during active attendance
router.post('/update', authenticate, async (req, res) => {
  let connection;

  try {
    const { latitude, longitude, accuracy_m } = req.body;
    const guardId = req.user.id;

    const lat = Number(latitude);
    const lng = Number(longitude);
    const accuracy = accuracy_m === undefined || accuracy_m === null
      ? null
      : Number(accuracy_m);

    if (
      latitude === undefined ||
      longitude === undefined ||
      latitude === null ||
      longitude === null ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return res.status(400).json({
        success: false,
        message: 'Valid latitude and longitude are required.'
      });
    }

    if (
      accuracy !== null &&
      (!Number.isFinite(accuracy) || accuracy < 0)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid GPS accuracy.'
      });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Find the guard's currently open attendance record.
    const [attendanceRows] = await connection.query(
      `SELECT id
       FROM attendance
       WHERE guard_id = ?
         AND clock_out_at IS NULL
       ORDER BY clock_in_at DESC
       LIMIT 1
       FOR UPDATE`,
      [guardId]
    );

        // Do not record or update GPS when the guard is off duty.
    if (attendanceRows.length === 0) {
      await connection.commit();

      return res.json({
        success: true,
        message: 'Location not recorded because you are not clocked in.',
        tracking_active: false,
        history_saved: false
      });
    }

    // Always maintain the existing latest live-location record.
    await connection.query(
      `INSERT INTO guard_locations
         (guard_id, latitude, longitude, accuracy_m, recorded_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         latitude = VALUES(latitude),
         longitude = VALUES(longitude),
         accuracy_m = VALUES(accuracy_m),
         recorded_at = NOW()`,
      [guardId, lat, lng, accuracy]
    );

    let historySaved = false;

    // Save history only when an active attendance record exists.
    if (attendanceRows.length > 0) {
      await connection.query(
        `INSERT INTO guard_location_history
           (guard_id, attendance_id, latitude, longitude, accuracy_m, recorded_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [
          guardId,
          attendanceRows[0].id,
          lat,
          lng,
          accuracy
        ]
      );

      historySaved = true;
    }

    await connection.commit();

    return res.json({
      success: true,
      message: 'Location updated.',
      history_saved: historySaved
    });

  } catch (err) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('GPS transaction rollback failed:', rollbackError);
      }
    }

    console.error('GPS location update failed:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to update location.'
    });

  } finally {
    if (connection) connection.release();
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
           JOIN attendance a ON a.guard_id = u.id AND a.clock_out_at IS NULL
      WHERE u.role = 'guard' AND u.is_active = 1
      ORDER BY gl.recorded_at DESC
    `);

    res.json({ success: true, data: rows });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      success: false,
      message: 'Failed to fetch live locations.'
    });
  }
});

module.exports = router;
