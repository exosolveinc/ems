import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Working hours configuration
const WORK_START_HOUR = 9  // 9 AM
const WORK_END_HOUR = 17   // 5 PM
const HOURS_PER_DAY = WORK_END_HOUR - WORK_START_HOUR // 8 hours

// Timezone configuration
// EST is UTC-5, EDT (daylight saving) is UTC-4
// For simplicity, using EST offset (-5 hours)
const EST_OFFSET_HOURS = -5

// Convert UTC timestamp to EST Date
function utcToEst(utcTimestamp: string): Date {
  const utcDate = new Date(utcTimestamp)
  // Add EST offset (which is negative, so we subtract hours)
  const estDate = new Date(utcDate.getTime() + (EST_OFFSET_HOURS * 60 * 60 * 1000))
  return estDate
}

// Get date string in EST (YYYY-MM-DD)
function getEstDateString(timestamp: string, isEstStored: boolean = false): string {
  if (isEstStored) {
    // Check-in data is already in EST, just extract the date part
    const date = new Date(timestamp)
    return date.toISOString().split('T')[0]
  } else {
    // Hourly status is in UTC, convert to EST first
    const estDate = utcToEst(timestamp)
    return estDate.toISOString().split('T')[0]
  }
}

// Get hour in EST from a timestamp
function getEstHour(timestamp: string, isEstStored: boolean = false): number {
  if (isEstStored) {
    // Check-in data is already in EST
    return new Date(timestamp).getHours()
  } else {
    // Hourly status is in UTC, convert to EST
    const estDate = utcToEst(timestamp)
    return estDate.getUTCHours()
  }
}

// Hour status types
type HourStatus = 'worked' | 'blocked' | 'gap' | 'no-checkin'

interface HourBlock {
  hour: number
  start_time: string
  end_time: string
  status: HourStatus
  status_text: string | null
  task_title: string | null
  ticket_number: string | null
}

interface DayData {
  date: string
  day_name: string
  day_number: string
  is_checked_in: boolean
  check_in_time: string | null
  check_out_time: string | null
  hours_worked: number
  hours_expected: number
  hours_blocked: number
  hours_gap: number
  hour_blocks: HourBlock[]
}

interface EmployeeTimesheet {
  employee_id: string
  employee_name: string
  employee_initials: string
  email: string
  days: DayData[]
  total_hours_worked: number
  total_hours_expected: number
  total_hours_blocked: number
  total_hours_gap: number
}

// Helper to format hour to AM/PM
function formatHour(hour: number): string {
  if (hour === 0) return '12am'
  if (hour === 12) return '12pm'
  if (hour < 12) return `${hour}am`
  return `${hour - 12}pm`
}

// Helper to get day name
function getDayName(date: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return days[date.getDay()]
}

// Helper to format date as "Dec 16"
function formatDayNumber(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[date.getMonth()]} ${date.getDate()}`
}

// Helper to get initials from name
function getInitials(name: string | null): string {
  if (!name) return '??'
  return name
    .split(' ')
    .map(part => part.charAt(0).toUpperCase())
    .join('')
    .slice(0, 2)
}

// Helper to get Monday of the week for a given date
// For Sunday, returns the NEXT Monday (upcoming week)
// For Mon-Sat, returns the Monday of that week
function getMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay() // 0 = Sunday, 1 = Monday, ..., 6 = Saturday

  let daysToAdjust: number
  if (day === 0) {
    // Sunday -> get NEXT Monday (add 1 day)
    daysToAdjust = 1
  } else {
    // Mon-Sat -> get Monday of current week (subtract days)
    daysToAdjust = -(day - 1)
  }

  d.setDate(d.getDate() + daysToAdjust)
  d.setHours(0, 0, 0, 0)
  return d
}

// Helper to get Friday of the week
function getFriday(monday: Date): Date {
  const friday = new Date(monday)
  friday.setDate(monday.getDate() + 4)
  friday.setHours(23, 59, 59, 999)
  return friday
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

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
      .select('role, employee_id, full_name')
      .eq('id', user.id)
      .single()

    if (!employee) {
      return new Response(
        JSON.stringify({ success: false, error: 'Employee record not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const userRole = employee.role || 'employee'

    // Only handle GET requests
    if (req.method !== 'GET') {
      return new Response(
        JSON.stringify({ success: false, error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const url = new URL(req.url)
    const weekStartParam = url.searchParams.get('week_start')
    const employeeIdParam = url.searchParams.get('employee_id')

    // Parse week start date (default to current week's Monday)
    let weekStart: Date
    if (weekStartParam) {
      weekStart = getMonday(new Date(weekStartParam))
    } else {
      weekStart = getMonday(new Date())
    }

    const weekEnd = getFriday(weekStart)

    // Determine which employees to fetch
    let employeeIds: string[] = []

    if (employeeIdParam) {
      // Specific employee requested
      if (userRole === 'admin' || userRole === 'manager' || userRole === 'hr') {
        // Get the UUID for the employee_id
        const { data: targetEmployee } = await supabaseAdmin
          .from('employees')
          .select('id')
          .eq('employee_id', employeeIdParam)
          .single()

        if (targetEmployee) {
          employeeIds = [targetEmployee.id]
        } else {
          return new Response(
            JSON.stringify({ success: false, error: 'Employee not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      } else {
        // Regular employees can only see their own data
        employeeIds = [user.id]
      }
    } else {
      // No specific employee - admins/managers see all, employees see only themselves
      if (userRole === 'admin' || userRole === 'manager' || userRole === 'hr') {
        const { data: allEmployees } = await supabaseAdmin
          .from('employees')
          .select('id')
          .eq('status', 'active')

        employeeIds = (allEmployees || []).map((e: any) => e.id)
      } else {
        employeeIds = [user.id]
      }
    }

    // If no employees found, return empty response
    if (employeeIds.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          week_start: weekStart.toISOString().split('T')[0],
          week_end: weekEnd.toISOString().split('T')[0],
          employees: [],
          summary: {
            total_hours_expected: 0,
            total_hours_worked: 0,
            total_hours_gap: 0,
            total_hours_blocked: 0,
          },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch all required data for the week
    const weekStartStr = weekStart.toISOString()
    const weekEndStr = weekEnd.toISOString()

    // Fetch check-ins for the week
    const { data: checkIns } = await supabaseAdmin
      .from('check_ins')
      .select(`
        id,
        employee_id,
        check_in_time,
        work_location,
        task_ids,
        check_outs (
          id,
          check_out_time,
          total_hours
        )
      `)
      .in('employee_id', employeeIds)
      .gte('check_in_time', weekStartStr)
      .lte('check_in_time', weekEndStr)

    // Fetch hourly statuses for the week
    const { data: hourlyStatuses } = await supabaseAdmin
      .from('hourly_status')
      .select(`
        id,
        employee_id,
        status_time,
        status_text,
        work_status,
        blocker_description,
        task_id,
        task:task_id (
          id,
          title,
          ticket_number
        )
      `)
      .in('employee_id', employeeIds)
      .gte('status_time', weekStartStr)
      .lte('status_time', weekEndStr)
      .order('status_time', { ascending: true })

    // Fetch employee details
    const { data: employees } = await supabaseAdmin
      .from('employees')
      .select('id, employee_id, full_name, email')
      .in('id', employeeIds)

    // Build the response
    const employeeTimesheets: EmployeeTimesheet[] = []

    for (const emp of employees || []) {
      const empCheckIns = (checkIns || []).filter((c: any) => c.employee_id === emp.id)
      const empStatuses = (hourlyStatuses || []).filter((s: any) => s.employee_id === emp.id)

      const days: DayData[] = []
      let totalWorked = 0
      let totalExpected = 0
      let totalBlocked = 0
      let totalGap = 0

      // Process each day (Mon-Fri)
      for (let i = 0; i < 5; i++) {
        const currentDate = new Date(weekStart)
        currentDate.setDate(weekStart.getDate() + i)
        const dateStr = currentDate.toISOString().split('T')[0]

        // Find check-in for this day (check-ins are stored in EST)
        const dayCheckIn = empCheckIns.find((c: any) => {
          const checkInDate = getEstDateString(c.check_in_time, true) // true = EST stored
          return checkInDate === dateStr
        })

        const isCheckedIn = !!dayCheckIn
        const checkInTime = dayCheckIn?.check_in_time || null
        const checkOut = dayCheckIn?.check_outs?.[0]
        const checkOutTime = checkOut?.check_out_time || null

        // Get hourly statuses for this day (statuses are stored in UTC, convert to EST)
        const dayStatuses = empStatuses.filter((s: any) => {
          const statusDate = getEstDateString(s.status_time, false) // false = UTC stored
          return statusDate === dateStr
        })

        // Build hour blocks (9am to 5pm)
        const hourBlocks: HourBlock[] = []
        let dayWorked = 0
        let dayBlocked = 0
        let dayGap = 0

        for (let hour = WORK_START_HOUR; hour < WORK_END_HOUR; hour++) {
          // Find status for this hour (statuses are in UTC, convert to EST hour)
          const hourStatus = dayStatuses.find((s: any) => {
            const statusHour = getEstHour(s.status_time, false) // false = UTC stored
            return statusHour === hour
          })

          let status: HourStatus
          let statusText: string | null = null
          let taskTitle: string | null = null
          let ticketNumber: string | null = null

          if (!isCheckedIn) {
            status = 'no-checkin'
          } else if (hourStatus) {
            if (hourStatus.work_status === 'blocked') {
              status = 'blocked'
              statusText = hourStatus.blocker_description || hourStatus.status_text
              dayBlocked++
            } else if (hourStatus.work_status === 'progress' || hourStatus.work_status === 'done') {
              status = 'worked'
              statusText = hourStatus.status_text
              taskTitle = hourStatus.task?.title || null
              ticketNumber = hourStatus.task?.ticket_number || null
              dayWorked++
            } else {
              // Has status but no work_status - treat as worked
              status = 'worked'
              statusText = hourStatus.status_text
              taskTitle = hourStatus.task?.title || null
              ticketNumber = hourStatus.task?.ticket_number || null
              dayWorked++
            }
          } else {
            // No status for this hour
            if (isCheckedIn) {
              // Check if within check-in/check-out time range
              // Check-in times are stored in EST, so get the hour directly
              const checkInHour = checkInTime ? getEstHour(checkInTime, true) : null
              const checkOutHour = checkOutTime ? getEstHour(checkOutTime, true) : null

              if (checkInHour !== null && hour >= checkInHour) {
                if (checkOutHour === null || hour < checkOutHour) {
                  status = 'gap'
                  dayGap++
                } else {
                  // After check-out, still mark as gap for accountability
                  status = 'gap'
                  dayGap++
                }
              } else {
                // Before check-in hour
                status = 'gap'
                dayGap++
              }
            } else {
              status = 'no-checkin'
            }
          }

          hourBlocks.push({
            hour,
            start_time: formatHour(hour),
            end_time: formatHour(hour + 1),
            status,
            status_text: statusText,
            task_title: taskTitle,
            ticket_number: ticketNumber,
          })
        }

        const hoursExpected = isCheckedIn ? HOURS_PER_DAY : 0

        days.push({
          date: dateStr,
          day_name: getDayName(currentDate),
          day_number: formatDayNumber(currentDate),
          is_checked_in: isCheckedIn,
          check_in_time: checkInTime,
          check_out_time: checkOutTime,
          hours_worked: dayWorked,
          hours_expected: hoursExpected,
          hours_blocked: dayBlocked,
          hours_gap: dayGap,
          hour_blocks: hourBlocks,
        })

        totalWorked += dayWorked
        totalExpected += hoursExpected
        totalBlocked += dayBlocked
        totalGap += dayGap
      }

      employeeTimesheets.push({
        employee_id: emp.employee_id || '',
        employee_name: emp.full_name || 'Unknown',
        employee_initials: getInitials(emp.full_name),
        email: emp.email || '',
        days,
        total_hours_worked: totalWorked,
        total_hours_expected: totalExpected,
        total_hours_blocked: totalBlocked,
        total_hours_gap: totalGap,
      })
    }

    // Calculate summary
    const summary = {
      total_hours_expected: employeeTimesheets.reduce((sum, e) => sum + e.total_hours_expected, 0),
      total_hours_worked: employeeTimesheets.reduce((sum, e) => sum + e.total_hours_worked, 0),
      total_hours_gap: employeeTimesheets.reduce((sum, e) => sum + e.total_hours_gap, 0),
      total_hours_blocked: employeeTimesheets.reduce((sum, e) => sum + e.total_hours_blocked, 0),
    }

    return new Response(
      JSON.stringify({
        success: true,
        week_start: weekStart.toISOString().split('T')[0],
        week_end: weekEnd.toISOString().split('T')[0],
        employees: employeeTimesheets,
        summary,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
