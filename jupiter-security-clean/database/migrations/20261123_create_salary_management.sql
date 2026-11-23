-- JSMS Salary Management
-- Separate from legacy payroll tables.
-- Currency: NAD.

CREATE TABLE IF NOT EXISTS employee_salary_rates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  monthly_salary DECIMAL(12,2) NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  notes VARCHAR(1000) NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_salary_rate_employee
    FOREIGN KEY (employee_id) REFERENCES users(id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_salary_rate_creator
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE RESTRICT,

  CONSTRAINT chk_salary_rate_amount
    CHECK (monthly_salary > 0),

  CONSTRAINT chk_salary_rate_dates
    CHECK (effective_to IS NULL OR effective_to >= effective_from),

  UNIQUE KEY uq_employee_salary_effective (employee_id, effective_from),
  INDEX idx_salary_rate_employee_dates (employee_id, effective_from, effective_to)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS salary_monthly_obligations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  salary_rate_id INT UNSIGNED NULL,
  salary_year SMALLINT UNSIGNED NOT NULL,
  salary_month TINYINT UNSIGNED NOT NULL,
  amount_due DECIMAL(12,2) NOT NULL,
  due_date DATE NOT NULL,
  notes VARCHAR(1000) NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_salary_obligation_employee
    FOREIGN KEY (employee_id) REFERENCES users(id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_salary_obligation_rate
    FOREIGN KEY (salary_rate_id) REFERENCES employee_salary_rates(id)
    ON DELETE SET NULL,

  CONSTRAINT fk_salary_obligation_creator
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE RESTRICT,

  CONSTRAINT chk_salary_obligation_amount
    CHECK (amount_due > 0),

  CONSTRAINT chk_salary_obligation_month
    CHECK (salary_month BETWEEN 1 AND 12),

  UNIQUE KEY uq_employee_salary_month (employee_id, salary_year, salary_month),
  INDEX idx_salary_obligation_due (due_date),
  INDEX idx_salary_obligation_employee (employee_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS salary_payments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  obligation_id INT UNSIGNED NOT NULL,
  amount_paid DECIMAL(12,2) NOT NULL,
  payment_date DATE NOT NULL,
  payment_method ENUM('cash','bank_transfer','cheque','other') NOT NULL,
  payment_reference VARCHAR(120) NULL,
  notes VARCHAR(1000) NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_salary_payment_obligation
    FOREIGN KEY (obligation_id) REFERENCES salary_monthly_obligations(id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_salary_payment_creator
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE RESTRICT,

  CONSTRAINT chk_salary_payment_amount
    CHECK (amount_paid > 0),

  INDEX idx_salary_payment_obligation (obligation_id),
  INDEX idx_salary_payment_date (payment_date)
) ENGINE=InnoDB;
