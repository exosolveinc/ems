// Validation Utility Functions

export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

export function validateCheckInRequest(data: any): { valid: boolean; error?: string } {
  if (!data.employee_id) {
    return { valid: false, error: 'employee_id is required' };
  }
  
  if (!isValidUUID(data.employee_id)) {
    return { valid: false, error: 'Invalid employee_id format' };
  }
  
  return { valid: true };
}

export function validateCheckOutRequest(data: any): { valid: boolean; error?: string } {
  if (!data.employee_id) {
    return { valid: false, error: 'employee_id is required' };
  }
  
  if (!isValidUUID(data.employee_id)) {
    return { valid: false, error: 'Invalid employee_id format' };
  }
  
  return { valid: true };
}
