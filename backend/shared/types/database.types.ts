// Database Type Definitions

export interface Employee {
  id: string;
  email: string;
  phone?: string;
  first_name: string;
  last_name: string;
  employee_id: string;
  designation?: string;
  department?: string;
  division?: string;
  salary?: number;
  join_date: string;
  status: 'active' | 'inactive' | 'on_leave';
  manager_id?: string;
  profile_image_url?: string;
  slack_user_id?: string;
  role: 'employee' | 'manager' | 'hr' | 'admin';
  created_at: string;
  updated_at: string;
}

export interface CheckIn {
  id: string;
  employee_id: string;
  check_in_time: string;
  check_in_location?: string;
  check_in_ip?: string;
  check_in_notes?: string;
  created_at: string;
}

export interface CheckOut {
  id: string;
  employee_id: string;
  check_in_id?: string;
  check_out_time: string;
  check_out_location?: string;
  check_out_ip?: string;
  check_out_notes?: string;
  total_hours?: number;
  created_at: string;
}

export interface Violation {
  id: string;
  employee_id: string;
  violation_type: 'late_checkin' | 'no_checkin' | 'no_checkout' | 'no_status_update' | 'early_checkout';
  violation_date: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description?: string;
  escalated: boolean;
  escalated_to?: string;
  escalation_time?: string;
  resolved: boolean;
  resolved_at?: string;
  resolved_notes?: string;
  created_at: string;
}

export interface VacationRequest {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  total_days: number;
  vacation_type: 'annual' | 'sick' | 'personal' | 'unpaid';
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
  approved_by?: string;
  approved_at?: string;
  rejection_reason?: string;
  created_at: string;
}

export interface Timesheet {
  id: string;
  employee_id: string;
  week_start_date: string;
  week_end_date: string;
  total_hours?: number;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  submitted_at?: string;
  approved_by?: string;
  approved_at?: string;
  rejection_reason?: string;
  created_at: string;
}

export interface HourlyStatus {
  id: string;
  employee_id: string;
  status_time: string;
  status_type: 'working' | 'break' | 'meeting' | 'idle' | 'away';
  status_message?: string;
  created_at: string;
}

export interface StandupEntry {
  project_name: string
  ticket_number?: string
  task_description: string
  confidence_score: number
  difficulty_level: number
  estimated_hours?: number
}
