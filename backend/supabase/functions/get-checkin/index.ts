import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
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

    // Verify user
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get employee info
    const { data: employee } = await supabaseAdmin
      .from('employees')
      .select('role')
      .eq('id', user.id)
      .single()

    const userRole = employee?.role || 'employee'

    // Parse query params
    const url = new URL(req.url)
    const date = url.searchParams.get('date')
    const startDate = url.searchParams.get('start_date')
    const endDate = url.searchParams.get('end_date')
    const limit = parseInt(url.searchParams.get('limit') || '10')
    const offset = parseInt(url.searchParams.get('offset') || '0')
    const employeeId = url.searchParams.get('employee_id') // For managers/HR

    // Build query
    let query = supabaseAdmin
      .from('check_ins')
      .select(`
        *,
        standup_entries (*),
        check_outs (*)
      `, { count: 'exact' })
      .order('check_in_time', { ascending: false })
      .range(offset, offset + limit - 1)

    // Filter by employee based on role
    if (userRole === 'employee') {
      // Regular employees can only see their own
      query = query.eq('employee_id', user.id)
    } else if (employeeId && (userRole === 'manager' || userRole === 'hr' || userRole === 'admin')) {
      // Managers/HR can filter by specific employee
      query = query.eq('employee_id', employeeId)
    } else if (userRole === 'manager') {
      // Managers see their team (need to get team members)
      const { data: teamMembers } = await supabaseAdmin
        .from('employees')
        .select('id')
        .eq('manager_id', user.id)
      
      const teamIds = teamMembers?.map(m => m.id) || []
      teamIds.push(user.id) // Include self
      query = query.in('employee_id', teamIds)
    }
    // HR/Admin see all (no filter needed)

    // Date filters
    if (date) {
      const dayStart = new Date(date)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(date)
      dayEnd.setHours(23, 59, 59, 999)
      query = query.gte('check_in_time', dayStart.toISOString()).lte('check_in_time', dayEnd.toISOString())
    } else if (startDate && endDate) {
      query = query.gte('check_in_time', startDate).lte('check_in_time', endDate)
    }

    const { data, error, count } = await query

    if (error) throw error

    return new Response(
      JSON.stringify({ 
        success: true, 
        data,
        pagination: {
          total: count,
          limit,
          offset,
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
})