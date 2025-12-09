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
    const statusId = pathParts[pathParts.length - 1]

    switch (req.method) {
      case 'GET':
        return await handleGet(supabaseAdmin, user.id, userRole, statusId, url.searchParams)
      case 'POST':
        return await handleCreate(supabaseAdmin, user.id, req)
      case 'PUT':
      case 'PATCH':
        return await handleUpdate(supabaseAdmin, user.id, statusId, req)
      case 'DELETE':
        return await handleDelete(supabaseAdmin, user.id, statusId)
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

// GET - List hourly statuses or get specific status
async function handleGet(
  supabase: any,
  userId: string,
  userRole: string,
  statusId: string,
  searchParams: URLSearchParams
) {
  try {
    // Get specific status by ID
    if (statusId && statusId !== 'hourly-status') {
      const { data, error } = await supabase
        .from('hourly_status')
        .select(`
          *,
          employees:employee_id (
            employee_id,
            full_name,
            email
          )
        `)
        .eq('id', statusId)
        .single()

      if (error || !data) {
        return new Response(
          JSON.stringify({ success: false, error: 'Status update not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Check permissions - employees can only view their own, admins/managers can view all
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

    // List statuses with filters
    let query = supabase
      .from('hourly_status')
      .select(`
        *,
        employees:employee_id (
          employee_id,
          full_name,
          email
        )
      `)

    // Regular employees can only see their own statuses
    if (userRole !== 'admin' && userRole !== 'manager') {
      query = query.eq('employee_id', userId)
    }

    // Filter by employee_id if provided (admin/manager only)
    const employeeId = searchParams.get('employee_id')
    if (employeeId && (userRole === 'admin' || userRole === 'manager')) {
      query = query.eq('employee_id', employeeId)
    } else if (!employeeId && (userRole !== 'admin' && userRole !== 'manager')) {
      query = query.eq('employee_id', userId)
    }

    // Filter by date
    const date = searchParams.get('date')
    if (date) {
      const startOfDay = new Date(date)
      startOfDay.setHours(0, 0, 0, 0)
      const endOfDay = new Date(date)
      endOfDay.setHours(23, 59, 59, 999)
      
      query = query
        .gte('status_time', startOfDay.toISOString())
        .lte('status_time', endOfDay.toISOString())
    }

    // Filter by date range
    const startDate = searchParams.get('start_date')
    const endDate = searchParams.get('end_date')
    if (startDate) {
      query = query.gte('status_time', new Date(startDate).toISOString())
    }
    if (endDate) {
      const end = new Date(endDate)
      end.setHours(23, 59, 59, 999)
      query = query.lte('status_time', end.toISOString())
    }

    // Filter by status type
    const statusType = searchParams.get('status_type')
    if (statusType) {
      query = query.eq('status_type', statusType)
    }

    // Limit and pagination
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')
    query = query.range(offset, offset + limit - 1)

    // Order by status_time descending (most recent first)
    query = query.order('status_time', { ascending: false })

    const { data, error } = await query

    if (error) throw error

    return new Response(
      JSON.stringify({ 
        success: true, 
        data, 
        count: data.length,
        offset,
        limit
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    throw error
  }
}

// POST - Create hourly status update
async function handleCreate(supabase: any, userId: string, req: Request) {
  try {
    const body = await req.json()

    // Map frontend fields to database fields
    // Frontend sends: status_text, task_description
    // DB expects: status_message, status_type
    const status_text = body.status_text || body.status_message
    const task_description = body.task_description
    const status_type = body.status_type
    const status_time = body.status_time

    // Validate required fields
    if (!status_text) {
      return new Response(
        JSON.stringify({ success: false, error: 'status_text is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Combine status_text and task_description into status_message for DB
    let status_message = status_text
    if (task_description) {
      status_message = `${status_text} - ${task_description}`
    }

    // Validate status_type if provided
    const validStatusTypes = ['working', 'break', 'meeting', 'idle', 'away']
    if (status_type && !validStatusTypes.includes(status_type)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `status_type must be one of: ${validStatusTypes.join(', ')}`
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Use provided status_time or current time
    const timestamp = status_time ? new Date(status_time).toISOString() : new Date().toISOString()

    // Create status update
    const { data, error } = await supabase
      .from('hourly_status')
      .insert({
        employee_id: userId,
        status_message,
        status_type: status_type || null,
        status_time: timestamp,
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
        message: 'Status update created successfully',
        data
      }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    throw error
  }
}

// PUT/PATCH - Update status (within last hour only)
async function handleUpdate(supabase: any, userId: string, statusId: string, req: Request) {
  try {
    if (!statusId || statusId === 'hourly-status') {
      return new Response(
        JSON.stringify({ success: false, error: 'Status ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const body = await req.json()

    // Get existing status
    const { data: existing, error: fetchError } = await supabase
      .from('hourly_status')
      .select('*')
      .eq('id', statusId)
      .single()

    if (fetchError || !existing) {
      return new Response(
        JSON.stringify({ success: false, error: 'Status update not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check permissions
    if (existing.employee_id !== userId) {
      return new Response(
        JSON.stringify({ success: false, error: 'You can only edit your own status updates' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if status is recent (within last hour)
    const statusTime = new Date(existing.status_time)
    const now = new Date()
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000)

    if (statusTime < hourAgo) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Can only edit status updates from the last hour'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build update object
    // Map frontend fields to database fields
    const updateData: any = {}

    // Handle status_text or status_message
    const status_text = body.status_text || body.status_message
    const task_description = body.task_description

    if (status_text !== undefined || task_description !== undefined) {
      if (status_text !== undefined && !status_text) {
        return new Response(
          JSON.stringify({ success: false, error: 'status_text cannot be empty' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Combine status_text and task_description if both provided
      if (status_text !== undefined && task_description !== undefined) {
        updateData.status_message = `${status_text} - ${task_description}`
      } else if (status_text !== undefined) {
        updateData.status_message = status_text
      } else if (task_description !== undefined) {
        // If only task_description is updated, append to existing status_message
        updateData.status_message = `${existing.status_message} - ${task_description}`
      }
    }

    if (body.status_type !== undefined) {
      const validStatusTypes = ['working', 'break', 'meeting', 'idle', 'away']
      if (body.status_type && !validStatusTypes.includes(body.status_type)) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `status_type must be one of: ${validStatusTypes.join(', ')}`
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      updateData.status_type = body.status_type
    }

    // Update status
    const { data, error } = await supabase
      .from('hourly_status')
      .update(updateData)
      .eq('id', statusId)
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
        message: 'Status update updated successfully',
        data
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    throw error
  }
}

// DELETE - Delete status (within last hour only)
async function handleDelete(supabase: any, userId: string, statusId: string) {
  try {
    if (!statusId || statusId === 'hourly-status') {
      return new Response(
        JSON.stringify({ success: false, error: 'Status ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get existing status
    const { data: existing, error: fetchError } = await supabase
      .from('hourly_status')
      .select('*')
      .eq('id', statusId)
      .single()

    if (fetchError || !existing) {
      return new Response(
        JSON.stringify({ success: false, error: 'Status update not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check permissions
    if (existing.employee_id !== userId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Access denied' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if status is recent (within last hour)
    const statusTime = new Date(existing.status_time)
    const now = new Date()
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000)

    if (statusTime < hourAgo) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Can only delete status updates from the last hour' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Delete status
    const { error } = await supabase
      .from('hourly_status')
      .delete()
      .eq('id', statusId)

    if (error) throw error

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Status update deleted successfully'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    throw error
  }
}