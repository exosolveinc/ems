-- Row Level Security (RLS) Policies
-- Description: Implements security policies for all tables

-- =============================================================================
-- ENABLE RLS
-- =============================================================================

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_outs ENABLE ROW LEVEL SECURITY;
ALTER TABLE violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vacation_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE hourly_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- EMPLOYEES POLICIES
-- =============================================================================

-- Employees can view their own profile
CREATE POLICY "employees_select_own"
    ON employees FOR SELECT
    USING (auth.uid() = id);

-- Managers and admins can view all employees
CREATE POLICY "employees_select_managers"
    ON employees FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM employees
            WHERE id = auth.uid()
            AND role IN ('manager', 'hr', 'admin')
        )
    );

-- Employees can update their own non-sensitive fields
CREATE POLICY "employees_update_own"
    ON employees FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (
        auth.uid() = id
        AND role = (SELECT role FROM employees WHERE id = auth.uid()) -- Cannot change own role
    );

-- Admins can update all employees
CREATE POLICY "employees_update_admin"
    ON employees FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM employees
            WHERE id = auth.uid()
            AND role = 'admin'
        )
    );

-- Admins can insert employees
CREATE POLICY "employees_insert_admin"
    ON employees FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM employees
            WHERE id = auth.uid()
            AND role = 'admin'
        )
    );

-- =============================================================================
-- CHECK-INS POLICIES
-- =============================================================================

-- Employees can view their own check-ins
CREATE POLICY "check_ins_select_own"
    ON check_ins FOR SELECT
    USING (auth.uid() = employee_id);

-- Managers and admins can view all check-ins
CREATE POLICY "check_ins_select_managers"
    ON check_ins FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM employees
            WHERE id = auth.uid()
            AND role IN ('manager', 'hr', 'admin')
        )
    );

-- Employees can insert their own check-ins
CREATE POLICY "check_ins_insert_own"
    ON check_ins FOR INSERT
    WITH CHECK (auth.uid() = employee_id);

-- =============================================================================
-- CHECK-OUTS POLICIES
-- =============================================================================

-- Employees can view their own check-outs
CREATE POLICY "check_outs_select_own"
    ON check_outs FOR SELECT
    USING (auth.uid() = employee_id);

-- Managers and admins can view all check-outs
CREATE POLICY "check_outs_select_managers"
    ON check_outs FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM employees
            WHERE id = auth.uid()
            AND role IN ('manager', 'hr', 'admin')
        )
    );

-- Employees can insert their own check-outs
CREATE POLICY "check_outs_insert_own"
    ON check_outs FOR INSERT
    WITH CHECK (auth.uid() = employee_id);

-- =============================================================================
-- VIOLATIONS POLICIES
-- =============================================================================

-- Employees can view their own violations
CREATE POLICY "violations_select_own"
    ON violations FOR SELECT
    USING (auth.uid() = employee_id);

-- Managers and admins can view all violations
CREATE POLICY "violations_select_managers"
    ON violations FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM employees
            WHERE id = auth.uid()
            AND role IN ('manager', 'hr', 'admin')
        )
    );

-- System can insert violations (service role only)
CREATE POLICY "violations_insert_system"
    ON violations FOR INSERT
    WITH CHECK (true); -- Will be restricted by service role key

-- Managers and admins can update violations (resolve them)
CREATE POLICY "violations_update_managers"
    ON violations FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM employees
            WHERE id = auth.uid()
            AND role IN ('manager', 'hr', 'admin')
        )
    );

-- =============================================================================
-- VACATION REQUESTS POLICIES
-- =============================================================================

-- Employees can view their own vacation requests
CREATE POLICY "vacation_requests_select_own"
    ON vacation_requests FOR SELECT
    USING (auth.uid() = employee_id);

-- Managers and admins can view all vacation requests
CREATE POLICY "vacation_requests_select_managers"
    ON vacation_requests FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM employees
            WHERE id = auth.uid()
            AND role IN ('manager', 'hr', 'admin')
        )
    );

-- Employees can create their own vacation requests
CREATE POLICY "vacation_requests_insert_own"
    ON vacation_requests FOR INSERT
    WITH CHECK (auth.uid() = employee_id);

-- Employees can update their own pending vacation requests
CREATE POLICY "vacation_requests_update_own"
    ON vacation_requests FOR UPDATE
    USING (
        auth.uid() = employee_id
        AND status = 'pending'
    )
    WITH CHECK (
        auth.uid() = employee_id
        AND status = 'pending' -- Can only update if still pending
    );

-- Managers and admins can update all vacation requests (approve/reject)
CREATE POLICY "vacation_requests_update_managers"
    ON vacation_requests FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM employees
            WHERE id = auth.uid()
            AND role IN ('manager', 'hr', 'admin')
        )
    );

-- Employees can delete their own pending vacation requests
CREATE POLICY "vacation_requests_delete_own"
    ON vacation_requests FOR DELETE
    USING (
        auth.uid() = employee_id
        AND status = 'pending'
    );

-- Admins can delete any vacation request
CREATE POLICY "vacation_requests_delete_admin"
    ON vacation_requests FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM employees
            WHERE id = auth.uid()
            AND role = 'admin'
        )
    );

-- =============================================================================
-- TIMESHEETS POLICIES
-- =============================================================================

-- Employees can view their own timesheets
CREATE POLICY "timesheets_select_own"
    ON timesheets FOR SELECT
    USING (auth.uid() = employee_id);

-- Managers and admins can view all timesheets
CREATE POLICY "timesheets_select_managers"
    ON timesheets FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM employees
            WHERE id = auth.uid()
            AND role IN ('manager', 'hr', 'admin')
        )
    );

-- Employees can create their own timesheets
CREATE POLICY "timesheets_insert_own"
    ON timesheets FOR INSERT
    WITH CHECK (auth.uid() = employee_id);

-- Employees can update their own non-approved timesheets
CREATE POLICY "timesheets_update_own"
    ON timesheets FOR UPDATE
    USING (
        auth.uid() = employee_id
        AND status != 'approved'
    )
    WITH CHECK (
        auth.uid() = employee_id
        AND status != 'approved'
    );

-- Managers and admins can update all timesheets (approve/reject)
CREATE POLICY "timesheets_update_managers"
    ON timesheets FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM employees
            WHERE id = auth.uid()
            AND role IN ('manager', 'hr', 'admin')
        )
    );

-- Employees can delete their own non-approved timesheets
CREATE POLICY "timesheets_delete_own"
    ON timesheets FOR DELETE
    USING (
        auth.uid() = employee_id
        AND status != 'approved'
    );

-- =============================================================================
-- HOURLY STATUS POLICIES
-- =============================================================================

-- Employees can view their own status
CREATE POLICY "hourly_status_select_own"
    ON hourly_status FOR SELECT
    USING (auth.uid() = employee_id);

-- Managers and admins can view all status
CREATE POLICY "hourly_status_select_managers"
    ON hourly_status FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM employees
            WHERE id = auth.uid()
            AND role IN ('manager', 'hr', 'admin')
        )
    );

-- Employees can insert their own status
CREATE POLICY "hourly_status_insert_own"
    ON hourly_status FOR INSERT
    WITH CHECK (auth.uid() = employee_id);

-- =============================================================================
-- NOTIFICATIONS POLICIES
-- =============================================================================

-- Employees can view their own notifications
CREATE POLICY "notifications_select_own"
    ON notifications FOR SELECT
    USING (auth.uid() = employee_id);

-- System can insert notifications (service role only)
CREATE POLICY "notifications_insert_system"
    ON notifications FOR INSERT
    WITH CHECK (true);

-- Employees can update their own notifications (mark as read)
CREATE POLICY "notifications_update_own"
    ON notifications FOR UPDATE
    USING (auth.uid() = employee_id)
    WITH CHECK (auth.uid() = employee_id);

-- Employees can delete their own notifications
CREATE POLICY "notifications_delete_own"
    ON notifications FOR DELETE
    USING (auth.uid() = employee_id);

-- =============================================================================
-- GRANT PERMISSIONS
-- =============================================================================

-- Grant authenticated users access to tables
GRANT SELECT, INSERT, UPDATE, DELETE ON employees TO authenticated;
GRANT SELECT, INSERT ON check_ins TO authenticated;
GRANT SELECT, INSERT ON check_outs TO authenticated;
GRANT SELECT ON violations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON vacation_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON timesheets TO authenticated;
GRANT SELECT, INSERT ON hourly_status TO authenticated;
GRANT SELECT, UPDATE, DELETE ON notifications TO authenticated;

-- Service role has full access (bypass RLS)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
