const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// POST calculate payroll for a period
router.post('/calculate', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { period_start, period_end } = req.body;
    if (!period_start || !period_end) {
      return res.status(400).json({ success: false, message: 'period_start and period_end required (YYYY-MM-DD).' });
    }

    // Create or get period
    let periodId;
    const [existing] = await pool.query(
      'SELECT id FROM payroll_periods WHERE period_start = ? AND period_end = ?',
      [period_start, period_end]
    );

    if (existing.length) {
      periodId = existing[0].id;
      // Clear old records for re-calculation
      await pool.query('DELETE FROM payroll_records WHERE period_id = ?', [periodId]);
    } else {
      const [ins] = await pool.query(
        `INSERT INTO payroll_periods (period_start, period_end, status) VALUES (?, ?, 'processing')`,
        [period_start, period_end]
      );
      periodId = ins.insertId;
    }

    // Get all active guards
    const [guards] = await pool.query(
      `SELECT id, employee_code, full_name, hourly_rate FROM users WHERE role = 'guard' AND is_active = 1`
    );

    const results = [];

    for (const guard of guards) {
      // Sum hours worked in the period
      const [hours] = await pool.query(
        `SELECT COALESCE(SUM(hours_worked), 0) AS total_hours
         FROM attendance
         WHERE guard_id = ?
           AND clock_out_at IS NOT NULL
           AND DATE(clock_in_at) BETWEEN ? AND ?`,
        [guard.id, period_start, period_end]
      );

      const totalHours = parseFloat(hours[0].total_hours) || 0;
      const rate = parseFloat(guard.hourly_rate) || 0;
      const gross = Math.round(totalHours * rate * 100) / 100;
      const deductions = 0; // can be extended later (tax, SSC, etc.)
      const net = gross - deductions;

      await pool.query(
        `INSERT INTO payroll_records
         (period_id, guard_id, total_hours, hourly_rate, gross_amount, deductions, net_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [periodId, guard.id, totalHours, rate, gross, deductions, net]
      );

      results.push({
        guard_id: guard.id,
        employee_code: guard.employee_code,
        full_name: guard.full_name,
        total_hours: totalHours,
        hourly_rate: rate,
        gross_amount: gross,
        net_amount: net
      });
    }

    await pool.query(`UPDATE payroll_periods SET status = 'open' WHERE id = ?`, [periodId]);

    res.json({
      success: true,
      message: `Payroll calculated for ${results.length} guards.`,
      period_id: periodId,
      currency: 'NAD',
      data: results
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Payroll calculation failed.' });
  }
});

// GET payroll records for a period
router.get('/period/:periodId', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT pr.*, u.employee_code, u.full_name, pp.period_start, pp.period_end, pp.status
       FROM payroll_records pr
       JOIN users u ON u.id = pr.guard_id
       JOIN payroll_periods pp ON pp.id = pr.period_id
       WHERE pr.period_id = ?
       ORDER BY u.full_name`,
      [req.params.periodId]
    );
    res.json({ success: true, currency: 'NAD', data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch payroll.' });
  }
});

// GET all periods
router.get('/periods', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM payroll_periods ORDER BY period_start DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch periods.' });
  }
});

// GET my payslip summary (guard)
router.get('/my', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT pr.*, pp.period_start, pp.period_end, pp.status
       FROM payroll_records pr
       JOIN payroll_periods pp ON pp.id = pr.period_id
       WHERE pr.guard_id = ?
       ORDER BY pp.period_start DESC
       LIMIT 12`,
      [req.user.id]
    );
    res.json({ success: true, currency: 'NAD', data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch payslips.' });
  }
});

module.exports = router;