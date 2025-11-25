# EMS API Reference

## Quick Answer to Your Questions:

### 1. Can I get violations by sending GET request?
**YES!** Use the `/violations` endpoint:
```bash
GET /functions/v1/violations
```

### 2. Do I need to call both detect-violations and check-in APIs?
**NO!** Here's what happens:

| API | When to Call | Who Calls It |
|-----|--------------|--------------|
| **check-in** | When employee checks in | **Frontend** |
| **check-out** | When employee checks out | **Frontend** |
| **violations (GET)** | To view violations | **Frontend** |
| **detect-violations** | Scheduled (hourly) | **Backend Cron Job** |

**The check-in API automatically creates violations if employee is late!**

---

## API Endpoints

### Authentication

#### Sign Up
```http
POST /functions/v1/signup
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "full_name": "John Doe",
  "employee_id": "EMP001",
  "role": "employee"
}
```

#### Sign In
```http
POST /functions/v1/signin
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "session": {
    "access_token": "eyJ...",
    "refresh_token": "...",
    "expires_in": 3600
  },
  "user": {
    "id": "...",
    "email": "user@example.com",
    "employee_id": "EMP001",
    "full_name": "John Doe",
    "role": "employee"
  }
}
```

---

### Check-In / Check-Out

#### Check In
```http
POST /functions/v1/checkin
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "employee_id": "user-uuid",
  "location": "Office",
  "ip": "192.168.1.1",  // optional
  "notes": "On time"     // optional
}
```

**Response (On Time):**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "employee_id": "...",
    "check_in_time": "2025-11-25T08:55:00Z",
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
    "id": "...",
    "employee_id": "...",
    "check_in_time": "2025-11-25T10:30:00Z"
  },
  "violation": {
    "created": true,
    "severity": "high",
    "minutes_late": 90
  }
}
```

#### Check Out
```http
POST /functions/v1/checkout
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "employee_id": "user-uuid",
  "location": "Office",
  "ip": "192.168.1.1",  // optional
  "notes": "End of day"  // optional
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "employee_id": "...",
    "check_out_time": "2025-11-25T17:00:00Z",
    "total_hours": 8.08
  }
}
```

---

### Violations

#### Get All Violations (Employee - sees own only)
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
      "id": "...",
      "employee_id": "...",
      "violation_type": "late_checkin",
      "violation_date": "2025-11-25",
      "severity": "high",
      "description": "Checked in 60 minutes late",
      "escalated": false,
      "resolved": false,
      "created_at": "2025-11-25T10:30:00Z",
      "employee": {
        "employee_id": "EMP001",
        "full_name": "John Doe",
        "email": "user@example.com"
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

#### Resolve Violation (Manager/Admin only)
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

#### Get My Vacation Requests
```http
GET /functions/v1/vacation-request
Authorization: Bearer {access_token}
```

#### Create Vacation Request
```http
POST /functions/v1/vacation-request
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "start_date": "2025-12-20",
  "end_date": "2025-12-27",
  "reason": "Family vacation",
  "vacation_type": "annual"
}
```

#### Get All Vacation Requests (Manager)
```http
GET /functions/v1/vacation-request?status=pending
Authorization: Bearer {manager_access_token}
```

#### Approve Vacation Request (Manager)
```http
PATCH /functions/v1/vacation-approve/{request_id}
Authorization: Bearer {manager_access_token}
Content-Type: application/json

{
  "status": "approved",
  "review_notes": "Approved"
}
```

---

### Timesheets

#### Submit Timesheet
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

#### Get My Timesheets
```http
GET /functions/v1/timesheet-submit
Authorization: Bearer {access_token}

# Filter by status
GET /functions/v1/timesheet-submit?status=submitted
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

## Violation Types

| Type | Description | When Created |
|------|-------------|--------------|
| **late_checkin** | Checked in after 9:05 AM | Automatically by check-in API |
| **early_checkout** | Checked out before 4:45 PM | Automatically by check-out API |
| **no_checkin** | Didn't check in by 9:00 AM | By detect-violations cron |
| **no_checkout** | Checked in but didn't check out | By detect-violations cron |

## Severity Levels

| Level | Late Check-in | Early Checkout | Impact |
|-------|---------------|----------------|--------|
| **low** | 5-15 min late | < 30 min early | Warning |
| **medium** | 15-30 min late | 30-60 min early | Written warning |
| **high** | 30-60 min late | 60-120 min early | May affect review |
| **critical** | 60+ min late | 120+ min early | Escalated to manager |

## Escalation Rules

Violations are automatically escalated to manager when:
- **Critical** severity (always)
- **High** + 2+ violations in last 30 days
- **Medium** + 3+ violations in last 30 days
- **Low** + 5+ violations in last 30 days

---

## Frontend Implementation Flow

```typescript
// 1. User clicks "Check In"
const checkInResponse = await checkIn();

// 2. Backend automatically detects if late and creates violation
if (checkInResponse.violation?.created) {
  // Show warning to user
  showWarning(`You are ${checkInResponse.violation.minutes_late} minutes late`);
}

// 3. Later, fetch violations for dashboard
const violations = await getViolations({ resolved: false });
```

**You do NOT need to call detect-violations from frontend!**

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
