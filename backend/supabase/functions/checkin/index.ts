import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// import { StandupEntry } from '../../../shared/types/database.types'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
export interface StandupEntry {
  project_name: string
  ticket_number?: string
  task_description: string
  confidence_score: number
  difficulty_level: number
  estimated_hours?: number
}
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
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

    // Get user role from employees table
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

    if (userRole !== 'employee' && userRole !== 'manager' && userRole !== 'hr') {
      return new Response(
        JSON.stringify({ success: false, error: 'Only employees can check in' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { 
      location, 
      ip, 
      notes,
      work_location,
      yesterday = [],
      today = [],
      blockers = []
    } = await req.json()

    // Validate required fields
    if (!work_location || !['home', 'office'].includes(work_location)) {
      return new Response(
        JSON.stringify({ success: false, error: 'work_location is required (home or office)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!today || today.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'At least one task for today is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const employee_id = user.id

    // Check if already checked in today (using EST)
    const now = new Date()
    const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const todayStart = new Date(estTime)
    todayStart.setHours(0, 0, 0, 0)

    const { data: existing } = await supabaseAdmin
      .from('check_ins')
      .select('id')
      .eq('employee_id', employee_id)
      .gte('check_in_time', todayStart.toISOString())
      .single()

    if (existing) {
      return new Response(
        JSON.stringify({ success: false, error: 'Already checked in today' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create check-in record
    const { data: checkin, error: checkinError } = await supabaseAdmin
      .from('check_ins')
      .insert({
        employee_id,
        check_in_location: location,
        check_in_ip: ip,
        check_in_notes: notes,
        work_location,
        has_blockers: blockers.length > 0,
      })
      .select()
      .single()

    if (checkinError) throw checkinError

    // Insert standup entries
    const standupEntries = [
      ...yesterday.map((entry: StandupEntry) => ({
        check_in_id: checkin.id,
        employee_id,
        entry_type: 'yesterday',
        project_name: entry.project_name,
        ticket_number: entry.ticket_number || null,
        task_description: entry.task_description,
        confidence_score: entry.confidence_score,
        difficulty_level: entry.difficulty_level,
        estimated_hours: entry.estimated_hours || null,
      })),
      ...today.map((entry: StandupEntry) => ({
        check_in_id: checkin.id,
        employee_id,
        entry_type: 'today',
        project_name: entry.project_name,
        ticket_number: entry.ticket_number || null,
        task_description: entry.task_description,
        confidence_score: entry.confidence_score,
        difficulty_level: entry.difficulty_level,
        estimated_hours: entry.estimated_hours || null,
      })),
      ...blockers.map((entry: StandupEntry) => ({
        check_in_id: checkin.id,
        employee_id,
        entry_type: 'blocker',
        project_name: entry.project_name,
        ticket_number: entry.ticket_number || null,
        task_description: entry.task_description,
        confidence_score: entry.confidence_score || null,
        difficulty_level: entry.difficulty_level || null,
        estimated_hours: entry.estimated_hours || null,
      })),
    ]

    if (standupEntries.length > 0) {
      const { error: standupError } = await supabaseAdmin
        .from('standup_entries')
        .insert(standupEntries)

      if (standupError) throw standupError
    }

    // Check if late and create violation (using EST)
    const checkInTimeUTC = new Date(checkin.check_in_time)
    const checkInTime = new Date(checkInTimeUTC.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const workStart = new Date(checkInTime)
    workStart.setHours(9, 0, 0, 0)

    let violation = null
    if (checkInTime > workStart) {
      const minutesLate = Math.floor((checkInTime.getTime() - workStart.getTime()) / (1000 * 60))

      let severity = 'low'
      if (minutesLate > 60) severity = 'high'
      else if (minutesLate > 30) severity = 'medium'

      await supabaseAdmin
        .from('violations')
        .insert({
          employee_id,
          violation_type: 'late_checkin',
          violation_date: new Date().toISOString().split('T')[0],
          severity,
          description: `Checked in ${minutesLate} minutes late`,
        })

      violation = {
        created: true,
        severity,
        minutes_late: minutesLate,
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          checkin,
          standup: {
            yesterday: yesterday.length,
            today: today.length,
            blockers: blockers.length,
          },
        },
        employee: {
          id: employee_id,
          name: employee.full_name,
          employee_id: employee.employee_id,
        },
        violation,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})