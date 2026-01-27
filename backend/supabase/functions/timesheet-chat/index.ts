import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  toYAML,
  daysAgo,
  getCurrentDate,
  TIME_RANGES,
  isAdminOrManager,
  callHaiku,
  SYSTEM_PROMPTS
} from '../_shared/chat-utils.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Working hours configuration
const WORK_START_HOUR = 9  // 9 AM
const WORK_END_HOUR = 17   // 5 PM

// Convert UTC timestamp to EST date string (YYYY-MM-DD)
function getEstDateFromUtc(timestamp: string): string {
  const date = new Date(timestamp)
  const estString = date.toLocaleString('en-US', { timeZone: 'America/New_York' })
  const estDate = new Date(estString)
  return `${estDate.getFullYear()}-${String(estDate.getMonth() + 1).padStart(2, '0')}-${String(estDate.getDate()).padStart(2, '0')}`
}

// Get date string from EST timestamp
function getDateFromEst(timestamp: string): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// Get hour from EST timestamp
function getHourFromEst(timestamp: string): number {
  return new Date(timestamp).getHours()
}

// Calculate hours summary from check-ins and hourly statuses
function calculateDaySummary(
  checkIns: any[],
  hourlyStatuses: any[],
  dateStr: string
): { worked: number; blocked: number; break_time: number } {
  let worked = 0
  let blocked = 0
  let break_time = 0

  // Get statuses for this day
  const dayStatuses = hourlyStatuses.filter(s => getDateFromEst(s.status_time) === dateStr)

  for (let hour = WORK_START_HOUR; hour < WORK_END_HOUR; hour++) {
    const hourStatus = dayStatuses.find(s => getHourFromEst(s.status_time) === hour)

    if (hourStatus) {
      if (hourStatus.work_status === 'break') {
        break_time++
      } else if (hourStatus.work_status === 'blocked') {
        blocked++
      } else {
        worked++
      }
    }
  }

  return { worked, blocked, break_time }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Only allow POST
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ success: false, error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get auth header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create Supabase clients
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Verify authentication
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get user role
    const { data: employee } = await supabaseAdmin
      .from('employees')
      .select('role, first_name, last_name')
      .eq('id', user.id)
      .single()

    const userRole = employee?.role || 'employee'
    const userName = employee ? `${employee.first_name} ${employee.last_name}` : 'User'

    // Parse request body
    const body = await req.json()
    const { message } = body

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return new Response(
        JSON.stringify({ success: false, error: 'message is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch data based on role
    const since = daysAgo(TIME_RANGES.timesheet)
    const adminManager = isAdminOrManager(userRole)

    // Determine employee IDs to fetch
    let employeeIds: string[] = []
    let employees: any[] = []

    if (adminManager) {
      const { data } = await supabaseAdmin
        .from('employees')
        .select('id, first_name, last_name, email')
      employees = data || []
      employeeIds = employees.map(e => e.id)
    } else {
      employeeIds = [user.id]
    }

    // Fetch check-ins with check-outs
    const { data: checkIns } = await supabaseAdmin
      .from('check_ins')
      .select(`
        id,
        employee_id,
        check_in_time,
        work_location,
        check_outs (
          check_out_time,
          total_hours
        )
      `)
      .in('employee_id', employeeIds)
      .gte('check_in_time', since)
      .order('check_in_time', { ascending: false })

    // Fetch hourly statuses
    const { data: hourlyStatuses } = await supabaseAdmin
      .from('hourly_status')
      .select(`
        id,
        employee_id,
        status_time,
        status_text,
        work_status,
        task:task_id (title, ticket_number)
      `)
      .in('employee_id', employeeIds)
      .gte('status_time', since)
      .order('status_time', { ascending: false })

    // Build daily summaries per employee
    const dailySummaries: any[] = []
    const dateSet = new Set<string>()

    // Collect all dates from check-ins
    for (const ci of checkIns || []) {
      const dateStr = getEstDateFromUtc(ci.check_in_time)
      dateSet.add(`${ci.employee_id}|${dateStr}`)
    }

    // Collect all dates from hourly statuses
    for (const hs of hourlyStatuses || []) {
      const dateStr = getDateFromEst(hs.status_time)
      dateSet.add(`${hs.employee_id}|${dateStr}`)
    }

    // Calculate summary for each employee-date
    for (const key of dateSet) {
      const [empId, dateStr] = key.split('|')
      const empCheckIns = (checkIns || []).filter(c => c.employee_id === empId)
      const empStatuses = (hourlyStatuses || []).filter(s => s.employee_id === empId)

      const dayCheckIn = empCheckIns.find(c => getEstDateFromUtc(c.check_in_time) === dateStr)
      const summary = calculateDaySummary(empCheckIns, empStatuses, dateStr)

      const emp = employees.find(e => e.id === empId)
      const empName = emp ? `${emp.first_name} ${emp.last_name}` : userName

      dailySummaries.push({
        employee_name: empName,
        date: dateStr,
        check_in_time: dayCheckIn?.check_in_time || null,
        check_out_time: dayCheckIn?.check_outs?.[0]?.check_out_time || null,
        hours_worked: summary.worked,
        hours_blocked: summary.blocked,
        hours_break: summary.break_time,
        work_location: dayCheckIn?.work_location || null
      })
    }

    // Sort by date descending
    dailySummaries.sort((a, b) => b.date.localeCompare(a.date))

    // Build data object
    const dataForAI = adminManager
      ? { employees, daily_timesheet: dailySummaries }
      : { daily_timesheet: dailySummaries }

    // Convert to YAML
    const yamlData = toYAML(dataForAI)

    // Calculate current week boundaries (Monday to Sunday)
    const today = new Date()
    const dayOfWeek = today.getDay()
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    const monday = new Date(today)
    monday.setDate(today.getDate() + mondayOffset)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)

    const weekStart = monday.toISOString().split('T')[0]
    const weekEnd = sunday.toISOString().split('T')[0]

    // Build context
    const currentDate = getCurrentDate()
    const systemPrompt = SYSTEM_PROMPTS.timesheet(userRole, currentDate)
    const userMessage = `Your role: ${userRole}
Your name: ${userName}
Today: ${currentDate}
This week: ${weekStart} to ${weekEnd}

Data:
${yamlData}

Question: ${message}`

    // Call Haiku
    const response = await callHaiku(systemPrompt, userMessage)

    return new Response(
      JSON.stringify({ success: true, response }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
