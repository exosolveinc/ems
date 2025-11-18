// Application Messages

export const MESSAGES = {
  // Success messages
  CHECKIN_SUCCESS: 'Checked in successfully',
  CHECKOUT_SUCCESS: 'Checked out successfully',
  STATUS_UPDATED: 'Status updated successfully',
  
  // Error messages
  ALREADY_CHECKED_IN: 'You have already checked in today',
  ALREADY_CHECKED_OUT: 'You have already checked out today',
  NO_CHECKIN_FOUND: 'No check-in found for today',
  EMPLOYEE_NOT_FOUND: 'Employee not found',
  INVALID_REQUEST: 'Invalid request data',
  UNAUTHORIZED: 'Unauthorized access',
  
  // Violation messages
  LATE_CHECKIN: (minutes: number) => `Checked in ${minutes} minutes late`,
  NO_CHECKIN: 'No check-in recorded for today',
  NO_CHECKOUT: 'No check-out recorded',
};
