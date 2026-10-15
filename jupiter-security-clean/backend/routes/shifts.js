const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

/**
 * Generate the 7 Day → 7 Night → 1 Off pattern
 * Day: 06:00 – 18:00
 * Night: 18:00 – 06:00 (next day)
 */
function generateShiftTimes(shiftDate, shiftType) {
  // shiftDate is a Date object or 'YYYY-MM-DD' string
  const dateStr = typeof shiftDate === 'string' ? shiftDate : shiftDate.toISOString().slice(0, 10);

  if (shiftType === 'day') {
    return {
      start_time: `${dateStr} 06:00:00`,
      end_time:   `${dateStr} 18:00:00`
    };
  }
  if (shiftType === 'night') {
    // Night ends next calendar day at 06:00
    const nextDay = new Date(dateStr);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextStr = nextDay.toISOString().slice(0, 10);
    return {
      start_time: `${dateStr} 18:00:00`,
      end_time:   `${nextStr} 06:00:00`
    };
  }
  // off
  return {
    start_time: `${dateStr} 00:00:00`,
    end_time:   `${dateStr} 23:59:59`
  };
}

/**
 * Build a 15-day cycle starting from cycleStartDate
 * Days 1-7  : Day shifts
 * Days 8-14 : Night shifts
 * Day 15    : Off
 */
function buildCycleShifts(cycleStartDate, guardId, siteId) {
  const shifts = [];
  const start = new Date(cycleStartDate);

  for (let i = 0; i < 15; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);

    let shiftType;
    if (i < 7) shiftType = 'day';
    else if (i < 14) shiftType = 'night';
    else shiftType = 'off';

    const times = generateShiftTimes(dateStr, shiftType);
    shifts.push({
      guard_id: guardId,
      site_id: siteId,
      shift_date: dateStr,
      shift_type: shiftType,
      start_time: times.start_time,
      end_time: times.end_time
    });
  }
  return shifts;
}

// POST generate shifts for a guard (one or more cycles)
router.post('/generate', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { guard_id, site_id, cycle_start_date, number_of_cycles = 1 } = req.body;

    if (!guard_id || !site_id || !cycle_start_date) {
      return res.status(400).json({
        success: false,
        message: 'guard_id, site_id and cycle_start_date are required.'
      });
    }

    const allShifts = [];
    let currentStart = new Date(cycle_start_date);

    for (let c = 0; c < number_of_cycles; c++) {
      const cycleShifts = buildCycleShifts(currentStart, guard_id, site_id);
      allShifts.push(...cycleShifts);

      // Record the cycle
      await pool.query(
        'INSERT INTO shift_cycles (guard_id, cycle_start_date) VALUES (?, ?)',
        [guard_id, currentStart.toISOString().slice(0, 10)]
      );

      // Next cycle starts 15 days later
      currentStart.setDate(currentStart.getDate() + 15);
    }

    // Insert shifts (ignore duplicates)
    for (const s of allShifts) {
      await pool.query(
        `INSERT IGNORE INTO scheduled_shifts
         (guard_id, site_id, shift_date, shift_type, start_time, end_time)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [s.guard_id, s.site_id, s.shift_date, s.shift_type, s.start_time, s.end_time]
      );
    }

    res.status(201).json({
      success: true,
      message: `Generated ${allShifts.length} shifts (${number_of_cycles} cycle(s)).`,
      data: { total_shifts: allShifts.length }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to generate shifts.' });
  }
});

// GET shifts for a guard (or all for managers)
router.get('/', authenticate, async (req, res) => {
  try {
    const { guard_id, from, to } = req.query;
    let sql = `
      SELECT ss.*, u.full_name AS guard_name, u.employee_code,
             s.name AS site_name, s.site_code
      FROM scheduled_shifts ss
      JOIN users u ON u.id = ss.guard_id
      JOIN sites s ON s.id = ss.site_id
      WHERE 1=1
    `;
    const params = [];

    if (req.user.role === 'guard') {
      sql += ' AND ss.guard_id = ?';
      params.push(req.user.id);
    } else if (guard_id) {
      sql += ' AND ss.guard_id = ?';
      params.push(guard_id);
    }

    if (from) { sql += ' AND ss.shift_date >= ?'; params.push(from); }
    if (to)   { sql += ' AND ss.shift_date <= ?'; params.push(to); }

    sql += ' ORDER BY ss.shift_date, ss.start_time';

    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch shifts.' });
  }
});

// GET today's shift for logged-in guard
router.get('/today', authenticate, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [rows] = await pool.query(
      `SELECT ss.*, s.name AS site_name, s.site_code, s.latitude, s.longitude, s.geo_radius_m
       FROM scheduled_shifts ss
       JOIN sites s ON s.id = ss.site_id
       WHERE ss.guard_id = ? AND ss.shift_date = ? AND ss.shift_type != 'off'
       LIMIT 1`,
      [req.user.id, today]
    );
    res.json({ success: true, data: rows[0] || null });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;