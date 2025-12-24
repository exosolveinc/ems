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
          ),
          task:task_id (
            id,
            title,
            ticket_number,
            status,
            project:project_id (
              id,
              project_name
            )
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
        ),
        task:task_id (
          id,
          title,
          ticket_number,
          status,
          project:project_id (
            id,
            project_name
          )
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

    // Filter by work_status
    const workStatus = searchParams.get('work_status')
    if (workStatus && ['progress', 'done', 'blocked'].includes(workStatus)) {
      query = query.eq('work_status', workStatus)
    }

    // Filter by task_id
    const taskId = searchParams.get('task_id')
    if (taskId) {
      query = query.eq('task_id', taskId)
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

// Valid work status values
const VALID_WORK_STATUSES = ['progress', 'done', 'blocked']

// POST - Create hourly status update
async function handleCreate(supabase: any, userId: string, req: Request) {
  try {
    const body = await req.json()

    const {
      status_text,
      task_id,
      work_status,
      blocker_description,
      status_time
    } = body

    // Validate required fields
    if (!status_text || typeof status_text !== 'string' || status_text.trim() === '') {
      return new Response(
        JSON.stringify({ success: false, error: 'status_text is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate work_status if provided
    if (work_status && !VALID_WORK_STATUSES.includes(work_status)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `work_status must be one of: ${VALID_WORK_STATUSES.join(', ')}`
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate blocker_description is provided when work_status is 'blocked'
    if (work_status === 'blocked' && (!blocker_description || blocker_description.trim() === '')) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'blocker_description is required when work_status is blocked'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate task_id exists if provided
    if (task_id) {
      const { data: taskExists, error: taskError } = await supabase
        .from('tasks')
        .select('id')
        .eq('id', task_id)
        .maybeSingle()

      if (taskError) throw taskError

      if (!taskExists) {
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid task_id - task not found' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Use provided status_time or current time
    const timestamp = status_time ? new Date(status_time).toISOString() : new Date().toISOString()

    // Create status update
    const { data, error } = await supabase
      .from('hourly_status')
      .insert({
        employee_id: userId,
        status_text: status_text.trim(),
        task_id: task_id || null,
        work_status: work_status || null,
        blocker_description: work_status === 'blocked' ? blocker_description?.trim() : null,
        status_time: timestamp,
      })
      .select(`
        *,
        employees:employee_id (
          employee_id,
          full_name,
          email
        ),
        task:task_id (
          id,
          title,
          ticket_number,
          status,
          project:project_id (
            id,
            project_name
          )
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
    const updateData: any = {}

    // Handle status_text
    if (body.status_text !== undefined) {
      if (!body.status_text || body.status_text.trim() === '') {
        return new Response(
          JSON.stringify({ success: false, error: 'status_text cannot be empty' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      updateData.status_text = body.status_text.trim()
    }

    // Handle task_id
    if (body.task_id !== undefined) {
      if (body.task_id) {
        const { data: taskExists, error: taskError } = await supabase
          .from('tasks')
          .select('id')
          .eq('id', body.task_id)
          .maybeSingle()

        if (taskError) throw taskError

        if (!taskExists) {
          return new Response(
            JSON.stringify({ success: false, error: 'Invalid task_id - task not found' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      }
      updateData.task_id = body.task_id || null
    }

    // Handle work_status
    if (body.work_status !== undefined) {
      if (body.work_status && !VALID_WORK_STATUSES.includes(body.work_status)) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `work_status must be one of: ${VALID_WORK_STATUSES.join(', ')}`
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      updateData.work_status = body.work_status || null
    }

    // Handle blocker_description
    const finalWorkStatus = body.work_status !== undefined ? body.work_status : existing.work_status
    if (body.blocker_description !== undefined || finalWorkStatus === 'blocked') {
      if (finalWorkStatus === 'blocked' && (!body.blocker_description || body.blocker_description.trim() === '')) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'blocker_description is required when work_status is blocked'
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      updateData.blocker_description = finalWorkStatus === 'blocked' ? body.blocker_description?.trim() : null
    }

    if (Object.keys(updateData).length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'No fields to update' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
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
        ),
        task:task_id (
          id,
          title,
          ticket_number,
          status,
          project:project_id (
            id,
            project_name
          )
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