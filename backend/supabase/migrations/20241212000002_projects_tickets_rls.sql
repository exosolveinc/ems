-- RLS Policies for Projects and Tickets Tables
-- Description: Row Level Security policies for project and ticket management
-- Date: 2024-12-12

-- =============================================================================
-- ENABLE RLS
-- =============================================================================

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- PROJECTS TABLE POLICIES
-- =============================================================================

-- All authenticated employees can view active projects
CREATE POLICY "Employees can view active projects"
ON projects FOR SELECT
TO authenticated
USING (status = 'active' OR status = 'inactive');

-- All authenticated employees can create projects
CREATE POLICY "Employees can create projects"
ON projects FOR INSERT
TO authenticated
WITH CHECK (true);

-- Admins and creators can update their projects
CREATE POLICY "Admins and creators can update projects"
ON projects FOR UPDATE
TO authenticated
USING (
  auth.uid() IN (
    SELECT id FROM employees WHERE role = 'admin'
  )
  OR auth.uid() = created_by
);

-- Only admins can delete projects
CREATE POLICY "Admins can delete projects"
ON projects FOR DELETE
TO authenticated
USING (
  auth.uid() IN (
    SELECT id FROM employees WHERE role = 'admin'
  )
);

-- =============================================================================
-- TICKETS TABLE POLICIES
-- =============================================================================

-- All authenticated employees can view tickets
CREATE POLICY "Employees can view tickets"
ON tickets FOR SELECT
TO authenticated
USING (true);

-- All authenticated employees can create tickets
CREATE POLICY "Employees can create tickets"
ON tickets FOR INSERT
TO authenticated
WITH CHECK (true);

-- Admins and creators can update their tickets
CREATE POLICY "Admins and creators can update tickets"
ON tickets FOR UPDATE
TO authenticated
USING (
  auth.uid() IN (
    SELECT id FROM employees WHERE role = 'admin'
  )
  OR auth.uid() = created_by
);

-- Admins and creators can delete their tickets
CREATE POLICY "Admins and creators can delete tickets"
ON tickets FOR DELETE
TO authenticated
USING (
  auth.uid() IN (
    SELECT id FROM employees WHERE role = 'admin'
  )
  OR auth.uid() = created_by
);
