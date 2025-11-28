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

    // Check if user has permission to approve (admin or manager only)
    if (userRole !== 'admin' && userRole !== 'manager') {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Access denied. Only admins and managers can approve vacation requests'
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

// GET - List pending vacation requests for approval
async function handleGetPending(supabase: any, searchParams: URLSearchParams) {
  try {
    let query = supabase
      .from('vacation_requests')
      .select(`
        *,
        employees:employee_id (
          employee_id,
          full_name,
          email,
          department,
          designation
        )
      `)

    // Filter by status (default to pending)
    const status = searchParams.get('status') || 'pending'
    query = query.eq('status', status)

    // Filter by employee_id if provided
    const employeeId = searchParams.get('employee_id')
    if (employeeId) {
      query = query.eq('employee_id', employeeId)
    }

    // Filter by date range
    const startDate = searchParams.get('start_date')
    const endDate = searchParams.get('end_date')
    if (startDate) {
      query = query.gte('start_date', startDate)
    }
    if (endDate) {
      query = query.lte('end_date', endDate)
    }

    // Order by created date
    query = query.order('created_at', { ascending: false })

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

// POST - Approve or reject vacation request
async function handleApprove(supabase: any, userId: string, approverName: string, req: Request) {
  try {
    const { request_id, action, notes } = await req.json()

    // Validate input
    if (!request_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'request_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!action || !['approve', 'reject'].includes(action)) {
      return new Response(
        JSON.stringify({ success: false, error: 'action must be either "approve" or "reject"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get the vacation request
    const { data: request, error: fetchError } = await supabase
      .from('vacation_requests')
      .select(`
        *,
        employees:employee_id (
          employee_id,
          full_name,
          email
        )
      `)
      .eq('id', request_id)
      .single()

    if (fetchError || !request) {
      return new Response(
        JSON.stringify({ success: false, error: 'Vacation request not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if request is in correct status
    if (request.status !== 'pending') {
      return new Response(
        JSON.stringify({
          success: false,
          error: `This vacation request has already been ${request.status}`
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Determine new status
    const newStatus = action === 'approve' ? 'approved' : 'rejected'

    // Update vacation request
    const { data: updatedRequest, error: updateError } = await supabase
      .from('vacation_requests')
      .update({
        status: newStatus,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        review_notes: notes || null,
      })
      .eq('id', request_id)
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
        employee_id: request.employee_id,
        type: 'vacation_update',
        title: `Vacation Request ${action === 'approve' ? 'Approved' : 'Rejected'}`,
        message: `Your vacation request from ${request.start_date} to ${request.end_date} has been ${newStatus} by ${approverName}`,
        read: false,
      })
      .catch(() => {}) // Ignore if notifications table doesn't exist

    return new Response(
      JSON.stringify({
        success: true,
        message: `Vacation request ${newStatus} successfully`,
        data: {
          id: updatedRequest.id,
          employee: updatedRequest.employees,
          start_date: updatedRequest.start_date,
          end_date: updatedRequest.end_date,
          days: updatedRequest.days,
          vacation_type: updatedRequest.vacation_type,
          status: updatedRequest.status,
          reviewed_by: approverName,
          reviewed_at: updatedRequest.reviewed_at,
          review_notes: updatedRequest.review_notes,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    throw error
  }
}