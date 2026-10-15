const express = require('express');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// GET all sites
router.get('/', authenticate, async (req, res) => {
  try {
    const { status } = req.query;
    let sql = 'SELECT * FROM sites WHERE 1=1';
    const params = [];
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    sql += ' ORDER BY name';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch sites.' });
  }
});

// GET single site
router.get('/:id', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM sites WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Site not found.' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST add new approved site
router.post('/', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { site_code, name, address, town, latitude, longitude, geo_radius_m, notes } = req.body;
    if (!site_code || !name) {
      return res.status(400).json({ success: false, message: 'site_code and name are required.' });
    }

    const [result] = await pool.query(
      `INSERT INTO sites (site_code, name, address, town, latitude, longitude, geo_radius_m, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?)`,
      [site_code, name, address || null, town || null, latitude || null, longitude || null,
       geo_radius_m || 150, notes || null]
    );

    res.status(201).json({
      success: true,
      message: 'Site added and approved.',
      data: { id: result.insertId, site_code, name, status: 'approved' }
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'Site code already exists.' });
    }
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to add site.' });
  }
});

// PUT update site (including terminate)
router.put('/:id', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { name, address, town, latitude, longitude, geo_radius_m, status, notes } = req.body;
    const updates = [];
    const params = [];

    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (address !== undefined) { updates.push('address = ?'); params.push(address); }
    if (town !== undefined) { updates.push('town = ?'); params.push(town); }
    if (latitude !== undefined) { updates.push('latitude = ?'); params.push(latitude); }
    if (longitude !== undefined) { updates.push('longitude = ?'); params.push(longitude); }
    if (geo_radius_m !== undefined) { updates.push('geo_radius_m = ?'); params.push(geo_radius_m); }
    if (status !== undefined) {
      if (!['approved', 'terminated'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Status must be approved or terminated.' });
      }
      updates.push('status = ?');
      params.push(status);
    }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update.' });
    }

    params.push(req.params.id);
    await pool.query(`UPDATE sites SET ${updates.join(', ')} WHERE id = ?`, params);

    res.json({ success: true, message: 'Site updated successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update site.' });
  }
});

// DELETE (soft terminate)
router.delete('/:id', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    await pool.query(`UPDATE sites SET status = 'terminated' WHERE id = ?`, [req.params.id]);
    res.json({ success: true, message: 'Site terminated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to terminate site.' });
  }
});

module.exports = router;