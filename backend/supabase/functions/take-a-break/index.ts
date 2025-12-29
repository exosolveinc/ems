import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
}

// Get current EST date string (YYYY-MM-DD)
function getEstDateString(): string {
  const now = new Date()
  const estString = now.toLocaleString('en-US', { timeZone: 'America/New_York' })
  const estDate = new Date(estString)
  const year = estDate.getFullYear()
  const month = String(estDate.getMonth() + 1).padStart(2, '0')
  const day = String(estDate.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// Get current EST timestamp as ISO string (for storing in DB)
function getEstTimestamp(): string {
  const now = new Date()
  const estString = now.toLocaleString('en-US', { timeZone: 'America/New_York' })
  const estDate = new Date(estString)
  return estDate.toISOString()
}

// Get EST timestamp formatted for database storage (YYYY-MM-DD HH:MM:SS)
function getEstTimestampForDb(): string {
  const now = new Date()
  return now.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).replace(/(\d+)\/(\d+)\/(\d+),\s/, '$3-$1-$2 ')
}

// Get current EST hour (0-23)
function getEstCurrentHour(): number {
  const now = new Date()
  const estString = now.toLocaleString('en-US', { timeZone: 'America/New_York' })
  const estDate = new Date(estString)
  return estDate.getHours()
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
    const todayDate = getEstDateString()

    // GET - Get breaks for today or specified date
    if (req.method === 'GET') {
      const url = new URL(req.url)
      const dateParam = url.searchParams.get('date') || todayDate
      const employeeIdParam = url.searchParams.get('employee_id')

      let query = supabaseAdmin
        .from('breaks')
        .select('*')
        .eq('break_date', dateParam)
        .order('break_start', { ascending: true })

      // Filter by employee
      if (employeeIdParam && (userRole === 'admin' || userRole === 'manager' || userRole === 'hr')) {
        const { data: targetEmployee } = await supabaseAdmin
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
        query = query.eq('employee_id', user.id)
      }

      const { data: breaks, error } = await query

      if (error) throw error

      // Calculate total break time for the day
      const totalMinutes = (breaks || []).reduce((sum: number, b: any) => {
        return sum + (b.duration_minutes || 0)
      }, 0)

      // Check if currently on break
      const activeBreak = (breaks || []).find((b: any) => !b.break_end)

      return new Response(
        JSON.stringify({
          success: true,
          date: dateParam,
          breaks: breaks || [],
          total_break_minutes: totalMinutes,
          total_break_hours: Math.round((totalMinutes / 60) * 100) / 100,
          currently_on_break: !!activeBreak,
          active_break: activeBreak || null,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // POST - Start a break
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      const { break_type, notes } = body

      // Check if already on a break
      const { data: activeBreak } = await supabaseAdmin
        .from('breaks')
        .select('id')
        .eq('employee_id', user.id)
        .eq('break_date', todayDate)
        .is('break_end', null)
        .maybeSingle()

      if (activeBreak) {
        return new Response(
          JSON.stringify({ success: false, error: 'Already on a break. End current break first.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Get EST timestamp for break start
      const breakStartEst = getEstTimestamp()

      // Create break record with EST timestamp
      const { data: newBreak, error: breakError } = await supabaseAdmin
        .from('breaks')
        .insert({
          employee_id: user.id,
          break_date: todayDate,
          break_start: breakStartEst,
          break_type: break_type || 'general',
          notes: notes || null,
        })
        .select()
        .single()

      if (breakError) throw breakError

      // Create hourly status with 'break' work_status (EST format for DB)
      const statusTimeEst = getEstTimestampForDb()
      const currentHour = getEstCurrentHour()

      // Check if hourly status already exists for this hour today
      // Query by date and hour range since exact timestamp match is unreliable
      const hourStart = `${todayDate} ${String(currentHour).padStart(2, '0')}:00:00`
      const hourEnd = `${todayDate} ${String(currentHour).padStart(2, '0')}:59:59`

      const { data: existingStatus } = await supabaseAdmin
        .from('hourly_status')
        .select('id')
        .eq('employee_id', user.id)
        .gte('status_time', hourStart)
        .lte('status_time', hourEnd)
        .maybeSingle()

      let hourlyStatusResult = null
      if (existingStatus) {
        // Update existing status to break
        const { data: updatedStatus, error: updateError } = await supabaseAdmin
          .from('hourly_status')
          .update({
            work_status: 'break',
            status_text: notes || 'Taking a break',
          })
          .eq('id', existingStatus.id)
          .select()
          .single()

        if (updateError) {
          console.error('Failed to update hourly status:', updateError)
        }
        hourlyStatusResult = updatedStatus
      } else {
        // Create new hourly status with EST time
        const { data: newStatus, error: insertError } = await supabaseAdmin
          .from('hourly_status')
          .insert({
            employee_id: user.id,
            status_time: statusTimeEst,
            work_status: 'break',
            status_text: notes || 'Taking a break',
          })
          .select()
          .single()

        if (insertError) {
          console.error('Failed to insert hourly status:', insertError)
        }
        hourlyStatusResult = newStatus
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Break started',
          data: newBreak,
          employee: {
            id: user.id,
            employee_id: employee.employee_id,
            full_name: employee.full_name,
          },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // PUT - End a break
    if (req.method === 'PUT') {
      const body = await req.json().catch(() => ({}))
      const { break_id, notes } = body

      // Find active break
      let query = supabaseAdmin
        .from('breaks')
        .select('*')
        .eq('employee_id', user.id)
        .eq('break_date', todayDate)
        .is('break_end', null)

      if (break_id) {
        query = query.eq('id', break_id)
      }

      const { data: activeBreak, error: findError } = await query.maybeSingle()

      if (findError) throw findError

      if (!activeBreak) {
        return new Response(
          JSON.stringify({ success: false, error: 'No active break found' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Calculate duration using EST times
      const breakStart = new Date(activeBreak.break_start)
      const breakEndEst = getEstTimestamp()
      const breakEnd = new Date(breakEndEst)
      const durationMs = breakEnd.getTime() - breakStart.getTime()
      const durationMinutes = Math.round(durationMs / (1000 * 60))

      // Update break record with EST end time
      const updateData: any = {
        break_end: breakEndEst,
        duration_minutes: durationMinutes,
      }

      if (notes) {
        updateData.notes = activeBreak.notes
          ? `${activeBreak.notes} | End: ${notes}`
          : notes
      }

      const { data: updatedBreak, error: updateError } = await supabaseAdmin
        .from('breaks')
        .update(updateData)
        .eq('id', activeBreak.id)
        .select()
        .single()

      if (updateError) throw updateError

      // Get total break time for today
      const { data: allBreaks } = await supabaseAdmin
        .from('breaks')
        .select('duration_minutes')
        .eq('employee_id', user.id)
        .eq('break_date', todayDate)

      const totalMinutes = (allBreaks || []).reduce((sum: number, b: any) => {
        return sum + (b.duration_minutes || 0)
      }, 0)

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Break ended',
          data: updatedBreak,
          break_duration_minutes: durationMinutes,
          total_break_minutes_today: totalMinutes,
          total_break_hours_today: Math.round((totalMinutes / 60) * 100) / 100,
          employee: {
            id: user.id,
            employee_id: employee.employee_id,
            full_name: employee.full_name,
          },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
