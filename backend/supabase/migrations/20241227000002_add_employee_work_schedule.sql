-- Migration: Add work schedule fields to employees table
-- Allows users to set their work start time, work end time, and work days (all in EST)

-- Add work schedule columns
ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_start_time TIME DEFAULT '09:00:00';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_end_time TIME DEFAULT '17:00:00';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_days TEXT[] DEFAULT ARRAY['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

-- Add comment
COMMENT ON COLUMN employees.work_start_time IS 'Employee work start time in EST';
COMMENT ON COLUMN employees.work_end_time IS 'Employee work end time in EST';
COMMENT ON COLUMN employees.work_days IS 'Array of work days (monday, tuesday, etc.) in EST';
