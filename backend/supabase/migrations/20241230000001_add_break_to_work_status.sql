-- Add 'break' to the allowed work_status values in hourly_status table
ALTER TABLE public.hourly_status
DROP CONSTRAINT IF EXISTS hourly_status_work_status_check;

ALTER TABLE public.hourly_status
ADD CONSTRAINT hourly_status_work_status_check
CHECK (work_status = ANY (ARRAY['progress'::text, 'done'::text, 'blocked'::text, 'break'::text]));
