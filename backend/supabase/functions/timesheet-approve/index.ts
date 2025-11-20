import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
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

    // Get user role
    const { data: employee } = await supabaseAdmin
      .from('employees')
      .select('role, full_name')
      .eq('id', user.id)
      .single()

    const userRole = employee?.role || user.user_metadata?.role || 'employee'
    const approverName = employee?.full_name || user.email

    // Check if user has permission to approve
    if (userRole !== 'admin' && userRole !== 'manager') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Access denied. Only admins and managers can approve timesheets'
        }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Route based on method
    const url = new URL(req.url)
    const searchParams = url.searchParams

    switch (req.method) {
      case 'GET':
        return await handleGetPending(supabaseAdmin, searchParams)
      case 'POST':
        return await handleApprove(supabaseAdmin, user.id, approverName, req)
      default:
        return new Response(
          JSON.stringify({ success: false, error: 'Method not allowed' }),
          { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// GET - List pending timesheets for approval
async function handleGetPending(supabase: any, searchParams: URLSearchParams) {
  try {
    let query = supabase
      .from('timesheets')
      .select(`
        *,
        employees:employee_id (
          employee_id,
          full_name,
          email
        )
      `)

    // Filter by status (default to submitted)
    const status = searchParams.get('status') || 'submitted'
    query = query.eq('status', status)

    // Filter by employee_id if provided
    const employeeId = searchParams.get('employee_id')
    if (employeeId) {
      query = query.eq('employee_id', employeeId)
    }

    // Filter by date range
    const weekStart = searchParams.get('week_start')
    const weekEnd = searchParams.get('week_end')
    if (weekStart) {
      query = query.gte('week_start_date', weekStart)
    }
    if (weekEnd) {
      query = query.lte('week_end_date', weekEnd)
    }

    // Order by submitted date
    query = query.order('submitted_at', { ascending: false })

    const { data, error } = await query

    if (error) throw error

    return new Response(
      JSON.stringify({ success: true, data, count: data.length }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    throw error
  }
}

// POST - Approve or reject timesheet
async function handleApprove(supabase: any, userId: string, approverName: string, req: Request) {
  try {
    const { timesheet_id, action, notes } = await req.json()

    // Validate input
    if (!timesheet_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'timesheet_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!action || !['approve', 'reject'].includes(action)) {
      return new Response(
        JSON.stringify({ success: false, error: 'action must be either "approve" or "reject"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get the timesheet
    const { data: timesheet, error: fetchError } = await supabase
      .from('timesheets')
      .select(`
        *,
        employees:employee_id (
          employee_id,
          full_name,
          email
        )
      `)
      .eq('id', timesheet_id)
      .single()

    if (fetchError || !timesheet) {
      return new Response(
        JSON.stringify({ success: false, error: 'Timesheet not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if timesheet is in correct status
    if (timesheet.status !== 'submitted') {
      return new Response(
        JSON.stringify({
          success: false,
          error: `This timesheet has already been ${timesheet.status}`
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Determine new status
    const newStatus = action === 'approve' ? 'approved' : 'rejected'

    // Update timesheet
    const { data: updatedTimesheet, error: updateError } = await supabase
      .from('timesheets')
      .update({
        status: newStatus,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        admin_notes: notes || null,
      })
      .eq('id', timesheet_id)
      .select(`
        *,
        employees:employee_id (
          employee_id,
          full_name,
          email
        ),
        reviewer:reviewed_by (
          full_name,
          email
        )
      `)
      .single()

    if (updateError) throw updateError

    // Create notification for employee
    await supabase
      .from('notifications')
      .insert({
        employee_id: timesheet.employee_id,
        type: 'timesheet_update',
        title: `Timesheet ${action === 'approve' ? 'Approved' : 'Rejected'}`,
        message: `Your timesheet for week ${timesheet.week_start_date} to ${timesheet.week_end_date} has been ${newStatus} by ${approverName}`,
        read: false,
      })
      .catch(() => {}) // Ignore if notifications table doesn't exist

    return new Response(
      JSON.stringify({
        success: true,
        message: `Timesheet ${newStatus} successfully`,
        data: {
          id: updatedTimesheet.id,
          employee: updatedTimesheet.employees,
          week_start_date: updatedTimesheet.week_start_date,
          week_end_date: updatedTimesheet.week_end_date,
          total_hours: updatedTimesheet.total_hours,
          entries: updatedTimesheet.entries,
          status: updatedTimesheet.status,
          reviewed_by: approverName,
          reviewed_at: updatedTimesheet.reviewed_at,
          admin_notes: updatedTimesheet.admin_notes,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    throw error
  }
}