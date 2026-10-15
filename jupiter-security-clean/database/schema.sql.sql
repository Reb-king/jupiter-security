-- ============================================================
-- JUPITER SECURITY MANAGEMENT SYSTEM
-- Namibia | MySQL Schema
-- ============================================================

CREATE DATABASE IF NOT EXISTS jupiter_security
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE jupiter_security;

-- ------------------------------------------------------------
-- USERS (Admin / Manager / Security Guards)
-- ------------------------------------------------------------
CREATE TABLE users (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_code   VARCHAR(20)  NOT NULL UNIQUE,          -- e.g. JUP-SEC-001
  full_name       VARCHAR(120) NOT NULL,
  phone           VARCHAR(20),                            -- Namibia format e.g. +26481...
  email           VARCHAR(120) UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  role            ENUM('admin', 'manager', 'guard') NOT NULL DEFAULT 'guard',
  hourly_rate     DECIMAL(10,2) NOT NULL DEFAULT 0.00,   -- NAD per hour (can differ per guard)
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- SITES (Approved / Terminated)
-- ------------------------------------------------------------
CREATE TABLE sites (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  site_code       VARCHAR(20)  NOT NULL UNIQUE,          -- e.g. JUP-SITE-01
  name            VARCHAR(150) NOT NULL,
  address         VARCHAR(255),
  town            VARCHAR(80),                            -- e.g. Windhoek, Walvis Bay, Rundu
  latitude        DECIMAL(10,7),
  longitude       DECIMAL(10,7),
  geo_radius_m    INT UNSIGNED DEFAULT 150,               -- metres allowed for clock-in
  status          ENUM('approved', 'terminated') NOT NULL DEFAULT 'approved',
  notes           TEXT,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- GUARD ASSIGNED TO SITE
-- ------------------------------------------------------------
CREATE TABLE guard_site_assignments (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  guard_id        INT UNSIGNED NOT NULL,
  site_id         INT UNSIGNED NOT NULL,
  assigned_from   DATE NOT NULL,
  assigned_to     DATE NULL,                              -- NULL = still current
  is_current      TINYINT(1) NOT NULL DEFAULT 1,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (guard_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (site_id)  REFERENCES sites(id) ON DELETE CASCADE,
  INDEX idx_guard_current (guard_id, is_current)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- SHIFT CYCLES
-- Pattern: 7 Day shifts → 7 Night shifts → 1 Day Off (repeats)
-- Day: 06:00 – 18:00 | Night: 18:00 – 06:00
-- ------------------------------------------------------------
CREATE TABLE shift_cycles (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  guard_id        INT UNSIGNED NOT NULL,
  cycle_start_date DATE NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (guard_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE scheduled_shifts (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  guard_id        INT UNSIGNED NOT NULL,
  site_id         INT UNSIGNED NOT NULL,
  shift_date      DATE NOT NULL,                          -- date the shift starts
  shift_type      ENUM('day', 'night', 'off') NOT NULL,
  start_time      DATETIME NOT NULL,
  end_time        DATETIME NOT NULL,
  status          ENUM('scheduled', 'completed', 'missed', 'cancelled') NOT NULL DEFAULT 'scheduled',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (guard_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (site_id)  REFERENCES sites(id) ON DELETE CASCADE,
  UNIQUE KEY uq_guard_shift (guard_id, shift_date, shift_type),
  INDEX idx_date (shift_date),
  INDEX idx_guard_date (guard_id, shift_date)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- ATTENDANCE (Clock In / Clock Out)
-- ------------------------------------------------------------
CREATE TABLE attendance (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  guard_id        INT UNSIGNED NOT NULL,
  site_id         INT UNSIGNED NOT NULL,
  scheduled_shift_id INT UNSIGNED NULL,
  clock_in_at     DATETIME NOT NULL,
  clock_out_at    DATETIME NULL,
  clock_in_lat    DECIMAL(10,7),
  clock_in_lng    DECIMAL(10,7),
  clock_out_lat   DECIMAL(10,7),
  clock_out_lng   DECIMAL(10,7),
  clock_in_within_geofence  TINYINT(1) DEFAULT NULL,
  clock_out_within_geofence TINYINT(1) DEFAULT NULL,
  hours_worked    DECIMAL(6,2) NULL,
  notes           VARCHAR(255),
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (guard_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (site_id)  REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY (scheduled_shift_id) REFERENCES scheduled_shifts(id) ON DELETE SET NULL,
  INDEX idx_guard_date (guard_id, clock_in_at)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- LIVE LOCATION
-- ------------------------------------------------------------
CREATE TABLE guard_locations (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  guard_id        INT UNSIGNED NOT NULL UNIQUE,
  latitude        DECIMAL(10,7) NOT NULL,
  longitude       DECIMAL(10,7) NOT NULL,
  accuracy_m      DECIMAL(8,2),
  recorded_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (guard_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- PAYROLL (Namibia – NAD)
-- ------------------------------------------------------------
CREATE TABLE payroll_periods (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  status          ENUM('open', 'processing', 'paid', 'closed') NOT NULL DEFAULT 'open',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_period (period_start, period_end)
) ENGINE=InnoDB;

CREATE TABLE payroll_records (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  period_id       INT UNSIGNED NOT NULL,
  guard_id        INT UNSIGNED NOT NULL,
  total_hours     DECIMAL(8,2) NOT NULL DEFAULT 0,
  hourly_rate     DECIMAL(10,2) NOT NULL,                 -- NAD snapshot
  gross_amount    DECIMAL(12,2) NOT NULL DEFAULT 0,
  deductions      DECIMAL(12,2) NOT NULL DEFAULT 0,
  net_amount      DECIMAL(12,2) NOT NULL DEFAULT 0,
  calculated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (period_id) REFERENCES payroll_periods(id) ON DELETE CASCADE,
  FOREIGN KEY (guard_id)  REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_period_guard (period_id, guard_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- DEFAULT ADMIN (password will be set on first run)
-- ------------------------------------------------------------
INSERT INTO users (employee_code, full_name, phone, email, password_hash, role, hourly_rate, is_active)
VALUES (
  'JUP-ADMIN-001',
  'Jupiter Administrator',
  '+264810000000',
  'admin@jupitersecurity.na',
  '$2b$10$placeholder',
  'admin',
  0.00,
  1
);

SELECT 'Jupiter Security Management System database created successfully.' AS message;