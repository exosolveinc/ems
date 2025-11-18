// Application Configuration Constants

export const CONFIG = {
  WORK_START_TIME: Deno.env.get('WORK_START_TIME') || '09:00',
  WORK_END_TIME: Deno.env.get('WORK_END_TIME') || '18:00',
  CHECKIN_GRACE_PERIOD_MINUTES: parseInt(Deno.env.get('CHECKIN_GRACE_PERIOD_MINUTES') || '15'),
  LATE_CHECKIN_THRESHOLD_MINUTES: parseInt(Deno.env.get('LATE_CHECKIN_THRESHOLD_MINUTES') || '30'),
  TIMEZONE: 'UTC',
};

export const VIOLATION_SEVERITY = {
  LATE_15_MIN: 'low',
  LATE_30_MIN: 'medium',
  LATE_60_MIN: 'high',
  NO_CHECKIN: 'critical',
  NO_CHECKOUT: 'medium',
} as const;

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
