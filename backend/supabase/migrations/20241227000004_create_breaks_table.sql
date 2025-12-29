-- Migration: Create breaks table to track employee break times
-- This table records when employees take breaks during the work day

-- Create breaks table
CREATE TABLE IF NOT EXISTS breaks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    break_date DATE NOT NULL DEFAULT CURRENT_DATE,
    break_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    break_end TIMESTAMPTZ,
    duration_minutes INTEGER, -- Calculated when break ends
    break_type TEXT DEFAULT 'general', -- general, lunch, personal, etc.
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_breaks_employee_id ON breaks(employee_id);
CREATE INDEX IF NOT EXISTS idx_breaks_date ON breaks(break_date);
CREATE INDEX IF NOT EXISTS idx_breaks_employee_date ON breaks(employee_id, break_date);

-- Enable RLS
ALTER TABLE breaks ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Employees can view their own breaks
CREATE POLICY "Employees can view own breaks"
    ON breaks FOR SELECT
    USING (auth.uid() = employee_id);

-- Employees can insert their own breaks
CREATE POLICY "Employees can insert own breaks"
    ON breaks FOR INSERT
    WITH CHECK (auth.uid() = employee_id);

-- Employees can update their own breaks
CREATE POLICY "Employees can update own breaks"
    ON breaks FOR UPDATE
    USING (auth.uid() = employee_id);

-- Managers/admins can view all breaks
CREATE POLICY "Managers can view all breaks"
    ON breaks FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM employees
            WHERE employees.id = auth.uid()
            AND employees.role IN ('admin', 'manager', 'hr')
        )
    );

-- Add work_status 'break' to hourly_status if using enum (skip if text)
-- The hourly_status table uses TEXT for work_status, so 'break' is already valid

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_breaks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS breaks_updated_at ON breaks;
CREATE TRIGGER breaks_updated_at
    BEFORE UPDATE ON breaks
    FOR EACH ROW
    EXECUTE FUNCTION update_breaks_updated_at();

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON breaks TO authenticated;
GRANT ALL ON breaks TO service_role;

COMMENT ON TABLE breaks IS 'Tracks employee break times during work days';
COMMENT ON COLUMN breaks.duration_minutes IS 'Calculated duration in minutes when break ends';
COMMENT ON COLUMN breaks.break_type IS 'Type of break: general, lunch, personal, etc.';
