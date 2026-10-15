const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// GET current assignments
router.get('/', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT a.id, a.guard_id, a.site_id, a.assigned_from, a.assigned_to, a.is_current,
             u.employee_code, u.full_name AS guard_name,
             s.site_code, s.name AS site_name, s.town
      FROM guard_site_assignments a
      JOIN users u ON u.id = a.guard_id
      JOIN sites s ON s.id = a.site_id
      WHERE a.is_current = 1
      ORDER BY s.name, u.full_name
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch assignments.' });
  }
});

// POST assign guard to site
router.post('/', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { guard_id, site_id, assigned_from } = req.body;
    if (!guard_id || !site_id) {
      return res.status(400).json({ success: false, message: 'guard_id and site_id required.' });
    }

    // End any previous current assignment for this guard
    await pool.query(
      `UPDATE guard_site_assignments SET is_current = 0, assigned_to = CURDATE()
       WHERE guard_id = ? AND is_current = 1`,
      [guard_id]
    );

    const [result] = await pool.query(
      `INSERT INTO guard_site_assignments (guard_id, site_id, assigned_from, is_current)
       VALUES (?, ?, ?, 1)`,
      [guard_id, site_id, assigned_from || new Date().toISOString().slice(0, 10)]
    );

    res.status(201).json({
      success: true,
      message: 'Guard assigned to site successfully.',
      data: { id: result.insertId }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to assign guard.' });
  }
});

// GET assignment for a specific guard (used by guard app)
router.get('/my-site', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT a.*, s.site_code, s.name AS site_name, s.address, s.town,
             s.latitude, s.longitude, s.geo_radius_m
      FROM guard_site_assignments a
      JOIN sites s ON s.id = a.site_id
      WHERE a.guard_id = ? AND a.is_current = 1 AND s.status = 'approved'
      LIMIT 1
    `, [req.user.id]);

    if (rows.length === 0) {
      return res.json({ success: true, data: null, message: 'No current site assignment.' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;