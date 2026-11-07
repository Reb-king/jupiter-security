const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const realtime = require('../services/realtime');

const router = express.Router();

// Realtime attendance updates
router.get('/events', authenticate, (req, res) => {
  realtime.connect(req, res);
});

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
  let connection;
  let transactionStarted = false;

  try {
    const guardId = req.user.id;
    const { latitude, longitude, notes } = req.body;

    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    // Lock this guard's user row so simultaneous clock-in requests
    // for the same guard are processed one at a time.
    const [guardRows] = await connection.query(
      `SELECT id
       FROM users
       WHERE id = ?
       FOR UPDATE`,
      [guardId]
    );

    if (guardRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Guard account not found.'
      });
    }

    // Check for an existing open attendance record while holding the lock.
    const [open] = await connection.query(
      `SELECT id
       FROM attendance
       WHERE guard_id = ? AND clock_out_at IS NULL`,
      [guardId]
    );

    if (open.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'You are already clocked in. Please clock out first.'
      });
    }

    // Find the guard's active scheduled shift and assigned site.
    // Uses Namibia local time (UTC+2).
    const [shifts] = await connection.query(
      `SELECT
          ss.id AS scheduled_shift_id,
          ss.site_id,
          ss.shift_type,
          s.latitude AS site_lat,
          s.longitude AS site_lng,
          s.geo_radius_m,
          s.name AS site_name
       FROM scheduled_shifts ss
       JOIN sites s ON s.id = ss.site_id
       JOIN users u ON u.id = ss.guard_id
       WHERE ss.guard_id = ?
         AND ss.shift_type IN ('day', 'night')
         AND ss.status = 'scheduled'
         AND u.is_active = 1
         AND u.role = 'guard'
         AND s.status = 'approved'
         AND CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+02:00') >= ss.start_time
         AND CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+02:00') < ss.end_time
       ORDER BY ss.start_time DESC
       LIMIT 1`,
      [guardId]
    );

    if (shifts.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No active scheduled shift found for today.'
      });
    }

    const site = shifts[0];
    const scheduledShiftId = site.scheduled_shift_id;

    let withinGeofence = null;

    if (
      latitude != null &&
      longitude != null &&
      site.site_lat != null &&
      site.site_lng != null
    ) {
      const dist = distanceMetres(
        latitude,
        longitude,
        site.site_lat,
        site.site_lng
      );

      withinGeofence = dist <= (site.geo_radius_m || 150) ? 1 : 0;
    }

    // Record attendance against the scheduled shift's site.
    const [result] = await connection.query(
      `INSERT INTO attendance
       (guard_id, site_id, scheduled_shift_id, clock_in_at,
        clock_in_lat, clock_in_lng, clock_in_within_geofence, notes)
       VALUES (?, ?, ?, UTC_TIMESTAMP(), ?, ?, ?, ?)`,
      [
        guardId,
        site.site_id,
        scheduledShiftId,
        latitude ?? null,
        longitude ?? null,
        withinGeofence,
        notes || null
      ]
    );

    // Update live location when coordinates are available.
    if (latitude != null && longitude != null) {
      await connection.query(
        `INSERT INTO guard_locations
         (guard_id, latitude, longitude, recorded_at)
         VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
         latitude = VALUES(latitude),
         longitude = VALUES(longitude),
         recorded_at = NOW()`,
        [guardId, latitude, longitude]
      );
    }

    await connection.commit();
    transactionStarted = false;

    // Notify authorized connected users about Clock In.
    realtime.publishAttendanceChange({
      action: 'clock-in',
      status: 'clocked_in',
      guard_id: guardId,
      attendance_id: result.insertId
    });

    res.status(201).json({
      success: true,
      message: 'Clocked in successfully.',
      data: {
        attendance_id: result.insertId,
        site_name: site.site_name,
        within_geofence: withinGeofence === null ? null : withinGeofence === 1,
        clock_in_at: new Date().toISOString()
      }
    });

  } catch (err) {
    console.error('Clock-in error:', err);
    res.status(500).json({
      success: false,
      message: 'Clock-in failed.'
    });
  } finally {
    if (connection) {
      if (transactionStarted) {
        await connection.rollback().catch(err => {
          console.error('Clock-in rollback error:', err);
        });
      }

      connection.release();
    }
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

    // Calculate hours worked using UTC timestamps
const clockIn = new Date(
  String(record.clock_in_at).replace(' ', 'T') + 'Z'
);

const clockOut = new Date();

if (Number.isNaN(clockIn.getTime())) {
  throw new Error('Invalid clock-in timestamp.');
}

const hoursWorked = Math.round(
  ((clockOut.getTime() - clockIn.getTime()) / 3600000) * 100
) / 100;

    await pool.query(
      `UPDATE attendance SET
         clock_out_at = UTC_TIMESTAMP(),
         clock_out_lat = ?,
         clock_out_lng = ?,
         clock_out_within_geofence = ?,
         hours_worked = ?,
         notes = CONCAT(IFNULL(notes,''), IFNULL(?, ''))
       WHERE id = ?`,
      [latitude || null, longitude || null, withinGeofence, hoursWorked, notes ? ' | ' + notes : null, record.id]
    );

   // Mark scheduled shift as completed only after its scheduled end time
if (record.scheduled_shift_id) {
  await pool.query(
    `UPDATE scheduled_shifts
     SET status = 'completed'
     WHERE id = ?
       AND end_time <= CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+02:00')`,
    [record.scheduled_shift_id]
  );
}

       // Remove live location after Clock Out.
    // Historical GPS records remain untouched.
    await pool.query(
      `DELETE FROM guard_locations
       WHERE guard_id = ?`,
      [guardId]
    );
        // Notify all authorized connected users about Clock Out.
    realtime.publishAttendanceChange({
      action: 'clock-out',
      status: 'clocked_out',
      guard_id: guardId,
      attendance_id: record.id
    });

    res.json({
      success: true,
      message: 'Clocked out successfully.',
      data: {
        hours_worked: hoursWorked,
        within_geofence: withinGeofence === null ? null : withinGeofence === 1,
        clock_out_at: clockOut.toISOString()
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Clock-out failed.' });
  }
});

// GET current clock status (guard)
router.get('/status', authenticate, async (req, res) => {
  try {
    const guardId = req.user.id;

    const [rows] = await pool.query(
      `SELECT
         a.id AS attendance_id,
         a.site_id,
         a.clock_in_at,
         a.clock_in_within_geofence,
         s.name AS site_name
       FROM attendance a
       LEFT JOIN sites s ON s.id = a.site_id
       WHERE a.guard_id = ?
         AND a.clock_out_at IS NULL
       ORDER BY a.clock_in_at DESC
       LIMIT 1`,
      [guardId]
    );

    res.json({
      success: true,
      data: {
        clocked_in: rows.length > 0,
        attendance: rows[0] || null
      }
    });
  } catch (err) {
    console.error('Clock status error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to check clock status.'
    });
  }
});
// GET my attendance history (guard)
router.get('/my', authenticate, async (req, res) => {
  try {
    const guardId = req.user.id;

    const [offRows] = await pool.query(
      `SELECT id, end_time
       FROM scheduled_shifts
       WHERE guard_id = ?
         AND shift_type = 'off'
         AND end_time <= CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+02:00')
       ORDER BY end_time DESC, id DESC
       LIMIT 1`,
      [guardId]
    );

    const latestOff = offRows[0] || null;

    const [visibilityRows] = await pool.query(
      `SELECT last_off_shift_id, visible_from
       FROM guard_attendance_visibility
       WHERE guard_id = ?`,
      [guardId]
    );

    if (visibilityRows.length === 0) {
      await pool.query(
        `INSERT INTO guard_attendance_visibility
           (guard_id, last_off_shift_id, visible_from)
         VALUES (?, ?, ?)`,
        [
          guardId,
          latestOff ? latestOff.id : null,
          latestOff ? latestOff.end_time : '1000-01-01 00:00:00'
        ]
      );
    } else if (
      latestOff &&
      Number(visibilityRows[0].last_off_shift_id) !== Number(latestOff.id)
    ) {
      await pool.query(
        `UPDATE guard_attendance_visibility
         SET last_off_shift_id = ?, visible_from = ?
         WHERE guard_id = ?`,
        [latestOff.id, latestOff.end_time, guardId]
      );
    }

    const [rows] = await pool.query(
      `SELECT a.*, s.name AS site_name, s.site_code
       FROM attendance a
       JOIN sites s ON s.id = a.site_id
       WHERE a.guard_id = ?
         AND a.clock_in_at >= GREATEST(
           (SELECT management_visible_from
            FROM attendance_visibility_settings
            WHERE id = 1),
           (SELECT visible_from
            FROM guard_attendance_visibility
            WHERE guard_id = ?)
         )
       ORDER BY a.clock_in_at DESC
       LIMIT 50`,
      [guardId, guardId]
    );

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('My attendance visibility error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch attendance.' });
  }
});

router.post('/clear', authenticate, authorize('admin', 'manager'), async (req, res) => {
  let connection;
  let transactionStarted = false;

  try {
    const { date } = req.body;

    // Validate the selected date.
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid date in YYYY-MM-DD format.'
      });
    }

    const [year, month, day] = date.split('-').map(Number);
    const parsedDate = new Date(Date.UTC(year, month - 1, day));

    if (
      parsedDate.getUTCFullYear() !== year ||
      parsedDate.getUTCMonth() !== month - 1 ||
      parsedDate.getUTCDate() !== day
    ) {
      return res.status(400).json({
        success: false,
        message: 'The selected date is invalid.'
      });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    // Find guards still clocked in whose scheduled shifts have ended.
    // Scheduled shift times use Namibia time (UTC+02:00).
    // Attendance timestamps are stored in UTC.
    const [overdueRows] = await connection.query(
      `SELECT
          a.id AS attendance_id,
          a.guard_id,
          a.clock_in_at,
          a.scheduled_shift_id,
          ss.end_time
       FROM attendance a
       INNER JOIN scheduled_shifts ss
         ON ss.id = a.scheduled_shift_id
       WHERE a.clock_out_at IS NULL
         AND ss.shift_type IN ('day', 'night')
         AND ss.status <> 'cancelled'
         AND ss.end_time <= CONVERT_TZ(
           UTC_TIMESTAMP(), '+00:00', '+02:00'
         )
         AND CONVERT_TZ(
           ss.end_time, '+02:00', '+00:00'
         ) > a.clock_in_at
       ORDER BY ss.end_time ASC
       FOR UPDATE`
    );

    const clockedOutGuards = new Set();

    for (const record of overdueRows) {
      // Use the scheduled finishing time, converted to UTC.
      const [updateResult] = await connection.query(
        `UPDATE attendance
         SET
           clock_out_at = CONVERT_TZ(?, '+02:00', '+00:00'),
           clock_out_lat = NULL,
           clock_out_lng = NULL,
           clock_out_within_geofence = NULL,
           hours_worked = ROUND(
             TIMESTAMPDIFF(
               SECOND,
               clock_in_at,
               CONVERT_TZ(?, '+02:00', '+00:00')
             ) / 3600,
             2
           ),
           notes = LEFT(
             CONCAT(
               IFNULL(notes, ''),
               IF(IFNULL(notes, '') = '', '', ' | '),
               'Automatically clocked out during attendance clearing.'
             ),
             255
           )
         WHERE id = ?
           AND clock_out_at IS NULL`,
        [
          record.end_time,
          record.end_time,
          record.attendance_id
        ]
      );

      if (updateResult.affectedRows === 0) {
        continue;
      }

      // Complete the corresponding scheduled shift.
      await connection.query(
        `UPDATE scheduled_shifts
         SET status = 'completed'
         WHERE id = ?
           AND status <> 'cancelled'`,
        [record.scheduled_shift_id]
      );

      // Remove live location, preserving historical GPS records.
      clockedOutGuards.add(record.guard_id);
    }

    for (const guardId of clockedOutGuards) {
      await connection.query(
        `DELETE FROM guard_locations
         WHERE guard_id = ?`,
        [guardId]
      );
    }

    // Apply attendance visibility date.
    // The selected date itself remains visible.
    await connection.query(
      `INSERT INTO attendance_visibility_settings
         (id, management_visible_from)
       VALUES (1, ?)
       ON DUPLICATE KEY UPDATE
         management_visible_from = VALUES(management_visible_from)`,
      [`${date} 00:00:00`]
    );

    await connection.commit();
    transactionStarted = false;

    // Notify connected management users after successful commit.
    for (const record of overdueRows) {
      if (!clockedOutGuards.has(record.guard_id)) {
        continue;
      }

      realtime.publishAttendanceChange({
        action: 'clock-out',
        status: 'clocked_out',
        guard_id: record.guard_id,
        attendance_id: record.attendance_id
      });
    }

    res.json({
      success: true,
      message:
        `Attendance records before ${date} are now hidden. ` +
        `${overdueRows.length} overdue attendance record(s) checked; ` +
        `${clockedOutGuards.size} guard(s) automatically clocked out. ` +
        'No attendance records were deleted.',
      visible_from: date,
      automatically_clocked_out: overdueRows.length,
      guards_clocked_out: clockedOutGuards.size
    });

  } catch (err) {
    if (connection && transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Attendance rollback failed:', rollbackError);
      }
    }

    console.error('Clear attendance visibility error:', err);

    res.status(500).json({
      success: false,
      message: 'Failed to update attendance visibility and clock out overdue guards.'
    });

  } finally {
    if (connection) {
      connection.release();
    }
  }
});
router.get('/', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { from, to, guard_id } = req.query;

    let sql = `
      SELECT a.*, u.full_name AS guard_name, u.employee_code, s.name AS site_name
      FROM attendance a
      JOIN users u ON u.id = a.guard_id
      JOIN sites s ON s.id = a.site_id
      WHERE a.clock_in_at >= (
        SELECT management_visible_from
        FROM attendance_visibility_settings
        WHERE id = 1
      )
    `;

    const params = [];

    if (guard_id) {
      sql += ' AND a.guard_id = ?';
      params.push(guard_id);
    }

    if (from) {
      sql += ' AND DATE(a.clock_in_at) >= ?';
      params.push(from);
    }

    if (to) {
      sql += ' AND DATE(a.clock_in_at) <= ?';
      params.push(to);
    }

    sql += ' ORDER BY a.clock_in_at DESC LIMIT 200';

    const [rows] = await pool.query(sql, params);
    const [visibilityRows] = await pool.query(
  `SELECT DATE_FORMAT(management_visible_from, '%Y-%m-%d') AS visible_from
   FROM attendance_visibility_settings
   WHERE id = 1`
);

res.json({
  success: true,
  data: rows,
  visible_from: visibilityRows[0]?.visible_from || '1000-01-01'
});
  } catch (err) {
    console.error('Management attendance visibility error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch attendance.' });
  }
});
module.exports = router;

