// API Request/Response Types

export interface CheckInRequest {
  employee_id: string;
  location?: string;
  ip?: string;
  notes?: string;
}

export interface CheckInResponse {
  success: boolean;
  data?: any;
  error?: string;
  violation?: {
    created: boolean;
    severity: string;
    minutes_late: number;
  };
}

export interface CheckOutRequest {
  employee_id: string;
  check_in_id?: string;
  location?: string;
  ip?: string;
  notes?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface ErrorResponse {
  success: false;
  error: string;
  details?: any;
}
