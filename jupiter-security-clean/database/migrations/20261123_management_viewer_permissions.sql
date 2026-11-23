-- Jupiter Security Management System
-- Add the read-only management_viewer role and job_title metadata.
-- Run this against the LOCAL jupiter_security database first.
-- The migration is safe to re-run on MySQL 8.x.

USE jupiter_security;

-- Add job_title only when it is not already present.
SET @job_title_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'job_title'
);
SET @job_title_sql = IF(
  @job_title_exists = 0,
  'ALTER TABLE users ADD COLUMN job_title VARCHAR(100) NULL AFTER role',
  'SELECT 1'
);
PREPARE job_title_stmt FROM @job_title_sql;
EXECUTE job_title_stmt;
DEALLOCATE PREPARE job_title_stmt;

-- Preserve the existing roles and add management_viewer.
ALTER TABLE users
  MODIFY COLUMN role ENUM('admin', 'manager', 'guard', 'management_viewer')
  NOT NULL DEFAULT 'guard';

-- Confirm the final structure.
SHOW COLUMNS FROM users LIKE 'role';
SHOW COLUMNS FROM users LIKE 'job_title';
