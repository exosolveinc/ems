# Chat API Documentation

AI-powered chat endpoints for analyzing employee data using Claude Haiku.

## Base URL

```
https://<your-project>.supabase.co/functions/v1
```

## Authentication

All endpoints require a valid JWT token in the Authorization header:

```
Authorization: Bearer <jwt_token>
```

---

## Endpoints

### 1. Hourly Status Chat

**POST** `/hourly-chat`

Analyze hourly work statuses, productivity patterns, and blockers.

**Request:**
```json
{
  "message": "What was I working on yesterday?"
}
```

**Response:**
```json
{
  "success": true,
  "response": "Yesterday you worked on 3 tasks..."
}
```

**Example Questions:**
- "What was I working on yesterday?"
- "How often was I blocked last week?"
- "Which task took the most time?"
- "Show me my work pattern for this week"
- Admin: "What was John working on last Monday?"

**Data Range:** Last 30 days

---

### 2. Timesheet Chat

**POST** `/timesheet-chat`

Analyze timesheet data, hours worked, and approval status.

**Request:**
```json
{
  "message": "How many hours did I work last week?"
}
```

**Response:**
```json
{
  "success": true,
  "response": "Last week you logged 42 hours..."
}
```

**Example Questions:**
- "How many hours did I work last week?"
- "Is my timesheet approved?"
- "Show me my hours breakdown by day"
- "What's my average weekly hours this quarter?"
- Admin: "Who hasn't submitted their timesheet?"

**Data Range:** Last 90 days

---

### 3. Vacation Chat

**POST** `/vacation-chat`

Analyze vacation requests, leave history, and upcoming time off.

**Request:**
```json
{
  "message": "How many vacation days have I taken this year?"
}
```

**Response:**
```json
{
  "success": true,
  "response": "This year you've taken 8 vacation days..."
}
```

**Example Questions:**
- "How many vacation days have I taken this year?"
- "What's the status of my vacation request?"
- "When is my next approved vacation?"
- "How many sick days did I use?"
- Admin: "Who is on vacation next week?"

**Data Range:** Last 365 days

---

### 4. Project Chat

**POST** `/project-chat`

Analyze projects, tasks, assignments, and workload.

**Request:**
```json
{
  "message": "What tasks are assigned to me?"
}
```

**Response:**
```json
{
  "success": true,
  "response": "You have 5 tasks assigned..."
}
```

**Example Questions:**
- "What tasks are assigned to me?"
- "What's the status of Project X?"
- "How many story points am I assigned?"
- "Which tasks are blocked?"
- "What tasks are in review?"
- "What is John working on?"
- "Show me all high priority tasks"
- "Who is assigned to Project X?"

**Data Range:** All active projects + tasks completed in last 90 days

**Note:** All users can query about any employee's tasks/projects (no role restriction).

---

### 5. Violations Chat

**POST** `/violations-chat`

Analyze employee violations, patterns, and resolution status.

**Request:**
```json
{
  "message": "How many violations do I have this month?"
}
```

**Response:**
```json
{
  "success": true,
  "response": "This month you have 2 violations..."
}
```

**Example Questions:**
- "How many violations do I have?"
- "What are my unresolved violations?"
- "Show me my violation history"
- "What's my most common violation type?"
- Admin: "Who has the most violations this month?"
- Admin: "Show me all critical violations"
- Admin: "What are John's unresolved violations?"

**Violation Types:** late_checkin, early_checkout, no_checkin, no_checkout

**Severity Levels:** low, medium, high, critical

**Data Range:** Last 90 days

---

## Role-Based Access

| Endpoint | Employee | Manager/Admin |
|----------|----------|---------------|
| `/hourly-chat` | Own data only | All employees |
| `/timesheet-chat` | Own data only | All employees |
| `/vacation-chat` | Own data only | All employees |
| `/violations-chat` | Own data only | All employees |
| `/project-chat` | All projects/tasks | All projects/tasks |

**Note:** `/project-chat` allows all users to query any employee's tasks - useful for team collaboration.

Admins and managers can ask about specific employees by name in hourly/timesheet/vacation:
- "What was John's vacation last month?"
- "How many hours did Sarah work last week?"

---

## Error Responses

**401 Unauthorized:**
```json
{
  "success": false,
  "error": "Missing authorization header"
}
```

**400 Bad Request:**
```json
{
  "success": false,
  "error": "message is required"
}
```

**500 Server Error:**
```json
{
  "success": false,
  "error": "ANTHROPIC_API_KEY not configured"
}
```

---

## cURL Examples

```bash
# Hourly Status Chat
curl -X POST https://<project>.supabase.co/functions/v1/hourly-chat \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "What was I working on yesterday?"}'

# Timesheet Chat
curl -X POST https://<project>.supabase.co/functions/v1/timesheet-chat \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "How many hours did I work last week?"}'

# Vacation Chat
curl -X POST https://<project>.supabase.co/functions/v1/vacation-chat \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "When is my next vacation?"}'

# Project Chat
curl -X POST https://<project>.supabase.co/functions/v1/project-chat \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "What tasks are assigned to me?"}'

# Violations Chat
curl -X POST https://<project>.supabase.co/functions/v1/violations-chat \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "How many violations do I have?"}'
```

---

## Setup

1. Set Anthropic API key:
```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-your-key
```

2. Deploy functions:
```bash
supabase functions deploy hourly-chat
supabase functions deploy timesheet-chat
supabase functions deploy vacation-chat
supabase functions deploy project-chat
supabase functions deploy violations-chat
```
