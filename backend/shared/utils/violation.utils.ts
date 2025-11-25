// Violation Detection Utilities
// Centralized logic for detecting and creating employee violations

export interface ViolationConfig {
  workStartHour: number;       // e.g., 9 for 9 AM
  workStartMinute: number;      // e.g., 0
  workEndHour: number;          // e.g., 17 for 5 PM
  workEndMinute: number;        // e.g., 0
  lateThresholdMinutes: number; // Minutes late before creating violation
  earlyCheckoutThresholdMinutes: number; // Minutes early before creating violation
  lowSeverityThreshold: number;  // Minutes late for 'low' severity
  mediumSeverityThreshold: number; // Minutes late for 'medium' severity
  highSeverityThreshold: number; // Minutes late for 'high' severity
}

// Default configuration
export const DEFAULT_VIOLATION_CONFIG: ViolationConfig = {
  workStartHour: 9,
  workStartMinute: 0,
  workEndHour: 17,
  workEndMinute: 0,
  lateThresholdMinutes: 5, // Grace period
  earlyCheckoutThresholdMinutes: 15,
  lowSeverityThreshold: 15,    // 5-15 minutes late
  mediumSeverityThreshold: 30,  // 15-30 minutes late
  highSeverityThreshold: 60,    // 30-60 minutes late
  // > 60 minutes = critical
};

export interface ViolationResult {
  hasViolation: boolean;
  violationType?: 'late_checkin' | 'early_checkout' | 'no_checkin' | 'no_checkout' | 'no_status_update';
  severity?: 'low' | 'medium' | 'high' | 'critical';
  minutesLate?: number;
  minutesEarly?: number;
  description?: string;
}

/**
 * Detects if a check-in constitutes a late arrival violation
 */
export function detectLateCheckinViolation(
  checkInTime: Date,
  config: ViolationConfig = DEFAULT_VIOLATION_CONFIG
): ViolationResult {
  const workStart = new Date(checkInTime);
  workStart.setHours(config.workStartHour, config.workStartMinute, 0, 0);

  const minutesLate = Math.floor((checkInTime.getTime() - workStart.getTime()) / (1000 * 60));

  // Within grace period
  if (minutesLate <= config.lateThresholdMinutes) {
    return { hasViolation: false };
  }

  // Determine severity
  let severity: 'low' | 'medium' | 'high' | 'critical';
  if (minutesLate <= config.lowSeverityThreshold) {
    severity = 'low';
  } else if (minutesLate <= config.mediumSeverityThreshold) {
    severity = 'medium';
  } else if (minutesLate <= config.highSeverityThreshold) {
    severity = 'high';
  } else {
    severity = 'critical';
  }

  return {
    hasViolation: true,
    violationType: 'late_checkin',
    severity,
    minutesLate,
    description: `Checked in ${minutesLate} minutes late`,
  };
}

/**
 * Detects if a check-out constitutes an early departure violation
 */
export function detectEarlyCheckoutViolation(
  checkOutTime: Date,
  checkInTime: Date,
  config: ViolationConfig = DEFAULT_VIOLATION_CONFIG
): ViolationResult {
  const workEnd = new Date(checkOutTime);
  workEnd.setHours(config.workEndHour, config.workEndMinute, 0, 0);

  const minutesEarly = Math.floor((workEnd.getTime() - checkOutTime.getTime()) / (1000 * 60));

  // Check-out is after or within threshold of work end time
  if (minutesEarly <= config.earlyCheckoutThresholdMinutes) {
    return { hasViolation: false };
  }

  // Calculate actual hours worked
  const hoursWorked = (checkOutTime.getTime() - checkInTime.getTime()) / (1000 * 60 * 60);
  const expectedHours = config.workEndHour - config.workStartHour;

  // Determine severity based on how many hours short
  let severity: 'low' | 'medium' | 'high' | 'critical';
  const hoursShort = expectedHours - hoursWorked;

  if (hoursShort <= 0.5) {
    severity = 'low';
  } else if (hoursShort <= 1) {
    severity = 'medium';
  } else if (hoursShort <= 2) {
    severity = 'high';
  } else {
    severity = 'critical';
  }

  return {
    hasViolation: true,
    violationType: 'early_checkout',
    severity,
    minutesEarly,
    description: `Checked out ${minutesEarly} minutes early (worked ${hoursWorked.toFixed(2)} hours)`,
  };
}

/**
 * Detects if employee missed check-in for a given date
 */
export function detectMissingCheckin(
  date: Date,
  config: ViolationConfig = DEFAULT_VIOLATION_CONFIG
): ViolationResult {
  const workStart = new Date(date);
  workStart.setHours(config.workStartHour, config.workStartMinute, 0, 0);

  const now = new Date();
  const hoursLate = (now.getTime() - workStart.getTime()) / (1000 * 60 * 60);

  // Check if it's past work start time
  if (now < workStart) {
    return { hasViolation: false };
  }

  // Determine severity based on how long they've been missing
  let severity: 'low' | 'medium' | 'high' | 'critical';
  if (hoursLate <= 1) {
    severity = 'medium';
  } else if (hoursLate <= 2) {
    severity = 'high';
  } else {
    severity = 'critical';
  }

  return {
    hasViolation: true,
    violationType: 'no_checkin',
    severity,
    description: `No check-in recorded for ${date.toISOString().split('T')[0]}`,
  };
}

/**
 * Detects if employee checked in but never checked out
 */
export function detectMissingCheckout(
  checkInTime: Date,
  config: ViolationConfig = DEFAULT_VIOLATION_CONFIG
): ViolationResult {
  const workEnd = new Date(checkInTime);
  workEnd.setHours(config.workEndHour + 2, 0, 0, 0); // 2 hours grace after work end

  const now = new Date();

  // Check if it's past expected checkout time
  if (now < workEnd) {
    return { hasViolation: false };
  }

  const hoursOverdue = (now.getTime() - workEnd.getTime()) / (1000 * 60 * 60);

  // Determine severity
  let severity: 'low' | 'medium' | 'high' | 'critical';
  if (hoursOverdue <= 2) {
    severity = 'low';
  } else if (hoursOverdue <= 6) {
    severity = 'medium';
  } else if (hoursOverdue <= 12) {
    severity = 'high';
  } else {
    severity = 'critical';
  }

  return {
    hasViolation: true,
    violationType: 'no_checkout',
    severity,
    description: `No check-out recorded for check-in at ${checkInTime.toISOString()}`,
  };
}

/**
 * Creates a violation record in the database
 */
export async function createViolation(
  supabase: any,
  employeeId: string,
  violation: ViolationResult,
  violationDate: Date = new Date()
): Promise<{ success: boolean; data?: any; error?: string }> {
  if (!violation.hasViolation) {
    return { success: false, error: 'No violation to create' };
  }

  try {
    const { data, error } = await supabase
      .from('violations')
      .insert({
        employee_id: employeeId,
        violation_type: violation.violationType,
        violation_date: violationDate.toISOString().split('T')[0],
        severity: violation.severity,
        description: violation.description,
      })
      .select()
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Checks if violation should trigger escalation
 */
export function shouldEscalateViolation(
  severity: 'low' | 'medium' | 'high' | 'critical',
  recentViolationsCount: number
): boolean {
  // Critical violations always escalate
  if (severity === 'critical') {
    return true;
  }

  // High severity with 2+ recent violations
  if (severity === 'high' && recentViolationsCount >= 2) {
    return true;
  }

  // Medium severity with 3+ recent violations
  if (severity === 'medium' && recentViolationsCount >= 3) {
    return true;
  }

  // Low severity with 5+ recent violations
  if (severity === 'low' && recentViolationsCount >= 5) {
    return true;
  }

  return false;
}
