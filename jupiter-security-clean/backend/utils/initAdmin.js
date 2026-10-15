/**
 * Initialize / reset the default admin password
 * Run: node utils/initAdmin.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

async function init() {
  try {
    const password = 'Admin@123';
    const hash = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      `UPDATE users SET password_hash = ? WHERE employee_code = 'JUP-ADMIN-001'`,
      [hash]
    );

    if (result.affectedRows === 0) {
      // Insert if not exists
      await pool.query(
        `INSERT INTO users (employee_code, full_name, phone, email, password_hash, role, hourly_rate, is_active)
         VALUES ('JUP-ADMIN-001', 'Jupiter Administrator', '+264810000000', 'admin@jupitersecurity.na', ?, 'admin', 0, 1)`,
        [hash]
      );
      console.log('Admin user created.');
    } else {
      console.log('Admin password updated.');
    }

    console.log('----------------------------------------');
    console.log('  Employee Code : JUP-ADMIN-001');
    console.log('  Password      : Admin@123');
    console.log('----------------------------------------');
    console.log('Change this password after first login!');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

init();