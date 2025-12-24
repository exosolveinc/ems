-- Update Check-ins Table with Additional Fields
-- Description: Adds mood, health_status, symptoms, energy_level, stress_level, focus_level, workload, wins, blockers
-- Date: 2024-12-20

-- =============================================================================
-- UPDATE WORK_LOCATION CONSTRAINT
-- =============================================================================

-- First drop the old constraint and add updated one
ALTER TABLE check_ins DROP CONSTRAINT IF EXISTS check_ins_work_location_check;
ALTER TABLE check_ins ADD CONSTRAINT check_ins_work_location_check
    CHECK (work_location IN ('home', 'office', 'apartment', 'travel'));

-- =============================================================================
-- ADD NEW COLUMNS TO CHECK_INS TABLE
-- =============================================================================

-- Add mood column
ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS mood TEXT
    CHECK (mood IN ('amazing', 'happy', 'good', 'okay', 'tired', 'stressed', 'frustrated'));

-- Add health_status column
ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS health_status TEXT
    CHECK (health_status IN ('healthy', 'slight', 'sick', 'recovering', 'mental'));

-- Add symptoms column (array of predefined symptoms)
ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS symptoms TEXT[] DEFAULT '{}';

-- Add energy_level (1-10 scale)
ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS energy_level INTEGER
    CHECK (energy_level >= 1 AND energy_level <= 10);

-- Add stress_level (1-10 scale)
ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS stress_level INTEGER
    CHECK (stress_level >= 1 AND stress_level <= 10);

-- Add focus_level (1-10 scale)
ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS focus_level INTEGER
    CHECK (focus_level >= 1 AND focus_level <= 10);

-- Add workload column
ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS workload TEXT
    CHECK (workload IN ('light', 'balanced', 'heavy', 'overwhelming'));

-- Add wins column (free text)
ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS wins TEXT;

-- Add blockers column (free text)
ALTER TABLE check_ins ADD COLUMN IF NOT EXISTS blockers TEXT;

-- =============================================================================
-- INDEXES
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_check_ins_mood ON check_ins(mood);
CREATE INDEX IF NOT EXISTS idx_check_ins_health_status ON check_ins(health_status);
CREATE INDEX IF NOT EXISTS idx_check_ins_workload ON check_ins(workload);

-- =============================================================================
-- COMMENTS
-- =============================================================================

COMMENT ON COLUMN check_ins.mood IS 'Employee mood: amazing, happy, good, okay, tired, stressed, frustrated';
COMMENT ON COLUMN check_ins.health_status IS 'Employee health status: healthy, slight, sick, recovering, mental';
COMMENT ON COLUMN check_ins.symptoms IS 'Array of symptoms: headache, fever, cold, fatigue, stomach, allergies, back, anxiety, burnout';
COMMENT ON COLUMN check_ins.energy_level IS 'Employee energy level (1-10)';
COMMENT ON COLUMN check_ins.stress_level IS 'Employee stress level (1-10)';
COMMENT ON COLUMN check_ins.focus_level IS 'Employee focus level (1-10)';
COMMENT ON COLUMN check_ins.workload IS 'Perceived workload: light, balanced, heavy, overwhelming';
COMMENT ON COLUMN check_ins.wins IS 'Free text describing recent wins or accomplishments';
COMMENT ON COLUMN check_ins.blockers IS 'Free text describing current blockers or challenges';
