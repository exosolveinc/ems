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

// Handle GET request to retrieve check-ins
async function handleGetCheckIns(supabase: any, userId: string, userRole: string, url: string) {
  try {
    const urlObj = new URL(url)
    const searchParams = urlObj.searchParams

    // Build query
    let query = supabase
      .from('check_ins')
      .select(`
        *,
        employees:employee_id (
          employee_id,
          full_name,
          email,
          department,
          designation
        ),
        standup_entries (
          id,
          entry_type,
          project_name,
          ticket_number,
          task_description,
          confidence_score,
          difficulty_level,
          estimated_hours,
          created_at
        ),
        check_outs (
          id,
          check_out_time,
          check_out_location,
          check_out_ip,
          check_out_notes,
          total_hours
        )
      `)

    // Filter by employee_id query param (managers/admins can query any employee)
    const employeeIdParam = searchParams.get('employee_id')
    if (employeeIdParam) {
      if (userRole === 'admin' || userRole === 'manager' || userRole === 'hr') {
        // Managers/admins can query by employee_id
        const { data: targetEmployee } = await supabase
          .from('employees')
          .select('id')
          .eq('employee_id', employeeIdParam)
          .single()

        if (targetEmployee) {
          query = query.eq('employee_id', targetEmployee.id)
        } else {
          return new Response(
            JSON.stringify({ success: false, error: 'Employee not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      } else {
        // Regular employees can only query their own data
        query = query.eq('employee_id', userId)
      }
    } else {
      // No employee_id param - employees see only their own, others need to specify
      if (userRole !== 'admin' && userRole !== 'manager' && userRole !== 'hr') {
        query = query.eq('employee_id', userId)
      }
    }

    // Filter by date
    const date = searchParams.get('date')
    if (date) {
      const startOfDay = new Date(date)
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date(date)
      endOfDay.setHours(23, 59, 59, 999)

      query = query
        .gte('check_in_time', startOfDay.toISOString())
        .lte('check_in_time', endOfDay.toISOString())
    }

    // Filter by date range
    const startDate = searchParams.get('start_date')
    const endDate = searchParams.get('end_date')
    if (startDate) {
      query = query.gte('check_in_time', new Date(startDate).toISOString())
    }
    if (endDate) {
      const end = new Date(endDate)
      end.setHours(23, 59, 59, 999)
      query = query.lte('check_in_time', end.toISOString())
    }

    // Filter by work_location
    const workLocation = searchParams.get('work_location')
    if (workLocation && (workLocation === 'home' || workLocation === 'office')) {
      query = query.eq('work_location', workLocation)
    }

    // Pagination
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')
    query = query.range(offset, offset + limit - 1)

    // Order by check_in_time descending
    query = query.order('check_in_time', { ascending: false })

    const { data, error } = await query

    if (error) throw error

    return new Response(
      JSON.stringify({
        success: true,
        data: data || [],
        count: data?.length || 0,
        offset,
        limit
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
}

// Handle check status request - check if user is currently checked in today
async function handleCheckStatus(supabase: any, userId: string, employee: any) {
  try {
    // Get today's date in EST
    const now = new Date()
    const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const todayStart = new Date(estTime)
    todayStart.setHours(0, 0, 0, 0)

    // Check for today's check-in
    const { data: checkin } = await supabase
      .from('check_ins')
      .select(`
        id,
        check_in_time,
        check_in_location,
        work_location,
        has_blockers,
        standup_entries (
          id,
          entry_type,
          project_name,
          ticket_number,
          task_description,
          confidence_score,
          difficulty_level,
          estimated_hours
        )
      `)
      .eq('employee_id', userId)
      .gte('check_in_time', todayStart.toISOString())
      .maybeSingle()

    if (!checkin) {
      return new Response(
        JSON.stringify({
          success: true,
          checked_in: false,
          message: 'Not checked in today',
          employee: {
            id: userId,
            employee_id: employee.employee_id,
            full_name: employee.full_name
          }
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check for checkout
    const { data: checkout } = await supabase
      .from('check_outs')
      .select('id, check_out_time, total_hours')
      .eq('check_in_id', checkin.id)
      .maybeSingle()

    return new Response(
      JSON.stringify({
        success: true,
        checked_in: true,
        checked_out: !!checkout,
        check_in: {
          id: checkin.id,
          check_in_time: checkin.check_in_time,
          check_in_location: checkin.check_in_location,
          work_location: checkin.work_location,
          has_blockers: checkin.has_blockers,
          standup_entries: checkin.standup_entries || []
        },
        check_out: checkout ? {
          id: checkout.id,
          check_out_time: checkout.check_out_time,
          total_hours: checkout.total_hours
        } : null,
        employee: {
          id: userId,
          employee_id: employee.employee_id,
          full_name: employee.full_name
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
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

    // Handle GET request
    if (req.method === 'GET') {
      const url = new URL(req.url)
      const checkStatus = url.searchParams.get('check_status')

      // Check current check-in status for today
      if (checkStatus === 'true') {
        return await handleCheckStatus(supabaseAdmin, user.id, employee)
      }

      // Retrieve check-ins
      return await handleGetCheckIns(supabaseAdmin, user.id, userRole, req.url)
    }

    // POST request - check in
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