const express = require('express');

const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

function getText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Convert a Namibia-local datetime to a UTC MySQL DATETIME string.
function toUtcDateTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}:00+02:00`);

  if (Number.isNaN(date.getTime())) return null;

  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const [hour, minute] = value.slice(11).split(':').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute));

  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute
  ) {
    return null;
  }

  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// ALL AUTHENTICATED ROLES: VIEW CURRENT ANNOUNCEMENTS
router.get(
  '/',
  authenticate,
  authorize('admin', 'manager', 'guard'),
  async (req, res) => {
    try {
      const [rows] = await pool.query(`
        SELECT
          a.id,
          a.title,
          a.message,
          a.published_at,
          a.expires_at,
          a.created_at,
          creator.full_name AS created_by_name,
          EXISTS (
            SELECT 1
            FROM announcement_reads ar
            WHERE ar.announcement_id = a.id
              AND ar.user_id = ?
          ) AS has_read
        FROM announcements a
        JOIN users creator ON creator.id = a.created_by
        WHERE a.published_at <= UTC_TIMESTAMP()
          AND (
            a.expires_at IS NULL
            OR a.expires_at > UTC_TIMESTAMP()
          )
        ORDER BY a.published_at DESC, a.id DESC
      `, [req.user.id]);

      res.json({ success: true, data: rows });
    } catch (err) {
      console.error('Failed to fetch announcements:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch announcements.'
      });
    }
  }
);

// ADMIN/MANAGER: CREATE AN ANNOUNCEMENT
router.post(
  '/',
  authenticate,
  authorize('admin', 'manager'),
  async (req, res) => {
    try {
      const title = getText(req.body.title);
      const message = getText(req.body.message);
      const expiryInput = getText(req.body.expires_at);

      if (!title || title.length > 180) {
        return res.status(400).json({
          success: false,
          message: 'A title is required (maximum 180 characters).'
        });
      }

      if (!message || message.length > 20000) {
        return res.status(400).json({
          success: false,
          message: 'A message is required (maximum 20,000 characters).'
        });
      }

      let expiresAt = null;

      if (expiryInput) {
        expiresAt = toUtcDateTime(expiryInput);

        if (!expiresAt) {
          return res.status(400).json({
            success: false,
            message: 'Please provide a valid expiry date and time.'
          });
        }

        if (new Date(`${expiresAt.replace(' ', 'T')}Z`).getTime() <= Date.now()) {
          return res.status(400).json({
            success: false,
            message: 'The expiry date and time must be in the future.'
          });
        }
      }

      const [result] = await pool.query(`
        INSERT INTO announcements (
          title,
          message,
          created_by,
          published_at,
          expires_at,
          created_at
        )
        VALUES (?, ?, ?, UTC_TIMESTAMP(), ?, UTC_TIMESTAMP())
      `, [
        title,
        message,
        req.user.id,
        expiresAt
      ]);

      res.status(201).json({
        success: true,
        message: 'Announcement published successfully.',
        data: { id: result.insertId }
      });
    } catch (err) {
      console.error('Failed to create announcement:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to publish announcement.'
      });
    }
  }
);

// ADMIN/MANAGER: VIEW WHICH GUARDS HAVE READ AN ANNOUNCEMENT
router.get(
  '/:id/readers',
  authenticate,
  authorize('admin', 'manager'),
  async (req, res) => {
    try {
      const announcementId = Number(req.params.id);

      if (!Number.isSafeInteger(announcementId) || announcementId < 1) {
        return res.status(400).json({
          success: false,
          message: 'Invalid announcement ID.'
        });
      }

      const [announcements] = await pool.query(
        'SELECT id, title FROM announcements WHERE id = ? LIMIT 1',
        [announcementId]
      );

      if (!announcements.length) {
        return res.status(404).json({
          success: false,
          message: 'Announcement not found.'
        });
      }

      const [readers] = await pool.query(`
        SELECT
          u.id AS user_id,
          u.employee_code,
          u.full_name,
          u.is_active,
          ar.read_at
        FROM users u
        LEFT JOIN announcement_reads ar
          ON ar.user_id = u.id
          AND ar.announcement_id = ?
        WHERE u.role = 'guard'
          AND u.is_active = 1
        ORDER BY
          CASE WHEN ar.read_at IS NULL THEN 1 ELSE 0 END ASC,
          ar.read_at ASC,
          u.full_name ASC
      `, [announcementId]);

      const readCount = readers.filter(row => row.read_at !== null).length;

      res.json({
        success: true,
        data: {
          announcement: announcements[0],
          total_guards: readers.length,
          read_count: readCount,
          unread_count: readers.length - readCount,
          readers
        }
      });
    } catch (err) {
      console.error('Failed to fetch announcement readers:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to fetch announcement readership.'
      });
    }
  }
);

// ALL ROLES: MARK AN ANNOUNCEMENT AS READ
router.post(
  '/:id/read',
  authenticate,
  authorize('admin', 'manager', 'guard'),
  async (req, res) => {
    try {
      const announcementId = Number(req.params.id);

      if (!Number.isSafeInteger(announcementId) || announcementId < 1) {
        return res.status(400).json({
          success: false,
          message: 'Invalid announcement ID.'
        });
      }

      const [result] = await pool.query(`
        INSERT INTO announcement_reads (
          announcement_id,
          user_id,
          read_at
        )
        SELECT id, ?, UTC_TIMESTAMP()
        FROM announcements
        WHERE id = ?
          AND published_at <= UTC_TIMESTAMP()
          AND (
            expires_at IS NULL
            OR expires_at > UTC_TIMESTAMP()
          )
        ON DUPLICATE KEY UPDATE
          read_at = read_at
      `, [req.user.id, announcementId]);

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: 'Current announcement not found.'
        });
      }

      res.json({
        success: true,
        message: 'Announcement marked as read.'
      });
    } catch (err) {
      console.error('Failed to mark announcement as read:', err);
      res.status(500).json({
        success: false,
        message: 'Failed to mark announcement as read.'
      });
    }
  }
);

module.exports = router;
