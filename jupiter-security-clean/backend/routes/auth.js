const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();


 // POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    // Accept the new username field and the old field for compatibility.
    const username = String(
      req.body.username || req.body.employee_code || ''
    ).trim();
    const { password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username and password are required.'
      });
    }

    const [rows] = await pool.query(
      `SELECT id, employee_code, full_name, role,
              password_hash, is_active, hourly_rate
       FROM users
       WHERE employee_code = ?`,
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password.'
      });
    }

    const user = rows[0];

    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated. Contact management.'
      });
    }

    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password.'
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
        employee_code: user.employee_code,
        full_name: user.full_name
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
    );

    return res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        employee_code: user.employee_code,
        username: user.employee_code,
        full_name: user.full_name,
        role: user.role,
        hourly_rate: user.hourly_rate
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error during login.'
    });
  }
});


// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, employee_code, full_name, phone, email, role, hourly_rate, is_active FROM users WHERE id = ?',
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    res.json({ success: true, user: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
