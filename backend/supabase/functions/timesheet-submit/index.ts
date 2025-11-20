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

    // Route based on method
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/').filter(Boolean)
    const timesheetId = pathParts[pathParts.length - 1]

    switch (req.method) {
      case 'GET':
        return await handleGet(supabaseAdmin, user.id, timesheetId, url.searchParams)
      case 'POST':
        return await handleSubmit(supabaseAdmin, user.id, req)
      case 'PUT':
      case 'PATCH':
        return await handleUpdate(supabaseAdmin, user.id, timesheetId, req)
      case 'DELETE':
        return await handleDelete(supabaseAdmin, user.id, timesheetId)
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

// GET - List timesheets or get specific timesheet
async function handleGet(
  supabase: any,
  userId: string,
  timesheetId: string,
  searchParams: URLSearchParams
) {
  try {
    // Get specific timesheet by ID
    if (timesheetId && timesheetId !== 'timesheet-submit') {
      const { data, error } = await supabase
        .from('timesheets')
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
        .eq('id', timesheetId)
        .single()

      if (error || !data) {
        return new Response(
          JSON.stringify({ success: false, error: 'Timesheet not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Check permissions - employees can only view their own
      if (data.employee_id !== userId) {
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

    // List all timesheets for current user
    let query = supabase
      .from('timesheets')
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
      .eq('employee_id', userId)

    // Filter by status if provided
    const status = searchParams.get('status')
    if (status) {
      query = query.eq('status', status)
    }

    // Filter by week/date range
    const weekStart = searchParams.get('week_start')
    const weekEnd = searchParams.get('week_end')
    if (weekStart) {
      query = query.eq('week_start_date', weekStart)
    }
    if (weekEnd) {
      query = query.eq('week_end_date', weekEnd)
    }

    // Order by week start date descending
    query = query.order('week_start_date', { ascending: false })

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

// POST - Submit timesheet
async function handleSubmit(supabase: any, userId: string, req: Request) {
  try {
    const { week_start_date, week_end_date, entries, notes } = await req.json()

    // Validate required fields
    if (!week_start_date || !week_end_date || !entries || entries.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'week_start_date, week_end_date, and entries are required' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate dates
    const startDate = new Date(week_start_date)
    const endDate = new Date(week_end_date)

    if (endDate < startDate) {
      return new Response(
        JSON.stringify({ success: false, error: 'Week end date must be after start date' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate entries structure
    for (const entry of entries) {
      if (!entry.date || !entry.hours) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Each entry must have date and hours' 
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Validate hours (must be positive and reasonable)
      if (entry.hours < 0 || entry.hours > 24) {
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: 'Hours must be between 0 and 24 per entry' 
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Calculate total hours
    const totalHours = entries.reduce((sum: number, entry: any) => sum + parseFloat(entry.hours), 0)

    // Check for existing timesheet for this week
    const { data: existing } = await supabase
      .from('timesheets')
      .select('id, status')
      .eq('employee_id', userId)
      .eq('week_start_date', week_start_date)
      .eq('week_end_date', week_end_date)
      .maybeSingle()

    if (existing) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Timesheet already exists for this week (status: ${existing.status})`,
          existing_id: existing.id
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create timesheet
    const { data, error } = await supabase
      .from('timesheets')
      .insert({
        employee_id: userId,
        week_start_date,
        week_end_date,
        total_hours: totalHours,
        entries: entries,
        notes: notes || null,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
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

    // Optional: Create notification for manager
    await supabase
      .from('notifications')
      .insert({
        employee_id: userId,
        type: 'timesheet_submitted',
        title: 'Timesheet Submitted',
        message: `Your timesheet for week ${week_start_date} to ${week_end_date} has been submitted for approval`,
        read: false,
      })
      .catch(() => {}) // Ignore if notifications table doesn't exist

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Timesheet submitted successfully',
        data
      }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    throw error
  }
}

// PUT/PATCH - Update timesheet (only if not approved)
async function handleUpdate(supabase: any, userId: string, timesheetId: string, req: Request) {
  try {
    if (!timesheetId || timesheetId === 'timesheet-submit') {
      return new Response(
        JSON.stringify({ success: false, error: 'Timesheet ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const body = await req.json()

    // Get existing timesheet
    const { data: existing, error: fetchError } = await supabase
      .from('timesheets')
      .select('*')
      .eq('id', timesheetId)
      .single()

    if (fetchError || !existing) {
      return new Response(
        JSON.stringify({ success: false, error: 'Timesheet not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check permissions
    if (existing.employee_id !== userId) {
      return new Response(
        JSON.stringify({ success: false, error: 'You can only edit your own timesheets' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Cannot edit approved timesheets
    if (existing.status === 'approved') {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Cannot edit approved timesheets. Contact admin if changes are needed.' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build update object
    const updateData: any = {}

    if (body.entries) {
      // Validate entries
      for (const entry of body.entries) {
        if (!entry.date || !entry.hours) {
          return new Response(
            JSON.stringify({ 
              success: false, 
              error: 'Each entry must have date and hours' 
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      }

      updateData.entries = body.entries
      // Recalculate total hours
      updateData.total_hours = body.entries.reduce((sum: number, entry: any) => sum + parseFloat(entry.hours), 0)
    }

    if (body.notes !== undefined) {
      updateData.notes = body.notes
    }

    // Re-submit if rejected
    if (existing.status === 'rejected') {
      updateData.status = 'submitted'
      updateData.submitted_at = new Date().toISOString()
    }

    // Update timesheet
    const { data, error } = await supabase
      .from('timesheets')
      .update(updateData)
      .eq('id', timesheetId)
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
        message: 'Timesheet updated successfully',
        data
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    throw error
  }
}

// DELETE - Delete timesheet (only if not approved)
async function handleDelete(supabase: any, userId: string, timesheetId: string) {
  try {
    if (!timesheetId || timesheetId === 'timesheet-submit') {
      return new Response(
        JSON.stringify({ success: false, error: 'Timesheet ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get existing timesheet
    const { data: existing, error: fetchError } = await supabase
      .from('timesheets')
      .select('*')
      .eq('id', timesheetId)
      .single()

    if (fetchError || !existing) {
      return new Response(
        JSON.stringify({ success: false, error: 'Timesheet not found' }),
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

    // Cannot delete approved timesheets
    if (existing.status === 'approved') {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Cannot delete approved timesheets. Contact admin for assistance.' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Delete timesheet
    const { error } = await supabase
      .from('timesheets')
      .delete()
      .eq('id', timesheetId)

    if (error) throw error

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Timesheet deleted successfully'
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    throw error
  }
}