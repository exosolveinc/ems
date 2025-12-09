# EMS API Documentation

## Table of Contents
1. [Overview & Base Configuration](#overview--base-configuration)
2. [Authentication Endpoints](#authentication-endpoints)
3. [Check-In/Out & Standup Management](#check-inout--standup-management)
4. [Violations Management](#violations-management)
5. [Vacation Request Management](#vacation-request-management)
6. [Timesheet Management](#timesheet-management)
7. [Hourly Status Tracking](#hourly-status-tracking)
8. [Background Jobs & Cron](#background-jobs--cron)
9. [Data Models & Schemas](#data-models--schemas)
10. [Role-Based Access Control Matrix](#role-based-access-control-matrix)
11. [Error Response Reference](#error-response-reference)

---

## Overview & Base Configuration

### Base URL
```
https://<SUPABASE_PROJECT_ID>.supabase.co/functions/v1/
```

### Architecture
- **Framework**: Supabase Edge Functions (Deno Runtime)
- **Authentication**: JWT Bearer Token (Supabase Auth)
- **Response Format**: JSON
- **Timezone**: America/New_York (EST/EDT) for work hour calculations

### Common Headers
```http
Authorization: Bearer {access_token}
Content-Type: application/json
```

### CORS Configuration
All endpoints support CORS with the following headers:
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type
```

All endpoints support `OPTIONS` method for CORS preflight requests.

---

## Authentication Endpoints

### Sign Up

Create a new user account (employee, manager, HR, or admin).

**Endpoint**: `POST /functions/v1/signup`

**Authentication**: None (Public)

**HTTP Methods**: `POST`, `OPTIONS`

**Request Body**:
```json
{
  "email": "john@company.com",
  "password": "securepassword123",
  "employee_id": "EMP001",
  "first_name": "John",
  "last_name": "Doe",
  "full_name": "John Doe",
  "role": "employee",
  "phone": "+1234567890",
  "designation": "Software Engineer",
  "department": "Engineering",
  "division": "Tech",
  "salary": 75000,
  "join_date": "2025-01-15",
  "manager_id": "uuid-of-manager"
}
```

**Required Fields**:
- `email` (string): Valid email address
- `password` (string): Minimum 6 characters
- `employee_id` (string): Unique employee identifier
- `first_name` + `last_name` OR `full_name` (string): Employee name

**Optional Fields**:
- `role` (enum): employee, manager, hr, admin (default: employee)
- `phone`, `designation`, `department`, `division` (string)
- `salary` (number)
- `join_date` (ISO date): defaults to today
- `manager_id` (UUID): Reference to manager's employee record

**Response** (200 OK):
```json
{
  "success": true,
  "message": "User created successfully",
  "user": {
    "id": "uuid",
    "email": "john@company.com",
    "employee_id": "EMP001",
    "first_name": "John",
    "last_name": "Doe",
    "full_name": "John Doe",
    "role": "employee",
    "designation": "Software Engineer",
    "department": "Engineering",
    "status": "active"
  }
}
```

**cURL Example**:
```bash
curl -X POST https://<PROJECT>.supabase.co/functions/v1/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@company.com",
    "password": "securepass123",
    "employee_id": "EMP001",
    "full_name": "John Doe",
    "role": "employee"
  }'
```

**Validation Rules**:
- Password must be at least 6 characters
- Employee ID must be unique
- Role must be one of: employee, manager, hr, admin
- Either provide `full_name` OR both `first_name` and `last_name`

**Error Responses**:
- `400`: Missing required fields, invalid role, duplicate employee_id
- `500`: Server error

---

### Sign In

Authenticate a user and receive access tokens.

**Endpoint**: `POST /functions/v1/signin`

**Authentication**: None (Public)

**HTTP Methods**: `POST`, `OPTIONS`

**Request Body**:
```json
{
  "email": "john@company.com",
  "password": "securepassword123"
}
```

**Required Fields**:
- `email` (string): User email
- `password` (string): User password

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Sign in successful",
  "session": {
    "access_token": "eyJ...",
    "refresh_token": "...",
    "expires_in": 3600,
    "expires_at": 1732800000
  },
  "user": {
    "id": "uuid",
    "email": "john@company.com",
    "employee_id": "EMP001",
    "full_name": "John Doe",
    "role": "employee"
  }
}
```

**cURL Example**:
```bash
curl -X POST https://<PROJECT>.supabase.co/functions/v1/signin \
  -H "Content-Type: application/json" \
  -d '{
    "email": "john@company.com",
    "password": "securepass123"
  }'
```

**Error Responses**:
- `400`: Missing email or password
- `401`: Invalid credentials
- `500`: Server error

---

## Check-In/Out & Standup Management

### Check In

Record daily check-in with standup entries.

**Endpoint**: `POST /functions/v1/checkin`

**Authentication**: Bearer Token (Required)

**Allowed Roles**: employee, manager, hr (NOT admin)

**HTTP Methods**: `POST`, `OPTIONS`

**Request Body**:
```json
{
  "work_location": "office",
  "location": "New York Office",
  "ip": "192.168.1.100",
  "notes": "Starting work on Project A",
  "yesterday": [
    {
      "project_name": "Project A",
      "ticket_number": "PROJ-123",
      "task_description": "Implemented user authentication",
      "confidence_score": 9,
      "difficulty_level": 7,
      "estimated_hours": 8
    }
  ],
  "today": [
    {
      "project_name": "Project A",
      "ticket_number": "PROJ-124",
      "task_description": "Implement password reset flow",
      "confidence_score": 8,
      "difficulty_level": 6,
      "estimated_hours": 6
    }
  ],
  "blockers": [
    {
      "project_name": "Project A",
      "task_description": "Need API documentation for third-party service",
      "confidence_score": 5,
      "difficulty_level": 8
    }
  ]
}
```

**Required Fields**:
- `work_location` (enum): "home" or "office"
- `today` (array): At least one task entry for today

**Optional Fields**:
- `yesterday` (array): Tasks completed yesterday
- `blockers` (array): Current blockers
- `location` (string): Physical location
- `ip` (string): IP address
- `notes` (string): Additional notes

**StandupEntry Schema** (for yesterday/today/blockers):
- `project_name` (string, required): Project name
- `ticket_number` (string, optional): Ticket/issue number
- `task_description` (string, required): Description of task
- `confidence_score` (number, required for yesterday/today): 1-10 confidence level
- `difficulty_level` (number, required for yesterday/today): 1-10 difficulty rating
- `estimated_hours` (number, optional): Estimated hours to complete

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "checkin": {
      "id": "uuid",
      "employee_id": "uuid",
      "check_in_time": "2025-11-28T08:55:00Z",
      "check_in_location": "New York Office",
      "work_location": "office",
      "has_blockers": true
    },
    "standup": {
      "yesterday": 1,
      "today": 1,
      "blockers": 1
    }
  },
  "employee": {
    "id": "uuid",
    "name": "John Doe",
    "employee_id": "EMP001"
  },
  "violation": null
}
```

**Response with Late Check-in Violation** (200 OK):
```json
{
  "success": true,
  "data": {
    "checkin": { },
    "standup": { }
  },
  "employee": { },
  "violation": {
    "created": true,
    "severity": "high",
    "minutes_late": 90
  }
}
```

**cURL Example**:
```bash
curl -X POST https://<PROJECT>.supabase.co/functions/v1/checkin \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "work_location": "office",
    "today": [{
      "project_name": "Project A",
      "task_description": "Implement feature X",
      "confidence_score": 8,
      "difficulty_level": 6
    }]
  }'
```

**Business Rules**:
- Work start time: 9:00 AM EST
- Late check-in creates automatic violation:
  - **Low severity**: < 30 minutes late
  - **Medium severity**: 30-60 minutes late
  - **High severity**: 60+ minutes late
- One check-in per employee per day
- Employees can only check in for themselves

**Error Responses**:
- `400`: Missing required fields, invalid work_location, already checked in today
- `401`: Missing or invalid authorization token
- `403`: Admin role cannot check in
- `404`: Employee record not found
- `500`: Server error

---

### Check Out

Record daily check-out and calculate total hours worked.

**Endpoint**: `POST /functions/v1/checkout`

**Authentication**: Bearer Token (Required)

**Allowed Roles**: employee, manager, hr (NOT admin)

**HTTP Methods**: `POST`, `OPTIONS`

**Request Body**:
```json
{
  "location": "New York Office",
  "ip": "192.168.1.100",
  "notes": "Completed Project A tasks"
}
```

**All Fields Optional**:
- `location` (string): Physical location
- `ip` (string): IP address
- `notes` (string): End-of-day notes

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "employee_id": "uuid",
    "check_in_id": "uuid",
    "check_out_time": "2025-11-28T17:05:00Z",
    "check_out_location": "New York Office",
    "total_hours": 8.17
  }
}
```

**cURL Example**:
```bash
curl -X POST https://<PROJECT>.supabase.co/functions/v1/checkout \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "location": "Office",
    "notes": "Day completed"
  }'
```

**Business Rules**:
- Must have checked in today before checking out
- Total hours calculated automatically: `(checkout_time - checkin_time) / hours`
- One check-out per check-in
- Timezone-aware calculation using EST

**Error Responses**:
- `400`: No check-in found for today, already checked out
- `401`: Missing or invalid authorization token
- `403`: Admin role cannot check out
- `500`: Server error

---

## Violations Management

### Get Violations

Retrieve violations with optional filtering.

**Endpoint**: `GET /functions/v1/violations`

**Authentication**: Bearer Token (Required)

**Allowed Roles**: All

**HTTP Methods**: `GET`, `OPTIONS`

**Query Parameters**:
- `employee_id` (UUID): Filter by employee (manager/admin only)
- `violation_type` (enum): late_checkin, early_checkout, no_checkin, no_checkout, no_status_update
- `severity` (enum): low, medium, high, critical
- `resolved` (boolean): true/false
- `escalated` (boolean): true/false
- `start_date` (ISO date): Filter from date
- `end_date` (ISO date): Filter to date
- `limit` (number): Results per page (default: 50)
- `offset` (number): Pagination offset (default: 0)
- `include_summary` (boolean): Include statistics summary

**Response** (200 OK):
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "employee_id": "uuid",
      "violation_type": "late_checkin",
      "violation_date": "2025-11-28",
      "severity": "high",
      "description": "Checked in 60 minutes late",
      "escalated": false,
      "resolved": false,
      "created_at": "2025-11-28T10:30:00Z",
      "employee": {
        "employee_id": "EMP001",
        "full_name": "John Doe",
        "email": "john@company.com"
      }
    }
  ],
  "count": 1
}
```

**Response with Summary** (200 OK):
```json
{
  "success": true,
  "data": [ ],
  "count": 15,
  "summary": {
    "total": 15,
    "by_severity": {
      "low": 5,
      "medium": 7,
      "high": 3,
      "critical": 0
    },
    "by_type": {
      "late_checkin": 10,
      "no_checkin": 3,
      "no_checkout": 2,
      "early_checkout": 0,
      "no_status_update": 0
    },
    "resolved": 5,
    "unresolved": 10
  }
}
```

**cURL Examples**:
```bash
# Get my violations
curl -X GET https://<PROJECT>.supabase.co/functions/v1/violations \
  -H "Authorization: Bearer ${ACCESS_TOKEN}"

# Get unresolved high-severity violations with summary
curl -X GET "https://<PROJECT>.supabase.co/functions/v1/violations?severity=high&resolved=false&include_summary=true" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}"

# Get violations for specific employee (manager/admin)
curl -X GET "https://<PROJECT>.supabase.co/functions/v1/violations?employee_id=uuid&start_date=2025-11-01&end_date=2025-11-30" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}"
```

**Permission Logic**:
- Employees: See only their own violations
- Managers/HR/Admins: See all violations

---

### Get Specific Violation

**Endpoint**: `GET /functions/v1/violations/{violation_id}`

**Authentication**: Bearer Token (Required)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "employee_id": "uuid",
    "violation_type": "late_checkin",
    "violation_date": "2025-11-28",
    "severity": "high",
    "description": "Checked in 60 minutes late",
    "escalated": false,
    "resolved": false,
    "employee": {
      "employee_id": "EMP001",
      "full_name": "John Doe",
      "email": "john@company.com"
    }
  }
}
```

**cURL Example**:
```bash
curl -X GET https://<PROJECT>.supabase.co/functions/v1/violations/{violation_id} \
  -H "Authorization: Bearer ${ACCESS_TOKEN}"
```

---

### Resolve Violation

Mark a violation as resolved (manager/admin only).

**Endpoint**: `PATCH /functions/v1/violations/{violation_id}` or `PUT /functions/v1/violations/{violation_id}`

**Authentication**: Bearer Token (Required)

**Allowed Roles**: manager, hr, admin only

**HTTP Methods**: `PATCH`, `PUT`, `OPTIONS`

**Request Body**:
```json
{
  "resolved": true,
  "resolved_notes": "Approved as medical appointment",
  "notes": "Doctor's note provided"
}
```

**Fields**:
- `resolved` (boolean): true to mark as resolved
- `resolved_notes` (string, optional): Resolution reason
- `notes` (string, optional): Additional notes

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Violation updated successfully",
  "data": {
    "id": "uuid",
    "resolved": true,
    "resolved_by": "uuid",
    "resolved_at": "2025-11-28T15:00:00Z",
    "resolved_notes": "Approved as medical appointment"
  }
}
```

**cURL Example**:
```bash
curl -X PATCH https://<PROJECT>.supabase.co/functions/v1/violations/{violation_id} \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "resolved": true,
    "resolved_notes": "Approved exception"
  }'
```

**Error Responses**:
- `400`: Violation not found
- `401`: Unauthorized
- `403`: Employees cannot resolve violations
- `404`: Violation not found
- `500`: Server error

---

## Vacation Request Management

### Create Vacation Request

Submit a vacation request (employee self-service).

**Endpoint**: `POST /functions/v1/vacation-request`

**Authentication**: Bearer Token (Required)

**Allowed Roles**: All (create own only)

**HTTP Methods**: `POST`, `OPTIONS`

**Request Body**:
```json
{
  "start_date": "2025-12-20",
  "end_date": "2025-12-27",
  "vacation_type": "annual",
  "reason": "Family vacation"
}
```

**Required Fields**:
- `start_date` (ISO date): Vacation start date
- `end_date` (ISO date): Vacation end date

**Optional Fields**:
- `vacation_type` (enum): annual, sick, personal, unpaid (default: annual)
- `reason` (string): Reason for vacation

**Response** (201 Created):
```json
{
  "success": true,
  "message": "Vacation request created successfully",
  "data": {
    "id": "uuid",
    "employee_id": "uuid",
    "start_date": "2025-12-20",
    "end_date": "2025-12-27",
    "days": 8,
    "vacation_type": "annual",
    "reason": "Family vacation",
    "status": "pending",
    "created_at": "2025-11-28T10:00:00Z"
  }
}
```

**cURL Example**:
```bash
curl -X POST https://<PROJECT>.supabase.co/functions/v1/vacation-request \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "start_date": "2025-12-20",
    "end_date": "2025-12-27",
    "vacation_type": "annual",
    "reason": "Family vacation"
  }'
```

**Validation Rules**:
- Start date cannot be in the past
- End date must be after start date
- Days calculated automatically (business days)
- Checks for overlapping requests

**Error Responses**:
- `400`: Invalid dates, overlapping requests
- `401`: Unauthorized
- `500`: Server error

---

### Get Vacation Requests

**Endpoint**: `GET /functions/v1/vacation-request`

**Authentication**: Bearer Token (Required)

**Query Parameters**:
- `status` (enum): pending, approved, rejected
- `employee_id` (UUID): Filter by employee (manager/admin only)
- `start_date`, `end_date` (ISO date): Date range filter

**Response** (200 OK):
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "employee_id": "uuid",
      "start_date": "2025-12-20",
      "end_date": "2025-12-27",
      "days": 8,
      "vacation_type": "annual",
      "status": "pending",
      "created_at": "2025-11-28T10:00:00Z"
    }
  ],
  "count": 1
}
```

**Permission Logic**:
- Employees: See only their own requests
- Managers/HR/Admins: See all requests

---

### Get Specific Vacation Request

**Endpoint**: `GET /functions/v1/vacation-request/{request_id}`

**Authentication**: Bearer Token (Required)

---

### Update Vacation Request

Update a pending vacation request (employee, own requests only).

**Endpoint**: `PUT /functions/v1/vacation-request/{request_id}` or `PATCH /functions/v1/vacation-request/{request_id}`

**Authentication**: Bearer Token (Required)

**HTTP Methods**: `PUT`, `PATCH`, `OPTIONS`

**Request Body**:
```json
{
  "start_date": "2025-12-21",
  "end_date": "2025-12-28",
  "reason": "Updated family vacation dates"
}
```

**Restrictions**:
- Can only edit pending requests
- Cannot edit approved/rejected requests

**Error Responses**:
- `400`: Cannot edit approved requests
- `403`: Can only edit own requests
- `404`: Request not found

---

### Delete Vacation Request

**Endpoint**: `DELETE /functions/v1/vacation-request/{request_id}`

**Authentication**: Bearer Token (Required)

**HTTP Methods**: `DELETE`, `OPTIONS`

**Restrictions**:
- Employees cannot delete approved requests
- Managers/admins can delete any request

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Vacation request deleted successfully"
}
```

---

### Approve/Reject Vacation Request

Manager/admin endpoint to approve or reject vacation requests.

**Endpoint**: `POST /functions/v1/vacation-approve`

**Authentication**: Bearer Token (Required)

**Allowed Roles**: manager, hr, admin only

**HTTP Methods**: `POST`, `OPTIONS`

**Request Body**:
```json
{
  "request_id": "uuid",
  "action": "approve",
  "notes": "Approved - enjoy your vacation!"
}
```

**Required Fields**:
- `request_id` (UUID): Vacation request ID
- `action` (enum): "approve" or "reject"

**Optional Fields**:
- `notes` (string): Approval/rejection reason

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Vacation request approved successfully",
  "data": {
    "id": "uuid",
    "employee": {
      "employee_id": "EMP001",
      "full_name": "John Doe",
      "email": "john@company.com"
    },
    "start_date": "2025-12-20",
    "end_date": "2025-12-27",
    "days": 8,
    "vacation_type": "annual",
    "status": "approved",
    "reviewed_by": "Manager Name",
    "reviewed_at": "2025-11-28T11:00:00Z",
    "review_notes": "Approved - enjoy your vacation!"
  }
}
```

**cURL Example**:
```bash
curl -X POST https://<PROJECT>.supabase.co/functions/v1/vacation-approve \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "request_id": "uuid",
    "action": "approve",
    "notes": "Approved"
  }'
```

**Side Effects**:
- Creates notification for employee
- Updates request status to approved/rejected

---

### Get Pending Vacation Requests (Manager)

**Endpoint**: `GET /functions/v1/vacation-approve`

**Authentication**: Bearer Token (Required)

**Allowed Roles**: manager, hr, admin only

**Query Parameters**:
- `status` (enum): Filter by status (default: pending)
- `employee_id` (UUID): Filter by employee
- `start_date`, `end_date` (ISO date): Date range

**Response** (200 OK):
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "employee_id": "uuid",
      "employees": {
        "employee_id": "EMP001",
        "full_name": "John Doe",
        "email": "john@company.com",
        "department": "Engineering",
        "designation": "Software Engineer"
      },
      "start_date": "2025-12-20",
      "end_date": "2025-12-27",
      "days": 8,
      "vacation_type": "annual",
      "reason": "Family vacation",
      "status": "pending",
      "created_at": "2025-11-28T10:00:00Z"
    }
  ],
  "count": 1
}
```

---

## Timesheet Management

### Submit Timesheet

Submit weekly timesheet (employee self-service).

**Endpoint**: `POST /functions/v1/timesheet-submit`

**Authentication**: Bearer Token (Required)

**Allowed Roles**: All (submit own only)

**HTTP Methods**: `POST`, `OPTIONS`

**Request Body**:
```json
{
  "week_start_date": "2025-11-18",
  "week_end_date": "2025-11-24",
  "entries": [
    {
      "date": "2025-11-18",
      "hours": 8,
      "project": "Project A",
      "task": "Development",
      "notes": "Frontend implementation"
    },
    {
      "date": "2025-11-19",
      "hours": 7.5,
      "project": "Project B",
      "task": "Testing"
    }
  ],
  "notes": "Week summary notes"
}
```

**Required Fields**:
- `week_start_date` (ISO date): Week start date
- `week_end_date` (ISO date): Week end date
- `entries` (array): Array of timesheet entries

**Timesheet Entry Schema**:
- `date` (ISO date, required): Work date
- `hours` (number, required): Hours worked (0-24)
- `project` (string, required): Project name
- `task` (string, required): Task description
- `notes` (string, optional): Entry notes

**Optional Fields**:
- `notes` (string): Week summary

**Response** (201 Created):
```json
{
  "success": true,
  "message": "Timesheet submitted successfully",
  "data": {
    "id": "uuid",
    "employee_id": "uuid",
    "week_start_date": "2025-11-18",
    "week_end_date": "2025-11-24",
    "total_hours": 15.5,
    "entries": [ ],
    "status": "submitted",
    "submitted_at": "2025-11-25T10:00:00Z"
  }
}
```

**cURL Example**:
```bash
curl -X POST https://<PROJECT>.supabase.co/functions/v1/timesheet-submit \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "week_start_date": "2025-11-18",
    "week_end_date": "2025-11-24",
    "entries": [
      {
        "date": "2025-11-18",
        "hours": 8,
        "project": "Project A",
        "task": "Development"
      }
    ]
  }'
```

**Validation Rules**:
- Hours must be 0-24 per entry
- Prevents duplicate submissions for same week
- Total hours calculated automatically

**Error Responses**:
- `400`: Invalid hours, duplicate submission
- `401`: Unauthorized
- `500`: Server error

---

### Get Timesheets

**Endpoint**: `GET /functions/v1/timesheet-submit`

**Authentication**: Bearer Token (Required)

**Query Parameters**:
- `status` (enum): submitted, approved, rejected
- `week_start`, `week_end` (ISO date): Filter by week
- `employee_id` (UUID): Manager/admin only

**Permission Logic**:
- Employees: See only their own timesheets
- Managers/HR/Admins: See all timesheets

---

### Get Specific Timesheet

**Endpoint**: `GET /functions/v1/timesheet-submit/{timesheet_id}`

**Authentication**: Bearer Token (Required)

---

### Update Timesheet

**Endpoint**: `PUT /functions/v1/timesheet-submit/{timesheet_id}` or `PATCH`

**Authentication**: Bearer Token (Required)

**HTTP Methods**: `PUT`, `PATCH`, `OPTIONS`

**Restrictions**:
- Cannot update approved timesheets
- Can only edit own timesheets

---

### Delete Timesheet

**Endpoint**: `DELETE /functions/v1/timesheet-submit/{timesheet_id}`

**Authentication**: Bearer Token (Required)

**HTTP Methods**: `DELETE`, `OPTIONS`

**Restrictions**:
- Cannot delete approved timesheets

---

### Approve/Reject Timesheet

Manager/admin endpoint to approve or reject timesheets.

**Endpoint**: `POST /functions/v1/timesheet-approve`

**Authentication**: Bearer Token (Required)

**Allowed Roles**: manager, hr, admin only

**HTTP Methods**: `POST`, `OPTIONS`

**Request Body**:
```json
{
  "timesheet_id": "uuid",
  "action": "approve",
  "notes": "Approved"
}
```

**Required Fields**:
- `timesheet_id` (UUID): Timesheet ID
- `action` (enum): "approve" or "reject"

**Optional Fields**:
- `notes` (string): Admin notes

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Timesheet approved successfully",
  "data": {
    "id": "uuid",
    "employee": {
      "employee_id": "EMP001",
      "full_name": "John Doe",
      "email": "john@company.com"
    },
    "week_start_date": "2025-11-18",
    "week_end_date": "2025-11-24",
    "total_hours": 40,
    "entries": [ ],
    "status": "approved",
    "reviewed_by": "Manager Name",
    "reviewed_at": "2025-11-25T15:00:00Z",
    "admin_notes": "Approved"
  }
}
```

**cURL Example**:
```bash
curl -X POST https://<PROJECT>.supabase.co/functions/v1/timesheet-approve \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "timesheet_id": "uuid",
    "action": "approve"
  }'
```

**Side Effects**:
- Creates notification for employee
- Updates timesheet status

---

### Get Pending Timesheets (Manager)

**Endpoint**: `GET /functions/v1/timesheet-approve`

**Authentication**: Bearer Token (Required)

**Allowed Roles**: manager, hr, admin only

**Query Parameters**:
- `status` (enum): Filter by status (default: submitted)
- `employee_id` (UUID): Filter by employee
- `week_start`, `week_end` (ISO date): Date range

---

## Hourly Status Tracking

### Create Hourly Status

Submit an hourly status update.

**Endpoint**: `POST /functions/v1/hourly-status`

**Authentication**: Bearer Token (Required)

**Allowed Roles**: All

**HTTP Methods**: `POST`, `OPTIONS`

**Request Body**:
```json
{
  "activity": "Working on user authentication module",
  "activity_type": "coding",
  "project": "Project A",
  "task": "PROJ-124",
  "productivity_level": 4,
  "mood": "good",
  "location": "Office",
  "notes": "Making good progress",
  "status_time": "2025-11-28T14:00:00Z"
}
```

**Required Fields**:
- `activity` (string): Current activity description

**Optional Fields**:
- `activity_type` (enum): coding, meeting, review, testing, documentation, planning, break, learning, research, other
- `project` (string): Project name
- `task` (string): Task identifier
- `productivity_level` (number): 1-5 rating
- `mood` (enum): great, good, okay, tired, stressed, overwhelmed
- `location` (string): Physical location
- `notes` (string): Additional notes
- `status_time` (ISO timestamp): Status time (defaults to current time)

**Response** (201 Created):
```json
{
  "success": true,
  "message": "Status update created successfully",
  "data": {
    "id": "uuid",
    "employee_id": "uuid",
    "activity": "Working on user authentication module",
    "activity_type": "coding",
    "project": "Project A",
    "productivity_level": 4,
    "mood": "good",
    "status_time": "2025-11-28T14:00:00Z",
    "employees": {
      "employee_id": "EMP001",
      "full_name": "John Doe",
      "email": "john@company.com"
    }
  }
}
```

**cURL Example**:
```bash
curl -X POST https://<PROJECT>.supabase.co/functions/v1/hourly-status \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "activity": "Code review",
    "activity_type": "review",
    "productivity_level": 4
  }'
```

**Validation Rules**:
- `productivity_level` must be 1-5
- `mood` must be one of valid values
- `activity_type` must be one of valid values

---

### Get Hourly Statuses

**Endpoint**: `GET /functions/v1/hourly-status`

**Authentication**: Bearer Token (Required)

**HTTP Methods**: `GET`, `OPTIONS`

**Query Parameters**:
- `employee_id` (UUID): Filter by employee (manager/admin only)
- `date` (ISO date): Filter by specific date
- `start_date`, `end_date` (ISO date): Date range filter
- `activity_type` (enum): Filter by activity type
- `project` (string): Filter by project
- `limit` (number): Results per page (default: 50)
- `offset` (number): Pagination offset (default: 0)

**Response** (200 OK):
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "employee_id": "uuid",
      "activity": "Working on authentication",
      "activity_type": "coding",
      "project": "Project A",
      "productivity_level": 4,
      "mood": "good",
      "status_time": "2025-11-28T14:00:00Z",
      "employees": {
        "employee_id": "EMP001",
        "full_name": "John Doe",
        "email": "john@company.com"
      }
    }
  ],
  "count": 1,
  "offset": 0,
  "limit": 50
}
```

**Permission Logic**:
- Employees: See only their own statuses
- Managers/Admins: See all statuses

---

### Get Specific Hourly Status

**Endpoint**: `GET /functions/v1/hourly-status/{status_id}`

**Authentication**: Bearer Token (Required)

---

### Update Hourly Status

Update a recent hourly status (within last hour only).

**Endpoint**: `PUT /functions/v1/hourly-status/{status_id}` or `PATCH`

**Authentication**: Bearer Token (Required)

**HTTP Methods**: `PUT`, `PATCH`, `OPTIONS`

**Restrictions**:
- Can only edit status updates from the last hour
- Can only edit own statuses

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Status update updated successfully",
  "data": { }
}
```

---

### Delete Hourly Status

**Endpoint**: `DELETE /functions/v1/hourly-status/{status_id}`

**Authentication**: Bearer Token (Required)

**HTTP Methods**: `DELETE`, `OPTIONS`

**Restrictions**:
- Can only delete status updates from the last hour
- Can only delete own statuses

**Response** (200 OK):
```json
{
  "success": true,
  "message": "Status update deleted successfully"
}
```

---

## Background Jobs & Cron

### Detect Violations (Scheduled Job)

Hourly cron job to detect missing check-ins/check-outs and create violations.

**Endpoint**: `POST /functions/v1/detect-violations`

**Authentication**: Service Role Key (Backend only)

**HTTP Methods**: `POST`, `OPTIONS`

**Trigger**: Hourly cron job (0 * * * *)

**Purpose**:
- Detect employees with no check-in
- Detect employees who checked in but didn't check out
- Create violations automatically
- Escalate violations to managers based on severity and frequency
- Send notifications to employees and managers

**Response** (200 OK):
```json
{
  "success": true,
  "summary": {
    "employees_checked": 25,
    "violations_created": 3,
    "notifications_sent": 3,
    "escalations": 1
  },
  "violations": [
    {
      "id": "uuid",
      "employee_id": "uuid",
      "violation_type": "no_checkin",
      "severity": "high",
      "description": "No check-in recorded. Work started 3.5 hours ago."
    }
  ]
}
```

**Configuration**:
- Work hours: 9:00 AM - 5:00 PM EST
- Grace period for checkout: 2 hours after work end (7:00 PM)
- Late threshold: 5 minutes
- Severity thresholds:
  - Low: < 15 minutes late
  - Medium: 15-30 minutes late
  - High: 30-60 minutes late
  - Critical: 60+ minutes late

**Violation Types Created**:
- `no_checkin`: No check-in after work start + grace period
  - Medium severity: < 2 hours late
  - High severity: 2-4 hours late
  - Critical severity: 4+ hours late
- `late_checkin`: Checked in late (after 9:00 AM + 5 min grace)
- `no_checkout`: Checked in but no checkout after end time + grace period
  - Low severity: < 2 hours overdue
  - Medium severity: 2-6 hours overdue
  - High severity: 6-12 hours overdue
  - Critical severity: 12+ hours overdue

**Escalation Rules**:
Violations are automatically escalated to manager when:
- **Critical** severity: Always escalate
- **High** severity: 2+ violations in last 30 days
- **Medium** severity: 3+ violations in last 30 days
- **Low** severity: 5+ violations in last 30 days

**cURL Example** (Service Role only):
```bash
curl -X POST https://<PROJECT>.supabase.co/functions/v1/detect-violations \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json"
```

**Cron Configuration** (in `supabase/config.toml`):
```toml
[functions.detect-violations]
verify_jwt = false

[[cron]]
name = "hourly-violation-detection"
schedule = "0 * * * *"
function = "detect-violations"
```

---

## Data Models & Schemas

### StandupEntry

Used in check-in requests for yesterday/today/blockers.

```typescript
interface StandupEntry {
  project_name: string              // Required: Project name
  ticket_number?: string            // Optional: Ticket/issue number
  task_description: string          // Required: Task description
  confidence_score: number          // Required for yesterday/today: 1-10
  difficulty_level: number          // Required for yesterday/today: 1-10
  estimated_hours?: number          // Optional: Estimated hours
}
```

### Entry Types
- `yesterday`: Tasks completed yesterday
- `today`: Tasks planned for today
- `blocker`: Current blockers preventing progress

---

### Violation Types

```typescript
type ViolationType =
  | 'late_checkin'         // Checked in after 9:00 AM EST
  | 'early_checkout'       // Checked out before work end
  | 'no_checkin'          // No check-in recorded
  | 'no_checkout'         // Checked in but no check-out
  | 'no_status_update'    // No hourly status update
```

---

### Severity Levels

```typescript
type SeverityLevel =
  | 'low'        // Minor infraction
  | 'medium'     // Moderate infraction
  | 'high'       // Serious infraction
  | 'critical'   // Critical infraction
```

---

### Vacation Types

```typescript
type VacationType =
  | 'annual'     // Annual/PTO leave
  | 'sick'       // Sick leave
  | 'personal'   // Personal leave
  | 'unpaid'     // Unpaid leave
```

---

### Activity Types

```typescript
type ActivityType =
  | 'coding'         // Writing code
  | 'meeting'        // In a meeting
  | 'review'         // Code review
  | 'testing'        // Testing
  | 'documentation'  // Writing docs
  | 'planning'       // Planning/design
  | 'break'          // Taking a break
  | 'learning'       // Learning/training
  | 'research'       // Research
  | 'other'          // Other activities
```

---

### Mood Types

```typescript
type MoodType =
  | 'great'        // Feeling great
  | 'good'         // Feeling good
  | 'okay'         // Feeling okay
  | 'tired'        // Feeling tired
  | 'stressed'     // Feeling stressed
  | 'overwhelmed'  // Feeling overwhelmed
```

---

### User Roles

```typescript
type UserRole =
  | 'employee'   // Regular employee
  | 'manager'    // Team manager
  | 'hr'         // HR personnel
  | 'admin'      // System administrator
```

---

## Role-Based Access Control Matrix

| Endpoint | Employee | Manager | HR | Admin |
|----------|----------|---------|-----|-------|
| **Sign Up** | ✅ | ✅ | ✅ | ✅ |
| **Sign In** | ✅ | ✅ | ✅ | ✅ |
| **Check In** | ✅ (self only) | ✅ (self only) | ✅ (self only) | ❌ |
| **Check Out** | ✅ (self only) | ✅ (self only) | ✅ (self only) | ❌ |
| **View Violations** | ✅ (own only) | ✅ (all) | ✅ (all) | ✅ (all) |
| **Resolve Violations** | ❌ | ✅ | ✅ | ✅ |
| **Create Vacation Request** | ✅ (self only) | ✅ (self only) | ✅ (self only) | ✅ (self only) |
| **View Vacation Requests** | ✅ (own only) | ✅ (all) | ✅ (all) | ✅ (all) |
| **Approve Vacation** | ❌ | ✅ | ✅ | ✅ |
| **Submit Timesheet** | ✅ (self only) | ✅ (self only) | ✅ (self only) | ✅ (self only) |
| **View Timesheets** | ✅ (own only) | ✅ (all) | ✅ (all) | ✅ (all) |
| **Approve Timesheet** | ❌ | ✅ | ✅ | ✅ |
| **Create Hourly Status** | ✅ (self only) | ✅ (self only) | ✅ (self only) | ✅ (self only) |
| **View Hourly Status** | ✅ (own only) | ✅ (all) | ✅ (all) | ✅ (all) |
| **Update Hourly Status** | ✅ (self, <1h) | ✅ (self, <1h) | ✅ (self, <1h) | ✅ (self, <1h) |
| **Detect Violations** | ❌ | ❌ | ❌ | ❌ (Service Role) |

---

## Error Response Reference

### Standard Error Format

```json
{
  "success": false,
  "error": "Error message description"
}
```

---

### HTTP Status Codes

| Code | Meaning | Common Scenarios |
|------|---------|------------------|
| **200** | OK | Successful GET, PATCH, PUT, DELETE |
| **201** | Created | Successful POST (resource created) |
| **400** | Bad Request | Missing required fields, invalid data, validation errors |
| **401** | Unauthorized | Missing auth token, invalid token, expired token |
| **403** | Forbidden | Insufficient permissions, role not allowed |
| **404** | Not Found | Resource not found, employee not found |
| **405** | Method Not Allowed | HTTP method not supported for endpoint |
| **500** | Internal Server Error | Server error, database error |

---

### Common Error Messages

#### Authentication Errors (401)
```json
{ "success": false, "error": "Missing authorization header" }
{ "success": false, "error": "Unauthorized" }
{ "success": false, "error": "Invalid token" }
```

#### Permission Errors (403)
```json
{ "success": false, "error": "Only employees can check in" }
{ "success": false, "error": "Access denied. Only admins and managers can approve vacation requests" }
{ "success": false, "error": "You can only edit your own status updates" }
```

#### Validation Errors (400)
```json
{ "success": false, "error": "Email, password, and employee_id are required" }
{ "success": false, "error": "Either full_name or both first_name and last_name are required" }
{ "success": false, "error": "work_location is required (home or office)" }
{ "success": false, "error": "At least one task for today is required" }
{ "success": false, "error": "productivity_level must be between 1 and 5" }
{ "success": false, "error": "Invalid role. Must be one of: employee, manager, hr, admin" }
```

#### Resource Errors (404)
```json
{ "success": false, "error": "Employee record not found" }
{ "success": false, "error": "Violation not found" }
{ "success": false, "error": "Status update not found" }
```

#### Business Logic Errors (400)
```json
{ "success": false, "error": "Already checked in today" }
{ "success": false, "error": "No check-in found for today" }
{ "success": false, "error": "Already checked out today" }
{ "success": false, "error": "Can only edit status updates from the last hour" }
{ "success": false, "error": "Cannot edit approved timesheets" }
```

---

## API Summary

### Total Endpoints: 11 Implemented Functions

1. **signup** - Create user account
2. **signin** - Authenticate user
3. **checkin** - Daily check-in with standup
4. **checkout** - Daily check-out
5. **violations** - View/manage violations
6. **vacation-request** - CRUD vacation requests
7. **vacation-approve** - Approve/reject requests
8. **timesheet-submit** - CRUD timesheets
9. **timesheet-approve** - Approve/reject timesheets
10. **hourly-status** - CRUD hourly status updates
11. **detect-violations** - Automated violation detection (cron)

### Implementation Status

**Fully Implemented** (11): All endpoints documented above are fully functional.

**Placeholder Functions** (6): The following function directories exist but have no implementation:
- `slack-webhook`
- `send-slack-notification`
- `send-reminders`
- `gemini-query`
- `gemini-analyze`
- `generate-report`

---

## Notes

- All timestamps are stored in UTC but work hour calculations use EST/EDT timezone
- Work hours default: 9:00 AM - 5:00 PM EST
- Grace periods and thresholds are configurable in the detect-violations function
- Employees can only perform actions on their own records unless specified otherwise
- Managers, HR, and Admins have elevated permissions for viewing and approving

---

**Last Updated**: 2025-11-29
**API Version**: 1.0
**EMS Version**: Beta
