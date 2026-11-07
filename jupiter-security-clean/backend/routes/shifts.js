const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');
const { publishShiftChange } = require('../services/realtime');

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
    const nextDay = new Date(`${dateStr}T00:00:00.000Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const nextStr = nextDay.toISOString().slice(0, 10);
    return {
      start_time: `${dateStr} 18:00:00`,
      end_time:   `${nextStr} 06:00:00`
    };
  }
  // Off begins when the final night shift ends at 06:00.
  const nextDay = new Date(`${dateStr}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const nextStr = nextDay.toISOString().slice(0, 10);

  return {
    start_time: `${dateStr} 06:00:00`,
    end_time:   `${nextStr} 06:00:00`
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
  let connection;
  let transactionStarted = false;

  try {
    const {
      guard_id,
      site_id,
      cycle_start_date,
      number_of_cycles = 1
    } = req.body;

    const guardId = Number(guard_id);
    const siteId = Number(site_id);
    const cycleCount = Number(number_of_cycles);
    const startDate = String(cycle_start_date || '');

    if (!Number.isSafeInteger(guardId) || guardId < 1 ||
        !Number.isSafeInteger(siteId) || siteId < 1) {
      return res.status(400).json({
        success: false,
        message: 'A valid guard and site are required.'
      });
    }

    if (!Number.isInteger(cycleCount) ||
        cycleCount < 1 || cycleCount > 12) {
      return res.status(400).json({
        success: false,
        message: 'number_of_cycles must be an integer between 1 and 12.'
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
        Number.isNaN(Date.parse(`${startDate}T00:00:00.000Z`)) ||
        new Date(`${startDate}T00:00:00.000Z`)
          .toISOString().slice(0, 10) !== startDate) {
      return res.status(400).json({
        success: false,
        message: 'cycle_start_date must be a valid YYYY-MM-DD date.'
      });
    }

    const cycleStarts = [];

    for (let c = 0; c < cycleCount; c++) {
      const date = new Date(`${startDate}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + (15 * c));
      cycleStarts.push(date.toISOString().slice(0, 10));
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    // Lock the guard row so concurrent generation requests for this guard
    // cannot both pass the cycle checks at the same time.
    const [guards] = await connection.query(
      `SELECT id
       FROM users
       WHERE id = ? AND role = 'guard' AND is_active = 1
       FOR UPDATE`,
      [guardId]
    );

    if (guards.length === 0) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(400).json({
        success: false,
        message: 'Guard not found or inactive.'
      });
    }

    const [sites] = await connection.query(
      `SELECT id
       FROM sites
       WHERE id = ? AND status = 'approved'
       FOR UPDATE`,
      [siteId]
    );

    if (sites.length === 0) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({
        success: false,
        message: 'Shifts can only be generated for an approved site.'
      });
    }

    const allShifts = [];

    for (const cycleDate of cycleStarts) {
      // A cycle occupies its start date and the following 14 dates.
      // Reject any existing cycle whose 15-day period would overlap it.
      const [existingCycles] = await connection.query(
        `SELECT id, cycle_start_date
         FROM shift_cycles
         WHERE guard_id = ?
           AND cancelled_at IS NULL
           AND cycle_start_date BETWEEN
               DATE_SUB(?, INTERVAL 14 DAY)
               AND DATE_ADD(?, INTERVAL 14 DAY)
         FOR UPDATE`,
        [guardId, cycleDate, cycleDate]
      );

      if (existingCycles.length > 0) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(409).json({
          success: false,
          message: `Cycle starting ${cycleDate} overlaps an existing recorded cycle. No shifts were generated.`
        });
      }

      const cycleShifts = buildCycleShifts(
        new Date(`${cycleDate}T00:00:00.000Z`),
        guardId,
        siteId
      );

      const lastDate = cycleShifts[cycleShifts.length - 1].shift_date;

      // Do not silently skip existing shifts, including shifts at another site
      // or shifts of a different type on the same date.
      const [existingShifts] = await connection.query(
        `SELECT id, shift_date, shift_type, site_id
         FROM scheduled_shifts
         WHERE guard_id = ?
           AND shift_date BETWEEN ? AND ?
         FOR UPDATE`,
        [guardId, cycleDate, lastDate]
      );

      if (existingShifts.length > 0) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(409).json({
          success: false,
          message: `Existing shifts conflict with the proposed cycle starting ${cycleDate}. No changes were saved.`
        });
      }

      allShifts.push(...cycleShifts);
    }

    // Save the cycle records and shifts together. Any failure rolls back both.
    for (const cycleDate of cycleStarts) {
      await connection.query(
        `INSERT INTO shift_cycles (guard_id, cycle_start_date)
         VALUES (?, ?)`,
        [guardId, cycleDate]
      );
    }

    let insertedCount = 0;

    for (const shift of allShifts) {
      const [result] = await connection.query(
        `INSERT INTO scheduled_shifts
         (guard_id, site_id, shift_date, shift_type, start_time, end_time)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          shift.guard_id,
          shift.site_id,
          shift.shift_date,
          shift.shift_type,
          shift.start_time,
          shift.end_time
        ]
      );

      insertedCount += result.affectedRows;
    }

    await connection.commit();
    transactionStarted = false;

    publishShiftChange({
      guard_id: guardId,
      action: 'generated',
      total_shifts: insertedCount
    });

    return res.status(201).json({
      success: true,
      message: `Generated ${insertedCount} shifts (${cycleCount} cycle(s)).`,
      data: {
        total_shifts: insertedCount,
        number_of_cycles: cycleCount
      }
    });
  } catch (err) {
    if (connection && transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Shift generation rollback failed:', rollbackError);
      }
      transactionStarted = false;
    }

    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: 'A conflicting cycle or shift already exists. No changes were saved.'
      });
    }

    console.error('Shift generation failed:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to generate shifts.'
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// POST manually assign one Day or Night shift
router.post('/manual', authenticate, authorize('admin', 'manager'), async (req, res) => {
  let connection;
  let transactionStarted = false;

  try {
    const guardId = Number(req.body.guard_id);
    const siteId = Number(req.body.site_id);
    const shiftDate = String(req.body.shift_date || '');
    const shiftType = String(req.body.shift_type || '').trim().toLowerCase();

    if (!Number.isSafeInteger(guardId) || guardId < 1 ||
        !Number.isSafeInteger(siteId) || siteId < 1) {
      return res.status(400).json({
        success: false,
        message: 'Please select a valid guard and site.'
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(shiftDate) ||
        Number.isNaN(Date.parse(`${shiftDate}T00:00:00.000Z`)) ||
        new Date(`${shiftDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== shiftDate) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid shift date.'
      });
    }

    if (!['day', 'night'].includes(shiftType)) {
      return res.status(400).json({
        success: false,
        message: 'Manual assignments must be Day or Night shifts.'
      });
    }

    const times = generateShiftTimes(shiftDate, shiftType);

    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    // Lock the guard row to prevent simultaneous shift assignments.
    const [guards] = await connection.query(
      `SELECT id
       FROM users
       WHERE id = ? AND role = 'guard' AND is_active = 1
       FOR UPDATE`,
      [guardId]
    );

    if (guards.length === 0) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({
        success: false,
        message: 'Guard not found or inactive. No assignment was saved.'
      });
    }

    // Only approved sites may receive new assignments.
    const [sites] = await connection.query(
      `SELECT id
       FROM sites
       WHERE id = ? AND status = 'approved'
       FOR UPDATE`,
      [siteId]
    );

    if (sites.length === 0) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({
        success: false,
        message: 'The selected site is not approved. No assignment was saved.'
      });
    }

    // Protect every existing record, including Off and cancelled shifts.
    const [existingShifts] = await connection.query(
      `SELECT id, shift_type, status
       FROM scheduled_shifts
       WHERE guard_id = ? AND shift_date = ?
       LIMIT 1
       FOR UPDATE`,
      [guardId, shiftDate]
    );

    if (existingShifts.length > 0) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({
        success: false,
        message: `This guard already has a ${existingShifts[0].shift_type} shift record on ${shiftDate}. No changes were made.`
      });
    }

    const [result] = await connection.query(
      `INSERT INTO scheduled_shifts
       (guard_id, site_id, shift_date, shift_type,
        start_time, end_time, status, shift_source)
       VALUES (?, ?, ?, ?, ?, ?, 'scheduled', 'manual')`,
      [
        guardId,
        siteId,
        shiftDate,
        shiftType,
        times.start_time,
        times.end_time
      ]
    );

    await connection.commit();
    transactionStarted = false;

    publishShiftChange({
      guard_id: guardId,
      action: 'manual',
      total_shifts: 1
    });

    return res.status(201).json({
      success: true,
      message: 'Manual shift assigned successfully.',
      data: {
        id: result.insertId,
        guard_id: guardId,
        site_id: siteId,
        shift_date: shiftDate,
        shift_type: shiftType,
        start_time: times.start_time,
        end_time: times.end_time,
        status: 'scheduled',
        shift_source: 'manual'
      }
    });

  } catch (err) {
    if (connection && transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Manual shift rollback failed:', rollbackError);
      }
    }

    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: 'A conflicting shift already exists. No changes were saved.'
      });
    }

    console.error('Manual shift assignment failed:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to assign manual shift.'
    });

  } finally {
    if (connection) {
      connection.release();
    }
  }
});
// GET shifts for a guard (or all for managers)
router.get('/', authenticate, async (req, res) => {
  try {
    const { guard_id, from, to } = req.query;
    let sql = `
      SELECT ss.*, u.full_name AS guard_name, u.employee_code,
             s.name AS site_name, s.site_code, s.status AS site_status
      FROM scheduled_shifts ss
      JOIN users u ON u.id = ss.guard_id
      LEFT JOIN sites s ON s.id = ss.site_id
      WHERE 1=1
        AND u.is_active = 1
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
      `SELECT ss.*, s.name AS site_name, s.site_code, s.status AS site_status, s.latitude, s.longitude, s.geo_radius_m
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

// PUT update the site assigned to an individual shift
router.put(
  '/:id/site',
  authenticate,
  authorize('admin', 'manager'),
  async (req, res) => {
    try {
      const shiftId = Number(req.params.id);
      const siteId = Number(req.body.site_id);

      if (!Number.isInteger(shiftId) || shiftId < 1) {
        return res.status(400).json({
          success: false,
          message: 'A valid shift ID is required.'
        });
      }

      if (!Number.isInteger(siteId) || siteId < 1) {
        return res.status(400).json({
          success: false,
          message: 'Please select a valid site.'
        });
      }

      // Confirm that the shift exists.
      const [shiftRows] = await pool.query(
        'SELECT id FROM scheduled_shifts WHERE id = ? LIMIT 1',
        [shiftId]
      );

      if (shiftRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Shift not found.'
        });
      }

      // Only approved sites can be assigned.
      const [siteRows] = await pool.query(
        'SELECT id FROM sites WHERE id = ? AND status = ? LIMIT 1',
        [siteId, 'approved']
      );

      if (siteRows.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'The selected site does not exist or is not approved.'
        });
      }

      // Update only the shift's site.
      await pool.query(
        'UPDATE scheduled_shifts SET site_id = ? WHERE id = ?',
        [siteId, shiftId]
      );

      return res.json({
        success: true,
        message: 'Shift site updated successfully.'
      });
    } catch (err) {
      console.error('Update shift site error:', err);

      return res.status(500).json({
        success: false,
        message: 'Failed to update the shift site.'
      });
    }
  }
);

// GET scheduled day/night guard counts for each approved site
router.get(
  '/coverage',
  authenticate,
  authorize('admin', 'manager'),
  async (req, res) => {
    try {
      const { date } = req.query;

      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({
          success: false,
          message: 'Date must use YYYY-MM-DD format.'
        });
      }

      const params = [];
      let dateCondition = '';

      if (date) {
        dateCondition = 'AND ss.shift_date = ?';
        params.push(date);
      }

      const [rows] = await pool.query(
        `
        SELECT
          s.id AS site_id,
          s.site_code,
          s.name AS site_name,
          s.status AS site_status,

          COUNT(DISTINCT CASE
            WHEN ss.shift_type = 'day'
            THEN ss.guard_id
          END) AS day_guards,

          COUNT(DISTINCT CASE
            WHEN ss.shift_type = 'night'
            THEN ss.guard_id
          END) AS night_guards

        FROM sites s

        LEFT JOIN scheduled_shifts ss
          ON ss.site_id = s.id
          AND ss.status = 'scheduled'
          AND ss.shift_type IN ('day', 'night')
          ${dateCondition}

        WHERE s.status IN ('approved', 'terminated')

        GROUP BY s.id, s.site_code, s.name, s.status
        ORDER BY s.site_code, s.name
        `,
        params
      );


      return res.json({
        success: true,
        data: rows
      });
    } catch (err) {
      console.error('Shift coverage error:', err);

      return res.status(500).json({
        success: false,
        message: 'Failed to fetch shift coverage.'
      });
    }
  }
);



/**
 * GET active guards and their expected shift for a selected date.
 * Uses the latest rotation start date on or before that date.
 * Read-only: does not modify roster or attendance records.
 */
router.get(
  '/missing',
  authenticate,
  authorize('admin', 'manager'),
  async (req, res) => {
    try {
      const date = req.query.date;

      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a date in YYYY-MM-DD format.'
        });
      }

      // Validate that the date is a real calendar date.
      const parsedDate = new Date(`${date}T00:00:00Z`);

      if (
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== date
      ) {
        return res.status(400).json({
          success: false,
          message: 'Please provide a valid calendar date.'
        });
      }

      const [rows] = await pool.query(
        `
        SELECT
          u.id AS guard_id,
          u.employee_code,
          u.full_name,
          cycles.cycle_start_date,
          ss.id AS shift_id,
          ss.shift_type,
          ss.status AS shift_status,
          ss.site_id,
          s.site_code,
          s.name AS site_name,
          s.status AS site_status
        FROM users u

        LEFT JOIN (
          SELECT
            guard_id,
            COALESCE(
              MAX(CASE WHEN cycle_start_date <= ? THEN cycle_start_date END),
              MIN(CASE WHEN cycle_start_date > ? THEN cycle_start_date END)
            ) AS cycle_start_date
          FROM shift_cycles
          WHERE cancelled_at IS NULL OR ? < cancelled_at
          GROUP BY guard_id
        ) cycles
          ON cycles.guard_id = u.id

        LEFT JOIN scheduled_shifts ss
          ON ss.guard_id = u.id
          AND ss.shift_date = ?

        LEFT JOIN sites s
          ON s.id = ss.site_id

        WHERE u.role = 'guard'
          AND u.is_active = 1

        ORDER BY u.full_name
        `,
        [date, date, date, date]
      );

      const data = rows.map(row => {
        let expectedShift = null;
        let finding;

        if (!row.cycle_start_date) {
          finding = 'No rotation assigned';
        } else {
          const cycleStart = String(row.cycle_start_date).slice(0, 10);

          if (date < cycleStart) {
            return {
              ...row,
              expected_shift: null,
              finding: 'Before rotation start'
            };
          }

          const startMs = Date.parse(`${cycleStart}T00:00:00Z`);
          const dateMs = Date.parse(`${date}T00:00:00Z`);

          const daysSinceStart = Math.floor(
            (dateMs - startMs) / 86400000
          );

          const cycleDay = ((daysSinceStart % 15) + 15) % 15 + 1;

          if (cycleDay <= 7) {
            expectedShift = 'day';
          } else if (cycleDay <= 14) {
            expectedShift = 'night';
          } else {
            expectedShift = 'off';
          }

          if (expectedShift === 'off') {
            finding = row.shift_id
              ? 'Off - shift record exists'
              : 'Off';
          } else if (!row.shift_id) {
            finding = 'Missing shift';
          } else if (
            String(row.shift_type).toLowerCase() !== expectedShift
          ) {
            finding = 'Shift type mismatch';
          } else if (row.shift_status === 'cancelled') {
            finding = 'Shift cancelled';
          } else if (row.shift_status === 'missed') {
            finding = 'Shift missed';
          } else if (row.shift_status !== 'scheduled') {
            finding = `Unexpected status: ${row.shift_status}`;
          } else if (row.site_id == null) {
            finding = 'No site assigned';
          } else {
            finding = 'Shift assigned';
          }
        }

        return {
          ...row,
          expected_shift: expectedShift,
          finding
        };
      });

      return res.json({
        success: true,
        date,
        data
      });
    } catch (err) {
      console.error('Missing shift report error:', err);

      return res.status(500).json({
        success: false,
        message: 'Failed to generate missing shift report.'
      });
    }
  }
);


module.exports = router;


