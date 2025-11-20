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
      .select('role')
      .eq('id', user.id)
      .single()

    const userRole = employee?.role || user.user_metadata?.role || 'employee'

    // Route based on method
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/').filter(Boolean)
    const requestId = pathParts[pathParts.length - 1]

    switch (req.method) {
      case 'GET':
        return await handleGet(supabaseAdmin, user.id, userRole, requestId, url.searchParams)
      case 'POST':
        return await handleCreate(supabaseAdmin, user.id, req)
      case 'PUT':
      case 'PATCH':
        return await handleUpdate(supabaseAdmin, user.id, userRole, requestId, req)
      case 'DELETE':
        return await handleDelete(supabaseAdmin, user.id, userRole, requestId)
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

// GET - List vacation requests or get specific request
async function handleGet(
  supabase: any, 
  userId: string, 
  userRole: string, 
  requestId: string,
  searchParams: URLSearchParams
) {
  try {
    // Get specific request by ID
    if (requestId && requestId !== 'vacation-request') {
      const { data, error } = await supabase
        .from('vacation_requests')
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
        .eq('id', requestId)
        .single()

      if (error) {
        return new Response(
          JSON.stringify({ success: false, error: 'Vacation request not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Check permissions
      if (userRole !== 'admin' && userRole !== 'manager' && data.employee_id !== userId) {
        return new Response(
          JSON.stringify({ success: false, error: 'Access denied' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ success: true, data }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // List all requests based on role
    let query = supabase
      .from('vacation_requests')
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

    // Regular employees can only see their own requests
    if (userRole !== 'admin' && userRole !== 'manager') {
      query = query.eq('employee_id', userId)
    }

    // Filter by status if provided
    const status = searchParams.get('status')
    if (status) {
      query = query.eq('status', status)
    }

    // Filter by employee_id if provided (admin/manager only)
    const employeeId = searchParams.get('employee_id')
    if (employeeId && (userRole === 'admin' || userRole === 'manager')) {
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

    // Order by created_at descending
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

// POST - Create vacation request
async function handleCreate(supabase: any, userId: string, req: Request) {
  try {
    const { start_date, end_date, reason, vacation_type } = await req.json()

    // Validate required fields
    if (!start_date || !end_date) {
      return new Response(
        JSON.stringify({ success: false, error: 'start_date and end_date are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate dates
    const startDate = new Date(start_date)
    const endDate = new Date(end_date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    if (startDate < today) {
      return new Response(
        JSON.stringify({ success: false, error: 'Start date cannot be in the past' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (endDate < startDate) {
      return new Response(
        JSON.stringify({ success: false, error: 'End date must be after start date' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Calculate days (inclusive)
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1

    // Check for overlapping requests
    const { data: overlapping } = await supabase
      .from('vacation_requests')
      .select('id, start_date, end_date, status')
      .eq('employee_id', userId)
      .in('status', ['pending', 'approved'])
      .or(`and(start_date.lte.${end_date},end_date.gte.${start_date})`)

    if (overlapping && overlapping.length > 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'You have an overlapping vacation request for these dates',
          overlapping: overlapping
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create vacation request
    const { data, error } = await supabase
      .from('vacation_requests')
      .insert({
        employee_id: userId,
        start_date,
        end_date,
        days,
        reason: reason || null,
        vacation_type: vacation_type || 'annual',
        status: 'pending',
      })
      .select(`
        *,
        employees:employee_id (
          employee_id,
          full_name,
          email
        )
      `)
      .single()

    if (error) throw error

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Vacation request created successfully',
        data 
      }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    throw error
  }
}

// PUT/PATCH - Update vacation request (employees can only edit their pending requests)
async function handleUpdate(supabase: any, userId: string, userRole: string, requestId: string, req: Request) {
  try {
    if (!requestId || requestId === 'vacation-request') {
      return new Response(
        JSON.stringify({ success: false, error: 'Request ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const body = await req.json()

    // Get existing request
    const { data: existing, error: fetchError } = await supabase
      .from('vacation_requests')
      .select('*')
      .eq('id', requestId)
      .single()

    if (fetchError || !existing) {
      return new Response(
        JSON.stringify({ success: false, error: 'Vacation request not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check permissions - employees can only edit their own pending requests
    if (existing.employee_id !== userId) {
      return new Response(
        JSON.stringify({ success: false, error: 'You can only edit your own vacation requests' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Prevent editing non-pending requests
    if (existing.status !== 'pending') {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Cannot edit ${existing.status} requests. Only pending requests can be edited.` 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build update object (only allow specific fields)
    const updateData: any = {}

    if (body.start_date) {
      const newStartDate = new Date(body.start_date)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      
      if (newStartDate < today) {
        return new Response(
          JSON.stringify({ success: false, error: 'Start date cannot be in the past' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      updateData.start_date = body.start_date
    }

    if (body.end_date) {
      updateData.end_date = body.end_date
    }

    if (body.reason !== undefined) {
      updateData.reason = body.reason
    }

    if (body.vacation_type) {
      updateData.vacation_type = body.vacation_type
    }

    // Recalculate days if dates changed
    if (body.start_date || body.end_date) {
      const startDate = new Date(body.start_date || existing.start_date)
      const endDate = new Date(body.end_date || existing.end_date)
      
      if (endDate < startDate) {
        return new Response(
          JSON.stringify({ success: false, error: 'End date must be after start date' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      updateData.days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
    }

    // Check for overlapping requests (excluding current request)
    if (body.start_date || body.end_date) {
      const checkStartDate = body.start_date || existing.start_date
      const checkEndDate = body.end_date || existing.end_date
      
      const { data: overlapping } = await supabase
        .from('vacation_requests')
        .select('id')
        .eq('employee_id', userId)
        .neq('id', requestId)
        .in('status', ['pending', 'approved'])
        .or(`and(start_date.lte.${checkEndDate},end_date.gte.${checkStartDate})`)

      if (overlapping && overlapping.length > 0) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'These dates overlap with another vacation request' 
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Update request
    const { data, error } = await supabase
      .from('vacation_requests')
      .update(updateData)
      .eq('id', requestId)
      .select(`
        *,
        employees:employee_id (
          employee_id,
          full_name,
          email
        )
      `)
      .single()

    if (error) throw error

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Vacation request updated successfully',
        data 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    throw error
  }
}

// DELETE - Delete vacation request
async function handleDelete(supabase: any, userId: string, userRole: string, requestId: string) {
  try {
    if (!requestId || requestId === 'vacation-request') {
      return new Response(
        JSON.stringify({ success: false, error: 'Request ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get existing request
    const { data: existing, error: fetchError } = await supabase
      .from('vacation_requests')
      .select('*')
      .eq('id', requestId)
      .single()

    if (fetchError || !existing) {
      return new Response(
        JSON.stringify({ success: false, error: 'Vacation request not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check permissions
    if (existing.employee_id !== userId && userRole !== 'admin') {
      return new Response(
        JSON.stringify({ success: false, error: 'Access denied' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Employees cannot delete approved requests
    if (existing.status === 'approved' && userRole !== 'admin') {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Cannot delete approved requests. Contact admin for assistance.' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Delete request
    const { error } = await supabase
      .from('vacation_requests')
      .delete()
      .eq('id', requestId)

    if (error) throw error

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Vacation request deleted successfully' 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    throw error
  }
}
