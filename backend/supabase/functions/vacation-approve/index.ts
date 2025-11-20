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
        return await handleGet(supabaseAdmin, user.id, userRole, requestId)
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

// GET - List vacation requests
async function handleGet(supabase: any, userId: string, userRole: string, requestId: string) {
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
          )
        `)
        .eq('id', requestId)
        .single()

      if (error) throw error

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
        )
      `)
      .order('created_at', { ascending: false })

    // Regular employees can only see their own requests
    if (userRole !== 'admin' && userRole !== 'manager') {
      query = query.eq('employee_id', userId)
    }

    const { data, error } = await query

    if (error) throw error

    return new Response(
      JSON.stringify({ success: true, data }),
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

    // Calculate days
    const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1

    // Check for overlapping requests
    const { data: overlapping } = await supabase
      .from('vacation_requests')
      .select('id')
      .eq('employee_id', userId)
      .in('status', ['pending', 'approved'])
      .or(`start_date.lte.${end_date},end_date.gte.${start_date}`)

    if (overlapping && overlapping.length > 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'You have an overlapping vacation request' 
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
        reason,
        vacation_type: vacation_type || 'annual',
        status: 'pending',
      })
      .select()
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

// PUT/PATCH - Update vacation request (approve/reject or edit)
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

    // Check permissions for status change (admin/manager only)
    if (body.status && (userRole !== 'admin' && userRole !== 'manager')) {
      return new Response(
        JSON.stringify({ success: false, error: 'Only admins can approve/reject requests' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check permissions for editing own request
    if (!body.status && existing.employee_id !== userId) {
      return new Response(
        JSON.stringify({ success: false, error: 'You can only edit your own requests' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Prevent editing approved/rejected requests
    if (!body.status && existing.status !== 'pending') {
      return new Response(
        JSON.stringify({ success: false, error: 'Cannot edit non-pending requests' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build update object
    const updateData: any = {}

    if (body.status) {
      updateData.status = body.status
      updateData.reviewed_by = userId
      updateData.reviewed_at = new Date().toISOString()
      if (body.admin_notes) {
        updateData.admin_notes = body.admin_notes
      }
    } else {
      if (body.start_date) updateData.start_date = body.start_date
      if (body.end_date) updateData.end_date = body.end_date
      if (body.reason) updateData.reason = body.reason
      if (body.vacation_type) updateData.vacation_type = body.vacation_type

      // Recalculate days if dates changed
      if (body.start_date || body.end_date) {
        const startDate = new Date(body.start_date || existing.start_date)
        const endDate = new Date(body.end_date || existing.end_date)
        updateData.days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
      }
    }

    // Update request
    const { data, error } = await supabase
      .from('vacation_requests')
      .update(updateData)
      .eq('id', requestId)
      .select()
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

    // Check permissions (own request or admin)
    if (existing.employee_id !== userId && userRole !== 'admin') {
      return new Response(
        JSON.stringify({ success: false, error: 'Access denied' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Prevent deleting approved requests (only admin can)
    if (existing.status === 'approved' && userRole !== 'admin') {
      return new Response(
        JSON.stringify({ success: false, error: 'Cannot delete approved requests' }),
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