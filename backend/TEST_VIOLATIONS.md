# Testing Check-in with Violation Detection

## Important: API Call Workflow

**You DO NOT need to call both `detect-violations` and `check-in` APIs from the frontend!**

Here's how it works:

### Frontend Should Call:
- **check-in API** - When employee checks in
- **check-out API** - When employee checks out
- **violations API (GET)** - To view violations

### Backend Automatic Processing:
- **check-in API** - Automatically detects late check-in violations
- **detect-violations API** - Scheduled job (runs hourly) to detect:
  - Missing check-ins
  - Missing check-outs
  - Batch violation detection

## Setup for Testing

### 1. First, apply migrations and deploy functions:
```bash
cd /Users/aayushpoudel/Works/ems/backend

# Apply migrations
npm run db:reset

# Deploy all functions
npm run deploy:all
```

### 2. Create a test user (via signup):
```bash
# Replace YOUR_SUPABASE_URL with your actual URL
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_ANON_KEY="your-anon-key"

curl -X POST "$SUPABASE_URL/functions/v1/signup" \
  -H "Content-Type: application/json" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -d '{
    "email": "test@example.com",
    "password": "test123456",
    "full_name": "Test Employee",
    "employee_id": "EMP001",
    "role": "employee"
  }'
```

### 3. Sign in to get access token:
```bash
curl -X POST "$SUPABASE_URL/functions/v1/signin" \
  -H "Content-Type: application/json" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -d '{
    "email": "test@example.com",
    "password": "test123456"
  }'

# Save the access_token from the response
export ACCESS_TOKEN="eyJ..." # Your actual token
```

## Test Case 1: On-Time Check-in (No Violation)

Check in before 9:05 AM:

```bash
curl -X POST "$SUPABASE_URL/functions/v1/checkin" \
  -H "Content-Type: application/json" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "employee_id": "YOUR_USER_ID_FROM_SIGNIN",
    "location": "Office",
    "ip": "192.168.1.1",
    "notes": "On time check-in"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "employee_id": "...",
    "check_in_time": "2025-11-25T08:55:00.000Z",
    ...
  },
  "violation": null  // No violation because on time
}
```

## Test Case 2: Late Check-in (Creates Violation)

### Option A: Modify check-in function to simulate late arrival

Temporarily edit `backend/supabase/functions/checkin/index.ts` line 67:

```typescript
// Change this line (around line 67):
const workStart = new Date(checkInTime)
workStart.setHours(9, 0, 0, 0) // 9 AM work start

// To this (set work start to 1 hour ago for testing):
const workStart = new Date(checkInTime)
workStart.setHours(checkInTime.getHours() - 1, 0, 0, 0) // Simulate being 1 hour late
```

Then redeploy and test:
```bash
npm run deploy:checkin

curl -X POST "$SUPABASE_URL/functions/v1/checkin" \
  -H "Content-Type: application/json" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d '{
    "employee_id": "YOUR_USER_ID",
    "location": "Office",
    "ip": "192.168.1.1",
    "notes": "Late check-in test"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "id": "...",
    "employee_id": "...",
    "check_in_time": "2025-11-25T10:30:00.000Z",
    ...
  },
  "violation": {
    "created": true,
    "severity": "high",
    "minutes_late": 60
  }
}
```

### Option B: Actually check in late (after 9:05 AM)

Simply wait until after 9:05 AM your local time and check in normally. The system will detect the late check-in.

## Test Case 3: Get Violations via GET Request

```bash
# Get all your violations
curl -X GET "$SUPABASE_URL/functions/v1/violations" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Get violations with summary
curl -X GET "$SUPABASE_URL/functions/v1/violations?include_summary=true" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Filter by severity
curl -X GET "$SUPABASE_URL/functions/v1/violations?severity=high" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Filter by date range
curl -X GET "$SUPABASE_URL/functions/v1/violations?start_date=2025-11-01&end_date=2025-11-30" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN"

# Filter by unresolved violations only
curl -X GET "$SUPABASE_URL/functions/v1/violations?resolved=false" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

**Expected Response:**
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
      "created_at": "2025-11-25T10:30:00.000Z",
      "employee": {
        "employee_id": "EMP001",
        "full_name": "Test Employee",
        "email": "test@example.com"
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

## Test Case 4: Scheduled Violation Detection (Missing Check-ins)

```bash
# Manually trigger the detect-violations function
# (In production, this would run on a schedule)
curl -X POST "$SUPABASE_URL/functions/v1/detect-violations" \
  -H "apikey: $SUPABASE_ANON_KEY"
```

**Expected Response:**
```json
{
  "success": true,
  "summary": {
    "employees_checked": 5,
    "violations_created": 2,
    "notifications_sent": 2,
    "escalations": 0
  },
  "violations": [
    {
      "id": "...",
      "employee_id": "...",
      "violation_type": "no_checkin",
      "severity": "medium",
      "description": "No check-in recorded. Work started 2.5 hours ago."
    }
  ]
}
```

## Frontend Integration Examples

### React/Next.js Example:

```typescript
// When employee clicks "Check In" button
async function handleCheckIn() {
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/checkin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        employee_id: user.id,
        location: 'Office',
        ip: await getUserIP(), // Optional
        notes: '', // Optional
      }),
    });

    const data = await response.json();

    if (data.success) {
      // Show success message
      toast.success('Checked in successfully!');

      // If violation was created, show warning
      if (data.violation?.created) {
        toast.warning(
          `Late check-in detected: ${data.violation.minutes_late} minutes late (${data.violation.severity} severity)`
        );
      }
    }
  } catch (error) {
    toast.error('Failed to check in');
  }
}

// Fetch violations for dashboard
async function fetchViolations() {
  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/violations?include_summary=true&resolved=false`,
    {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${accessToken}`,
      },
    }
  );

  const data = await response.json();

  if (data.success) {
    setViolations(data.data);
    setSummary(data.summary);
  }
}
```

## Manager Functions

If logged in as manager/admin:

```bash
# View all violations across all employees
curl -X GET "$SUPABASE_URL/functions/v1/violations?include_summary=true" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $MANAGER_ACCESS_TOKEN"

# Resolve a violation
curl -X PATCH "$SUPABASE_URL/functions/v1/violations/VIOLATION_ID" \
  -H "Content-Type: application/json" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $MANAGER_ACCESS_TOKEN" \
  -d '{
    "resolved": true,
    "resolved_notes": "Discussed with employee, approved as exception"
  }'
```

## Summary

### ✅ DO (Frontend):
- Call `check-in` when employee checks in
- Call `check-out` when employee checks out
- Call `violations` (GET) to view violations
- Display violation warnings if returned by check-in/check-out

### ❌ DON'T (Frontend):
- Call `detect-violations` manually (it's for scheduled jobs)
- Call check-in and detect-violations together

### ⚙️ Backend Setup (One-time):
1. Set up a cron job to call `detect-violations` every hour
2. This catches employees who forgot to check in/out
3. Violations from check-in/check-out are created in real-time automatically
