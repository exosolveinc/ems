-- Update Check-ins Table for Task-based Check-in
-- Description: Adds task_ids array, confidence_score, difficulty_level, and work_location to check_ins
-- Date: 2024-12-19

-- =============================================================================
-- ADD NEW COLUMNS TO CHECK_INS TABLE
-- =============================================================================

-- Add task_ids array column (references tasks table)
ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS task_ids UUID[] DEFAULT '{}';

-- Add confidence_score (1-10 scale)
ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS confidence_score INTEGER CHECK (confidence_score >= 1 AND confidence_score <= 10);

-- Add difficulty_level (1-10 scale)
ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS difficulty_level INTEGER CHECK (difficulty_level >= 1 AND difficulty_level <= 10);

-- Add work_location
ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS work_location TEXT CHECK (work_location IN ('home', 'office', 'hybrid', 'other'));

-- =============================================================================
-- DROP UNUSED COLUMNS (optional - keeping for backward compatibility)
-- =============================================================================

-- Remove check_in_ip column (no longer needed)
ALTER TABLE check_ins DROP COLUMN IF EXISTS check_in_ip;

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_check_ins_task_ids ON check_ins USING GIN (task_ids);
CREATE INDEX IF NOT EXISTS idx_check_ins_work_location ON check_ins(work_location);

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON COLUMN check_ins.task_ids IS 'Array of task UUIDs the employee is working on';
COMMENT ON COLUMN check_ins.confidence_score IS 'Employee confidence score for completing tasks (1-10)';
COMMENT ON COLUMN check_ins.difficulty_level IS 'Perceived difficulty level of tasks (1-10)';
COMMENT ON COLUMN check_ins.work_location IS 'Where the employee is working from: home, office, hybrid, other';
