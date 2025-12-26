import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Default work schedule (used if employee has no custom schedule)
const DEFAULT_WORK_START = '09:00:00'
const DEFAULT_WORK_END = '17:00:00'
const DEFAULT_WORK_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']

// Severity thresholds (in minutes)
const LATE_THRESHOLD_LOW = 15
const LATE_THRESHOLD_MEDIUM = 30
const LATE_THRESHOLD_HIGH = 60

// Day names for mapping
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

// Parse time string (HH:MM:SS or HH:MM) to hours and minutes
function parseTime(timeStr: string): { hour: number; minute: number } {
  const [hour, minute] = timeStr.split(':').map(Number)
  return { hour, minute }
}

// Check if employee has approved vacation for a specific date
async function hasApprovedVacation(supabase: any, employeeId: string, date: string): Promise<boolean> {
  const { data } = await supabase
    .from('vacation_requests')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('status', 'approved')
    .lte('start_date', date)
    .gte('end_date', date)
    .maybeSingle()

  return !!data
}

// Get severity based on minutes late
function getLateSeverity(minutesLate: number): string {
  if (minutesLate > LATE_THRESHOLD_HIGH) return 'high'
  if (minutesLate > LATE_THRESHOLD_MEDIUM) return 'medium'
  if (minutesLate > LATE_THRESHOLD_LOW) return 'low'
  return 'none'
}

// Check if violation already exists
async function violationExists(
  supabase: any,
  employeeId: string,
  violationType: string,
  violationDate: string
): Promise<boolean> {
  const { data } = await supabase
    .from('violations')
    .select('id')
    .eq('employee_id', employeeId)
    .eq('violation_type', violationType)
    .eq('violation_date', violationDate)
    .maybeSingle()

  return !!data
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Parse request body for optional parameters
    let targetDate: Date
    let checkType: 'realtime' | 'end_of_day' | 'hourly_status' = 'realtime'

    if (req.method === 'POST') {
      try {
        const body = await req.json()
        if (body.date) {
          targetDate = new Date(body.date)
        } else {
          targetDate = new Date()
        }
        if (body.check_type) {
          checkType = body.check_type
        }
      } catch {
        targetDate = new Date()
      }
    } else {
      targetDate = new Date()
    }

    // Convert to EST
    const nowUTC = new Date()
    const nowEST = new Date(nowUTC.toLocaleString('en-US', { timeZone: 'America/New_York' }))

    const estTime = new Date(targetDate.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    estTime.setHours(0, 0, 0, 0)
    const targetDateStr = estTime.toISOString().split('T')[0]
    const todayDayName = DAY_NAMES[estTime.getDay()]

    // Get all active employees with their work schedules
    const { data: employees, error: empError } = await supabase
      .from('employees')
      .select('id, employee_id, full_name, first_name, last_name, manager_id, work_start_time, work_end_time, work_days')
      .eq('status', 'active')

    if (empError) throw empError

    const violations: any[] = []
    const notifications: any[] = []
    const skippedEmployees: string[] = []
    const processedEmployees: string[] = []

    // Process each employee
    for (const employee of employees || []) {
      const employeeName = employee.full_name || `${employee.first_name} ${employee.last_name}`

      // Get employee's work schedule (with defaults)
      const workDays: string[] = employee.work_days || DEFAULT_WORK_DAYS
      const workStartTime: string = employee.work_start_time || DEFAULT_WORK_START
      const workEndTime: string = employee.work_end_time || DEFAULT_WORK_END

      // Check if today is a work day for this employee
      if (!workDays.includes(todayDayName)) {
        skippedEmployees.push(`${employeeName} (not a work day)`)
        continue
      }

      // Check if employee has approved vacation
      const onVacation = await hasApprovedVacation(supabase, employee.id, targetDateStr)
      if (onVacation) {
        skippedEmployees.push(`${employeeName} (on vacation)`)
        continue
      }

      processedEmployees.push(employeeName)

      // Parse work times
      const { hour: startHour, minute: startMinute } = parseTime(workStartTime)
      const { hour: endHour, minute: endMinute } = parseTime(workEndTime)

      // Create work start/end Date objects in EST
      const workStart = new Date(estTime)
      workStart.setHours(startHour, startMinute, 0, 0)

      const workEnd = new Date(estTime)
      workEnd.setHours(endHour, endMinute, 0, 0)

      // Get employee's check-in for target date
      const { data: checkIn } = await supabase
        .from('check_ins')
        .select('id, check_in_time')
        .eq('employee_id', employee.id)
        .gte('check_in_time', estTime.toISOString())
        .lt('check_in_time', new Date(estTime.getTime() + 24 * 60 * 60 * 1000).toISOString())
        .maybeSingle()

      // ============================================
      // CHECK TYPE: END OF DAY (scheduled at 11 PM)
      // ============================================
      if (checkType === 'end_of_day') {
        // 1. Missing check-in violation
        if (!checkIn) {
          if (!(await violationExists(supabase, employee.id, 'no_checkin', targetDateStr))) {
            violations.push({
              employee_id: employee.id,
              violation_type: 'no_checkin',
              violation_date: targetDateStr,
              severity: 'critical',
              description: `No check-in recorded for ${targetDateStr}. Work starts at ${workStartTime.slice(0, 5)}.`,
            })

            notifications.push({
              employee_id: employee.id,
              type: 'violation',
              title: 'Missing Check-in Violation',
              message: `You did not check in on ${targetDateStr}. A violation has been recorded.`,
            })
          }
        } else {
          // 2. Missing check-out violation
          const { data: checkOut } = await supabase
            .from('check_outs')
            .select('id')
            .eq('check_in_id', checkIn.id)
            .maybeSingle()

          if (!checkOut) {
            if (!(await violationExists(supabase, employee.id, 'no_checkout', targetDateStr))) {
              const checkInTime = new Date(checkIn.check_in_time)
              violations.push({
                employee_id: employee.id,
                violation_type: 'no_checkout',
                violation_date: targetDateStr,
                severity: 'high',
                description: `No check-out recorded for ${targetDateStr}. Checked in at ${checkInTime.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' })}.`,
              })

              notifications.push({
                employee_id: employee.id,
                type: 'violation',
                title: 'Missing Check-out Violation',
                message: `You did not check out on ${targetDateStr}. A violation has been recorded.`,
              })

              // Auto-checkout at work end time
              const autoCheckoutTime = new Date(workEnd)
              const totalHours = (autoCheckoutTime.getTime() - checkInTime.getTime()) / (1000 * 60 * 60)

              if (totalHours > 0 && totalHours < 16) {
                await supabase
                  .from('check_outs')
                  .insert({
                    employee_id: employee.id,
                    check_in_id: checkIn.id,
                    check_out_time: autoCheckoutTime.toISOString(),
                    check_out_notes: 'Auto-checkout - No manual checkout recorded',
                    total_hours: Math.round(totalHours * 100) / 100,
                  })
              }
            }
          }

          // 3. Missed hourly status updates
          // Count expected status updates (one per work hour)
          const checkInTime = new Date(checkIn.check_in_time)
          const checkInHour = checkInTime.getHours()
          const effectiveStartHour = Math.max(checkInHour, startHour)
          const expectedStatusCount = endHour - effectiveStartHour

          if (expectedStatusCount > 0) {
            // Get actual hourly status count for the day
            const { data: hourlyStatuses } = await supabase
              .from('hourly_status')
              .select('id, status_time')
              .eq('employee_id', employee.id)
              .gte('status_time', estTime.toISOString())
              .lt('status_time', new Date(estTime.getTime() + 24 * 60 * 60 * 1000).toISOString())

            const actualStatusCount = (hourlyStatuses || []).length
            const missedStatusCount = expectedStatusCount - actualStatusCount

            // Create violation if missed more than 2 status updates
            if (missedStatusCount > 2) {
              if (!(await violationExists(supabase, employee.id, 'no_status_update', targetDateStr))) {
                let severity = 'low'
                if (missedStatusCount > 4) severity = 'medium'
                if (missedStatusCount > 6) severity = 'high'

                violations.push({
                  employee_id: employee.id,
                  violation_type: 'no_status_update',
                  violation_date: targetDateStr,
                  severity,
                  description: `Missed ${missedStatusCount} hourly status updates on ${targetDateStr}. Expected: ${expectedStatusCount}, Actual: ${actualStatusCount}.`,
                })

                notifications.push({
                  employee_id: employee.id,
                  type: 'violation',
                  title: 'Missing Status Updates',
                  message: `You missed ${missedStatusCount} hourly status updates on ${targetDateStr}.`,
                })
              }
            }
          }
        }
      }

      // ============================================
      // CHECK TYPE: HOURLY STATUS (scheduled hourly)
      // ============================================
      if (checkType === 'hourly_status') {
        // Only check if employee is checked in and within work hours
        if (checkIn && nowEST >= workStart && nowEST <= workEnd) {
          const currentHour = nowEST.getHours()

          // Check if there's a status update for the previous hour
          const previousHourStart = new Date(nowEST)
          previousHourStart.setHours(currentHour - 1, 0, 0, 0)
          const previousHourEnd = new Date(nowEST)
          previousHourEnd.setHours(currentHour, 0, 0, 0)

          const { data: hourStatus } = await supabase
            .from('hourly_status')
            .select('id')
            .eq('employee_id', employee.id)
            .gte('status_time', previousHourStart.toISOString())
            .lt('status_time', previousHourEnd.toISOString())
            .maybeSingle()

          if (!hourStatus && currentHour > startHour) {
            // Send reminder notification (not a violation yet)
            notifications.push({
              employee_id: employee.id,
              type: 'reminder',
              title: 'Hourly Status Reminder',
              message: `Please submit your hourly status update for ${currentHour - 1}:00 - ${currentHour}:00.`,
            })
          }
        }
      }

      // ============================================
      // CHECK TYPE: REALTIME (can be called anytime)
      // ============================================
      if (checkType === 'realtime') {
        // Only process if we're past work start time
        if (nowEST > workStart) {
          // Check for late check-in (if checked in today)
          if (checkIn) {
            const checkInTime = new Date(checkIn.check_in_time)
            const checkInEST = new Date(checkInTime.toLocaleString('en-US', { timeZone: 'America/New_York' }))

            if (checkInEST > workStart) {
              const minutesLate = Math.floor((checkInEST.getTime() - workStart.getTime()) / (1000 * 60))
              const severity = getLateSeverity(minutesLate)

              if (severity !== 'none') {
                if (!(await violationExists(supabase, employee.id, 'late_checkin', targetDateStr))) {
                  violations.push({
                    employee_id: employee.id,
                    violation_type: 'late_checkin',
                    violation_date: targetDateStr,
                    severity,
                    description: `Checked in ${minutesLate} minutes late. Work starts at ${workStartTime.slice(0, 5)}.`,
                  })
                }
              }
            }
          } else {
            // No check-in - check if significantly late (more than 2 hours)
            const hoursLate = (nowEST.getTime() - workStart.getTime()) / (1000 * 60 * 60)

            if (hoursLate > 2) {
              if (!(await violationExists(supabase, employee.id, 'no_checkin', targetDateStr))) {
                notifications.push({
                  employee_id: employee.id,
                  type: 'warning',
                  title: 'Missing Check-in Warning',
                  message: `You have not checked in today. Work started ${hoursLate.toFixed(1)} hours ago.`,
                })
              }
            }
          }
        }
      }
    }

    // Insert all violations
    let createdViolations: any[] = []
    if (violations.length > 0) {
      const { data, error } = await supabase
        .from('violations')
        .insert(violations)
        .select()

      if (error) {
        console.error('Error creating violations:', error)
      } else {
        createdViolations = data || []
      }
    }

    // Insert notifications
    if (notifications.length > 0) {
      await supabase
        .from('notifications')
        .insert(notifications)
        .catch((err: any) => console.error('Error creating notifications:', err))
    }

    // Handle escalations for created violations
    const escalations: any[] = []
    for (const violation of createdViolations) {
      // Get recent violations count (last 30 days)
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      const { data: recentViolations } = await supabase
        .from('violations')
        .select('id')
        .eq('employee_id', violation.employee_id)
        .gte('violation_date', thirtyDaysAgo.toISOString().split('T')[0])

      const recentCount = (recentViolations || []).length

      // Determine if should escalate
      let shouldEscalate = false
      if (violation.severity === 'critical') {
        shouldEscalate = true
      } else if (violation.severity === 'high' && recentCount >= 2) {
        shouldEscalate = true
      } else if (violation.severity === 'medium' && recentCount >= 3) {
        shouldEscalate = true
      } else if (violation.severity === 'low' && recentCount >= 5) {
        shouldEscalate = true
      }

      if (shouldEscalate) {
        // Get employee's manager
        const emp = employees?.find((e: any) => e.id === violation.employee_id)
        if (emp?.manager_id) {
          escalations.push({
            violation_id: violation.id,
            escalated_to: emp.manager_id,
            employee_name: emp.full_name || emp.employee_id,
          })

          // Update violation with escalation info
          await supabase
            .from('violations')
            .update({
              escalated: true,
              escalated_to: emp.manager_id,
              escalation_time: new Date().toISOString(),
            })
            .eq('id', violation.id)

          // Notify manager
          await supabase
            .from('notifications')
            .insert({
              employee_id: emp.manager_id,
              type: 'violation_escalation',
              title: 'Violation Escalated',
              message: `${emp.full_name || emp.employee_id} has ${recentCount} violations in the last 30 days. Latest: ${violation.violation_type}`,
              link: `/violations/${violation.id}`,
            })
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        check_type: checkType,
        date_checked: targetDateStr,
        current_time_est: nowEST.toISOString(),
        summary: {
          employees_processed: processedEmployees.length,
          employees_skipped: skippedEmployees.length,
          violations_created: createdViolations.length,
          notifications_sent: notifications.length,
          escalations: escalations.length,
        },
        skipped_employees: skippedEmployees,
        violations: createdViolations,
        escalations,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
