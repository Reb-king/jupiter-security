const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// GET all users
router.get('/', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { role, active } = req.query;
    let sql = `
      SELECT id, employee_code, full_name, phone, email, role, hourly_rate, 
             is_active, date_of_birth, hired_at, suspended_at, created_at 
      FROM users WHERE 1=1
    `;
    const params = [];

    if (role) {
      sql += ' AND role = ?';
      params.push(role);
    }
    if (active !== undefined) {
      sql += ' AND is_active = ?';
      params.push(active === 'true' ? 1 : 0);
    }

    sql += ' ORDER BY full_name';
    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch users.' });
  }
});

// GET single user
router.get('/:id', authenticate, async (req, res) => {
  try {
    if (req.user.role === 'guard' && parseInt(req.params.id) !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }

    const [rows] = await pool.query(
      `SELECT id, employee_code, full_name, phone, email, role, hourly_rate, 
              is_active, date_of_birth, hired_at, suspended_at, created_at 
       FROM users WHERE id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST register new guard
router.post('/', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { employee_code, full_name, phone, email, password, role, hourly_rate, date_of_birth, hired_at } = req.body;

    if (!employee_code || !full_name || !password) {
      return res.status(400).json({ success: false, message: 'employee_code, full_name and password are required.' });
    }

    const allowedRoles = ['guard', 'manager'];
    const userRole = role && allowedRoles.includes(role) ? role : 'guard';
    const hash = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      `INSERT INTO users 
        (employee_code, full_name, phone, email, password_hash, role, hourly_rate, is_active, date_of_birth, hired_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        employee_code, 
        full_name, 
        phone || null, 
        email || null, 
        hash, 
        userRole, 
        hourly_rate || 0,
        date_of_birth || null,
        hired_at || new Date().toISOString().slice(0, 10)
      ]
    );

    res.status(201).json({
      success: true,
      message: 'User registered successfully.',
      data: { 
        id: result.insertId, 
        employee_code, 
        full_name, 
        role: userRole,
        temp_password: password   // return it once so you can see it
      }
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'Employee code or email already exists.' });
    }
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to register user.' });
  }
});

// PUT update user
router.put('/:id', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { full_name, phone, email, hourly_rate, password, date_of_birth, hired_at } = req.body;
    const updates = [];
    const params = [];

    if (full_name !== undefined) { updates.push('full_name = ?'); params.push(full_name); }
    if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email); }
    if (hourly_rate !== undefined) { updates.push('hourly_rate = ?'); params.push(hourly_rate); }
    if (date_of_birth !== undefined) { updates.push('date_of_birth = ?'); params.push(date_of_birth); }
    if (hired_at !== undefined) { updates.push('hired_at = ?'); params.push(hired_at); }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      updates.push('password_hash = ?');
      params.push(hash);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update.' });
    }

    params.push(req.params.id);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    res.json({ success: true, message: 'User updated successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update user.' });
  }
});

// ========== STATUS ACTIONS ==========

// Put on Access (Suspend)
router.put('/:id/suspend', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, message: 'Your password is required to perform this action.' });
    }

    const [adminRows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    const match = await bcrypt.compare(password, adminRows[0].password_hash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Incorrect password. Action cancelled.' });
    }

    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot suspend yourself.' });
    }

    await pool.query(
      'UPDATE users SET is_active = 0, suspended_at = NOW() WHERE id = ? AND role = "guard"',
      [req.params.id]
    );

    // Remove current site assignment
    await pool.query(
      `UPDATE guard_site_assignments SET is_current = 0, assigned_to = CURDATE()
       WHERE guard_id = ? AND is_current = 1`,
      [req.params.id]
    );

    res.json({ success: true, message: 'Guard has been placed On Access. They can no longer be assigned sites or shifts.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to suspend guard.' });
  }
});

// Reinstate
router.put('/:id/reinstate', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, message: 'Your password is required to perform this action.' });
    }

    const [adminRows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    const match = await bcrypt.compare(password, adminRows[0].password_hash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Incorrect password. Action cancelled.' });
    }

    await pool.query(
      'UPDATE users SET is_active = 1, suspended_at = NULL WHERE id = ? AND role = "guard"',
      [req.params.id]
    );

    res.json({ success: true, message: 'Guard has been reinstated and is now Active.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to reinstate guard.' });
  }
});

// Fire (permanent delete)
router.delete('/:id/fire', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, message: 'Your password is required to perform this action.' });
    }

    const [adminRows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    const match = await bcrypt.compare(password, adminRows[0].password_hash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Incorrect password. Action cancelled.' });
    }

    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot fire yourself.' });
    }

    await pool.query('DELETE FROM users WHERE id = ? AND role = "guard"', [req.params.id]);

    res.json({ success: true, message: 'Guard has been permanently fired and removed from the system.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fire guard.' });
  }
});

// Reset & Show Temporary Password
router.post('/:id/reset-password', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { password } = req.body; // admin password
    if (!password) {
      return res.status(400).json({ success: false, message: 'Your password is required.' });
    }

    // Verify admin password
    const [adminRows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (adminRows.length === 0) {
      return res.status(401).json({ success: false, message: 'Admin not found.' });
    }

    const match = await bcrypt.compare(password, adminRows[0].password_hash);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Incorrect password.' });
    }

    // Check the guard exists
    const [guardRows] = await pool.query(
      'SELECT id, full_name, is_active FROM users WHERE id = ? AND role = "guard"',
      [req.params.id]
    );

    if (guardRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Guard not found.' });
    }

    // Generate a simple temporary password
    const tempPassword = 'Temp' + Math.floor(1000 + Math.random() * 9000); // example: Temp4821
    const hash = await bcrypt.hash(tempPassword, 10);

    const [result] = await pool.query(
      'UPDATE users SET password_hash = ? WHERE id = ? AND role = "guard"',
      [hash, req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(500).json({ success: false, message: 'Failed to update password.' });
    }

    res.json({
      success: true,
      message: 'Temporary password has been reset successfully.',
      temp_password: tempPassword,
      guard_name: guardRows[0].full_name,
      is_active: guardRows[0].is_active
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to reset password.' });
  }
});
module.exports = router;