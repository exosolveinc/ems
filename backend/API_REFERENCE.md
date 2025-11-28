# EMS API Reference

## Authentication & Authorization Overview

### User Roles
All users (Admin and Employee) are stored in the same `employees` table with the following roles:
- **employee**: Regular employee (can check-in/out, submit timesheets, request vacation)
- **manager**: Can approve timesheets and vacation requests
- **hr**: Can approve timesheets and vacation requests
- **admin**: Full access (can approve, manage all users)

### Authentication Flow
1. **Signup**: Creates user in Supabase Auth + employee record
2. **Signin**: Returns access_token and user data including role
3. **All protected endpoints**: Require `Authorization: Bearer {access_token}` header

---

## API Endpoints

### Authentication

#### Sign Up (Admin or Employee)
```http
POST /functions/v1/signup
Content-Type: application/json

{
  "email": "john@company.com",
  "password": "securepassword123",
  "first_name": "John",        // Required (or use full_name)
  "last_name": "Doe",          // Required (or use full_name)
  // OR
  "full_name": "John Doe",     // Alternative to first_name + last_name
  "employee_id": "EMP001",     // Required
  "role": "employee",          // Optional: employee, manager, hr, or admin (default: employee)
  "phone": "+1234567890",      // Optional
  "designation": "Software Engineer",  // Optional
  "department": "Engineering", // Optional
  "division": "Tech",          // Optional
  "salary": 75000,             // Optional
  "join_date": "2025-01-15",   // Optional (defaults to today)
  "manager_id": "uuid-of-manager"  // Optional
}
```

**Note:** You must provide either:
- Both `first_name` AND `last_name`, OR
- Just `full_name` (will be split into first/last automatically)

**Response:**
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

#### Sign In
```http
POST /functions/v1/signin
Content-Type: application/json

{
  "email": "john@company.com",
  "password": "securepassword123"
}
```

**Response:**
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

---

### Check-In / Check-Out

#### Check In (Employee Only - Self)
**Note:** Employees can only check in themselves. The system uses the authenticated user's ID automatically.

```http
POST /functions/v1/checkin
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "location": "Office",        // Optional
  "ip": "192.168.1.1",        // Optional
  "notes": "On time"          // Optional
}
```

**Response (On Time):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "employee_id": "uuid",
    "check_in_time": "2025-11-28T08:55:00Z",
    "check_in_location": "Office"
  },
  "violation": null
}
```

**Response (Late - Violation Created):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "employee_id": "uuid",
    "check_in_time": "2025-11-28T10:30:00Z"
  },
  "violation": {
    "created": true,
    "severity": "high",
    "minutes_late": 90
  }
}
```

#### Check Out (Employee Only - Self)
**Note:** Employees can only check out themselves. The system uses the authenticated user's ID automatically.

```http
POST /functions/v1/checkout
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "location": "Office",        // Optional
  "ip": "192.168.1.1",        // Optional
  "notes": "End of day"       // Optional
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "employee_id": "uuid",
    "check_in_id": "uuid",
    "check_out_time": "2025-11-28T17:00:00Z",
    "total_hours": 8.08
  }
}
```

**Error Responses:**
```json
// No check-in found
{
  "success": false,
  "error": "No check-in found for today"
}

// Already checked out
{
  "success": false,
  "error": "Already checked out today"
}
```

---

### Violations

#### Get All Violations
**Permissions:**
- Employees: See only their own violations
- Managers/Admins: See all violations

```http
GET /functions/v1/violations
Authorization: Bearer {access_token}
```

#### Get Violations with Summary
```http
GET /functions/v1/violations?include_summary=true
Authorization: Bearer {access_token}
```

**Response:**
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
  "count": 1,
  "summary": {
    "total": 1,
    "by_severity": {
      "low": 0,
      "medium": 0,
      "high": 1,
      "critical": 0
    },
    "by_type": {
      "late_checkin": 1,
      "early_checkout": 0,
      "no_checkin": 0,
      "no_checkout": 0
    },
    "resolved": 0,
    "unresolved": 1
  }
}
```

#### Filter Violations
```http
# By severity
GET /functions/v1/violations?severity=high

# By type
GET /functions/v1/violations?violation_type=late_checkin

# By date range
GET /functions/v1/violations?start_date=2025-11-01&end_date=2025-11-30

# Unresolved only
GET /functions/v1/violations?resolved=false

# Escalated only
GET /functions/v1/violations?escalated=true

# Pagination
GET /functions/v1/violations?limit=20&offset=0

# Combine filters
GET /functions/v1/violations?severity=high&resolved=false&include_summary=true
```

#### Get Specific Violation
```http
GET /functions/v1/violations/{violation_id}
Authorization: Bearer {access_token}
```

#### Resolve Violation (Manager/Admin Only)
```http
PATCH /functions/v1/violations/{violation_id}
Authorization: Bearer {manager_access_token}
Content-Type: application/json

{
  "resolved": true,
  "resolved_notes": "Approved as exception - medical appointment"
}
```

---

### Vacation Requests

#### Get My Vacation Requests (Employee)
**Permissions:**
- Employees: See only their own requests
- Managers/Admins: See all requests

```http
GET /functions/v1/vacation-request
Authorization: Bearer {access_token}
```

**Filter Options:**
```http
# By status
GET /functions/v1/vacation-request?status=pending

# By employee (Manager/Admin only)
GET /functions/v1/vacation-request?employee_id=uuid

# By date range
GET /functions/v1/vacation-request?start_date=2025-12-01&end_date=2025-12-31
```

#### Create Vacation Request (Employee)
**Note:** Employees can only create requests for themselves.

```http
POST /functions/v1/vacation-request
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "start_date": "2025-12-20",
  "end_date": "2025-12-27",
  "reason": "Family vacation",
  "vacation_type": "annual"  // Options: annual, sick, personal, unpaid
}
```

**Response:**
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

#### Update My Vacation Request (Employee - Pending Only)
```http
PUT /functions/v1/vacation-request/{request_id}
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "start_date": "2025-12-21",
  "end_date": "2025-12-28",
  "reason": "Updated family vacation dates"
}
```

#### Delete My Vacation Request (Employee - Pending Only)
```http
DELETE /functions/v1/vacation-request/{request_id}
Authorization: Bearer {access_token}
```

---

### Vacation Approval (Manager/Admin Only)

#### Get Pending Vacation Requests
**Permissions:** Manager or Admin only

```http
GET /functions/v1/vacation-approve
Authorization: Bearer {manager_access_token}
```

**Filter Options:**
```http
# By status (defaults to pending)
GET /functions/v1/vacation-approve?status=pending

# By employee
GET /functions/v1/vacation-approve?employee_id=uuid

# By date range
GET /functions/v1/vacation-approve?start_date=2025-12-01&end_date=2025-12-31
```

**Response:**
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
      "reason": "Family vacation",
      "status": "pending",
      "created_at": "2025-11-28T10:00:00Z",
      "employees": {
        "employee_id": "EMP001",
        "full_name": "John Doe",
        "email": "john@company.com",
        "department": "Engineering",
        "designation": "Software Engineer"
      }
    }
  ],
  "count": 1
}
```

#### Approve or Reject Vacation Request
**Permissions:** Manager or Admin only

```http
POST /functions/v1/vacation-approve
Authorization: Bearer {manager_access_token}
Content-Type: application/json

{
  "request_id": "uuid",
  "action": "approve",  // or "reject"
  "notes": "Approved - enjoy your vacation!"
}
```

**Response:**
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

---

### Timesheets

#### Submit Timesheet (Employee)
**Note:** Employees can only submit their own timesheets.

```http
POST /functions/v1/timesheet-submit
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "week_start_date": "2025-11-18",
  "week_end_date": "2025-11-24",
  "entries": [
    {
      "date": "2025-11-18",
      "hours": 8,
      "project": "Project A",
      "task": "Development",
      "notes": "Frontend work"
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

**Response:**
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
    "entries": [...],
    "status": "submitted",
    "submitted_at": "2025-11-25T10:00:00Z"
  }
}
```

#### Get My Timesheets (Employee)
```http
GET /functions/v1/timesheet-submit
Authorization: Bearer {access_token}

# Filter by status
GET /functions/v1/timesheet-submit?status=submitted

# Filter by week
GET /functions/v1/timesheet-submit?week_start=2025-11-18
```

#### Update My Timesheet (Employee - Not Approved)
```http
PUT /functions/v1/timesheet-submit/{timesheet_id}
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "entries": [
    {
      "date": "2025-11-18",
      "hours": 8.5,
      "project": "Project A",
      "task": "Development"
    }
  ]
}
```

#### Delete My Timesheet (Employee - Not Approved)
```http
DELETE /functions/v1/timesheet-submit/{timesheet_id}
Authorization: Bearer {access_token}
```

---

### Timesheet Approval (Manager/Admin Only)

#### Get Pending Timesheets
**Permissions:** Manager or Admin only

```http
GET /functions/v1/timesheet-approve
Authorization: Bearer {manager_access_token}
```

**Filter Options:**
```http
# By status (defaults to submitted)
GET /functions/v1/timesheet-approve?status=submitted

# By employee
GET /functions/v1/timesheet-approve?employee_id=uuid

# By date range
GET /functions/v1/timesheet-approve?week_start=2025-11-18&week_end=2025-11-24
```

#### Approve or Reject Timesheet
**Permissions:** Manager or Admin only

```http
POST /functions/v1/timesheet-approve
Authorization: Bearer {manager_access_token}
Content-Type: application/json

{
  "timesheet_id": "uuid",
  "action": "approve",  // or "reject"
  "notes": "Approved"
}
```

**Response:**
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
    "entries": [...],
    "status": "approved",
    "reviewed_by": "Manager Name",
    "reviewed_at": "2025-11-25T15:00:00Z",
    "admin_notes": "Approved"
  }
}
```

---

### Scheduled Job (Backend Only)

#### Detect Violations (Run hourly via cron)
```http
POST /functions/v1/detect-violations
Authorization: Service Role Key
```

**Purpose:**
- Detects employees who haven't checked in
- Detects employees who checked in but didn't check out
- Creates violations and notifications
- Escalates repeated violations to managers

**Response:**
```json
{
  "success": true,
  "summary": {
    "employees_checked": 25,
    "violations_created": 3,
    "notifications_sent": 3,
    "escalations": 1
  }
}
```

---

## Role-Based Access Control

| Endpoint | Employee | Manager | HR | Admin |
|----------|----------|---------|-----|-------|
| **Signup** | ✅ | ✅ | ✅ | ✅ |
| **Signin** | ✅ | ✅ | ✅ | ✅ |
| **Check-in** | ✅ (self only) | ✅ (self only) | ✅ (self only) | ❌ |
| **Check-out** | ✅ (self only) | ✅ (self only) | ✅ (self only) | ❌ |
| **View Violations** | ✅ (own only) | ✅ (all) | ✅ (all) | ✅ (all) |
| **Resolve Violations** | ❌ | ✅ | ✅ | ✅ |
| **Create Vacation Request** | ✅ (self only) | ✅ (self only) | ✅ (self only) | ✅ (self only) |
| **View Vacation Requests** | ✅ (own only) | ✅ (all) | ✅ (all) | ✅ (all) |
| **Approve Vacation** | ❌ | ✅ | ✅ | ✅ |
| **Submit Timesheet** | ✅ (self only) | ✅ (self only) | ✅ (self only) | ✅ (self only) |
| **View Timesheets** | ✅ (own only) | ✅ (all) | ✅ (all) | ✅ (all) |
| **Approve Timesheet** | ❌ | ✅ | ✅ | ✅ |

---

## Violation Types

| Type | Description | When Created |
|------|-------------|--------------|
| **late_checkin** | Checked in after 9:00 AM | Automatically by check-in API |
| **early_checkout** | Checked out before work hours end | Automatically by check-out API |
| **no_checkin** | Didn't check in | By detect-violations cron |
| **no_checkout** | Checked in but didn't check out | By detect-violations cron |
| **no_status_update** | No hourly status update | By detect-violations cron |

## Severity Levels

| Level | Late Check-in | Impact |
|-------|---------------|--------|
| **low** | < 30 min late | Warning |
| **medium** | 30-60 min late | Written warning |
| **high** | 60+ min late | May affect review |

## Escalation Rules

Violations are automatically escalated to manager when:
- **High** severity (always)
- **Medium** + 2+ violations in last 30 days
- **Low** + 5+ violations in last 30 days

---

## Error Responses

### Authentication Errors
```json
// Missing auth header
{
  "success": false,
  "error": "Missing authorization header"
}

// Invalid token
{
  "success": false,
  "error": "Unauthorized"
}

// Insufficient permissions
{
  "success": false,
  "error": "Access denied. Only admins and managers can approve vacation requests"
}
```

### Validation Errors
```json
// Missing required fields
{
  "success": false,
  "error": "Email, password, and employee_id are required"
}

// Missing name fields
{
  "success": false,
  "error": "Either full_name or both first_name and last_name are required"
}

// Invalid role
{
  "success": false,
  "error": "Invalid role. Must be one of: employee, manager, hr, admin"
}

// Duplicate employee ID
{
  "success": false,
  "error": "Employee ID already exists"
}
```

---

## Frontend Implementation Flow

```typescript
// 1. Signup (Option 1: Using first_name and last_name)
const signupResponse = await fetch('/functions/v1/signup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'john@company.com',
    password: 'securepass123',
    first_name: 'John',
    last_name: 'Doe',
    employee_id: 'EMP001',
    role: 'employee',
    designation: 'Software Engineer',
    department: 'Engineering'
  })
});

// 1. Signup (Option 2: Using full_name)
const signupResponse = await fetch('/functions/v1/signup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'john@company.com',
    password: 'securepass123',
    full_name: 'John Doe',  // Will be auto-split into first_name and last_name
    employee_id: 'EMP001',
    role: 'employee'
  })
});

// 2. Signin
const signinResponse = await fetch('/functions/v1/signin', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'john@company.com',
    password: 'securepass123'
  })
});
const { session, user } = await signinResponse.json();
localStorage.setItem('access_token', session.access_token);
localStorage.setItem('user_role', user.role);

// 3. Check In (Employee only checks themselves)
const checkInResponse = await fetch('/functions/v1/checkin', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    location: 'Office',
    notes: 'On time'
  })
});
const checkInData = await checkInResponse.json();

// Show violation warning if late
if (checkInData.violation?.created) {
  alert(`You are ${checkInData.violation.minutes_late} minutes late`);
}

// 4. Check Out (Employee only checks themselves)
const checkOutResponse = await fetch('/functions/v1/checkout', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    location: 'Office',
    notes: 'End of day'
  })
});

// 5. Submit Timesheet (Employee)
const timesheetResponse = await fetch('/functions/v1/timesheet-submit', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    week_start_date: '2025-11-18',
    week_end_date: '2025-11-24',
    entries: [
      { date: '2025-11-18', hours: 8, project: 'Project A', task: 'Development' }
    ]
  })
});

// 6. Approve Timesheet (Manager/Admin only)
if (user.role === 'manager' || user.role === 'admin') {
  const approveResponse = await fetch('/functions/v1/timesheet-approve', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      timesheet_id: 'uuid',
      action: 'approve',
      notes: 'Approved'
    })
  });
}

// 7. Request Vacation (Employee)
const vacationResponse = await fetch('/functions/v1/vacation-request', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    start_date: '2025-12-20',
    end_date: '2025-12-27',
    vacation_type: 'annual',
    reason: 'Family vacation'
  })
});

// 8. Approve Vacation (Manager/Admin only)
if (user.role === 'manager' || user.role === 'admin') {
  const approveVacationResponse = await fetch('/functions/v1/vacation-approve', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      request_id: 'uuid',
      action: 'approve',
      notes: 'Enjoy your vacation!'
    })
  });
}
```

---

## Setup Cron Job

Add to `backend/supabase/config.toml`:

```toml
[functions.detect-violations]
verify_jwt = false

[[cron]]
name = "hourly-violation-detection"
schedule = "0 * * * *"  # Every hour
function = "detect-violations"
```
