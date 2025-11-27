-- Employee Management System - Initial Schema
-- Description: Creates all necessary tables for the EMS application
-- Based on: /shared/types/database.types.ts

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- EMPLOYEES TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS employees (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    first_name TEXT,
    last_name TEXT,
    full_name TEXT, -- Used by Edge Functions for compatibility
    employee_id TEXT UNIQUE NOT NULL,
    designation TEXT,
    department TEXT,
    division TEXT,
    salary NUMERIC(12, 2),
    join_date DATE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'on_leave')),
    manager_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    profile_image_url TEXT,
    slack_user_id TEXT,
    role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('employee', 'manager', 'hr', 'admin')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- CHECK_INS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS check_ins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    check_in_time TIMESTAMPTZ DEFAULT NOW(),
    check_in_location TEXT,
    check_in_ip TEXT,
    check_in_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- CHECK_OUTS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS check_outs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    check_in_id UUID REFERENCES check_ins(id) ON DELETE CASCADE,
    check_out_time TIMESTAMPTZ DEFAULT NOW(),
    check_out_location TEXT,
    check_out_ip TEXT,
    check_out_notes TEXT,
    total_hours NUMERIC(5, 2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- VIOLATIONS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS violations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    violation_type TEXT NOT NULL CHECK (violation_type IN ('late_checkin', 'no_checkin', 'no_checkout', 'no_status_update', 'early_checkout')),
    violation_date DATE NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    description TEXT,
    escalated BOOLEAN DEFAULT false,
    escalated_to UUID REFERENCES employees(id) ON DELETE SET NULL,
    escalation_time TIMESTAMPTZ,
    resolved BOOLEAN DEFAULT false,
    resolved_at TIMESTAMPTZ,
    resolved_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- VACATION_REQUESTS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS vacation_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days INTEGER NOT NULL,
    days INTEGER NOT NULL, -- Alias for total_days (used by Edge Functions)
    vacation_type TEXT NOT NULL CHECK (vacation_type IN ('annual', 'sick', 'personal', 'unpaid')),
    reason TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    approved_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES employees(id) ON DELETE SET NULL, -- Used by Edge Functions
    reviewed_at TIMESTAMPTZ, -- Used by Edge Functions
    rejection_reason TEXT,
    review_notes TEXT, -- Used by Edge Functions
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_date_range CHECK (end_date >= start_date),
    CONSTRAINT positive_days CHECK (total_days > 0)
);

-- =============================================================================
-- TIMESHEETS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS timesheets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    week_start_date DATE NOT NULL,
    week_end_date DATE NOT NULL,
    total_hours NUMERIC(6, 2),
    entries JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of {date, hours, project, task, notes}
    notes TEXT,
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
    submitted_at TIMESTAMPTZ,
    approved_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES employees(id) ON DELETE SET NULL, -- Used by Edge Functions
    reviewed_at TIMESTAMPTZ, -- Used by Edge Functions
    rejection_reason TEXT,
    review_notes TEXT, -- Used by Edge Functions
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT valid_week_range CHECK (week_end_date >= week_start_date),
    CONSTRAINT positive_hours CHECK (total_hours >= 0 OR total_hours IS NULL),
    UNIQUE(employee_id, week_start_date, week_end_date)
);

-- =============================================================================
-- HOURLY_STATUS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS hourly_status (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    status_time TIMESTAMPTZ DEFAULT NOW(),
    status_type TEXT NOT NULL CHECK (status_type IN ('working', 'break', 'meeting', 'idle', 'away')),
    status_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- NOTIFICATIONS TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    read BOOLEAN DEFAULT false,
    link TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Employees
CREATE INDEX IF NOT EXISTS idx_employees_employee_id ON employees(employee_id);
CREATE INDEX IF NOT EXISTS idx_employees_email ON employees(email);
CREATE INDEX IF NOT EXISTS idx_employees_role ON employees(role);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department);
CREATE INDEX IF NOT EXISTS idx_employees_manager_id ON employees(manager_id);

-- Check-ins
CREATE INDEX IF NOT EXISTS idx_check_ins_employee_id ON check_ins(employee_id);
CREATE INDEX IF NOT EXISTS idx_check_ins_time ON check_ins(check_in_time);
CREATE INDEX IF NOT EXISTS idx_check_ins_employee_time ON check_ins(employee_id, check_in_time DESC);

-- Check-outs
CREATE INDEX IF NOT EXISTS idx_check_outs_employee_id ON check_outs(employee_id);
CREATE INDEX IF NOT EXISTS idx_check_outs_check_in_id ON check_outs(check_in_id);
CREATE INDEX IF NOT EXISTS idx_check_outs_time ON check_outs(check_out_time);

-- Violations
CREATE INDEX IF NOT EXISTS idx_violations_employee_id ON violations(employee_id);
CREATE INDEX IF NOT EXISTS idx_violations_date ON violations(violation_date DESC);
CREATE INDEX IF NOT EXISTS idx_violations_severity ON violations(severity);
CREATE INDEX IF NOT EXISTS idx_violations_resolved ON violations(resolved);
CREATE INDEX IF NOT EXISTS idx_violations_escalated ON violations(escalated);

-- Vacation Requests
CREATE INDEX IF NOT EXISTS idx_vacation_requests_employee_id ON vacation_requests(employee_id);
CREATE INDEX IF NOT EXISTS idx_vacation_requests_status ON vacation_requests(status);
CREATE INDEX IF NOT EXISTS idx_vacation_requests_dates ON vacation_requests(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_vacation_requests_approved_by ON vacation_requests(approved_by);

-- Timesheets
CREATE INDEX IF NOT EXISTS idx_timesheets_employee_id ON timesheets(employee_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_status ON timesheets(status);
CREATE INDEX IF NOT EXISTS idx_timesheets_week ON timesheets(week_start_date DESC, week_end_date);
CREATE INDEX IF NOT EXISTS idx_timesheets_approved_by ON timesheets(approved_by);

-- Hourly Status
CREATE INDEX IF NOT EXISTS idx_hourly_status_employee_id ON hourly_status(employee_id);
CREATE INDEX IF NOT EXISTS idx_hourly_status_time ON hourly_status(status_time DESC);
CREATE INDEX IF NOT EXISTS idx_hourly_status_type ON hourly_status(status_type);

-- Notifications
CREATE INDEX IF NOT EXISTS idx_notifications_employee_id ON notifications(employee_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- Function to update updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to tables with updated_at columns
CREATE TRIGGER update_employees_updated_at
    BEFORE UPDATE ON employees
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vacation_requests_updated_at
    BEFORE UPDATE ON vacation_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_timesheets_updated_at
    BEFORE UPDATE ON timesheets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE employees IS 'Stores employee profile information linked to Supabase Auth';
COMMENT ON TABLE check_ins IS 'Daily employee check-in records with location tracking';
COMMENT ON TABLE check_outs IS 'Daily employee check-out records with calculated work hours';
COMMENT ON TABLE violations IS 'Employee policy violations with escalation workflow';
COMMENT ON TABLE vacation_requests IS 'Employee vacation and leave requests with approval workflow';
COMMENT ON TABLE timesheets IS 'Weekly employee timesheets';
COMMENT ON TABLE hourly_status IS 'Hourly employee status updates for real-time tracking';
