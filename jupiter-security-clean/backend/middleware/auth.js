const jwt = require('jsonwebtoken');
const pool = require('../config/db');

async function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No token provided.'
    });
  }

  const token = header.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const [rows] = await pool.query(
      `SELECT id, employee_code, full_name, role, job_title, is_active
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [decoded.id]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Account not found. Please log in again.'
      });
    }

    const user = rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: 'Account is deactivated. Contact management.'
      });
    }

    // Always use current database values, not role or identity
    // information supplied by an older JWT.
    req.user = {
      ...decoded,
      id: user.id,
      employee_code: user.employee_code,
      full_name: user.full_name,
      role: user.role,
      job_title: user.job_title
    };

    next();

  } catch (err) {
    console.error('Authentication error:', err);

    if (
      err.name === 'JsonWebTokenError' ||
      err.name === 'TokenExpiredError'
    ) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token.'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Authentication verification failed.'
    });
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden. Insufficient permissions.'
      });
    }

    next();
  };
}

// Read-only management access.
// A manager role alone does not grant management access.
function authorizeManagementRead(req, res, next) {
  const user = req.user;

  const allowed =
    user &&
    (
      user.role === 'admin' ||
      user.role === 'management_viewer' ||
      (
        user.role === 'manager' &&
        user.employee_code === 'JUP-MD-001'
      )
    );

  if (!allowed) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden. Management viewing access is required.'
    });
  }

  next();
}


// Allow guards and authorized management accounts to read announcements.
function authorizeManagementReadOrGuard(req, res, next) {
  if (req.user && req.user.role === 'guard') {
    return next();
  }
  return authorizeManagementRead(req, res, next);
}
// Management editing is restricted to Administrator
// and the specific Managing Director account.
function authorizeManagementEdit(req, res, next) {
  const user = req.user;

  const allowed =
    user &&
    (
      user.role === 'admin' ||
      (
        user.role === 'manager' &&
        user.employee_code === 'JUP-MD-001'
      )
    );

  if (!allowed) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden. Only the Administrator or Managing Director can make this change.'
    });
  }

  next();
}


// Guards may view their own guard-specific resources.
// Authorized management accounts may view management resources.
function authorizeGuardOrManagementRead(req, res, next) {
  if (req.user && req.user.role === 'guard') {
    return next();
  }

  return authorizeManagementRead(req, res, next);
}

// Salary Management is exclusively for the actual Managing Director account.
function authorizeManagingDirector(req, res, next) {
  const user = req.user;

  const allowed =
    user &&
    user.role === 'manager' &&
    user.employee_code === 'JUP-MD-001';

  if (!allowed) {
    return res.status(403).json({
      success: false,
      message: 'Forbidden. Only the Managing Director can access Salary Management.'
    });
  }

  next();
}

module.exports = {
  authorizeManagingDirector,
  authorizeGuardOrManagementRead,
  authenticate,
  authorize,
  authorizeManagementRead,
  authorizeManagementReadOrGuard,
  authorizeManagementEdit
};
