const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const pool = require('../config/db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

const uploadDirectory = path.resolve(__dirname, '../uploads/incidents');

fs.mkdirSync(uploadDirectory, { recursive: true });

const MAX_FILES = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const allowedTypes = {
  'image/jpeg': { extension: 'jpg', category: 'image' },
  'image/png': { extension: 'png', category: 'image' },
  'image/webp': { extension: 'webp', category: 'image' },
  'application/pdf': { extension: 'pdf', category: 'document' }
};

const storage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, uploadDirectory);
  },
  filename: (req, file, callback) => {
    callback(null, `${crypto.randomUUID()}.upload`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
    fields: 8,
    fieldSize: 20000
  }
});

function cleanupFiles(files) {
  if (!Array.isArray(files)) return;

  for (const file of files) {
    if (file && file.path) {
      try {
        fs.unlinkSync(file.path);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error('Incident file cleanup failed:', error.message);
        }
      }
    }
  }
}

function handleUpload(req, res, next) {
  upload.array('attachments', MAX_FILES)(req, res, (error) => {
    if (error) {
      cleanupFiles(req.files);
      return next(error);
    }

    next();
  });
}

function getText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

function validTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value);
}

function safeOriginalName(value) {
  return path.basename(value || 'attachment')
    .replace(/[^\w.\- ]/g, '_')
    .slice(0, 255) || 'attachment';
}

async function getFileType(filePath) {
  const module = await import('file-type');
  return module.fileTypeFromFile(filePath);
}

// GUARD: GET TODAY'S SCHEDULED SITE FOR INCIDENT LOCATION
router.get('/my-location', authenticate, authorize('guard'), async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.id, s.name, s.address
      FROM scheduled_shifts ss
      JOIN users u ON u.id = ss.guard_id
      JOIN sites s ON s.id = ss.site_id
      WHERE ss.guard_id = ?
        AND ss.shift_date = CURDATE()
        AND u.role = 'guard'
        AND u.is_active = 1
      ORDER BY ss.id DESC
      LIMIT 1
    `, [req.user.id]);

    const site = rows.length
      ? {
          id: rows[0].id,
          name: rows[0].name,
          address: rows[0].address || ''
        }
      : null;

    res.json({ success: true, data: site });
  } catch (err) {
    console.error('Failed to fetch guard scheduled site:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch your scheduled site.'
    });
  }
});
// GUARD: SUBMIT AN INCIDENT REPORT
router.post(
  '/',
  authenticate,
  authorize('guard'),
  handleUpload,
  async (req, res, next) => {
    const files = req.files || [];
    const finalFiles = [];
    let connection;

    try {
      const incidentDate = getText(req.body.incident_date);
      const incidentTime = getText(req.body.incident_time);
      const location = getText(req.body.location);
      const incidentType = getText(req.body.incident_type);
      const peopleInvolved = getText(req.body.people_involved);
      const description = getText(req.body.description);
      const actionsTaken = getText(req.body.actions_taken);
      const witness = getText(req.body.witness);

      if (!validDate(incidentDate)) {
        throw Object.assign(new Error('A valid incident date is required.'), { status: 400 });
      }

      if (!validTime(incidentTime)) {
        throw Object.assign(new Error('A valid incident time is required.'), { status: 400 });
      }

      if (!location || location.length > 255) {
        throw Object.assign(new Error('Location is required (maximum 255 characters).'), { status: 400 });
      }

      if (!incidentType || incidentType.length > 120) {
        throw Object.assign(new Error('Incident type is required (maximum 120 characters).'), { status: 400 });
      }

      if (!description || description.length > 20000) {
        throw Object.assign(new Error('Description is required (maximum 20,000 characters).'), { status: 400 });
      }

      if (peopleInvolved.length > 10000 ||
          actionsTaken.length > 10000 ||
          witness.length > 10000) {
        throw Object.assign(new Error('One or more optional fields are too long.'), { status: 400 });
      }

      const preparedAttachments = [];

      for (const file of files) {
        const detected = await getFileType(file.path);

        if (!detected || !allowedTypes[detected.mime]) {
          throw Object.assign(
            new Error(`Unsupported attachment type: ${safeOriginalName(file.originalname)}. Use JPG, PNG, WebP or PDF.`),
            { status: 400 }
          );
        }

        const allowed = allowedTypes[detected.mime];
        const finalName = `${crypto.randomUUID()}.${allowed.extension}`;
        const finalPath = path.join(uploadDirectory, finalName);

        fs.renameSync(file.path, finalPath);

        finalFiles.push({ path: finalPath });

        preparedAttachments.push({
          file_name: safeOriginalName(file.originalname),
          file_path: `uploads/incidents/${finalName}`,
          file_type: allowed.category
        });
      }

      connection = await pool.getConnection();
      await connection.beginTransaction();

      const [result] = await connection.execute(
        `INSERT INTO incident_reports
         (guard_id, incident_date, incident_time, location,
          incident_type, people_involved, description,
          actions_taken, witness)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.user.id,
          incidentDate,
          incidentTime,
          location,
          incidentType,
          peopleInvolved || null,
          description,
          actionsTaken || null,
          witness || null
        ]
      );

      for (const attachment of preparedAttachments) {
        await connection.execute(
          `INSERT INTO incident_attachments
           (incident_id, file_name, file_path, file_type)
           VALUES (?, ?, ?, ?)`,
          [
            result.insertId,
            attachment.file_name,
            attachment.file_path,
            attachment.file_type
          ]
        );
      }

      await connection.commit();

      res.status(201).json({
        success: true,
        message: 'Incident report submitted successfully.',
        incident_id: result.insertId,
        attachments: preparedAttachments.length
      });
    } catch (error) {
      if (connection) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          console.error('Incident rollback failed:', rollbackError.message);
        }
      }

      cleanupFiles(files);
      cleanupFiles(finalFiles);

      next(error);
    } finally {
      if (connection) connection.release();
    }
  }
);

// ADMIN / MANAGER: VIEW UNCLEARED REPORTS
router.get(
  '/',
  authenticate,
  authorize('admin', 'manager'),
  async (req, res, next) => {
    try {
      const [reports] = await pool.execute(
        `SELECT
           r.id,
           r.guard_id,
           r.incident_date,
           r.incident_time,
           r.location,
           r.incident_type,
           r.people_involved,
           r.description,
           r.actions_taken,
           r.witness,
           r.submitted_at,
           u.full_name,
           u.employee_code
         FROM incident_reports r
         INNER JOIN users u ON u.id = r.guard_id
         WHERE r.cleared_at IS NULL
         ORDER BY r.submitted_at DESC, r.id DESC`
      );

      if (reports.length === 0) {
        return res.json({ success: true, reports: [] });
      }

      const ids = reports.map(report => report.id);
      const placeholders = ids.map(() => '?').join(',');

      const [attachments] = await pool.execute(
        `SELECT id, incident_id, file_name, file_type, uploaded_at
         FROM incident_attachments
         WHERE incident_id IN (${placeholders})
         ORDER BY id ASC`,
        ids
      );

      const attachmentMap = new Map();

      for (const attachment of attachments) {
        if (!attachmentMap.has(attachment.incident_id)) {
          attachmentMap.set(attachment.incident_id, []);
        }

        attachmentMap.get(attachment.incident_id).push(attachment);
      }

      const result = reports.map(report => ({
        ...report,
        attachments: attachmentMap.get(report.id) || []
      }));

      res.json({ success: true, reports: result });
    } catch (error) {
      next(error);
    }
  }
);

// ADMIN / MANAGER: CLEAR ONE REPORT
router.put(
  '/:id/clear',
  authenticate,
  authorize('admin', 'manager'),
  async (req, res, next) => {
    try {
      const incidentId = Number(req.params.id);

      if (!Number.isSafeInteger(incidentId) || incidentId < 1) {
        return res.status(400).json({
          success: false,
          message: 'Invalid incident report ID.'
        });
      }

      const [result] = await pool.execute(
        `UPDATE incident_reports
         SET cleared_at = NOW(), cleared_by = ?
         WHERE id = ? AND cleared_at IS NULL`,
        [req.user.id, incidentId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: 'Incident report not found or already cleared.'
        });
      }

      res.json({
        success: true,
        message: 'Incident report cleared successfully.'
      });
    } catch (error) {
      next(error);
    }
  }
);

// SECURE ATTACHMENT ACCESS
router.get(
  '/:incidentId/attachments/:attachmentId',
  authenticate,
  authorize('guard', 'admin', 'manager'),
  async (req, res, next) => {
    try {
      const incidentId = Number(req.params.incidentId);
      const attachmentId = Number(req.params.attachmentId);

      if (
        !Number.isSafeInteger(incidentId) || incidentId < 1 ||
        !Number.isSafeInteger(attachmentId) || attachmentId < 1
      ) {
        return res.status(400).json({
          success: false,
          message: 'Invalid attachment request.'
        });
      }

      const [rows] = await pool.execute(
        `SELECT
           a.file_name,
           a.file_path,
           a.file_type,
           r.guard_id
         FROM incident_attachments a
         INNER JOIN incident_reports r ON r.id = a.incident_id
         WHERE a.id = ? AND r.id = ?`,
        [attachmentId, incidentId]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Attachment not found.'
        });
      }

      const attachment = rows[0];

      if (
        req.user.role === 'guard' &&
        Number(req.user.id) !== Number(attachment.guard_id)
      ) {
        return res.status(403).json({
          success: false,
          message: 'You cannot access another guard’s attachment.'
        });
      }

      const fullPath = path.resolve(__dirname, '..', attachment.file_path);

      if (!fullPath.startsWith(uploadDirectory + path.sep)) {
        return res.status(403).json({
          success: false,
          message: 'Invalid attachment path.'
        });
      }

      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({
          success: false,
          message: 'Attachment file is missing.'
        });
      }

      res.setHeader('X-Content-Type-Options', 'nosniff');

      // VIEW IMAGE OR PDF IN THE BROWSER
      if (req.query.view === '1') {
        const detected = await getFileType(fullPath);

        if (!detected || !allowedTypes[detected.mime]) {
          return res.status(415).json({
            success: false,
            message: 'Unsupported attachment viewing format.'
          });
        }

        res.setHeader('Content-Type', detected.mime);
        res.setHeader(
          'Content-Disposition',
          'inline; filename="' + safeOriginalName(attachment.file_name) + '"'
        );

        return res.sendFile(fullPath);
      }

      // KEEP EXISTING DOWNLOAD BEHAVIOUR
      res.download(fullPath, attachment.file_name);
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;

