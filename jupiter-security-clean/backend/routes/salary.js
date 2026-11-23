const express = require('express');

const pool = require('../config/db');
const {
  authenticate,
  authorizeManagingDirector
} = require('../middleware/auth');

const router = express.Router();

function validId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function validYear(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 2000 && number <= 2100
    ? number : null;
}

function validMonth(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 12
    ? number : null;
}

function validDate(value) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function validAmount(value) {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !/^\d{1,10}(\.\d{1,2})?$/.test(String(value))
  ) return null;

  const amount = Math.round(Number(value) * 100);

  return Number.isSafeInteger(amount) && amount > 0
    ? amount : null;
}

function optionalNotes(value) {
  if (value === undefined || value === null || value === '') {
    return { valid: true, value: null };
  }

  if (typeof value !== 'string' || value.length > 1000) {
    return { valid: false };
  }

  return { valid: true, value: value.trim() || null };
}

function previousDay(date) {
  const [year, month, day] = date.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day - 1));

  return [
    previous.getUTCFullYear(),
    String(previous.getUTCMonth() + 1).padStart(2, '0'),
    String(previous.getUTCDate()).padStart(2, '0')
  ].join('-');
}

function sendDatabaseError(res, err, operation) {
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({
      success: false,
      message: 'A conflicting salary record already exists.'
    });
  }

  console.error(`${operation}:`, err);

  return res.status(500).json({
    success: false,
    message: `${operation}.`
  });
}

// All salary routes are restricted to the Managing Director.
router.use(authenticate, authorizeManagingDirector);

// ============================================================
// GET 1: EMPLOYEES
// ============================================================

router.get('/employees', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        id,
        employee_code,
        full_name,
        role,
        job_title,
        is_active
      FROM users
      WHERE employee_code <> 'JUP-MD-001'
        AND is_active = 1
      ORDER BY is_active DESC, full_name ASC
    `);

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Failed to fetch salary employees:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch employees.'
    });
  }
});

// ============================================================
// GET 2: SALARY RATE HISTORY
// ============================================================

router.get('/rates', async (req, res) => {
  try {
    const employeeId = req.query.employee_id
      ? validId(req.query.employee_id) : null;

    if (req.query.employee_id && !employeeId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid employee ID.'
      });
    }

    let sql = `
      SELECT
        r.id,
        r.employee_id,
        u.employee_code,
        u.full_name,
        u.is_active,
        r.monthly_salary,
        r.effective_from,
        r.effective_to,
        r.notes,
        r.created_at,
        creator.full_name AS created_by_name
      FROM employee_salary_rates r
      JOIN users u ON u.id = r.employee_id
      JOIN users creator ON creator.id = r.created_by
      WHERE u.employee_code <> 'JUP-MD-001'
    `;

    const params = [];

    if (employeeId) {
      sql += ' AND r.employee_id = ?';
      params.push(employeeId);
    }

    sql += ' ORDER BY u.full_name ASC, r.effective_from DESC, r.id DESC';

    const [rows] = await pool.query(sql, params);

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Failed to fetch salary rates:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch salary rates.'
    });
  }
});

// ============================================================
// GET 3: MONTHLY SALARY OBLIGATIONS
// ============================================================

router.get('/obligations', async (req, res) => {
  try {
    const employeeId = req.query.employee_id
      ? validId(req.query.employee_id) : null;

    const year = req.query.year
      ? validYear(req.query.year) : null;

    const month = req.query.month
      ? validMonth(req.query.month) : null;

    if (
      (req.query.employee_id && !employeeId) ||
      (req.query.year && !year) ||
      (req.query.month && !month)
    ) {
      return res.status(400).json({
        success: false,
        message: 'One or more salary filters are invalid.'
      });
    }

    let sql = `
      SELECT
        o.id,
        o.employee_id,
        u.employee_code,
        u.full_name,
        u.role,
        u.job_title,
        u.is_active,
        o.salary_rate_id,
        o.salary_year,
        o.salary_month,
        o.amount_due,
        o.due_date,
        o.notes,
        o.created_at,
        COALESCE(p.total_paid, 0.00) AS total_paid,
        GREATEST(
          o.amount_due - COALESCE(p.total_paid, 0.00),
          0.00
        ) AS balance,
        CASE
          WHEN COALESCE(p.total_paid, 0.00) >= o.amount_due
            THEN 'paid'
          WHEN o.due_date < CURDATE()
            THEN 'overdue'
          WHEN COALESCE(p.total_paid, 0.00) > 0
            THEN 'partially_paid'
          ELSE 'unpaid'
        END AS payment_status,
        creator.full_name AS created_by_name
      FROM salary_monthly_obligations o
      JOIN users u ON u.id = o.employee_id
      JOIN users creator ON creator.id = o.created_by
      LEFT JOIN (
        SELECT obligation_id, SUM(amount_paid) AS total_paid
        FROM salary_payments
        GROUP BY obligation_id
      ) p ON p.obligation_id = o.id
      WHERE u.employee_code <> 'JUP-MD-001'
    `;

    const params = [];

    if (employeeId) {
      sql += ' AND o.employee_id = ?';
      params.push(employeeId);
    }

    if (year) {
      sql += ' AND o.salary_year = ?';
      params.push(year);
    }

    if (month) {
      sql += ' AND o.salary_month = ?';
      params.push(month);
    }

    sql += `
      ORDER BY
        o.salary_year DESC,
        o.salary_month DESC,
        u.full_name ASC
    `;

    const [rows] = await pool.query(sql, params);

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Failed to fetch salary obligations:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch monthly salary obligations.'
    });
  }
});

// ============================================================
// GET 4: PAYMENT HISTORY
// ============================================================

router.get('/obligations/:id/payments', async (req, res) => {
  try {
    const obligationId = validId(req.params.id);

    if (!obligationId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid salary obligation ID.'
      });
    }

    const [obligations] = await pool.query(`
      SELECT
        o.id,
        o.employee_id,
        u.employee_code,
        u.full_name,
        u.is_active,
        o.salary_year,
        o.salary_month,
        o.amount_due,
        o.due_date
      FROM salary_monthly_obligations o
      JOIN users u ON u.id = o.employee_id
      WHERE o.id = ?
        AND u.employee_code <> 'JUP-MD-001'
      LIMIT 1
    `, [obligationId]);

    if (!obligations.length) {
      return res.status(404).json({
        success: false,
        message: 'Salary obligation not found.'
      });
    }

    const [payments] = await pool.query(`
      SELECT
        p.id,
        p.obligation_id,
        p.amount_paid,
        p.payment_date,
        p.payment_method,
        p.payment_reference,
        p.notes,
        p.created_at,
        creator.full_name AS created_by_name
      FROM salary_payments p
      JOIN users creator ON creator.id = p.created_by
      WHERE p.obligation_id = ?
      ORDER BY p.payment_date DESC, p.id DESC
    `, [obligationId]);

    const totalPaid = payments.reduce(
      (total, payment) => total + Number(payment.amount_paid), 0
    );

    res.json({
      success: true,
      data: {
        obligation: obligations[0],
        payments,
        total_paid: totalPaid,
        balance: Math.max(
          Number(obligations[0].amount_due) - totalPaid, 0
        )
      }
    });
  } catch (err) {
    console.error('Failed to fetch salary payment history:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment history.'
    });
  }
});

// ============================================================

// ============================================================
// GET 5: ALL SALARY PAYMENTS
// Supports employee, year and month filtering.
// Preserves transactions belonging to inactive employees.
// ============================================================

router.get('/payments', async (req, res) => {
  try {
    const employeeId = req.query.employee_id
      ? validId(req.query.employee_id) : null;

    const year = req.query.year
      ? validYear(req.query.year) : null;

    const month = req.query.month
      ? validMonth(req.query.month) : null;

    if (
      (req.query.employee_id && !employeeId) ||
      (req.query.year && !year) ||
      (req.query.month && !month)
    ) {
      return res.status(400).json({
        success: false,
        message: 'One or more payment filters are invalid.'
      });
    }

    let sql = `
      SELECT
        p.id,
        p.obligation_id,
        p.amount_paid,
        p.payment_date,
        p.payment_method,
        p.payment_reference,
        p.notes,
        p.created_at,

        o.employee_id,
        u.employee_code,
        u.full_name,
        u.is_active,

        o.salary_year,
        o.salary_month,
        o.amount_due,
        o.due_date,

        COALESCE(t.total_paid, 0.00) AS total_paid,

        GREATEST(
          o.amount_due - COALESCE(t.total_paid, 0.00),
          0.00
        ) AS balance,

        creator.full_name AS created_by_name

      FROM salary_payments p

      JOIN salary_monthly_obligations o
        ON o.id = p.obligation_id

      JOIN users u
        ON u.id = o.employee_id

      JOIN users creator
        ON creator.id = p.created_by

      LEFT JOIN (
        SELECT
          obligation_id,
          SUM(amount_paid) AS total_paid
        FROM salary_payments
        GROUP BY obligation_id
      ) t ON t.obligation_id = o.id

      WHERE u.employee_code <> 'JUP-MD-001'
    `;

    const params = [];

    if (employeeId) {
      sql += ' AND o.employee_id = ?';
      params.push(employeeId);
    }

    if (year) {
      sql += ' AND o.salary_year = ?';
      params.push(year);
    }

    if (month) {
      sql += ' AND o.salary_month = ?';
      params.push(month);
    }

    sql += `
      ORDER BY
        p.payment_date DESC,
        p.id DESC
    `;

    const [rows] = await pool.query(sql, params);

    return res.json({
      success: true,
      data: rows
    });

  } catch (err) {
    console.error('Failed to fetch all salary payments:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch salary payments.'
    });
  }
});
// POST 1: CREATE SALARY RATE
//
// Automatically closes an open previous rate on the day before
// the new effective date. Existing future or conflicting
// historical periods are never silently modified.
// ============================================================

router.post('/rates', async (req, res) => {
  const employeeId = validId(req.body.employee_id);
  const monthlySalary = validAmount(req.body.monthly_salary);
  const effectiveFrom = req.body.effective_from;
  const notes = optionalNotes(req.body.notes);

  if (!employeeId || !monthlySalary || !validDate(effectiveFrom) ||
      !notes.valid) {
    return res.status(400).json({
      success: false,
      message: 'Provide a valid employee, positive salary amount, effective date (YYYY-MM-DD), and notes.'
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [employees] = await connection.query(`
      SELECT id, employee_code, is_active
      FROM users
      WHERE id = ?
      FOR UPDATE
    `, [employeeId]);

    if (
      !employees.length ||
      employees[0].employee_code === 'JUP-MD-001' ||
      Number(employees[0].is_active) !== 1
    ) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'New salary rates are only allowed for active employees other than the Managing Director.'
      });
    }

    const [rates] = await connection.query(`
      SELECT id, effective_from, effective_to
      FROM employee_salary_rates
      WHERE employee_id = ?
      ORDER BY effective_from ASC, id ASC
      FOR UPDATE
    `, [employeeId]);

    // Never overwrite an existing rate beginning on or after
    // the proposed effective date.
    const futureConflict = rates.find(
      rate => rate.effective_from >= effectiveFrom
    );

    if (futureConflict) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: 'A salary rate already exists on or after this effective date. Resolve the existing period first.'
      });
    }

    // An open previous rate may be closed automatically.
    // A finite period extending into the new date is a conflict.
    const overlaps = rates.filter(
      rate => rate.effective_from < effectiveFrom &&
        (rate.effective_to === null ||
         rate.effective_to >= effectiveFrom)
    );

    if (overlaps.length > 1 ||
        overlaps.some(rate => rate.effective_to !== null)) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: 'Conflicting historical salary periods exist. Resolve them before adding this rate.'
      });
    }

    if (overlaps.length === 1) {
      await connection.query(`
        UPDATE employee_salary_rates
        SET effective_to = ?
        WHERE id = ?
          AND employee_id = ?
          AND effective_to IS NULL
      `, [
        previousDay(effectiveFrom),
        overlaps[0].id,
        employeeId
      ]);
    }

    const [result] = await connection.query(`
      INSERT INTO employee_salary_rates (
        employee_id,
        monthly_salary,
        effective_from,
        effective_to,
        notes,
        created_by
      )
      VALUES (?, ?, ?, NULL, ?, ?)
    `, [
      employeeId,
      (monthlySalary / 100).toFixed(2),
      effectiveFrom,
      notes.value,
      req.user.id
    ]);

    await connection.commit();

    res.status(201).json({
      success: true,
      message: 'Salary rate created successfully.',
      rate_id: result.insertId
    });
  } catch (err) {
    await connection.rollback();
    sendDatabaseError(res, err, 'Failed to create salary rate');
  } finally {
    connection.release();
  }
});

// ============================================================
// POST 2: CREATE MONTHLY SALARY OBLIGATION
//
// Amount due and due date are entered manually by the MD.
// No automatic salary generation takes place.
// ============================================================

router.post('/obligations', async (req, res) => {
  const employeeId = validId(req.body.employee_id);
  const salaryYear = validYear(req.body.salary_year);
  const salaryMonth = validMonth(req.body.salary_month);
  const amountDue = validAmount(req.body.amount_due);
  const dueDate = req.body.due_date;
  const salaryRateId = req.body.salary_rate_id === undefined ||
    req.body.salary_rate_id === null ||
    req.body.salary_rate_id === ''
      ? null : validId(req.body.salary_rate_id);
  const notes = optionalNotes(req.body.notes);

  if (
    !employeeId ||
    !salaryYear ||
    !salaryMonth ||
    !amountDue ||
    !validDate(dueDate) ||
    !notes.valid ||
    (req.body.salary_rate_id !== undefined &&
     req.body.salary_rate_id !== null &&
     req.body.salary_rate_id !== '' &&
     !salaryRateId)
  ) {
    return res.status(400).json({
      success: false,
      message: 'Provide valid employee, year, month, amount due, due date, optional salary rate ID and notes.'
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [employees] = await connection.query(`
      SELECT id, employee_code, is_active
      FROM users
      WHERE id = ?
      FOR UPDATE
    `, [employeeId]);

    if (
      !employees.length ||
      employees[0].employee_code === 'JUP-MD-001' ||
      Number(employees[0].is_active) !== 1
    ) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'Monthly obligations can only be created for active employees other than the Managing Director.'
      });
    }

    if (salaryRateId) {
      const [rates] = await connection.query(`
        SELECT id
        FROM employee_salary_rates
        WHERE id = ?
          AND employee_id = ?
          AND effective_from <= LAST_DAY(?)
          AND (effective_to IS NULL OR effective_to >= ?)
        LIMIT 1
      `, [
        salaryRateId,
        employeeId,
        `${salaryYear}-${String(salaryMonth).padStart(2, '0')}-01`,
        `${salaryYear}-${String(salaryMonth).padStart(2, '0')}-01`
      ]);

      if (!rates.length) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: 'The selected salary rate does not belong to this employee or does not cover the selected month.'
        });
      }
    }

    const [result] = await connection.query(`
      INSERT INTO salary_monthly_obligations (
        employee_id,
        salary_rate_id,
        salary_year,
        salary_month,
        amount_due,
        due_date,
        notes,
        created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      employeeId,
      salaryRateId,
      salaryYear,
      salaryMonth,
      (amountDue / 100).toFixed(2),
      dueDate,
      notes.value,
      req.user.id
    ]);

    await connection.commit();

    res.status(201).json({
      success: true,
      message: 'Monthly salary obligation recorded successfully.',
      obligation_id: result.insertId
    });
  } catch (err) {
    await connection.rollback();
    sendDatabaseError(res, err, 'Failed to create monthly salary obligation');
  } finally {
    connection.release();
  }
});

// ============================================================
// POST 3: RECORD PAYMENT
//
// Locks the obligation and checks its outstanding balance
// inside a transaction to prevent overpayments.
// ============================================================

router.post('/obligations/:id/payments', async (req, res) => {
  const obligationId = validId(req.params.id);
  const amountPaid = validAmount(req.body.amount_paid);
  const paymentDate = req.body.payment_date;
  const paymentMethod = req.body.payment_method;
  const reference = req.body.payment_reference;
  const notes = optionalNotes(req.body.notes);

  const allowedMethods = [
    'cash',
    'bank_transfer',
    'cheque',
    'other'
  ];

  if (
    !obligationId ||
    !amountPaid ||
    !validDate(paymentDate) ||
    !allowedMethods.includes(paymentMethod) ||
    (reference !== undefined &&
     reference !== null &&
     reference !== '' &&
     (typeof reference !== 'string' || reference.length > 120)) ||
    !notes.valid
  ) {
    return res.status(400).json({
      success: false,
      message: 'Provide a valid obligation ID, positive payment amount, payment date, payment method, optional reference and notes.'
    });
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [obligations] = await connection.query(`
      SELECT
        o.id,
        o.amount_due,
        u.employee_code
      FROM salary_monthly_obligations o
      JOIN users u ON u.id = o.employee_id
      WHERE o.id = ?
      FOR UPDATE
    `, [obligationId]);

    if (
      !obligations.length ||
      obligations[0].employee_code === 'JUP-MD-001'
    ) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'Salary obligation not found.'
      });
    }

    const [totals] = await connection.query(`
      SELECT COALESCE(SUM(amount_paid), 0.00) AS total_paid
      FROM salary_payments
      WHERE obligation_id = ?
    `, [obligationId]);

    const amountDueCents = Math.round(
      Number(obligations[0].amount_due) * 100
    );

    const totalPaidCents = Math.round(
      Number(totals[0].total_paid) * 100
    );

    const balanceCents = amountDueCents - totalPaidCents;

    if (balanceCents <= 0) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: 'This salary obligation has already been fully paid.'
      });
    }

    if (amountPaid > balanceCents) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: 'Payment exceeds the outstanding salary balance.',
        outstanding_balance: (balanceCents / 100).toFixed(2)
      });
    }

    const [result] = await connection.query(`
      INSERT INTO salary_payments (
        obligation_id,
        amount_paid,
        payment_date,
        payment_method,
        payment_reference,
        notes,
        created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      obligationId,
      (amountPaid / 100).toFixed(2),
      paymentDate,
      paymentMethod,
      reference || null,
      notes.value,
      req.user.id
    ]);

    const newBalance = balanceCents - amountPaid;

    await connection.commit();

    res.status(201).json({
      success: true,
      message: 'Salary payment recorded successfully.',
      payment_id: result.insertId,
      total_paid: ((totalPaidCents + amountPaid) / 100).toFixed(2),
      balance: (newBalance / 100).toFixed(2),
      payment_status: newBalance === 0
        ? 'paid' : 'partially_paid'
    });
  } catch (err) {
    await connection.rollback();
    sendDatabaseError(res, err, 'Failed to record salary payment');
  } finally {
    connection.release();
  }
});

module.exports = router;


