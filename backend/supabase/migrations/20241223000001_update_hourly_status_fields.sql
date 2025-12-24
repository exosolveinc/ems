-- Update Hourly Status Table with New Fields
-- Description: Replaces status_type with work_status, adds task_id and blocker_description
-- Date: 2024-12-23

-- =============================================================================
-- ADD NEW COLUMNS TO HOURLY_STATUS TABLE
-- =============================================================================

-- Rename status_message to status_text for clarity
ALTER TABLE hourly_status RENAME COLUMN status_message TO status_text;

-- Drop the old status_type constraint and column
ALTER TABLE hourly_status DROP CONSTRAINT IF EXISTS hourly_status_status_type_check;
ALTER TABLE hourly_status DROP COLUMN IF EXISTS status_type;

-- Add task_id column (references tasks table)
ALTER TABLE hourly_status ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;

-- Add work_status column
ALTER TABLE hourly_status ADD COLUMN IF NOT EXISTS work_status TEXT
    CHECK (work_status IN ('progress', 'done', 'blocked'));

-- Add blocker_description column (for when work_status is 'blocked')
ALTER TABLE hourly_status ADD COLUMN IF NOT EXISTS blocker_description TEXT;

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_hourly_status_task_id ON hourly_status(task_id);
CREATE INDEX IF NOT EXISTS idx_hourly_status_work_status ON hourly_status(work_status);

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON COLUMN hourly_status.status_text IS 'Status update text describing current work';
COMMENT ON COLUMN hourly_status.task_id IS 'Reference to the task being worked on (optional)';
COMMENT ON COLUMN hourly_status.work_status IS 'Work status: progress, done, or blocked';
COMMENT ON COLUMN hourly_status.blocker_description IS 'Description of blocker when work_status is blocked';
