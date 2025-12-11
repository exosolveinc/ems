-- Project and Ticket Management - Simple Schema Migration
-- Description: Creates tables for storing project names and ticket numbers for check-in selection
-- Date: 2024-12-12

-- =============================================================================
-- PROJECTS TABLE (For storing project names used by employees)
-- =============================================================================
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_name TEXT UNIQUE NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
    created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- TICKETS TABLE (For storing ticket numbers used by employees)
-- =============================================================================
CREATE TABLE IF NOT EXISTS tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    ticket_number TEXT NOT NULL,
    title TEXT,
    description TEXT,
    jira_url TEXT, -- Optional Jira link
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'closed')),
    created_by UUID REFERENCES employees(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, ticket_number)
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Projects
CREATE INDEX IF NOT EXISTS idx_projects_project_name ON projects(project_name);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by);

-- Tickets
CREATE INDEX IF NOT EXISTS idx_tickets_project_id ON tickets(project_id);
CREATE INDEX IF NOT EXISTS idx_tickets_ticket_number ON tickets(ticket_number);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_created_by ON tickets(created_by);

-- =============================================================================
-- TRIGGERS
-- =============================================================================

-- Update projects updated_at timestamp
CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Update tickets updated_at timestamp
CREATE TRIGGER update_tickets_updated_at
    BEFORE UPDATE ON tickets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON TABLE projects IS 'Project names available for selection during check-in';
COMMENT ON TABLE tickets IS 'Ticket numbers linked to projects for task tracking';

COMMENT ON COLUMN projects.status IS 'Project status: active, inactive, or archived';
COMMENT ON COLUMN tickets.jira_url IS 'Optional Jira ticket URL for external tracking';
