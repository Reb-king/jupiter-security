/**
 * Jupiter Security Management System
 * Namibia | Node.js + Express + MySQL
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

const authRoutes      = require('./routes/auth');
const userRoutes      = require('./routes/users');
const siteRoutes      = require('./routes/sites');

const shiftRoutes     = require('./routes/shifts');
const attendanceRoutes = require('./routes/attendance');
const locationRoutes  = require('./routes/locations');
const incidentRoutes = require('./routes/incidents');
const announcementRoutes = require('./routes/announcements');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Serve frontend static files
const frontendPath = path.resolve(__dirname, '../frontend');
console.log('Frontend path:', frontendPath);
console.log('Frontend index exists:', require('fs').existsSync(path.join(frontendPath, 'index.html')));

app.use(express.static(frontendPath));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sites', siteRoutes);

app.use('/api/shifts', shiftRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/announcements', announcementRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    system: 'Jupiter Security Management System',
    country: 'Namibia',
    currency: 'NAD',
    time: new Date().toISOString()
  });
});

// Return JSON for unknown API endpoints
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found.'
  });
});
// Fallback to frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});
// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack || err.message);

  let status = err.status || 500;
  let message = 'Internal server error';

  if (err.name === 'MulterError') {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;

    message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Each attachment must be 10 MB or smaller.'
      : 'Invalid attachment upload. Please check the files and try again.';
  } else if (status >= 400 && status < 500) {
    message = err.message || 'Request could not be completed.';
  }

  res.status(status).json({
    success: false,
    message
  });
});

app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  JUPITER SECURITY MANAGEMENT SYSTEM`);
  console.log(`  Namibia | Running on port ${PORT}`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`========================================\n`);
});
