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
      .select('role, employee_id')
      .eq('id', user.id)
      .single()

    const userRole = employee?.role || 'employee'

    // Route based on method
    const url = new URL(req.url)
    const pathParts = url.pathname.split('/').filter(Boolean)
    const violationId = pathParts[pathParts.length - 1]

    switch (req.method) {
      case 'GET':
        return await handleGet(supabaseAdmin, user.id, userRole, violationId, url.searchParams)
      case 'PATCH':
      case 'PUT':
        return await handleUpdate(supabaseAdmin, user.id, userRole, violationId, req)
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

// GET - List violations or get specific violation
async function handleGet(
  supabase: any,
  userId: string,
  userRole: string,
  violationId: string,
  searchParams: URLSearchParams
) {
  try {
    // Get specific violation by ID
    if (violationId && violationId !== 'violations') {
      const { data, error } = await supabase
        .from('violations')
        .select(`
          *,
          employee:employees!violations_employee_id_fkey (
            employee_id,
            full_name,
            first_name,
            last_name,
            email
          ),
          escalated_employee:employees!violations_escalated_to_fkey (
            employee_id,
            full_name,
            first_name,
            last_name,
            email
          ),
          resolved_employee:employees!violations_resolved_by_fkey (
            employee_id,
            full_name,
            first_name,
            last_name,
            email
          )
        `)
        .eq('id', violationId)
        .single()

      if (error || !data) {
        return new Response(
          JSON.stringify({ success: false, error: 'Violation not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Check permissions - employees can only view their own
      if (userRole === 'employee' && data.employee_id !== userId) {
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

    // List violations
    let query = supabase
      .from('violations')
      .select(`
        *,
        employee:employees!violations_employee_id_fkey (
          employee_id,
          full_name,
          first_name,
          last_name,
          email,
          department
        )
      `)

    // Regular employees can only see their own violations
    if (userRole === 'employee') {
      query = query.eq('employee_id', userId)
    }

    // Filter by employee_id if provided (managers/admins only)
    const employeeId = searchParams.get('employee_id')
    if (employeeId && userRole !== 'employee') {
      query = query.eq('employee_id', employeeId)
    }

    // Filter by violation type
    const violationType = searchParams.get('violation_type')
    if (violationType) {
      query = query.eq('violation_type', violationType)
    }

    // Filter by severity
    const severity = searchParams.get('severity')
    if (severity) {
      query = query.eq('severity', severity)
    }

    // Filter by resolved status
    const resolved = searchParams.get('resolved')
    if (resolved !== null && resolved !== undefined) {
      query = query.eq('resolved', resolved === 'true')
    }

    // Filter by escalated status
    const escalated = searchParams.get('escalated')
    if (escalated !== null && escalated !== undefined) {
      query = query.eq('escalated', escalated === 'true')
    }

    // Filter by date range
    const startDate = searchParams.get('start_date')
    const endDate = searchParams.get('end_date')
    if (startDate) {
      query = query.gte('violation_date', startDate)
    }
    if (endDate) {
      query = query.lte('violation_date', endDate)
    }

    // Pagination
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')
    query = query.range(offset, offset + limit - 1)

    // Order by date descending
    query = query.order('violation_date', { ascending: false })
    query = query.order('created_at', { ascending: false })

    const { data, error, count } = await query

    if (error) throw error

    // Get summary stats if requested
    const includeSummary = searchParams.get('include_summary') === 'true'
    let summary = null

    if (includeSummary) {
      let summaryQuery = supabase
        .from('violations')
        .select('severity, resolved, violation_type', { count: 'exact' })

      if (userRole === 'employee') {
        summaryQuery = summaryQuery.eq('employee_id', userId)
      } else if (employeeId) {
        summaryQuery = summaryQuery.eq('employee_id', employeeId)
      }

      if (startDate) summaryQuery = summaryQuery.gte('violation_date', startDate)
      if (endDate) summaryQuery = summaryQuery.lte('violation_date', endDate)

      const { data: summaryData } = await summaryQuery

      if (summaryData) {
        summary = {
          total: summaryData.length,
          by_severity: {
            low: summaryData.filter((v: any) => v.severity === 'low').length,
            medium: summaryData.filter((v: any) => v.severity === 'medium').length,
            high: summaryData.filter((v: any) => v.severity === 'high').length,
            critical: summaryData.filter((v: any) => v.severity === 'critical').length,
          },
          by_type: {
            late_checkin: summaryData.filter((v: any) => v.violation_type === 'late_checkin').length,
            early_checkout: summaryData.filter((v: any) => v.violation_type === 'early_checkout').length,
            no_checkin: summaryData.filter((v: any) => v.violation_type === 'no_checkin').length,
            no_checkout: summaryData.filter((v: any) => v.violation_type === 'no_checkout').length,
          },
          resolved: summaryData.filter((v: any) => v.resolved).length,
          unresolved: summaryData.filter((v: any) => !v.resolved).length,
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        data,
        count: data.length,
        summary,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    throw error
  }
}

// PATCH/PUT - Update violation (resolve, add notes, etc.)
async function handleUpdate(
  supabase: any,
  userId: string,
  userRole: string,
  violationId: string,
  req: Request
) {
  try {
    if (!violationId || violationId === 'violations') {
      return new Response(
        JSON.stringify({ success: false, error: 'Violation ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Only managers and admins can update violations
    if (userRole === 'employee') {
      return new Response(
        JSON.stringify({ success: false, error: 'Access denied. Only managers can resolve violations.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const body = await req.json()

    // Build update object
    const updateData: any = {}

    if (body.resolved !== undefined) {
      updateData.resolved = body.resolved
      if (body.resolved) {
        updateData.resolved_at = new Date().toISOString()
        updateData.resolved_by = userId
      }
    }

    if (body.resolved_notes !== undefined) {
      updateData.resolved_notes = body.resolved_notes
    }

    if (body.notes !== undefined) {
      updateData.notes = body.notes
    }

    // Update violation
    const { data, error } = await supabase
      .from('violations')
      .update(updateData)
      .eq('id', violationId)
      .select(`
        *,
        employee:employees!violations_employee_id_fkey (
          employee_id,
          full_name,
          first_name,
          last_name,
          email
        )
      `)
      .single()

    if (error) throw error

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Violation updated successfully',
        data,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    throw error
  }
}
