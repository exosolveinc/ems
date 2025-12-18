-- Convert Tickets to Tasks - Schema Migration
-- Description: Transforms tickets table into tasks table with comprehensive task management fields
-- Date: 2024-12-18

-- =============================================================================
-- DROP EXISTING TICKETS TABLE AND RECREATE AS TASKS
-- =============================================================================

-- Drop existing tickets table (and its dependencies)
DROP TABLE IF EXISTS tickets CASCADE;

-- =============================================================================
-- TASKS TABLE (Comprehensive task management)
-- =============================================================================
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Basic Info
    task_type TEXT NOT NULL CHECK (task_type IN ('story', 'bug', 'task', 'epic', 'spike')),
    title TEXT NOT NULL,
    description TEXT,
    ticket_number TEXT NOT NULL,

    -- Project Reference
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,

    -- Priority & Estimation
    priority TEXT DEFAULT 'medium' CHECK (priority IN ('critical', 'high', 'medium', 'low')),
    story_points INTEGER CHECK (story_points IN (1, 2, 3, 5, 8, 13, 21)),
    complexity TEXT CHECK (complexity IN ('Low', 'Medium', 'High')),

    -- Time Estimation
    time_estimation_days INTEGER DEFAULT 0 CHECK (time_estimation_days >= 0),
    time_estimation_hours INTEGER DEFAULT 0 CHECK (time_estimation_hours >= 0 AND time_estimation_hours < 24),
    time_estimation_minutes INTEGER DEFAULT 0 CHECK (time_estimation_minutes >= 0 AND time_estimation_minutes < 60),

    -- Status
    status TEXT DEFAULT 'Backlog' CHECK (status IN ('Backlog', 'Ready', 'In Progress', 'In Review', 'Done')),

    -- Assignment
    assigned_employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    reviewer_id UUID REFERENCES employees(id) ON DELETE SET NULL,

    -- Technical Details
    technology_stack TEXT[] DEFAULT '{}',

    -- Attachments & Links
    file_urls TEXT[] DEFAULT '{}', -- Array of uploaded file URLs (images/PDFs)
    link_url TEXT, -- External link (e.g., Jira, GitHub, etc.)

    -- Audit
    created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Constraints
    UNIQUE(project_id, ticket_number)
);

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_ticket_number ON tasks(ticket_number);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
CREATE INDEX IF NOT EXISTS idx_tasks_task_type ON tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_employee_id ON tasks(assigned_employee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_reviewer_id ON tasks(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- Update tasks updated_at timestamp
CREATE TRIGGER update_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Admin: Full access
CREATE POLICY "admin_tasks_all" ON tasks
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM employees
            WHERE employees.id = auth.uid()
            AND employees.role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM employees
            WHERE employees.id = auth.uid()
            AND employees.role = 'admin'
        )
    );

-- Manager: Full access
CREATE POLICY "manager_tasks_all" ON tasks
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM employees
            WHERE employees.id = auth.uid()
            AND employees.role = 'manager'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM employees
            WHERE employees.id = auth.uid()
            AND employees.role = 'manager'
        )
    );

-- HR: Can view all tasks
CREATE POLICY "hr_tasks_select" ON tasks
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM employees
            WHERE employees.id = auth.uid()
            AND employees.role = 'hr'
        )
    );

-- Employees: Can view all tasks but only update their own
CREATE POLICY "employee_tasks_select" ON tasks
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM employees
            WHERE employees.id = auth.uid()
        )
    );

-- Employees can update tasks assigned to them or created by them
CREATE POLICY "employee_tasks_update" ON tasks
    FOR UPDATE
    TO authenticated
    USING (
        assigned_employee_id = auth.uid()
        OR created_by = auth.uid()
        OR reviewer_id = auth.uid()
    )
    WITH CHECK (
        assigned_employee_id = auth.uid()
        OR created_by = auth.uid()
        OR reviewer_id = auth.uid()
    );

-- Employees can create tasks
CREATE POLICY "employee_tasks_insert" ON tasks
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM employees
            WHERE employees.id = auth.uid()
        )
    );

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE tasks IS 'Comprehensive task management with assignment, estimation, and tracking';
COMMENT ON COLUMN tasks.task_type IS 'Type of task: story, bug, task, epic, spike';
COMMENT ON COLUMN tasks.priority IS 'Task priority: critical, high, medium, low';
COMMENT ON COLUMN tasks.story_points IS 'Agile story points: 1, 2, 3, 5, 8, 13, 21';
COMMENT ON COLUMN tasks.complexity IS 'Task complexity level: Low, Medium, High';
COMMENT ON COLUMN tasks.time_estimation_days IS 'Estimated days to complete';
COMMENT ON COLUMN tasks.time_estimation_hours IS 'Estimated hours (0-23)';
COMMENT ON COLUMN tasks.time_estimation_minutes IS 'Estimated minutes (0-59)';
COMMENT ON COLUMN tasks.technology_stack IS 'Array of technologies used for this task';
COMMENT ON COLUMN tasks.file_urls IS 'Array of uploaded file URLs (images/PDFs)';
COMMENT ON COLUMN tasks.link_url IS 'External link (Jira, GitHub, etc.)';
COMMENT ON COLUMN tasks.reviewer_id IS 'Employee who reviews/assigns the task';

-- =============================================================================
-- STORAGE BUCKET FOR TASK ATTACHMENTS
-- =============================================================================

-- Create storage bucket for task attachments (images and PDFs)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'task-attachments',
    'task-attachments',
    false,
    10485760, -- 10MB limit per file
    ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- STORAGE POLICIES FOR TASK ATTACHMENTS
-- =============================================================================

-- Allow authenticated users to upload files
CREATE POLICY "authenticated_upload_task_attachments"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
    bucket_id = 'task-attachments'
    AND (storage.foldername(name))[1] IS NOT NULL
);

-- Allow authenticated users to view files
CREATE POLICY "authenticated_view_task_attachments"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'task-attachments');

-- Allow authenticated users to update their own files
CREATE POLICY "authenticated_update_task_attachments"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'task-attachments')
WITH CHECK (bucket_id = 'task-attachments');

-- Allow admins and managers to delete any file, others can delete files in tasks they have access to
CREATE POLICY "authenticated_delete_task_attachments"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'task-attachments');
