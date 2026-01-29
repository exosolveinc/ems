// SQL generation and validation utilities

import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.24.3'
import { SCHEMAS, FeatureSchema } from './schemas.ts'

// Call Claude Haiku (with configurable max_tokens for speed optimization)
async function callHaiku(
  systemPrompt: string,
  userMessage: string,
  maxTokens: number = 512
): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const anthropic = new Anthropic({ apiKey })
  const response = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022', // Faster model
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  })

  return response.content[0].type === 'text' ? response.content[0].text : ''
}

// Validate SQL - only SELECT allowed, check employee filters
export function validateSQL(
  sql: string,
  role: string,
  userId: string,
  filteredTables: string[]
): { valid: boolean; error?: string } {
  const trimmedSQL = sql.trim()
  const upperSQL = trimmedSQL.toUpperCase()

  // Block non-SELECT statements
  if (!upperSQL.startsWith('SELECT')) {
    return { valid: false, error: 'Only SELECT queries are allowed.' }
  }

  // Block dangerous keywords
  const dangerous = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE', 'CREATE', 'GRANT', 'REVOKE']
  for (const keyword of dangerous) {
    if (upperSQL.includes(keyword)) {
      return { valid: false, error: `Query contains forbidden keyword: ${keyword}` }
    }
  }

  // For non-admin users: ensure employee_id filter exists for filtered tables
  if (role !== 'admin' && role !== 'manager') {
    for (const table of filteredTables) {
      // Check if this table is referenced in the query
      if (upperSQL.includes(table.toUpperCase())) {
        // Must have employee_id filter with the user's ID
        if (!sql.includes(userId)) {
          return {
            valid: false,
            error: `Access denied: You can only query your own data from ${table}.`
          }
        }
      }
    }
  }

  return { valid: true }
}

// Generate SQL from natural language question
export async function generateSQL(
  feature: string,
  question: string,
  role: string,
  userId: string,
  userName: string
): Promise<string> {
  const schema = SCHEMAS[feature]
  if (!schema) throw new Error(`Unknown feature: ${feature}`)

  const today = new Date().toISOString().split('T')[0]

  // Calculate week boundaries
  const now = new Date()
  const dayOfWeek = now.getDay()
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const monday = new Date(now)
  monday.setDate(now.getDate() + mondayOffset)
  const weekStart = monday.toISOString().split('T')[0]
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const weekEnd = sunday.toISOString().split('T')[0]

  // Month boundaries
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

  const isAdmin = role === 'admin' || role === 'manager'
  const filterTables = schema.employeeFilteredTables

  let roleInstructions = ''
  if (isAdmin) {
    roleInstructions = 'User is admin/manager - can query any employee data.'
  } else {
    if (filterTables.length > 0) {
      roleInstructions = `User is employee. For tables [${filterTables.join(', ')}], MUST include: employee_id = '${userId}'`
    } else {
      roleInstructions = 'User is employee. Can query all data in these tables.'
    }
  }

  const systemPrompt = `You are a PostgreSQL SELECT query generator. Output ONLY a SELECT query, nothing else.

CRITICAL RULES - READ CAREFULLY:
1. You can ONLY generate SELECT statements. NEVER use CREATE, INSERT, UPDATE, DELETE, DROP, ALTER, or any other statement.
2. "next task" or "what task should I work on" = SELECT existing tasks assigned to user, NOT create new task
3. "my tasks" = SELECT tasks WHERE assigned_employee_id = user's ID
4. This is a READ-ONLY system - all queries must be SELECT statements

SPECIAL CASE - "CREATE TASK" REQUESTS:
When user asks to "create a task", "add a task", "make a task", or similar:
- DO NOT generate CREATE/INSERT statements
- Instead, SELECT data to help suggest a task outline:
  - Query similar tasks in the project to see title patterns, assignees, priorities
  - Query employees who work on that project/technology
  - Query project details
- The analysis step will format this as a suggested task outline

Example: "create a task for login bug in EMS project" should generate:
SELECT t.title, t.description, t.task_type, t.priority, t.story_points,
       p.project_name, p.id as project_id,
       e.full_name as typical_assignee, e.id as assignee_id
FROM tasks t
JOIN projects p ON t.project_id = p.id
LEFT JOIN employees e ON t.assigned_employee_id = e.id
WHERE p.project_name ILIKE '%ems%' AND t.task_type = 'bug'
ORDER BY t.created_at DESC
LIMIT 5

Example: "what task should I work on next?" should generate:
SELECT t.ticket_number, t.title, t.priority, t.status, p.project_name
FROM tasks t
LEFT JOIN projects p ON t.project_id = p.id
WHERE t.assigned_employee_id = '[user_id]' AND t.status IN ('Ready', 'In Progress', 'Backlog')
ORDER BY CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END
LIMIT 5

RULES:
- ONLY SELECT statements allowed - no exceptions
- Do NOT include semicolon at the end
- Use proper PostgreSQL syntax
- Always include relevant columns for the question
- For date comparisons use: column >= 'YYYY-MM-DD' format
- ALWAYS JOIN tables to get full details (e.g., employee names, task titles) - never return just IDs
- When showing employees, include full_name (or first_name, last_name)
- When showing tasks, include title and ticket_number
- When showing projects, include project_name
- Keep queries efficient but complete with all relevant information
- EVERY JOIN must have an ON clause - never write "JOIN table" without "ON condition"
- For comparing two employees, use separate queries with UNION or use conditional aggregation, NOT multiple JOINs to same table
- ${roleInstructions}

TEXT SEARCH - ALWAYS USE FUZZY MATCHING:
- For project names: use ILIKE '%keyword%' (e.g., project_name ILIKE '%ems%' finds "EMS System")
- For task titles: use ILIKE '%keyword%' (e.g., title ILIKE '%login%' finds "Fix login bug")
- For employee names: use ILIKE '%keyword%' on full_name, first_name, or last_name
- For descriptions: use ILIKE '%keyword%'
- NEVER use exact match (=) for text searches unless user provides exact value in quotes
- ILIKE is case-insensitive, so 'ems', 'EMS', 'Ems' all match

CRITICAL - DATE HANDLING (ANALYZE CAREFULLY):
You MUST carefully analyze the user's question to determine the EXACT date range they are asking about.

STEP 1 - IDENTIFY DATE INTENT:
- Does the question mention a specific time period? (today, this week, last month, Q1, 2024, etc.)
- Is the question about "current" or "recent" data? (implies current period)
- Is the question about "history" or "trends"? (may need wider range)
- Is there NO time reference? (default to relevant current period based on context)

STEP 2 - MAP TO EXACT DATES:
Today: ${today}
Current Year: ${now.getFullYear()}
Previous Year: ${now.getFullYear() - 1}

RELATIVE TIME MAPPINGS (be precise):
- "today" = WHERE date_column = '${today}'
- "yesterday" = WHERE date_column = CURRENT_DATE - INTERVAL '1 day'
- "this week" = WHERE date_column >= '${weekStart}' AND date_column <= '${weekEnd}'
- "last week" / "previous week" = the 7 days BEFORE this week started
- "this month" = WHERE date_column >= '${monthStart}' AND date_column < DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month')
- "last month" / "previous month" = the full calendar month before current month
- "this quarter" = current Q1/Q2/Q3/Q4 based on current month
- "last quarter" = the quarter immediately before current quarter
- "this year" / "YTD" = WHERE EXTRACT(YEAR FROM date_column) = ${now.getFullYear()}
- "last year" / "previous year" = WHERE EXTRACT(YEAR FROM date_column) = ${now.getFullYear() - 1}

SPECIFIC YEAR REFERENCES:
- "in 2024" or "2024" = WHERE EXTRACT(YEAR FROM date_column) = 2024
- "in 2023" or "2023" = WHERE EXTRACT(YEAR FROM date_column) = 2023
- "since 2023" = WHERE date_column >= '2023-01-01'
- "before 2024" = WHERE date_column < '2024-01-01'
- "between 2023 and 2024" = WHERE EXTRACT(YEAR FROM date_column) BETWEEN 2023 AND 2024

QUARTER MAPPINGS:
- Q1 = January 1 to March 31 ('YYYY-01-01' to 'YYYY-03-31')
- Q2 = April 1 to June 30 ('YYYY-04-01' to 'YYYY-06-30')
- Q3 = July 1 to September 30 ('YYYY-07-01' to 'YYYY-09-30')
- Q4 = October 1 to December 31 ('YYYY-10-01' to 'YYYY-12-31')
- "Q1 2024" = WHERE date_column >= '2024-01-01' AND date_column <= '2024-03-31'

MONTH MAPPINGS (when user says "January", "Feb", etc.):
- Use current year if month is in past/current, use previous year if month is in future
- "January" = '${now.getFullYear()}-01-01' to '${now.getFullYear()}-01-31'
- "last January" = explicitly previous year's January

RANGE EXPRESSIONS:
- "last N days" = WHERE date_column >= CURRENT_DATE - INTERVAL 'N days'
- "last N weeks" = WHERE date_column >= CURRENT_DATE - INTERVAL 'N weeks'
- "last N months" = WHERE date_column >= CURRENT_DATE - INTERVAL 'N months'
- "past N days/weeks/months" = same as "last N"
- "recent" = typically last 7-30 days depending on context

PostgreSQL DATE SYNTAX (must be exact - SYNTAX ERRORS ARE UNACCEPTABLE):
- INTERVAL must ALWAYS have quotes: INTERVAL '1 week' NOT INTERVAL 1 week
- Date arithmetic: CURRENT_DATE - INTERVAL '7 days' or NOW() - INTERVAL '1 week'
- Previous week: WHERE date_column >= CURRENT_DATE - INTERVAL '14 days' AND date_column < CURRENT_DATE - INTERVAL '7 days'
- Last 7 days: WHERE date_column >= CURRENT_DATE - INTERVAL '7 days'
- Previous month: WHERE date_column >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') AND date_column < DATE_TRUNC('month', CURRENT_DATE)
- DATE_TRUNC for period starts: DATE_TRUNC('week', CURRENT_DATE), DATE_TRUNC('month', CURRENT_DATE)
- EXTRACT for components: EXTRACT(YEAR FROM date_column), EXTRACT(MONTH FROM date_column)
- For date ranges, ALWAYS use >= for start and <= or < for end (be consistent)

DEFAULT BEHAVIOR (when NO date is mentioned):
- For tasks/work queries: include all non-completed items (no date filter needed)
- For timesheet/attendance: default to current week or month
- For reports/metrics: default to current month
- For "all" or "total": no date restriction
- When in doubt about date range, include data and let the answer clarify the time period

INTERPRETING VAGUE QUESTIONS:
- "overworked" or "busiest" = most tasks assigned (COUNT tasks) or most story points (SUM story_points)
- "productive" = most tasks completed (status = 'Done')
- "blocked" = tasks with status issues or violations
- "workload" = count of non-Done tasks per person
- "performance" = completed tasks or hours worked
- When in doubt, use task count as the metric

IMPORTANT - QUESTION INTERPRETATION:
- "what task should I work on next?" = SELECT tasks assigned to user that are Ready or In Progress, ordered by priority
- "my tasks" or "my work" = tasks where assigned_employee_id = user's ID
- "what should I do?" = show pending/in-progress tasks assigned to user
- "next task" = highest priority task assigned to user that is not Done
- NEVER generate CREATE, INSERT, UPDATE - only SELECT queries
- These are READ-ONLY queries about existing data, not requests to create anything

IMPORTANT - FOR NON-ADMIN USERS (when role is 'employee' or 'hr'):
- Questions about "types", "common", "statistics" should STILL be filtered to user's own data
- "common violation types" = SELECT violation_type, COUNT(*) FROM violations WHERE employee_id = '[user_id]' GROUP BY violation_type
- "my violations" = SELECT * FROM violations WHERE employee_id = '[user_id]'
- For aggregate queries on filtered tables, ALWAYS include employee_id = '[user_id]' filter
- If user asks general questions like "what violation types exist?", return their own data grouped by type

SCHEMA:
${schema.schema}

DATE CONTEXT (use these exact values):
- Today: ${today}
- Yesterday: ${new Date(now.getTime() - 86400000).toISOString().split('T')[0]}
- This week: ${weekStart} (Monday) to ${weekEnd} (Sunday)
- This month: ${monthStart} to end of month
- Current year: ${now.getFullYear()}
- Previous year: ${now.getFullYear() - 1}
- Current quarter: Q${Math.ceil((now.getMonth() + 1) / 3)} ${now.getFullYear()}
- Day of week: ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()]}

USER CONTEXT:
- User ID: ${userId}
- User name: ${userName}
- User role: ${role}`

  // SQL queries are short - use lower max_tokens for speed
  const response = await callHaiku(systemPrompt, question, 256)

  // Clean the response - extract just the SQL
  let sql = response.trim()

  // Remove markdown code blocks if present
  if (sql.startsWith('```')) {
    sql = sql.replace(/```sql\n?/gi, '').replace(/```\n?/gi, '').trim()
  }

  // Remove ALL semicolons (causes syntax error in exec_sql wrapper)
  sql = sql.replace(/;/g, '')

  return sql
}

// Execute SQL query using Supabase RPC
export async function executeSQL(
  supabase: any,
  sql: string
): Promise<{ data: any[] | null; error: string | null }> {
  try {
    console.log('Executing SQL:', sql)
    const { data, error } = await supabase.rpc('exec_sql', { query: sql })

    if (error) {
      console.error('RPC error:', JSON.stringify(error))

      // Check if the function doesn't exist
      if (error.message?.includes('function') || error.code === '42883') {
        return { data: null, error: 'Database function not found. Please run migrations.' }
      }

      return { data: null, error: `Query error: ${error.message}` }
    }

    console.log('Query result rows:', data?.length ?? 0)
    return { data: data || [], error: null }
  } catch (e: any) {
    console.error('SQL execution error:', e?.message || e)
    return { data: null, error: `Execution error: ${e?.message || 'Unknown error'}` }
  }
}

// Check if question is about creating a task
function isCreateTaskQuestion(question: string): boolean {
  const q = question.toLowerCase()
  return (q.includes('create') || q.includes('add') || q.includes('make') || q.includes('new')) &&
         (q.includes('task') || q.includes('ticket') || q.includes('bug') || q.includes('story'))
}

// Analyze results and generate natural language answer
export async function analyzeResults(
  question: string,
  data: any[] | null,
  error: string | null
): Promise<string> {
  if (error) {
    return error
  }

  if (!data || data.length === 0) {
    return 'No data found for your query.'
  }

  // Special handling for "create task" type questions
  const isCreateTask = isCreateTaskQuestion(question)

  const systemPrompt = isCreateTask
    ? `You help users plan new tasks. Based on similar tasks in the project, suggest a task outline.

RULES:
- Format response as a TASK OUTLINE with these fields:
  • Title: (suggest based on user's request and similar task patterns)
  • Type: (bug/story/task/spike - infer from question)
  • Description: (brief description based on what user wants) [required field and important: be specific, concise, clear]
  • Priority: (suggest based on similar tasks, default to medium)
  • Suggested Assignee: (based on who works on similar tasks in the project)
  • Story Points: (suggest based on similar tasks)
  • Project: (from the data)
- Make the title specific and actionable
- Keep description concise but clear
- This is just a SUGGESTION - user will create the actual task manually
- Don't say "I suggest" or "I recommend" - just provide the outline`
    : `You answer questions based on data provided.

RULES:
- Give helpful, complete answers (2-4 sentences)
- Include specific numbers and names from the data
- Don't describe your process or how you analyzed
- Don't say "based on the data" or "according to the data"
- If showing a person, include relevant stats (e.g., "John has 15 tasks, 8 in progress")
- If showing counts, give context (e.g., "React is used in 12 tasks, followed by Node.js with 8")
- Be conversational but informative`

  const userMessage = isCreateTask
    ? `User request: ${question}

Similar tasks and project data for reference:
${JSON.stringify(data.slice(0, 10), null, 2)}

Generate a task outline based on the user's request and the similar tasks shown above.`
    : `Question: ${question}

Data:
${JSON.stringify(data.slice(0, 20), null, 2)}

Give a helpful answer with specific details from the data.`

  // Use appropriate max_tokens - more for task outlines
  return await callHaiku(systemPrompt, userMessage, isCreateTask ? 512 : 384)
}

// Fetch fallback data for the last 30 days based on feature
async function fetchFallbackData(
  feature: string,
  role: string,
  userId: string,
  supabase: any
): Promise<any> {
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const dateFilter = thirtyDaysAgo.toISOString()

  const isAdmin = role === 'admin' || role === 'manager'
  const data: any = {}

  try {
    if (feature === 'hourly-chat') {
      // Fetch hourly status with task details
      let query = supabase
        .from('hourly_status')
        .select(`
          id, status_time, status_text, work_status, blocker_description,
          employee:employee_id (id, full_name, department),
          task:task_id (id, title, ticket_number, status)
        `)
        .gte('status_time', dateFilter)
        .order('status_time', { ascending: false })
        .limit(70)

      if (!isAdmin) {
        query = query.eq('employee_id', userId)
      }

      const { data: hourlyStatus } = await query
      data.hourly_status = hourlyStatus || []

    } else if (feature === 'timesheet-chat') {
      // Fetch check-ins with check-outs
      let checkInQuery = supabase
        .from('check_ins')
        .select(`
          id, check_in_time, task_ids,
          employee:employee_id (id, full_name, department),
          check_outs (id, check_out_time, total_hours)
        `)
        .gte('check_in_time', dateFilter)
        .order('check_in_time', { ascending: false })
        .limit(70)

      if (!isAdmin) {
        checkInQuery = checkInQuery.eq('employee_id', userId)
      }

      const { data: checkIns } = await checkInQuery
      data.check_ins = checkIns || []

      // Fetch timesheets
      let timesheetQuery = supabase
        .from('timesheets')
        .select(`
          id, week_start_date, week_end_date, total_hours, status, notes,
          employee:employee_id (id, full_name, department)
        `)
        .gte('week_start_date', thirtyDaysAgo.toISOString().split('T')[0])
        .order('week_start_date', { ascending: false })
        .limit(20)

      if (!isAdmin) {
        timesheetQuery = timesheetQuery.eq('employee_id', userId)
      }

      const { data: timesheets } = await timesheetQuery
      data.timesheets = timesheets || []

    } else if (feature === 'vacation-chat') {
      let query = supabase
        .from('vacation_requests')
        .select(`
          id, start_date, end_date, total_days, vacation_type, reason, status, rejection_reason,
          employee:employee_id (id, full_name, department),
          approver:approved_by (id, full_name)
        `)
        .gte('created_at', dateFilter)
        .order('created_at', { ascending: false })
        .limit(50)

      if (!isAdmin) {
        query = query.eq('employee_id', userId)
      }

      const { data: vacations } = await query
      data.vacation_requests = vacations || []

    } else if (feature === 'project-chat') {
      // Projects - all users can see
      const { data: projects } = await supabase
        .from('projects')
        .select(`
          id, project_name, description, status,
          creator:created_by (id, full_name)
        `)
        .order('created_at', { ascending: false })
        .limit(20)

      data.projects = projects || []

      // Tasks - all users can see
      const { data: tasks } = await supabase
        .from('tasks')
        .select(`
          id, task_type, title, ticket_number, priority, story_points, complexity, status, technology_stack,
          project:project_id (id, project_name),
          assignee:assigned_employee_id (id, full_name),
          reviewer:reviewer_id (id, full_name)
        `)
        .order('created_at', { ascending: false })
        .limit(100)

      data.tasks = tasks || []

    } else if (feature === 'violations-chat') {
      let query = supabase
        .from('violations')
        .select(`
          id, violation_type, violation_date, severity, description, resolved, escalated,
          employee:employee_id (id, full_name, department)
        `)
        .gte('violation_date', thirtyDaysAgo.toISOString().split('T')[0])
        .order('violation_date', { ascending: false })
        .limit(50)

      if (!isAdmin) {
        query = query.eq('employee_id', userId)
      }

      const { data: violations } = await query
      data.violations = violations || []
    }

    return data
  } catch (e) {
    console.error('Fallback data fetch error:', e)
    return null
  }
}

// Analyze data using fallback method (direct data analysis)
async function analyzeWithFallback(
  feature: string,
  question: string,
  role: string,
  userId: string,
  userName: string,
  supabase: any
): Promise<{ success: boolean; response: string }> {
  console.log('Using fallback data analysis method')

  const data = await fetchFallbackData(feature, role, userId, supabase)

  if (!data || Object.values(data).every((arr: any) => !arr || arr.length === 0)) {
    return { success: true, response: 'No data found for the last 30 days.' }
  }

  const systemPrompt = `You are a helpful assistant analyzing employee/project data.

CRITICAL - USER IDENTITY:
- The current user asking the question is: ${userName}
- When user says "I", "my", "me" - they mean ${userName}
- When data shows employee name "${userName}" or contains "${userName}" - that IS the current user's data
- Treat any data with the user's name as THEIR personal data

RULES:
- Answer the user's question based on the data provided
- Give helpful, complete answers (2-4 sentences)
- Include specific numbers, names, and dates from the data
- Don't describe your process or how you analyzed
- Don't say "based on the data" or "according to the data"
- Be conversational but informative - speak directly to the user about THEIR data
- If the question can't be answered from the data, say so politely
- NEVER say "I don't have information about you" if the data contains records for ${userName}

USER CONTEXT:
- User name: ${userName} (THIS IS THE PERSON ASKING)
- User role: ${role}
- User ID: ${userId}

DATA CONTEXT:
- This is the last 30 days of data
- For non-admin users, data is filtered to their own records only
- Data with employee.full_name = "${userName}" belongs to the current user`

  const userMessage = `Question: ${question}

Available Data:
${JSON.stringify(data, null, 2)}

Answer the question based on this data.`

  try {
    // Short answers - use lower max_tokens for speed
    const response = await callHaiku(systemPrompt, userMessage, 1024)
    return { success: true, response }
  } catch (e) {
    console.error('Fallback analysis error:', e)
    return { success: false, response: 'Unable to analyze data. Please try again.' }
  }
}

// Main function to handle chat request
export async function handleChatWithSQL(
  feature: string,
  question: string,
  role: string,
  userId: string,
  userName: string,
  supabase: any
): Promise<{ success: boolean; response: string; sql?: string; usedFallback?: boolean }> {
  try {
    const schema = SCHEMAS[feature]
    if (!schema) {
      return { success: false, response: 'Unknown feature.' }
    }

    // Step 1: Generate SQL
    let sql: string
    try {
      sql = await generateSQL(feature, question, role, userId, userName)
      console.log('Generated SQL:', sql)
    } catch (e) {
      console.error('SQL generation failed, using fallback:', e)
      const fallbackResult = await analyzeWithFallback(feature, question, role, userId, userName, supabase)
      return { ...fallbackResult, usedFallback: true }
    }

    // Step 2: Validate SQL
    const validation = validateSQL(sql, role, userId, schema.employeeFilteredTables)
    if (!validation.valid) {
      console.log('SQL validation failed, using fallback:', validation.error)
      const fallbackResult = await analyzeWithFallback(feature, question, role, userId, userName, supabase)
      return { ...fallbackResult, usedFallback: true }
    }

    // Step 3: Execute SQL
    const { data, error } = await executeSQL(supabase, sql)
    console.log('Query result:', data?.length, 'rows')

    // If SQL execution failed, try fallback
    if (error) {
      console.log('SQL execution failed, using fallback:', error)
      const fallbackResult = await analyzeWithFallback(feature, question, role, userId, userName, supabase)
      return { ...fallbackResult, usedFallback: true }
    }

    // Step 4: Analyze results
    const response = await analyzeResults(question, data, error)

    return { success: true, response, sql }
  } catch (e) {
    console.error('Chat error, trying fallback:', e)
    // Last resort fallback
    try {
      const fallbackResult = await analyzeWithFallback(feature, question, role, userId, userName, supabase)
      return { ...fallbackResult, usedFallback: true }
    } catch (fallbackError) {
      console.error('Fallback also failed:', fallbackError)
      return { success: false, response: 'Something went wrong. Please try again.' }
    }
  }
}
