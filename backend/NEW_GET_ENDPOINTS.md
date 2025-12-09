# New GET API Endpoints

## Summary
Added GET endpoints for check-in and timesheet functions with query parameter support.

---

## 1. Get Check-Ins

Retrieve check-in records with checkout data and standup entries.

**Endpoint**: `GET /functions/v1/checkin`

**Query Parameters**:
- `employee_id` (string): Filter by employee ID (e.g., "EMP00123") - manager/admin only
- `date` (ISO date): Filter by specific date
- `start_date` (ISO date): Filter from date
- `end_date` (ISO date): Filter to date
- `work_location` (enum): "home" or "office"
- `limit` (number): Results per page (default: 50)
- `offset` (number): Pagination offset (default: 0)

**Example URLs**:
```
GET https://hygwacgmveeipjrybqip.supabase.co/functions/v1/checkin
GET https://hygwacgmveeipjrybqip.supabase.co/functions/v1/checkin?employee_id=EMP00123
GET https://hygwacgmveeipjrybqip.supabase.co/functions/v1/checkin?date=2025-11-28
GET https://hygwacgmveeipjrybqip.supabase.co/functions/v1/checkin?start_date=2025-11-01&end_date=2025-11-30
```

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "employee_id": "uuid",
      "check_in_time": "2025-11-28T08:55:00Z",
      "check_in_location": "New York Office",
      "work_location": "office",
      "has_blockers": true,
      "employees": {
        "employee_id": "EMP001",
        "full_name": "John Doe",
        "email": "john@company.com",
        "department": "Engineering",
        "designation": "Software Engineer"
      },
      "standup_entries": [
        {
          "id": "uuid",
          "entry_type": "yesterday",
          "project_name": "Project A",
          "task_description": "Implemented authentication",
          "confidence_score": 9,
          "difficulty_level": 7
        }
      ],
      "check_outs": [
        {
          "id": "uuid",
          "check_out_time": "2025-11-28T17:05:00Z",
          "total_hours": 8.17
        }
      ]
    }
  ],
  "count": 1,
  "offset": 0,
  "limit": 50
}
```

**Features**:
- Includes checkout data in `check_outs` array (if checked out)
- Includes all standup entries grouped by entry_type
- Supports filtering by employee_id (managers/admins only)
- Date range filtering
- Pagination support

---

## 2. Check Current Check-In Status

Check if the current user is checked in today.

**Endpoint**: `GET /functions/v1/checkin?check_status=true`

**Query Parameters**:
- `check_status=true` (required): Triggers status check

**Example URL**:
```
GET https://hygwacgmveeipjrybqip.supabase.co/functions/v1/checkin?check_status=true
```

**Response - Not Checked In**:
```json
{
  "success": true,
  "checked_in": false,
  "message": "Not checked in today",
  "employee": {
    "id": "uuid",
    "employee_id": "EMP001",
    "full_name": "John Doe"
  }
}
```

**Response - Checked In (Not Checked Out)**:
```json
{
  "success": true,
  "checked_in": true,
  "checked_out": false,
  "check_in": {
    "id": "uuid",
    "check_in_time": "2025-11-28T08:55:00Z",
    "check_in_location": "Office",
    "work_location": "office",
    "has_blockers": false,
    "standup_entries": [
      {
        "id": "uuid",
        "entry_type": "today",
        "project_name": "Project A",
        "task_description": "Working on feature X",
        "confidence_score": 8,
        "difficulty_level": 6
      }
    ]
  },
  "check_out": null,
  "employee": {
    "id": "uuid",
    "employee_id": "EMP001",
    "full_name": "John Doe"
  }
}
```

**Response - Checked In and Checked Out**:
```json
{
  "success": true,
  "checked_in": true,
  "checked_out": true,
  "check_in": {
    "id": "uuid",
    "check_in_time": "2025-11-28T08:55:00Z",
    "check_in_location": "Office",
    "work_location": "office",
    "has_blockers": false,
    "standup_entries": [ ]
  },
  "check_out": {
    "id": "uuid",
    "check_out_time": "2025-11-28T17:05:00Z",
    "total_hours": 8.17
  },
  "employee": {
    "id": "uuid",
    "employee_id": "EMP001",
    "full_name": "John Doe"
  }
}
```

**Use Cases**:
- Check if user needs to check in
- Display current work session info
- Show checkout button only if checked in
- Dashboard status widget

---

## 3. Get Timesheets

Retrieve timesheet records for the current user.

**Endpoint**: `GET /functions/v1/timesheet-submit`

**Query Parameters**:
- `status` (enum): "submitted", "approved", "rejected"
- `week_start` (ISO date): Filter by week start date
- `week_end` (ISO date): Filter by week end date

**Example URLs**:
```
GET https://hygwacgmveeipjrybqip.supabase.co/functions/v1/timesheet-submit
GET https://hygwacgmveeipjrybqip.supabase.co/functions/v1/timesheet-submit?status=submitted
GET https://hygwacgmveeipjrybqip.supabase.co/functions/v1/timesheet-submit?week_start=2025-11-18
```

**Response**:
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "employee_id": "uuid",
      "week_start_date": "2025-11-18",
      "week_end_date": "2025-11-24",
      "total_hours": 40,
      "entries": [
        {
          "date": "2025-11-18",
          "hours": 8,
          "project": "Project A",
          "task": "Development",
          "notes": "Frontend work"
        }
      ],
      "status": "submitted",
      "submitted_at": "2025-11-25T10:00:00Z",
      "employees": {
        "employee_id": "EMP001",
        "full_name": "John Doe",
        "email": "john@company.com"
      }
    }
  ],
  "count": 1
}
```

**Features**:
- Filter by submission status
- Filter by week dates
- Includes employee details
- Shows all timesheet entries

---

## Implementation Notes

### Files Modified:
1. **[/backend/supabase/functions/checkin/index.ts](backend/supabase/functions/checkin/index.ts)**
   - Added `handleGetCheckIns()` function for retrieving check-ins
   - Added `handleCheckStatus()` function for checking current status
   - Added GET request routing logic

2. **[/backend/supabase/functions/timesheet-submit/index.ts](backend/supabase/functions/timesheet-submit/index.ts)**
   - Fixed `reviewed_by` relationship error (removed from query)
   - GET method already existed, confirmed working

### Authentication:
All endpoints require Bearer token authentication:
```http
Authorization: Bearer {access_token}
```

### Permission Logic:
- **Check-ins**:
  - Employees see only their own data
  - Managers/HR/Admins can filter by employee_id to see any employee
- **Check Status**: Only shows current user's status
- **Timesheets**: Employees see only their own timesheets

### Timezone:
All date/time operations use EST/EDT (America/New_York) timezone for consistency with work hour calculations.

---

## Testing

### Test Check-In Status:
```bash
curl -X GET "https://hygwacgmveeipjrybqip.supabase.co/functions/v1/checkin?check_status=true" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Test Get Check-Ins:
```bash
# Get my check-ins
curl -X GET "https://hygwacgmveeipjrybqip.supabase.co/functions/v1/checkin" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Get specific employee (manager)
curl -X GET "https://hygwacgmveeipjrybqip.supabase.co/functions/v1/checkin?employee_id=EMP00123" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Test Get Timesheets:
```bash
curl -X GET "https://hygwacgmveeipjrybqip.supabase.co/functions/v1/timesheet-submit?status=submitted" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## Next Steps

1. Update main [API_Documentation.md](backend/API_Documentation.md) with these new endpoints
2. Test all endpoints with actual data
3. Deploy to Supabase
4. Update frontend to use new endpoints

---

**Created**: 2025-11-29
**Status**: ✅ Implemented
