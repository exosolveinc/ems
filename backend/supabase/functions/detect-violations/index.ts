import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ViolationConfig {
  workStartHour: number
  workStartMinute: number
  workEndHour: number
  workEndMinute: number
  lateThresholdMinutes: number
  lowSeverityThreshold: number
  mediumSeverityThreshold: number
  highSeverityThreshold: number
}

const DEFAULT_CONFIG: ViolationConfig = {
  workStartHour: 9,
  workStartMinute: 0,
  workEndHour: 17,
  workEndMinute: 0,
  lateThresholdMinutes: 5,
  lowSeverityThreshold: 15,
  mediumSeverityThreshold: 30,
  highSeverityThreshold: 60,
}

// Check if a date is a weekday (Monday-Friday)
function isWeekday(date: Date): boolean {
  const day = date.getDay()
  return day >= 1 && day <= 5 // 1 = Monday, 5 = Friday
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Parse request body for optional date parameter
    let targetDate: Date
    let checkEndOfDay = false

    if (req.method === 'POST') {
      try {
        const body = await req.json()
        if (body.date) {
          // Check for a specific date (e.g., yesterday for end-of-day processing)
          targetDate = new Date(body.date)
          checkEndOfDay = body.check_end_of_day === true
        } else {
          targetDate = new Date()
        }
      } catch {
        targetDate = new Date()
      }
    } else {
      targetDate = new Date()
    }

    // Convert to EST
    const estTime = new Date(targetDate.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    estTime.setHours(0, 0, 0, 0)
    const targetDateStr = estTime.toISOString().split('T')[0]

    // Skip weekends (Saturday = 6, Sunday = 0)
    if (!isWeekday(estTime)) {
      return new Response(
        JSON.stringify({
          success: true,
          message: `Skipping violation check - ${targetDateStr} is a weekend`,
          summary: {
            employees_checked: 0,
            violations_created: 0,
            notifications_sent: 0,
            escalations: 0,
          },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get all active employees
    const { data: employees, error: empError } = await supabase
      .from('employees')
      .select('id, employee_id, full_name, first_name, last_name')
      .eq('status', 'active')

    if (empError) throw empError

    const violations: any[] = []
    const notifications: any[] = []
    const skippedEmployees: string[] = []

    // Check each employee
    for (const employee of employees || []) {
      const employeeName = employee.full_name || `${employee.first_name} ${employee.last_name}`

      // Check if employee has approved vacation for this date
      const onVacation = await hasApprovedVacation(supabase, employee.id, targetDateStr)
      if (onVacation) {
        skippedEmployees.push(employeeName)
        continue // Skip this employee - they have approved leave
      }

      // Check for existing check-in
      const { data: checkIn } = await supabase
        .from('check_ins')
        .select('id, check_in_time')
        .eq('employee_id', employee.id)
        .gte('check_in_time', estTime.toISOString())
        .lt('check_in_time', new Date(estTime.getTime() + 24 * 60 * 60 * 1000).toISOString())
        .maybeSingle()

      const workStart = new Date(estTime)
      workStart.setHours(DEFAULT_CONFIG.workStartHour, DEFAULT_CONFIG.workStartMinute, 0, 0)

      const workEnd = new Date(estTime)
      workEnd.setHours(DEFAULT_CONFIG.workEndHour, DEFAULT_CONFIG.workEndMinute, 0, 0)

      const now = new Date()
      const nowEST = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))

      // For end-of-day checks (scheduled job), check the entire day
      // For real-time checks, only check if we're past work start time
      const shouldCheckViolations = checkEndOfDay || nowEST > workStart

      if (shouldCheckViolations) {
        if (!checkIn) {
          // Missing check-in violation - only create if workday has ended or significant time has passed
          const hoursLate = checkEndOfDay
            ? 8 // Full workday missed
            : (nowEST.getTime() - workStart.getTime()) / (1000 * 60 * 60)

          // Only create no_checkin violation if it's end of day check OR more than 2 hours late
          if (checkEndOfDay || hoursLate > 2) {
            let severity = 'high'
            if (checkEndOfDay) severity = 'critical' // Missed entire day

            // Check if violation already exists for this date
            const { data: existingViolation } = await supabase
              .from('violations')
              .select('id')
              .eq('employee_id', employee.id)
              .eq('violation_type', 'no_checkin')
              .eq('violation_date', targetDateStr)
              .maybeSingle()

            if (!existingViolation) {
              violations.push({
                employee_id: employee.id,
                violation_type: 'no_checkin',
                violation_date: targetDateStr,
                severity,
                description: checkEndOfDay
                  ? `No check-in recorded for the entire workday (${targetDateStr})`
                  : `No check-in recorded. Work started ${hoursLate.toFixed(1)} hours ago.`,
              })

              notifications.push({
                employee_id: employee.id,
                type: 'violation',
                title: 'Missing Check-in',
                message: checkEndOfDay
                  ? `You did not check in on ${targetDateStr}. A violation has been recorded.`
                  : `You have not checked in today. Please check in as soon as possible.`,
              })
            }
          }
        } else {
          // Check for late check-in
          const checkInTime = new Date(checkIn.check_in_time)
          const minutesLate = Math.floor((checkInTime.getTime() - workStart.getTime()) / (1000 * 60))

          if (minutesLate > DEFAULT_CONFIG.lateThresholdMinutes) {
            let severity = 'low'
            if (minutesLate > DEFAULT_CONFIG.lowSeverityThreshold) severity = 'medium'
            if (minutesLate > DEFAULT_CONFIG.mediumSeverityThreshold) severity = 'high'
            if (minutesLate > DEFAULT_CONFIG.highSeverityThreshold) severity = 'critical'

            // Check if late check-in violation already exists
            const { data: existingViolation } = await supabase
              .from('violations')
              .select('id')
              .eq('employee_id', employee.id)
              .eq('violation_type', 'late_checkin')
              .eq('violation_date', targetDateStr)
              .maybeSingle()

            if (!existingViolation) {
              violations.push({
                employee_id: employee.id,
                violation_type: 'late_checkin',
                violation_date: targetDateStr,
                severity,
                description: `Checked in ${minutesLate} minutes late`,
              })
            }
          }

          // Check for missing check-out (only if check-in was more than work hours ago)
          const checkoutGraceEnd = new Date(estTime)
          checkoutGraceEnd.setHours(DEFAULT_CONFIG.workEndHour + 2, 0, 0, 0) // 2 hours grace after work end

          // For end-of-day checks, always check for missing checkout
          // For real-time checks, only check if we're past the grace period
          const shouldCheckCheckout = checkEndOfDay || nowEST > checkoutGraceEnd

          if (shouldCheckCheckout) {
            const { data: checkOut } = await supabase
              .from('check_outs')
              .select('id')
              .eq('check_in_id', checkIn.id)
              .maybeSingle()

            if (!checkOut) {
              const hoursOverdue = checkEndOfDay
                ? 24 // End of day - they never checked out
                : (nowEST.getTime() - checkoutGraceEnd.getTime()) / (1000 * 60 * 60)

              let severity = 'medium'
              if (checkEndOfDay) severity = 'high' // Missed checkout for entire day
              else if (hoursOverdue > 2) severity = 'medium'
              else if (hoursOverdue > 6) severity = 'high'

              // Check if violation already exists
              const { data: existingViolation } = await supabase
                .from('violations')
                .select('id')
                .eq('employee_id', employee.id)
                .eq('violation_type', 'no_checkout')
                .eq('violation_date', targetDateStr)
                .maybeSingle()

              if (!existingViolation) {
                violations.push({
                  employee_id: employee.id,
                  violation_type: 'no_checkout',
                  violation_date: targetDateStr,
                  severity,
                  description: checkEndOfDay
                    ? `No check-out recorded for ${targetDateStr}. Checked in at ${checkInTime.toLocaleTimeString()}`
                    : `No check-out recorded for check-in at ${checkInTime.toLocaleTimeString()}`,
                })

                notifications.push({
                  employee_id: employee.id,
                  type: 'violation',
                  title: 'Missing Check-out',
                  message: checkEndOfDay
                    ? `You did not check out on ${targetDateStr}. A violation has been recorded.`
                    : `You checked in today but haven't checked out. Please check out.`,
                })

                // Auto-checkout at 6 PM EST (18:00) if not checked out and it's end of day check
                if (checkEndOfDay) {
                  const autoCheckoutTime = new Date(estTime)
                  autoCheckoutTime.setHours(18, 0, 0, 0) // 6 PM EST

                  // Calculate hours from check-in to 6 PM
                  const totalHours = (autoCheckoutTime.getTime() - new Date(checkIn.check_in_time).getTime()) / (1000 * 60 * 60)

                  // Only auto-checkout if hours are reasonable (positive and less than 12)
                  if (totalHours > 0 && totalHours < 12) {
                    await supabase
                      .from('check_outs')
                      .insert({
                        employee_id: employee.id,
                        check_in_id: checkIn.id,
                        check_out_time: autoCheckoutTime.toISOString(),
                        check_out_notes: 'Auto-checkout - No manual checkout recorded',
                        total_hours: Math.round(totalHours * 100) / 100,
                      })
                      .catch((err: any) => console.error('Error auto-checking out employee:', err))
                  }
                }
              }
            }
          }
        }
      }
    }

    // Insert all violations
    let createdViolations = []
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

    // Check for escalation
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
        const { data: empData } = await supabase
          .from('employees')
          .select('manager_id')
          .eq('id', violation.employee_id)
          .single()

        if (empData?.manager_id) {
          escalations.push({
            violation_id: violation.id,
            escalated_to: empData.manager_id,
          })

          // Notify manager
          await supabase
            .from('notifications')
            .insert({
              employee_id: empData.manager_id,
              type: 'violation_escalation',
              title: 'Violation Escalated',
              message: `Employee ${violation.employee_id} has ${recentCount} violations in the last 30 days`,
              link: `/violations/${violation.id}`,
            })
            .catch((err: any) => console.error('Error creating escalation notification:', err))
        }
      }
    }

    // Update violations with escalation info
    for (const escalation of escalations) {
      await supabase
        .from('violations')
        .update({
          escalated: true,
          escalated_to: escalation.escalated_to,
          escalation_time: new Date().toISOString(),
        })
        .eq('id', escalation.violation_id)
    }

    return new Response(
      JSON.stringify({
        success: true,
        date_checked: targetDateStr,
        summary: {
          employees_checked: (employees?.length || 0) - skippedEmployees.length,
          employees_on_vacation: skippedEmployees.length,
          violations_created: createdViolations.length,
          notifications_sent: notifications.length,
          escalations: escalations.length,
        },
        skipped_employees_on_vacation: skippedEmployees,
        violations: createdViolations,
      }),
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
