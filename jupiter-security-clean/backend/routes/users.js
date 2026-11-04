
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

/**
 * Send a temporary password by email.
 * Returns true only when the email provider accepts the message.
 */
async function sendTemporaryPasswordEmail({
  email,
  fullName,
  employeeCode,
  tempPassword,
  subject,
  actionDescription
}) {
  if (!email || !email.trim()) {
    return false;
  }

  await mailer.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: email.trim(),
    subject,
    text: [
      `Hello ${fullName},`,
      '',
      `Your Jupiter Security Management System account ${actionDescription}.`,
      '',
      `Employee Code: ${employeeCode}`,
      `Temporary Password: ${tempPassword}`,
      '',
      'Sign in and change your temporary password as soon as possible.',
      'Keep these login details private.',
      '',
      'Regards,',
      'Jupiter Security Management System'
    ].join('\n')
  });

  return true;
}

// GET all users
router.get(
  '/',
  authenticate,
  authorize('admin', 'manager'),
  async (req, res) => {
    try {
      const { role, active } = req.query;

      let sql = `
        SELECT id, employee_code, full_name, phone, email, role,
               hourly_rate, is_active, date_of_birth, hired_at,
               suspended_at, created_at
        FROM users
        WHERE 1=1
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
      console.error('Failed to fetch users:', err.message);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch users.'
      });
    }
  }
);

// GET single user
router.get('/:id', authenticate, async (req, res) => {
  try {
    if (
      req.user.role === 'guard' &&
      parseInt(req.params.id, 10) !== req.user.id
    ) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden.'
      });
    }

    const [rows] = await pool.query(
      `SELECT id, employee_code, full_name, phone, email, role,
              hourly_rate, is_active, date_of_birth, hired_at,
              suspended_at, created_at
       FROM users
       WHERE id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }

    const user = rows[0];

    user.date_of_birth = user.date_of_birth
      ? String(user.date_of_birth).slice(0, 10)
      : null;

    user.hired_at = user.hired_at
      ? String(user.hired_at).slice(0, 10)
      : null;

    res.json({ success: true, data: user });
  } catch (err) {
    console.error('Failed to fetch user:', err.message);
    res.status(500).json({
      success: false,
      message: 'Server error.'
    });
  }
});

/* POST register new guard or manager */
router.post(
  '/',
  authenticate,
  authorize('admin', 'manager'),
  async (req, res) => {
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

      if (
        typeof full_name !== 'string' ||
        !full_name.trim()
      ) {
        return res.status(400).json({
          success: false,
          message: 'Full name is required.'
        });
      }

      // Phone is mandatory.
      if (
        typeof phone !== 'string' ||
        !phone.trim()
      ) {
        return res.status(400).json({
          success: false,
          message: 'Phone number is required.'
        });
      }

      if (phone.trim().length > 20) {
        return res.status(400).json({
          success: false,
          message: 'Phone number must not exceed 20 characters.'
        });
      }

      // Email is optional. Blank email is stored as NULL.
      let normalizedEmail = null;

      if (email !== undefined && email !== null && email !== '') {
        if (typeof email !== 'string') {
          return res.status(400).json({
            success: false,
            message: 'Email address must be text.'
          });
        }

        if (email.trim()) {
          normalizedEmail = email.trim();

          if (
            normalizedEmail.length > 120 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
          ) {
            return res.status(400).json({
              success: false,
              message: 'Enter a valid email address.'
            });
          }
        }
      }

      const allowedRoles = ['guard', 'manager'];
      const userRole =
        role && allowedRoles.includes(role) ? role : 'guard';

      // Generate the next automatically generated employee code.
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

      const nextNumber = highestNumber + 1;

      const employee_code =
        `JUP-${String(nextNumber).padStart(3, '0')}`;

      // Generate a random temporary password.
      const tempPassword =
        `Jup-${crypto.randomBytes(12).toString('base64url')}`;

      const hash = await bcrypt.hash(tempPassword, 10);

      const [result] = await pool.query(
        `INSERT INTO users
          (employee_code, full_name, phone, email, password_hash,
           role, hourly_rate, is_active, date_of_birth, hired_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          employee_code,
          full_name.trim(),
          phone.trim(),
          normalizedEmail,
          hash,
          userRole,
          hourly_rate ?? 0,
          date_of_birth || null,
          hired_at || new Date().toISOString().slice(0, 10)
        ]
      );

      let emailSent = false;

      // Only attempt email when an email address was provided.
      if (normalizedEmail) {
        try {
          emailSent = await sendTemporaryPasswordEmail({
            email: normalizedEmail,
            fullName: full_name.trim(),
            employeeCode: employee_code,
            tempPassword,
            subject:
              'Your Jupiter Security Management System Login Details',
            actionDescription: 'has been created'
          });
        } catch (mailError) {
          // Do not log the password or other credentials.
          console.error(
            'Registration email failed:',
            mailError.message
          );
        }
      }

      // Password is returned only when email was not sent.
      // This endpoint is restricted to authenticated management users.
      return res.status(201).json({
        success: true,
        message: emailSent
          ? 'User registered and login details emailed successfully.'
          : normalizedEmail
            ? 'User created, but email delivery failed. Provide the temporary password to the guard securely.'
            : 'User created without an email address. Provide the temporary password to the guard securely.',
        data: {
          id: result.insertId,
          employee_code,
          full_name: full_name.trim(),
          phone: phone.trim(),
          email: normalizedEmail,
          role: userRole,
          email_sent: emailSent,
          ...(!emailSent
            ? { temp_password: tempPassword }
            : {})
        }
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          success: false,
          message:
            'The generated employee code already exists. Please retry the registration.'
        });
      }

      console.error('Registration failed:', err.message);

      return res.status(500).json({
        success: false,
        message: 'Failed to register user.'
      });
    }
  }
);


/* POST create a second administrator - admin only */
router.post(
  '/create-admin',
  authenticate,
  authorize('admin'),
  async (req, res) => {
    let connection;
    let transactionStarted = false;

    try {
      const { full_name, phone, email } = req.body;

      if (
        typeof full_name !== 'string' ||
        !full_name.trim() ||
        full_name.trim().length > 120
      ) {
        return res.status(400).json({
          success: false,
          message: 'Enter a valid full name.'
        });
      }

      if (
        typeof phone !== 'string' ||
        !phone.trim() ||
        phone.trim().length > 20
      ) {
        return res.status(400).json({
          success: false,
          message: 'Enter a valid phone number.'
        });
      }

      if (
        typeof email !== 'string' ||
        !email.trim() ||
        email.trim().length > 120 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      ) {
        return res.status(400).json({
          success: false,
          message: 'A valid email address is required.'
        });
      }

      const normalizedEmail = email.trim();
      const normalizedName = full_name.trim();
      const normalizedPhone = phone.trim();

      connection = await pool.getConnection();

      await connection.beginTransaction();
      transactionStarted = true;

      // Generate the next employee code.
      const [existingUsers] = await connection.query(
        `SELECT employee_code
         FROM users
         WHERE employee_code REGEXP '^JUP-[0-9]+$'
         FOR UPDATE`
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

      const employee_code =
        `JUP-${String(highestNumber + 1).padStart(3, '0')}`;

      // Generate and hash a temporary password.
      const tempPassword =
        `Jup-${crypto.randomBytes(12).toString('base64url')}`;

      const hash = await bcrypt.hash(tempPassword, 10);

      const [result] = await connection.query(
        `INSERT INTO users
          (employee_code, full_name, phone, email,
           password_hash, role, hourly_rate, is_active)
         VALUES (?, ?, ?, ?, ?, 'admin', 0, 1)`,
        [
          employee_code,
          normalizedName,
          normalizedPhone,
          normalizedEmail,
          hash
        ]
      );

      // Require successful email delivery.
      await sendTemporaryPasswordEmail({
        email: normalizedEmail,
        fullName: normalizedName,
        employeeCode: employee_code,
        tempPassword,
        subject: 'Your Jupiter Administrator Login Details',
        actionDescription: 'has been created'
      });

      await connection.commit();
      transactionStarted = false;

      return res.status(201).json({
        success: true,
        message: 'Administrator created and login details emailed successfully.',
        data: {
          id: result.insertId,
          employee_code,
          full_name: normalizedName,
          email: normalizedEmail,
          role: 'admin',
          email_sent: true
        }
      });

    } catch (err) {
      if (connection && transactionStarted) {
        await connection.rollback();
        transactionStarted = false;
      }

      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          success: false,
          message: 'This employee code or email address already exists.'
        });
      }

      console.error(
        'Administrator registration failed:',
        err.code || 'Unexpected error'
      );

      return res.status(500).json({
        success: false,
        message: 'Administrator creation failed. No account was committed. Check email delivery and try again.'
      });

    } finally {
      if (connection) {
        connection.release();
      }
    }
  }
);


// PUT update guard details
router.put(
  '/:id',
  authenticate,
  authorize('admin', 'manager'),
  async (req, res) => {
    try {
      const {
        full_name,
        phone,
        email,
        hourly_rate,
        date_of_birth,
        hired_at
      } = req.body;

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
        if (
          typeof full_name !== 'string' ||
          !full_name.trim()
        ) {
          return res.status(400).json({
            success: false,
            message: 'Full name cannot be blank.'
          });
        }

        updates.push('full_name = ?');
        params.push(full_name.trim());
      }

      if (phone !== undefined) {
        if (
          typeof phone !== 'string' ||
          !phone.trim()
        ) {
          return res.status(400).json({
            success: false,
            message: 'Phone number is required.'
          });
        }

        if (phone.trim().length > 20) {
          return res.status(400).json({
            success: false,
            message: 'Phone number must not exceed 20 characters.'
          });
        }

        updates.push('phone = ?');
        params.push(phone.trim());
      }

      if (email !== undefined) {
        let normalizedEmail = null;

        if (email !== null && email !== '') {
          if (typeof email !== 'string') {
            return res.status(400).json({
              success: false,
              message: 'Email address must be text.'
            });
          }

          if (email.trim()) {
            normalizedEmail = email.trim();

            if (
              normalizedEmail.length > 120 ||
              !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
            ) {
              return res.status(400).json({
                success: false,
                message: 'Enter a valid email address.'
              });
            }
          }
        }

        updates.push('email = ?');
        params.push(normalizedEmail);
      }

      if (hourly_rate !== undefined) {
        const rate = Number(hourly_rate);

        if (!Number.isFinite(rate) || rate < 0) {
          return res.status(400).json({
            success: false,
            message: 'Hourly rate must be a valid non-negative number.'
          });
        }

        updates.push('hourly_rate = ?');
        params.push(rate);
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
        `UPDATE users
         SET ${updates.join(', ')}
         WHERE id = ? AND role = 'guard'`,
        params
      );

      if (result.affectedRows === 0) {
        return res.status(400).json({
          success: false,
          message: 'No guard details were changed.'
        });
      }

      return res.json({
        success: true,
        message: 'Guard details updated successfully.'
      });
    } catch (err) {
      console.error('Guard update failed:', err.message);

      return res.status(500).json({
        success: false,
        message: 'Failed to update guard details.'
      });
    }
  }
);

// Put guard on Access (suspend)
router.put(
  '/:id/suspend',
  authenticate,
  authorize('admin', 'manager'),
  async (req, res) => {
    try {
      const { password } = req.body;

      if (!password) {
        return res.status(400).json({
          success: false,
          message: 'Your password is required to perform this action.'
        });
      }

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
          message: 'Incorrect password. Action cancelled.'
        });
      }

      if (Number(req.params.id) === Number(req.user.id)) {
        return res.status(400).json({
          success: false,
          message: 'You cannot suspend yourself.'
        });
      }

      const connection = await pool.getConnection();

      try {
        await connection.beginTransaction();

        const [guardRows] = await connection.query(
          `SELECT id
           FROM users
           WHERE id = ? AND role = ?
           FOR UPDATE`,
          [req.params.id, 'guard']
        );

        if (guardRows.length === 0) {
          await connection.rollback();

          return res.status(404).json({
            success: false,
            message: 'Guard not found. No changes were made.'
          });
        }

        await connection.query(
          `UPDATE users
           SET is_active = 0, suspended_at = NOW()
           WHERE id = ? AND role = ?`,
          [req.params.id, 'guard']
        );

        await connection.query(
          `UPDATE guard_site_assignments
           SET is_current = 0, assigned_to = CURDATE()
           WHERE guard_id = ? AND is_current = 1`,
          [req.params.id]
        );

        const [deletedShifts] = await connection.query(
          `DELETE FROM scheduled_shifts
           WHERE guard_id = ?
             AND shift_date >= CURDATE()`,
          [req.params.id]
        );

        const [cancelledCycles] = await connection.query(
          `UPDATE shift_cycles
           SET cancelled_at = CURDATE()
           WHERE guard_id = ?
             AND cancelled_at IS NULL
             AND DATE_ADD(cycle_start_date, INTERVAL 14 DAY) >= CURDATE()`,
          [req.params.id]
        );

        await connection.commit();

        return res.json({
          success: true,
          message:
            'Guard has been placed On Access. Future shifts have been cleared and active rotation cycles have been cancelled. Historical records and attendance have been preserved.',
          data: {
            deleted_future_shifts: deletedShifts.affectedRows,
            cancelled_rotation_cycles: cancelledCycles.affectedRows
          }
        });

      } catch (transactionError) {
        await connection.rollback();
        throw transactionError;

      } finally {
        connection.release();
      }

    } catch (err) {
      console.error('Guard suspension failed:', err.message);

      return res.status(500).json({
        success: false,
        message: 'Failed to suspend guard. No partial changes should remain.'
      });
    }
  }
);
// Reinstate guard
router.put(
  '/:id/reinstate',
  authenticate,
  authorize('admin', 'manager'),
  async (req, res) => {
    try {
      const { password } = req.body;

      if (!password) {
        return res.status(400).json({
          success: false,
          message: 'Your password is required to perform this action.'
        });
      }

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
          message: 'Incorrect password. Action cancelled.'
        });
      }

      const [reinstateGuardRows] = await pool.query(
        'SELECT id FROM users WHERE id = ? AND role = ?',
        [req.params.id, 'guard']
      );

      if (reinstateGuardRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Guard not found. No changes were made.'
        });
      }

      await pool.query(
        `UPDATE users
         SET is_active = 1, suspended_at = NULL
         WHERE id = ? AND role = ?`,
        [req.params.id, 'guard']
      );

      return res.json({
        success: true,
        message: 'Guard has been reinstated and is now Active.'
      });
    } catch (err) {
      console.error('Guard reinstatement failed:', err.message);

      return res.status(500).json({
        success: false,
        message: 'Failed to reinstate guard.'
      });
    }
  }
);

// Fire guard (permanent delete)
router.delete(
  '/:id/fire',
  authenticate,
  authorize('admin', 'manager'),
  async (req, res) => {
    try {
      const { password } = req.body;

      if (!password) {
        return res.status(400).json({
          success: false,
          message: 'Your password is required to perform this action.'
        });
      }

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
          message: 'Incorrect password. Action cancelled.'
        });
      }

      if (Number(req.params.id) === Number(req.user.id)) {
        return res.status(400).json({
          success: false,
          message: 'You cannot fire yourself.'
        });
      }

      const connection = await pool.getConnection();
      let result;

      try {
        await connection.beginTransaction();

        const [guardRows] = await connection.query(
          'SELECT id FROM users WHERE id = ? AND role = ? FOR UPDATE',
          [req.params.id, 'guard']
        );

        if (guardRows.length === 0) {
          await connection.rollback();

          return res.status(404).json({
            success: false,
            message: 'Guard not found. No records were deleted.'
          });
        }

        const linkedRecordChecks = [
          { table: 'attendance', sql: 'SELECT COUNT(*) AS total FROM attendance WHERE guard_id = ?' },
          { table: 'guard_locations', sql: 'SELECT COUNT(*) AS total FROM guard_locations WHERE guard_id = ?' },
          { table: 'guard_site_assignments', sql: 'SELECT COUNT(*) AS total FROM guard_site_assignments WHERE guard_id = ?' },
          { table: 'payroll_records', sql: 'SELECT COUNT(*) AS total FROM payroll_records WHERE guard_id = ?' },
          { table: 'scheduled_shifts', sql: 'SELECT COUNT(*) AS total FROM scheduled_shifts WHERE guard_id = ?' },
          { table: 'shift_cycles', sql: 'SELECT COUNT(*) AS total FROM shift_cycles WHERE guard_id = ?' }
        ];

        const linkedTables = [];

        for (const check of linkedRecordChecks) {
          const [rows] = await connection.query(
            check.sql,
            [req.params.id]
          );

          if (Number(rows[0].total) > 0) {
            linkedTables.push(check.table);
          }
        }

        if (linkedTables.length > 0) {
          await connection.rollback();

          return res.status(409).json({
            success: false,
            message:
              'Permanent deletion blocked to protect guard history. ' +
              'Use On Access instead. Linked records exist in: ' +
              linkedTables.join(', ') + '.',
            linked_tables: linkedTables
          });
        }

        const [deleteResult] = await connection.query(
          'DELETE FROM users WHERE id = ? AND role = ?',
          [req.params.id, 'guard']
        );

        if (deleteResult.affectedRows === 0) {
          await connection.rollback();

          return res.status(404).json({
            success: false,
            message: 'Guard not found. No records were deleted.'
          });
        }

        await connection.commit();
        result = deleteResult;
      } catch (transactionError) {
        await connection.rollback();
        throw transactionError;
      } finally {
        connection.release();
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: 'Guard not found.'
        });
      }

      return res.json({
        success: true,
        message: 'Guard has been permanently fired and removed from the system.'
      });
    } catch (err) {
      console.error('Guard deletion failed:', err.message);

      return res.status(500).json({
        success: false,
        message: 'Failed to fire guard.'
      });
    }
  }
);

/**
 * Reset a guard's password.
 *
 * If email succeeds, the temporary password is not returned.
 * If email is missing or fails, the temporary password is returned
 * only to the authenticated administrator performing this action.
 *
 * IMPORTANT: The frontend must display temp_password only in the
 * immediate reset result, and must not save it or log it.
 */
router.post(
  '/:id/reset-password',
  authenticate,
  authorize('admin', 'manager'),
  async (req, res) => {
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

      // Email is optional for password reset.
      const [guardRows] = await pool.query(
        `SELECT id, employee_code, full_name, email,
                is_active
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

      // Generate and hash a new temporary password.
      const tempPassword =
        `Jup-${crypto.randomBytes(12).toString('base64url')}`;

      const newHash = await bcrypt.hash(tempPassword, 10);

      const [result] = await pool.query(
        `UPDATE users
         SET password_hash = ?
         WHERE id = ? AND role = 'guard'`,
        [newHash, guard.id]
      );

      if (result.affectedRows === 0) {
        return res.status(500).json({
          success: false,
          message: 'Failed to update the guard password.'
        });
      }

      let emailSent = false;

      if (guard.email && guard.email.trim()) {
        try {
          emailSent = await sendTemporaryPasswordEmail({
            email: guard.email,
            fullName: guard.full_name,
            employeeCode: guard.employee_code,
            tempPassword,
            subject:
              'Your Jupiter Security Password Has Been Reset',
            actionDescription: 'has had its password reset'
          });
        } catch (mailError) {
          // Do not log the password or other credentials.
          console.error(
            'Password reset email failed:',
            mailError.message
          );
        }
      }

      return res.json({
        success: true,
        message: emailSent
          ? `Password reset successfully. Login details emailed to ${guard.email.trim()}.`
          : guard.email && guard.email.trim()
            ? 'Password reset successfully, but email delivery failed. Provide the temporary password to the guard securely.'
            : 'Password reset successfully. The guard has no email address; provide the temporary password securely.',
        guard_name: guard.full_name,
        employee_code: guard.employee_code,
        email_sent: emailSent,
        is_active: guard.is_active,
        ...(!emailSent
          ? { temp_password: tempPassword }
          : {})
      });
    } catch (err) {
      console.error('Password reset failed:', err.message);

      return res.status(500).json({
        success: false,
        message: 'The password reset could not be completed.'
      });
    }
  }
);

/**
 * Allow authenticated administrators and guards to change their own password.
 */
router.post(
  '/change-password',
  authenticate,
  authorize('admin', 'guard'),
  async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const allowedRoles = ['admin', 'guard'];
      const userRole = req.user.role;

      if (!allowedRoles.includes(userRole)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied.'
        });
      }

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          message: 'Enter your current password and your new password.'
        });
      }

      if (
        typeof newPassword !== 'string' ||
        newPassword.length < 4
      ) {
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
        `SELECT password_hash
         FROM users
         WHERE id = ? AND role = ?`,
        [req.user.id, userRole]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Your account was not found.'
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
        `UPDATE users
         SET password_hash = ?
         WHERE id = ? AND role = ?`,
        [newHash, req.user.id, userRole]
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
      console.error('Password change failed:', err.message);

      return res.status(500).json({
        success: false,
        message: 'Unable to change your password right now.'
      });
    }
  }
);
module.exports = router;

