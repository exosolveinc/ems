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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString().split('T')[0]

    // Get all active employees
    const { data: employees, error: empError } = await supabase
      .from('employees')
      .select('id, employee_id, full_name, first_name, last_name')
      .eq('status', 'active')

    if (empError) throw empError

    const violations: any[] = []
    const notifications: any[] = []

    // Check each employee
    for (const employee of employees || []) {
      const employeeName = employee.full_name || `${employee.first_name} ${employee.last_name}`

      // Check for missing check-in
      const { data: checkIn } = await supabase
        .from('check_ins')
        .select('id, check_in_time')
        .eq('employee_id', employee.id)
        .gte('check_in_time', today.toISOString())
        .maybeSingle()

      const workStart = new Date(today)
      workStart.setHours(DEFAULT_CONFIG.workStartHour, DEFAULT_CONFIG.workStartMinute, 0, 0)
      const now = new Date()

      // Only check for violations if work has started
      if (now > workStart) {
        if (!checkIn) {
          // Missing check-in violation
          const hoursLate = (now.getTime() - workStart.getTime()) / (1000 * 60 * 60)

          let severity = 'medium'
          if (hoursLate > 2) severity = 'high'
          if (hoursLate > 4) severity = 'critical'

          // Check if violation already exists for today
          const { data: existingViolation } = await supabase
            .from('violations')
            .select('id')
            .eq('employee_id', employee.id)
            .eq('violation_type', 'no_checkin')
            .eq('violation_date', todayStr)
            .maybeSingle()

          if (!existingViolation) {
            violations.push({
              employee_id: employee.id,
              violation_type: 'no_checkin',
              violation_date: todayStr,
              severity,
              description: `No check-in recorded. Work started ${hoursLate.toFixed(1)} hours ago.`,
            })

            notifications.push({
              employee_id: employee.id,
              type: 'violation',
              title: 'Missing Check-in',
              message: `You have not checked in today. Please check in as soon as possible.`,
            })
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
              .eq('violation_date', todayStr)
              .maybeSingle()

            if (!existingViolation) {
              violations.push({
                employee_id: employee.id,
                violation_type: 'late_checkin',
                violation_date: todayStr,
                severity,
                description: `Checked in ${minutesLate} minutes late`,
              })
            }
          }

          // Check for missing check-out (only if check-in was more than work hours ago)
          const workEnd = new Date(today)
          workEnd.setHours(DEFAULT_CONFIG.workEndHour + 2, 0, 0, 0) // 2 hours grace

          if (now > workEnd) {
            const { data: checkOut } = await supabase
              .from('check_outs')
              .select('id')
              .eq('check_in_id', checkIn.id)
              .maybeSingle()

            if (!checkOut) {
              const hoursOverdue = (now.getTime() - workEnd.getTime()) / (1000 * 60 * 60)

              let severity = 'low'
              if (hoursOverdue > 2) severity = 'medium'
              if (hoursOverdue > 6) severity = 'high'
              if (hoursOverdue > 12) severity = 'critical'

              // Check if violation already exists
              const { data: existingViolation } = await supabase
                .from('violations')
                .select('id')
                .eq('employee_id', employee.id)
                .eq('violation_type', 'no_checkout')
                .eq('violation_date', todayStr)
                .maybeSingle()

              if (!existingViolation) {
                violations.push({
                  employee_id: employee.id,
                  violation_type: 'no_checkout',
                  violation_date: todayStr,
                  severity,
                  description: `No check-out recorded for check-in at ${checkInTime.toLocaleTimeString()}`,
                })

                notifications.push({
                  employee_id: employee.id,
                  type: 'violation',
                  title: 'Missing Check-out',
                  message: `You checked in today but haven't checked out. Please check out.`,
                })

                // Auto-checkout at 6 PM EST (18:00) if not checked out
                const autoCheckoutTime = new Date(today)
                autoCheckoutTime.setHours(18, 0, 0, 0) // 6 PM EST

                if (now >= autoCheckoutTime) {
                  // Calculate hours from check-in to 6 PM
                  const totalHours = (autoCheckoutTime.getTime() - new Date(checkIn.check_in_time).getTime()) / (1000 * 60 * 60)

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
        summary: {
          employees_checked: employees?.length || 0,
          violations_created: createdViolations.length,
          notifications_sent: notifications.length,
          escalations: escalations.length,
        },
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
