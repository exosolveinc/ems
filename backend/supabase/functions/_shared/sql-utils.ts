// SQL generation and validation utilities

import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.24.3'
import { SCHEMAS, FeatureSchema } from './schemas.ts'

// Call Claude Haiku
async function callHaiku(systemPrompt: string, userMessage: string): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  const anthropic = new Anthropic({ apiKey })
  const response = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 1024,
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
4. This is a READ-ONLY system - users are asking about EXISTING data, never asking to create/modify data

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

IMPORTANT - DATE HANDLING:
- NO date restrictions - users can query ANY date range including previous years
- If user asks about "last year", "2023", "previous quarter", etc., generate appropriate date filters
- Use EXTRACT(YEAR FROM column) for year-based queries
- Examples: "last year" = previous calendar year, "Q1 2024" = '2024-01-01' to '2024-03-31'

PostgreSQL DATE SYNTAX (must be exact):
- INTERVAL must have quotes: INTERVAL '1 week' NOT INTERVAL 1 week
- Date arithmetic: CURRENT_DATE - INTERVAL '7 days' or NOW() - INTERVAL '1 week'
- Previous week: WHERE date_column >= CURRENT_DATE - INTERVAL '14 days' AND date_column < CURRENT_DATE - INTERVAL '7 days'
- Last 7 days: WHERE date_column >= CURRENT_DATE - INTERVAL '7 days'
- Previous month: WHERE date_column >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') AND date_column < DATE_TRUNC('month', CURRENT_DATE)
- DATE_TRUNC for period starts: DATE_TRUNC('week', CURRENT_DATE), DATE_TRUNC('month', CURRENT_DATE)

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

SCHEMA:
${schema.schema}

DATE CONTEXT (for reference, not restrictions):
- Today: ${today}
- This week: ${weekStart} to ${weekEnd} (Monday to Sunday)
- This month starts: ${monthStart}
- Previous year: ${now.getFullYear() - 1}

USER CONTEXT:
- User ID: ${userId}
- User name: ${userName}
- User role: ${role}`

  const response = await callHaiku(systemPrompt, question)

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

  const systemPrompt = `You answer questions based on data provided.

RULES:
- Give helpful, complete answers (2-4 sentences)
- Include specific numbers and names from the data
- Don't describe your process or how you analyzed
- Don't say "based on the data" or "according to the data"
- If showing a person, include relevant stats (e.g., "John has 15 tasks, 8 in progress")
- If showing counts, give context (e.g., "React is used in 12 tasks, followed by Node.js with 8")
- Be conversational but informative`

  const userMessage = `Question: ${question}

Data:
${JSON.stringify(data.slice(0, 50), null, 2)}

Give a helpful answer with specific details from the data.`

  return await callHaiku(systemPrompt, userMessage)
}

// Main function to handle chat request
export async function handleChatWithSQL(
  feature: string,
  question: string,
  role: string,
  userId: string,
  userName: string,
  supabase: any
): Promise<{ success: boolean; response: string; sql?: string }> {
  try {
    const schema = SCHEMAS[feature]
    if (!schema) {
      return { success: false, response: 'Unknown feature.' }
    }

    // Step 1: Generate SQL
    const sql = await generateSQL(feature, question, role, userId, userName)
    console.log('Generated SQL:', sql)

    // Step 2: Validate SQL
    const validation = validateSQL(sql, role, userId, schema.employeeFilteredTables)
    if (!validation.valid) {
      return { success: false, response: validation.error || 'Invalid query generated.' }
    }

    // Step 3: Execute SQL
    const { data, error } = await executeSQL(supabase, sql)
    console.log('Query result:', data?.length, 'rows')

    // Step 4: Analyze results
    const response = await analyzeResults(question, data, error)

    return { success: true, response, sql }
  } catch (e) {
    console.error('Chat error:', e)
    return { success: false, response: 'Something went wrong. Please try again.' }
  }
}
