const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const crypto = require('crypto');
const { authenticate, authorize } = require('../middleware/auth');

const nodemailer = require('nodemailer');

const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 465),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: (process.env.SMTP_PASS || '').replace(/\s/g, '')
  }
});

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

const formattedRows = rows.map(user => ({
  ...user,
  date_of_birth: user.date_of_birth
    ? String(user.date_of_birth).slice(0, 10)
    : null,
  hired_at: user.hired_at
    ? String(user.hired_at).slice(0, 10)
    : null
}));

res.json({ success: true, data: formattedRows });

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


/* POST register new guard */
router.post('/', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const {
      full_name,
      phone,
      email,
      role,
      hourly_rate,
      date_of_birth,
      hired_at
    } = req.body;

    if (!full_name || !full_name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Full name is required.'
      });
    }

    if (!email || !email.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Email address is required.'
      });
    }

    const allowedRoles = ['guard', 'manager'];
    const userRole =
      role && allowedRoles.includes(role) ? role : 'guard';

    // Find the highest existing automatically generated username.
    const [existingUsers] = await pool.query(
      `SELECT employee_code
       FROM users
       WHERE employee_code REGEXP '^JUP-[0-9]+$'`
    );

    let highestNumber = 0;

    for (const user of existingUsers) {
      const match = user.employee_code.match(/^JUP-(\d+)$/);

      if (match) {
        highestNumber = Math.max(
          highestNumber,
          Number(match[1])
        );
      }
    }

    // Generate the next username without changing existing accounts.
    const nextNumber = highestNumber + 1;
    const employee_code =
      `JUP-${String(nextNumber).padStart(3, '0')}`;

    // Generate a temporary password.
    const tempPassword =
      'Temp-' + crypto.randomBytes(6).toString('hex');

    const hash = await bcrypt.hash(tempPassword, 10);

    const [result] = await pool.query(
      `INSERT INTO users
        (employee_code, full_name, phone, email, password_hash,
         role, hourly_rate, is_active, date_of_birth, hired_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        employee_code,
        full_name.trim(),
        phone || null,
        email.trim(),
        hash,
        userRole,
        hourly_rate || 0,
        date_of_birth || null,
        hired_at || new Date().toISOString().slice(0, 10)
      ]
    );

   

let emailSent = false;

try {
  await mailer.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: email.trim(),
    subject: 'Your Jupiter Security Management System Login Details',
    text: [
      `Hello ${full_name.trim()},`,
      '',
      'Your Jupiter Security Management System account has been created.',
      '',
      `Employee Code: ${employee_code}`,
      `Temporary Password: ${tempPassword}`,
      '',
      'Please log in and change your temporary password as soon as possible.',
      'Keep these login details private.',
      '',
      'Regards,',
      'Jupiter Security Management System'
    ].join('\n')
  });

  emailSent = true;
} catch (mailError) {
  console.error('Registration email failed:', mailError.message);
}



return res.status(201).json({
  success: true,
  message: emailSent
    ? 'User registered and login details emailed successfully.'
    : 'User created, but the email could not be sent.',
  data: {
    id: result.insertId,
    employee_code,
    full_name: full_name.trim(),
    email: email.trim(),
    role: userRole,
    email_sent: emailSent,
    ...(!emailSent ? { temp_password: tempPassword } : {})
  }
});
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message:
          'This username or email already exists. Please try again.'
      });
    }

    console.error(err);
    res.status(500).json({
      success: false,
      message: 'Failed to register user.'
    });
  }
});


 // PUT update guard details
router.put('/:id', authenticate, authorize('admin', 'manager'), async (req, res) => {
  try {
    const { full_name, phone, email, hourly_rate, date_of_birth, hired_at } = req.body;

    // Confirm that this user exists and is a guard.
    const [guards] = await pool.query(
      'SELECT id FROM users WHERE id = ? AND role = ?',
      [req.params.id, 'guard']
    );

    if (guards.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Guard not found.'
      });
    }

    const updates = [];
    const params = [];

    if (full_name !== undefined) {
      updates.push('full_name = ?');
      params.push(full_name);
    }

    if (phone !== undefined) {
      updates.push('phone = ?');
      params.push(phone || null);
    }

    if (email !== undefined) {
      updates.push('email = ?');
      params.push(email || null);
    }

    if (hourly_rate !== undefined) {
      updates.push('hourly_rate = ?');
      params.push(hourly_rate);
    }

    if (date_of_birth !== undefined) {
      updates.push('date_of_birth = ?');
      params.push(date_of_birth || null);
    }

    if (hired_at !== undefined) {
      updates.push('hired_at = ?');
      params.push(hired_at || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update.'
      });
    }

    params.push(req.params.id);

    const [result] = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ? AND role = 'guard'`,
      params
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({
        success: false,
        message: 'No guard details were changed.'
      });
    }

    res.json({
      success: true,
      message: 'Guard details updated successfully.'
    });
  } catch (err) {
    console.error(err);

    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: 'That email address is already in use.'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to update guard details.'
    });
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
  'UPDATE users SET is_active = 0, suspended_at = NOW() WHERE id = ? AND role = ?',
  [req.params.id, 'guard']
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
      'UPDATE users SET is_active = 1, suspended_at = NULL WHERE id = ? AND role = ?',
[req.params.id, 'guard']
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

   await pool.query(
  'DELETE FROM users WHERE id = ? AND role = ?',
  [req.params.id, 'guard']
);

    res.json({ success: true, message: 'Guard has been permanently fired and removed from the system.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fire guard.' });
  }
});

/**
 * Reset a guard's password and email the temporary password.
 * The previous password is restored if email delivery fails.
 */
router.post('/:id/reset-password', authenticate, authorize('admin', 'manager'), async (req, res) => {
  let guardId;
  let previousHash;
  let newHash;
  let passwordUpdated = false;

  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Your password is required.'
      });
    }

    // Verify the manager's current password.
    const [adminRows] = await pool.query(
      'SELECT password_hash FROM users WHERE id = ?',
      [req.user.id]
    );

    if (adminRows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Management account not found.'
      });
    }

    const match = await bcrypt.compare(
      password,
      adminRows[0].password_hash
    );

    if (!match) {
      return res.status(401).json({
        success: false,
        message: 'Incorrect password.'
      });
    }

    // Get the guard's registered email and existing password hash.
    const [guardRows] = await pool.query(
      `SELECT id, full_name, email, is_active, password_hash
       FROM users
       WHERE id = ? AND role = 'guard'`,
      [req.params.id]
    );

    if (guardRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Guard not found.'
      });
    }

    const guard = guardRows[0];

    if (!guard.email || !guard.email.trim()) {
      return res.status(400).json({
        success: false,
        message: 'This guard has no registered email address. Update their email before resetting the password.'
      });
    }

    guardId = guard.id;
    previousHash = guard.password_hash;

    // Generate a cryptographically secure temporary password.
    const tempPassword = `Jup-${crypto.randomBytes(12).toString('base64url')}`;
    newHash = await bcrypt.hash(tempPassword, 10);

    // Change the password, then send the email.
    const [result] = await pool.query(
      `UPDATE users
       SET password_hash = ?
       WHERE id = ? AND role = 'guard'`,
      [newHash, guardId]
    );

    if (result.affectedRows === 0) {
      return res.status(500).json({
        success: false,
        message: 'Failed to update the guard password.'
      });
    }

   
passwordUpdated = true;


try {
  await mailer.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: guard.email.trim(),
    subject: 'Your Jupiter Security Password Has Been Reset',
    text: [
      `Hello ${guard.full_name},`,
      '',
      'A manager has reset your Jupiter Security Management System password.',
      '',
      `Employee account: ${guard.id}`,
      `Temporary password: ${tempPassword}`,
      '',
      'Please sign in and change this temporary password as soon as possible.',
      'If you did not expect this change, contact your management team.',
      '',
      'Jupiter Security Management System'
    ].join('\n')
  });
} catch (mailError) {
  // Restore the previous password if email delivery fails.
  try {
    const [rollbackResult] = await pool.query(
      `UPDATE users
       SET password_hash = ?
       WHERE id = ? AND role = 'guard' AND password_hash = ?`,
      [previousHash, guardId, newHash]
    );

    if (rollbackResult.affectedRows > 0) {
      passwordUpdated = false;
    } else {
      console.error('Password rollback could not be confirmed.');
    }
  } catch (rollbackError) {
    console.error('Password rollback failed:', rollbackError.message);
  }

  throw mailError;
}

    return res.json({
      success: true,
      message: `A temporary password has been emailed to ${guard.email.trim()}.`,
      guard_name: guard.full_name,
      is_active: guard.is_active
    });
  } catch (err) {
    console.error('Password reset failed:', err.message);

    return res.status(500).json({
      success: false,
      message: passwordUpdated
        ? 'Email delivery failed, and the previous password could not be confirmed as restored. Contact the system administrator before retrying.'
        : 'The password reset could not be completed. Check email delivery and try again.'
    });
  }
});


/**
 * Allow an authenticated guard to change their own password.
 */
router.post('/change-password', authenticate, authorize('guard'), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Enter your current password and your new password.'
      });
    }

    if (typeof newPassword !== 'string' || newPassword.length < 4) {
      return res.status(400).json({
        success: false,
        message: 'Your new password must be at least 4 characters long.'
      });
    }

    if (newPassword.length > 128) {
      return res.status(400).json({
        success: false,
        message: 'Your new password must not exceed 128 characters.'
      });
    }

    const [rows] = await pool.query(
      'SELECT password_hash FROM users WHERE id = ? AND role = ?',
      [req.user.id, 'guard']
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Guard account not found.'
      });
    }

    const matches = await bcrypt.compare(
      currentPassword,
      rows[0].password_hash
    );

    if (!matches) {
      return res.status(401).json({
        success: false,
        message: 'Your current password is incorrect.'
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Your new password must be different from your current password.'
      });
    }

    const newHash = await bcrypt.hash(newPassword, 10);

    const [result] = await pool.query(
      'UPDATE users SET password_hash = ? WHERE id = ? AND role = ?',
      [newHash, req.user.id, 'guard']
    );

    if (result.affectedRows === 0) {
      return res.status(500).json({
        success: false,
        message: 'Your password could not be changed. Please try again.'
      });
    }

    return res.json({
      success: true,
      message: 'Your password has been changed successfully.'
    });
  } catch (err) {
    console.error('Guard password change failed:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Unable to change your password right now.'
    });
  }
});


module.exports = router;