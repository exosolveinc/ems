-- Migration: Remove extra fields from check_ins table
-- Only task_ids is needed for check-in

-- Drop constraints first
ALTER TABLE check_ins DROP CONSTRAINT IF EXISTS check_ins_work_location_check;
ALTER TABLE check_ins DROP CONSTRAINT IF EXISTS check_ins_mood_check;
ALTER TABLE check_ins DROP CONSTRAINT IF EXISTS check_ins_health_status_check;
ALTER TABLE check_ins DROP CONSTRAINT IF EXISTS check_ins_workload_check;
ALTER TABLE check_ins DROP CONSTRAINT IF EXISTS check_ins_energy_level_check;
ALTER TABLE check_ins DROP CONSTRAINT IF EXISTS check_ins_stress_level_check;
ALTER TABLE check_ins DROP CONSTRAINT IF EXISTS check_ins_focus_level_check;
ALTER TABLE check_ins DROP CONSTRAINT IF EXISTS check_ins_confidence_score_check;
ALTER TABLE check_ins DROP CONSTRAINT IF EXISTS check_ins_difficulty_level_check;

-- Drop columns
ALTER TABLE check_ins DROP COLUMN IF EXISTS work_location;
ALTER TABLE check_ins DROP COLUMN IF EXISTS mood;
ALTER TABLE check_ins DROP COLUMN IF EXISTS health_status;
ALTER TABLE check_ins DROP COLUMN IF EXISTS symptoms;
ALTER TABLE check_ins DROP COLUMN IF EXISTS energy_level;
ALTER TABLE check_ins DROP COLUMN IF EXISTS stress_level;
ALTER TABLE check_ins DROP COLUMN IF EXISTS focus_level;
ALTER TABLE check_ins DROP COLUMN IF EXISTS workload;
ALTER TABLE check_ins DROP COLUMN IF EXISTS wins;
ALTER TABLE check_ins DROP COLUMN IF EXISTS blockers;
ALTER TABLE check_ins DROP COLUMN IF EXISTS confidence_score;
ALTER TABLE check_ins DROP COLUMN IF EXISTS difficulty_level;
ALTER TABLE check_ins DROP COLUMN IF EXISTS check_in_location;
ALTER TABLE check_ins DROP COLUMN IF EXISTS check_in_notes;
