// Complete schema definitions for each chat feature

export interface FeatureSchema {
  tables: string[]
  schema: string
  employeeFilteredTables: string[]  // Tables that need employee_id filter for non-admins
}

export const SCHEMAS: Record<string, FeatureSchema> = {
  'hourly-chat': {
    tables: ['hourly_status', 'tasks', 'employees'],
    schema: `
Tables:

hourly_status (
  id UUID PRIMARY KEY,
  employee_id UUID REFERENCES employees(id),
  status_time TIMESTAMPTZ,
  status_text TEXT,
  work_status TEXT CHECK (work_status IN ('progress', 'done', 'blocked', 'break')),
  blocker_description TEXT,
  task_id UUID REFERENCES tasks(id),
  created_at TIMESTAMPTZ
)

tasks (
  id UUID PRIMARY KEY,
  task_type TEXT CHECK (task_type IN ('story', 'bug', 'task', 'epic', 'spike')),
  title TEXT,
  description TEXT,
  ticket_number TEXT,
  project_id UUID REFERENCES projects(id),
  priority TEXT CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  story_points INTEGER CHECK (story_points IN (1, 2, 3, 5, 8, 13, 21)),
  complexity TEXT CHECK (complexity IN ('Low', 'Medium', 'High')),
  time_estimation_days INTEGER,
  time_estimation_hours INTEGER,
  time_estimation_minutes INTEGER,
  status TEXT CHECK (status IN ('Backlog', 'Ready', 'In Progress', 'In Review', 'Done')),
  assigned_employee_id UUID REFERENCES employees(id),
  reviewer_id UUID REFERENCES employees(id),
  technology_stack TEXT[],
  file_urls TEXT[],
  link_url TEXT,
  created_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)

employees (
  id UUID PRIMARY KEY,
  employee_id TEXT UNIQUE,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  email TEXT UNIQUE,
  phone TEXT,
  designation TEXT,
  department TEXT,
  division TEXT,
  role TEXT CHECK (role IN ('admin', 'manager', 'hr', 'employee')),
  status TEXT CHECK (status IN ('active', 'inactive', 'on_leave')),
  manager_id UUID REFERENCES employees(id),
  join_date DATE,
  created_at TIMESTAMPTZ
)

RELATIONSHIPS & JOINS:
- hourly_status.employee_id -> employees.id (get employee name: JOIN employees e ON hs.employee_id = e.id)
- hourly_status.task_id -> tasks.id (get task details: JOIN tasks t ON hs.task_id = t.id)
- tasks.assigned_employee_id -> employees.id (get assignee name)
- tasks.reviewer_id -> employees.id (get reviewer name)
- tasks.created_by -> employees.id (get creator name)
- employees.manager_id -> employees.id (get manager name with self-join)

EXAMPLE QUERIES:
- Get hourly status with employee name and task title:
  SELECT hs.status_time, hs.status_text, hs.work_status, e.full_name as employee_name, t.title as task_title, t.ticket_number
  FROM hourly_status hs
  JOIN employees e ON hs.employee_id = e.id
  LEFT JOIN tasks t ON hs.task_id = t.id

- Get who worked on what task:
  SELECT e.full_name, t.title, t.ticket_number, hs.status_text, hs.work_status, hs.status_time
  FROM hourly_status hs
  JOIN employees e ON hs.employee_id = e.id
  LEFT JOIN tasks t ON hs.task_id = t.id
`,
    employeeFilteredTables: ['hourly_status']
  },

  'timesheet-chat': {
    tables: ['check_ins', 'check_outs', 'hourly_status', 'timesheets', 'tasks', 'employees'],
    schema: `
Tables:

check_ins (
  id UUID PRIMARY KEY,
  employee_id UUID REFERENCES employees(id),
  check_in_time TIMESTAMPTZ,
  task_ids UUID[],
  created_at TIMESTAMPTZ
)

check_outs (
  id UUID PRIMARY KEY,
  check_in_id UUID REFERENCES check_ins(id),
  employee_id UUID REFERENCES employees(id),
  check_out_time TIMESTAMPTZ,
  check_out_location TEXT,
  check_out_notes TEXT,
  total_hours NUMERIC,
  created_at TIMESTAMPTZ
)

hourly_status (
  id UUID PRIMARY KEY,
  employee_id UUID REFERENCES employees(id),
  status_time TIMESTAMPTZ,
  status_text TEXT,
  work_status TEXT CHECK (work_status IN ('progress', 'done', 'blocked', 'break')),
  blocker_description TEXT,
  task_id UUID REFERENCES tasks(id),
  created_at TIMESTAMPTZ
)

tasks (
  id UUID PRIMARY KEY,
  task_type TEXT,
  title TEXT,
  ticket_number TEXT,
  project_id UUID,
  status TEXT,
  assigned_employee_id UUID REFERENCES employees(id)
)

timesheets (
  id UUID PRIMARY KEY,
  employee_id UUID REFERENCES employees(id),
  week_start_date DATE,
  week_end_date DATE,
  total_hours NUMERIC,
  entries JSONB,
  notes TEXT,
  status TEXT CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES employees(id),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES employees(id),
  rejection_reason TEXT,
  review_notes TEXT,
  created_at TIMESTAMPTZ
)

employees (
  id UUID PRIMARY KEY,
  employee_id TEXT UNIQUE,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  email TEXT UNIQUE,
  phone TEXT,
  designation TEXT,
  department TEXT,
  division TEXT,
  role TEXT CHECK (role IN ('admin', 'manager', 'hr', 'employee')),
  status TEXT CHECK (status IN ('active', 'inactive', 'on_leave')),
  manager_id UUID REFERENCES employees(id),
  join_date DATE,
  created_at TIMESTAMPTZ
)

RELATIONSHIPS & JOINS:
- check_ins.employee_id -> employees.id (get employee name)
- check_outs.check_in_id -> check_ins.id (link checkout to checkin for total hours)
- check_outs.employee_id -> employees.id (get employee name)
- hourly_status.employee_id -> employees.id (get employee name)
- hourly_status.task_id -> tasks.id (get task details: title, ticket_number)
- timesheets.employee_id -> employees.id (get employee name)
- timesheets.approved_by -> employees.id (get approver name)
- timesheets.reviewed_by -> employees.id (get reviewer name)

EXAMPLE QUERIES:
- Get check-in/check-out with employee name and hours worked:
  SELECT e.full_name, ci.check_in_time, co.check_out_time, co.total_hours
  FROM check_ins ci
  JOIN employees e ON ci.employee_id = e.id
  LEFT JOIN check_outs co ON co.check_in_id = ci.id

- Get hourly status with employee name and task details:
  SELECT e.full_name, hs.status_time, hs.status_text, hs.work_status, t.title as task_title, t.ticket_number
  FROM hourly_status hs
  JOIN employees e ON hs.employee_id = e.id
  LEFT JOIN tasks t ON hs.task_id = t.id

- Get timesheet with employee and approver names:
  SELECT e.full_name as employee, ts.week_start_date, ts.total_hours, ts.status, approver.full_name as approved_by
  FROM timesheets ts
  JOIN employees e ON ts.employee_id = e.id
  LEFT JOIN employees approver ON ts.approved_by = approver.id

- Hours worked per employee in a date range:
  SELECT e.full_name, SUM(co.total_hours) as total_hours
  FROM check_outs co
  JOIN employees e ON co.employee_id = e.id
  WHERE co.check_out_time >= '2024-01-01' AND co.check_out_time < '2025-01-01'
  GROUP BY e.id, e.full_name

- Hours logged PREVIOUS WEEK (from check_outs):
  SELECT e.full_name, SUM(co.total_hours) as total_hours, COUNT(*) as days_worked
  FROM check_outs co
  JOIN employees e ON co.employee_id = e.id
  WHERE co.check_out_time >= DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '7 days'
    AND co.check_out_time < DATE_TRUNC('week', CURRENT_DATE)
  GROUP BY e.id, e.full_name

- Hours logged THIS WEEK (from check_outs):
  SELECT e.full_name, SUM(co.total_hours) as total_hours
  FROM check_outs co
  JOIN employees e ON co.employee_id = e.id
  WHERE co.check_out_time >= DATE_TRUNC('week', CURRENT_DATE)
  GROUP BY e.id, e.full_name

- Weekly timesheet summary for previous week:
  SELECT e.full_name, ts.week_start_date, ts.week_end_date, ts.total_hours, ts.status
  FROM timesheets ts
  JOIN employees e ON ts.employee_id = e.id
  WHERE ts.week_start_date = DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '7 days'

IMPORTANT FOR HOURS QUERIES:
- Hours are stored in check_outs.total_hours (calculated from check-in to check-out)
- timesheets.total_hours contains weekly summaries
- hourly_status tracks WHAT was worked on, not hours (count entries for activity)
- "hours logged" = query check_outs.total_hours or timesheets.total_hours
- "previous week" = DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '7 days' to DATE_TRUNC('week', CURRENT_DATE)
`,
    employeeFilteredTables: ['check_ins', 'check_outs', 'hourly_status', 'timesheets']
  },

  'vacation-chat': {
    tables: ['vacation_requests', 'employees'],
    schema: `
Tables:

vacation_requests (
  id UUID PRIMARY KEY,
  employee_id UUID REFERENCES employees(id),
  start_date DATE,
  end_date DATE,
  total_days INTEGER,
  days INTEGER,
  vacation_type TEXT CHECK (vacation_type IN ('annual', 'sick', 'personal', 'unpaid')),
  reason TEXT,
  status TEXT CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES employees(id),
  approved_by UUID REFERENCES employees(id),
  reviewed_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  review_notes TEXT,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)

employees (
  id UUID PRIMARY KEY,
  employee_id TEXT UNIQUE,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  email TEXT UNIQUE,
  phone TEXT,
  designation TEXT,
  department TEXT,
  division TEXT,
  role TEXT CHECK (role IN ('admin', 'manager', 'hr', 'employee')),
  status TEXT CHECK (status IN ('active', 'inactive', 'on_leave')),
  manager_id UUID REFERENCES employees(id),
  join_date DATE,
  created_at TIMESTAMPTZ
)

RELATIONSHIPS & JOINS:
- vacation_requests.employee_id -> employees.id (get employee who requested vacation)
- vacation_requests.approved_by -> employees.id (get approver name)
- vacation_requests.reviewed_by -> employees.id (get reviewer name)
- employees.manager_id -> employees.id (get manager name with self-join)

EXAMPLE QUERIES:
- Get vacation requests with employee and approver names:
  SELECT e.full_name as employee, vr.start_date, vr.end_date, vr.total_days, vr.vacation_type, vr.status, approver.full_name as approved_by
  FROM vacation_requests vr
  JOIN employees e ON vr.employee_id = e.id
  LEFT JOIN employees approver ON vr.approved_by = approver.id

- Get pending vacation requests by department:
  SELECT e.department, COUNT(*) as pending_requests, SUM(vr.total_days) as total_days_requested
  FROM vacation_requests vr
  JOIN employees e ON vr.employee_id = e.id
  WHERE vr.status = 'pending'
  GROUP BY e.department

- Vacation days taken by employee in a year:
  SELECT e.full_name, vr.vacation_type, SUM(vr.total_days) as days_taken
  FROM vacation_requests vr
  JOIN employees e ON vr.employee_id = e.id
  WHERE vr.status = 'approved' AND vr.start_date >= '2024-01-01' AND vr.start_date < '2025-01-01'
  GROUP BY e.id, e.full_name, vr.vacation_type
`,
    employeeFilteredTables: ['vacation_requests']
  },

  'project-chat': {
    tables: ['projects', 'tasks', 'employees'],
    schema: `
Tables:

projects (
  id UUID PRIMARY KEY,
  project_name TEXT,
  description TEXT,
  status TEXT CHECK (status IN ('active', 'inactive', 'archived')),
  created_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)

tasks (
  id UUID PRIMARY KEY,
  task_type TEXT CHECK (task_type IN ('story', 'bug', 'task', 'epic', 'spike')),
  title TEXT,
  description TEXT,
  ticket_number TEXT,
  project_id UUID REFERENCES projects(id),
  priority TEXT CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  story_points INTEGER CHECK (story_points IN (1, 2, 3, 5, 8, 13, 21)),
  complexity TEXT CHECK (complexity IN ('Low', 'Medium', 'High')),
  time_estimation_days INTEGER,
  time_estimation_hours INTEGER,
  time_estimation_minutes INTEGER,
  status TEXT CHECK (status IN ('Backlog', 'Ready', 'In Progress', 'In Review', 'Done')),
  assigned_employee_id UUID REFERENCES employees(id),
  reviewer_id UUID REFERENCES employees(id),
  technology_stack TEXT[],
  file_urls TEXT[],
  link_url TEXT,
  created_by UUID REFERENCES employees(id),
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)

employees (
  id UUID PRIMARY KEY,
  employee_id TEXT UNIQUE,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  email TEXT UNIQUE,
  phone TEXT,
  designation TEXT,
  department TEXT,
  division TEXT,
  role TEXT CHECK (role IN ('admin', 'manager', 'hr', 'employee')),
  status TEXT CHECK (status IN ('active', 'inactive', 'on_leave')),
  manager_id UUID REFERENCES employees(id),
  join_date DATE,
  created_at TIMESTAMPTZ
)

RELATIONSHIPS & JOINS:
- tasks.project_id -> projects.id (get project name for a task)
- tasks.assigned_employee_id -> employees.id (get assignee name)
- tasks.reviewer_id -> employees.id (get reviewer name)
- tasks.created_by -> employees.id (get task creator name)
- projects.created_by -> employees.id (get project creator name)
- employees.manager_id -> employees.id (get manager name with self-join)

ARRAY HANDLING (technology_stack is TEXT[]):
- Count technologies: SELECT unnest(technology_stack) as tech, COUNT(*) FROM tasks GROUP BY tech
- Find tasks with specific tech: SELECT * FROM tasks WHERE 'React' = ANY(technology_stack)
- Check if array contains value: WHERE technology_stack @> ARRAY['React']

EXAMPLE QUERIES:
- Get tasks with project name, assignee, and reviewer:
  SELECT t.ticket_number, t.title, t.status, t.priority, p.project_name,
         assignee.full_name as assigned_to, reviewer.full_name as reviewer
  FROM tasks t
  JOIN projects p ON t.project_id = p.id
  LEFT JOIN employees assignee ON t.assigned_employee_id = assignee.id
  LEFT JOIN employees reviewer ON t.reviewer_id = reviewer.id

- Tasks per employee with their names:
  SELECT e.full_name, COUNT(*) as task_count, SUM(t.story_points) as total_points
  FROM tasks t
  JOIN employees e ON t.assigned_employee_id = e.id
  GROUP BY e.id, e.full_name
  ORDER BY task_count DESC

- Project summary with task counts:
  SELECT p.project_name, COUNT(t.id) as total_tasks,
         COUNT(CASE WHEN t.status = 'Done' THEN 1 END) as completed,
         COUNT(CASE WHEN t.status = 'In Progress' THEN 1 END) as in_progress
  FROM projects p
  LEFT JOIN tasks t ON t.project_id = p.id
  GROUP BY p.id, p.project_name

- Who is working on what (current assignments):
  SELECT e.full_name, t.ticket_number, t.title, t.status, p.project_name
  FROM tasks t
  JOIN employees e ON t.assigned_employee_id = e.id
  JOIN projects p ON t.project_id = p.id
  WHERE t.status IN ('In Progress', 'In Review')

- Compare two employees (CORRECT way - use conditional aggregation):
  SELECT
    e.full_name,
    COUNT(t.id) as task_count,
    SUM(t.story_points) as total_points,
    COUNT(CASE WHEN t.status = 'Done' THEN 1 END) as completed
  FROM employees e
  LEFT JOIN tasks t ON t.assigned_employee_id = e.id
  WHERE e.full_name ILIKE '%john%' OR e.full_name ILIKE '%sushant%'
  GROUP BY e.id, e.full_name
`,
    employeeFilteredTables: []  // No filter - all users can see all projects/tasks
  },

  'violations-chat': {
    tables: ['violations', 'employees'],
    schema: `
Tables:

violations (
  id UUID PRIMARY KEY,
  employee_id UUID REFERENCES employees(id),
  violation_type TEXT CHECK (violation_type IN ('late_checkin', 'no_checkin', 'no_checkout', 'no_status_update', 'early_checkout')),
  violation_date DATE,
  severity TEXT CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  description TEXT,
  escalated BOOLEAN DEFAULT false,
  escalated_to UUID REFERENCES employees(id),
  escalation_time TIMESTAMPTZ,
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  resolved_notes TEXT,
  created_at TIMESTAMPTZ
)

employees (
  id UUID PRIMARY KEY,
  employee_id TEXT UNIQUE,
  first_name TEXT,
  last_name TEXT,
  full_name TEXT,
  email TEXT UNIQUE,
  phone TEXT,
  designation TEXT,
  department TEXT,
  division TEXT,
  role TEXT CHECK (role IN ('admin', 'manager', 'hr', 'employee')),
  status TEXT CHECK (status IN ('active', 'inactive', 'on_leave')),
  manager_id UUID REFERENCES employees(id),
  join_date DATE,
  created_at TIMESTAMPTZ
)

RELATIONSHIPS & JOINS:
- violations.employee_id -> employees.id (get employee who has the violation)
- violations.escalated_to -> employees.id (get manager/person it was escalated to)
- employees.manager_id -> employees.id (get employee's manager with self-join)

VIOLATION TYPES EXPLAINED:
- late_checkin: Employee checked in after expected time
- no_checkin: Employee did not check in for the day
- no_checkout: Employee did not check out
- no_status_update: Employee missed hourly status update
- early_checkout: Employee checked out before expected time

EXAMPLE QUERIES:
- Get violations with employee name and escalated-to person:
  SELECT v.violation_date, v.violation_type, v.severity, v.description, v.resolved,
         e.full_name as employee_name, e.department,
         escalated.full_name as escalated_to_name
  FROM violations v
  JOIN employees e ON v.employee_id = e.id
  LEFT JOIN employees escalated ON v.escalated_to = escalated.id

- Violations count by employee:
  SELECT e.full_name, e.department, COUNT(*) as violation_count,
         COUNT(CASE WHEN v.resolved = false THEN 1 END) as unresolved
  FROM violations v
  JOIN employees e ON v.employee_id = e.id
  GROUP BY e.id, e.full_name, e.department
  ORDER BY violation_count DESC

- Violations by type and severity:
  SELECT v.violation_type, v.severity, COUNT(*) as count
  FROM violations v
  GROUP BY v.violation_type, v.severity
  ORDER BY v.severity, count DESC

- Unresolved violations with employee details:
  SELECT e.full_name, e.department, v.violation_type, v.violation_date, v.severity, v.description
  FROM violations v
  JOIN employees e ON v.employee_id = e.id
  WHERE v.resolved = false
  ORDER BY v.severity DESC, v.violation_date DESC
`,
    employeeFilteredTables: ['violations']
  }
}
