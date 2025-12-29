-- Migration: Setup pg_cron jobs for automatic violation detection
--
-- IMPORTANT: This migration requires manual setup in Supabase Dashboard
--
-- Option 1: Using Supabase Dashboard (Recommended)
-- ================================================
-- 1. Go to Supabase Dashboard > Database > Extensions
-- 2. Enable "pg_cron" extension
-- 3. Go to SQL Editor and run the cron schedule commands below
--
-- Option 2: Using External Cron Service
-- =====================================
-- Use cron-job.org or similar to call the Edge Function:
--
-- End of Day Check (11 PM EST, Mon-Fri):
--   POST https://your-project.supabase.co/functions/v1/detect-violations
--   Headers: Authorization: Bearer <service_role_key>
--   Body: {"check_type": "end_of_day"}
--
-- Hourly Status Check (Every hour 10 AM - 5 PM EST, Mon-Fri):
--   POST https://your-project.supabase.co/functions/v1/detect-violations
--   Headers: Authorization: Bearer <service_role_key>
--   Body: {"check_type": "hourly_status"}

-- =============================================================================
-- STORED PROCEDURE: Detect violations directly in SQL (alternative to Edge Function)
-- =============================================================================

CREATE OR REPLACE FUNCTION detect_violations_daily()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    target_date DATE := CURRENT_DATE;
    target_day_name TEXT;
    employee_record RECORD;
    checkin_record RECORD;
    checkout_record RECORD;
    status_count INTEGER;
    expected_status_count INTEGER;
    violation_count INTEGER := 0;
    result jsonb;
BEGIN
    -- Get day name (lowercase)
    target_day_name := LOWER(TO_CHAR(target_date, 'day'));
    target_day_name := TRIM(target_day_name);

    -- Loop through all active employees
    FOR employee_record IN
        SELECT
            id,
            employee_id,
            full_name,
            manager_id,
            COALESCE(work_start_time, '09:00:00'::TIME) as work_start,
            COALESCE(work_end_time, '17:00:00'::TIME) as work_end,
            COALESCE(work_days, ARRAY['monday', 'tuesday', 'wednesday', 'thursday', 'friday']) as work_days
        FROM employees
        WHERE status = 'active'
    LOOP
        -- Skip if not a work day for this employee
        IF NOT (target_day_name = ANY(employee_record.work_days)) THEN
            CONTINUE;
        END IF;

        -- Skip if on approved vacation
        IF EXISTS (
            SELECT 1 FROM vacation_requests
            WHERE employee_id = employee_record.id
            AND status = 'approved'
            AND target_date BETWEEN start_date AND end_date
        ) THEN
            CONTINUE;
        END IF;

        -- Check for check-in
        SELECT * INTO checkin_record
        FROM check_ins
        WHERE employee_id = employee_record.id
        AND DATE(check_in_time AT TIME ZONE 'America/New_York') = target_date
        LIMIT 1;

        IF checkin_record.id IS NULL THEN
            -- No check-in - create violation
            IF NOT EXISTS (
                SELECT 1 FROM violations
                WHERE employee_id = employee_record.id
                AND violation_type = 'no_checkin'
                AND violation_date = target_date
            ) THEN
                INSERT INTO violations (employee_id, violation_type, violation_date, severity, description)
                VALUES (
                    employee_record.id,
                    'no_checkin',
                    target_date,
                    'critical',
                    'No check-in recorded for ' || target_date || '. Work starts at ' || TO_CHAR(employee_record.work_start, 'HH24:MI') || '.'
                );
                violation_count := violation_count + 1;

                -- Create notification
                INSERT INTO notifications (employee_id, type, title, message)
                VALUES (
                    employee_record.id,
                    'violation',
                    'Missing Check-in Violation',
                    'You did not check in on ' || target_date || '. A violation has been recorded.'
                );
            END IF;
        ELSE
            -- Has check-in - check for late check-in
            IF (checkin_record.check_in_time AT TIME ZONE 'America/New_York')::TIME > employee_record.work_start THEN
                DECLARE
                    minutes_late INTEGER;
                    severity TEXT;
                BEGIN
                    minutes_late := EXTRACT(EPOCH FROM (
                        (checkin_record.check_in_time AT TIME ZONE 'America/New_York')::TIME - employee_record.work_start
                    )) / 60;

                    IF minutes_late > 60 THEN severity := 'high';
                    ELSIF minutes_late > 30 THEN severity := 'medium';
                    ELSIF minutes_late > 15 THEN severity := 'low';
                    ELSE severity := NULL;
                    END IF;

                    IF severity IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM violations
                        WHERE employee_id = employee_record.id
                        AND violation_type = 'late_checkin'
                        AND violation_date = target_date
                    ) THEN
                        INSERT INTO violations (employee_id, violation_type, violation_date, severity, description)
                        VALUES (
                            employee_record.id,
                            'late_checkin',
                            target_date,
                            severity,
                            'Checked in ' || minutes_late || ' minutes late. Work starts at ' || TO_CHAR(employee_record.work_start, 'HH24:MI') || '.'
                        );
                        violation_count := violation_count + 1;
                    END IF;
                END;
            END IF;

            -- Check for missing check-out
            SELECT * INTO checkout_record
            FROM check_outs
            WHERE check_in_id = checkin_record.id
            LIMIT 1;

            IF checkout_record.id IS NULL THEN
                IF NOT EXISTS (
                    SELECT 1 FROM violations
                    WHERE employee_id = employee_record.id
                    AND violation_type = 'no_checkout'
                    AND violation_date = target_date
                ) THEN
                    INSERT INTO violations (employee_id, violation_type, violation_date, severity, description)
                    VALUES (
                        employee_record.id,
                        'no_checkout',
                        target_date,
                        'high',
                        'No check-out recorded for ' || target_date || '.'
                    );
                    violation_count := violation_count + 1;

                    -- Auto-checkout at work end time
                    INSERT INTO check_outs (employee_id, check_in_id, check_out_time, check_out_notes, total_hours)
                    VALUES (
                        employee_record.id,
                        checkin_record.id,
                        target_date + employee_record.work_end,
                        'Auto-checkout - No manual checkout recorded',
                        EXTRACT(EPOCH FROM (employee_record.work_end - (checkin_record.check_in_time AT TIME ZONE 'America/New_York')::TIME)) / 3600
                    );
                END IF;
            END IF;

            -- Check for missed hourly status updates
            expected_status_count := EXTRACT(HOUR FROM employee_record.work_end) -
                                    GREATEST(
                                        EXTRACT(HOUR FROM employee_record.work_start),
                                        EXTRACT(HOUR FROM (checkin_record.check_in_time AT TIME ZONE 'America/New_York')::TIME)
                                    );

            SELECT COUNT(*) INTO status_count
            FROM hourly_status
            WHERE employee_id = employee_record.id
            AND DATE(status_time AT TIME ZONE 'America/New_York') = target_date;

            IF (expected_status_count - status_count) > 2 THEN
                DECLARE
                    missed_count INTEGER := expected_status_count - status_count;
                    severity TEXT;
                BEGIN
                    IF missed_count > 6 THEN severity := 'high';
                    ELSIF missed_count > 4 THEN severity := 'medium';
                    ELSE severity := 'low';
                    END IF;

                    IF NOT EXISTS (
                        SELECT 1 FROM violations
                        WHERE employee_id = employee_record.id
                        AND violation_type = 'no_status_update'
                        AND violation_date = target_date
                    ) THEN
                        INSERT INTO violations (employee_id, violation_type, violation_date, severity, description)
                        VALUES (
                            employee_record.id,
                            'no_status_update',
                            target_date,
                            severity,
                            'Missed ' || missed_count || ' hourly status updates. Expected: ' || expected_status_count || ', Actual: ' || status_count || '.'
                        );
                        violation_count := violation_count + 1;
                    END IF;
                END;
            END IF;
        END IF;
    END LOOP;

    result := jsonb_build_object(
        'success', true,
        'date_checked', target_date,
        'violations_created', violation_count
    );

    RETURN result;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION detect_violations_daily() TO service_role;

-- =============================================================================
-- SETUP PG_CRON (Run this after enabling pg_cron extension in dashboard)
-- =============================================================================
--
-- -- Enable pg_cron extension first in Supabase Dashboard
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
--
-- -- Schedule end-of-day violation check (11 PM EST = 4 AM UTC next day)
-- SELECT cron.schedule(
--     'detect-violations-daily',
--     '0 4 * * 1-5',  -- 4 AM UTC (11 PM EST), Monday through Friday
--     'SELECT detect_violations_daily()'
-- );
--
-- -- View scheduled jobs
-- SELECT * FROM cron.job;
--
-- -- Unschedule if needed
-- SELECT cron.unschedule('detect-violations-daily');

COMMENT ON FUNCTION detect_violations_daily() IS 'Detects and creates violations for missing check-ins, check-outs, late arrivals, and missed status updates. Should be run at end of each work day.';
