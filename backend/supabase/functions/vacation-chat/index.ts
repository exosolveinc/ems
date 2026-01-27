import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  toYAML,
  daysAgo,
  getCurrentDate,
  TIME_RANGES,
  isAdminOrManager,
  callHaiku,
  SYSTEM_PROMPTS
} from '../_shared/chat-utils.ts'

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
    // Only allow POST
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ success: false, error: 'Method not allowed' }),
        { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

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
      .select('role, first_name, last_name')
      .eq('id', user.id)
      .single()

    const userRole = employee?.role || 'employee'
    const userName = employee ? `${employee.first_name} ${employee.last_name}` : 'User'

    // Parse request body
    const body = await req.json()
    const { message } = body

    if (!message || typeof message !== 'string' || message.trim() === '') {
      return new Response(
        JSON.stringify({ success: false, error: 'message is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch data based on role
    const since = daysAgo(TIME_RANGES.vacation)
    const adminManager = isAdminOrManager(userRole)

    // For admins: include employee list for name matching
    let employees = null
    if (adminManager) {
      const { data } = await supabaseAdmin
        .from('employees')
        .select('id, first_name, last_name, email')
      employees = data
    }

    // Build query
    let query = supabaseAdmin
      .from('vacation_requests')
      .select(`
        *,
        employee:employees!employee_id(first_name, last_name),
        reviewer:employees!reviewed_by(first_name, last_name)
      `)
      .gte('start_date', since)
      .order('start_date', { ascending: false })

    // Filter by employee_id only for regular employees
    if (!adminManager) {
      query = query.eq('employee_id', user.id)
    }

    const { data: vacations, error: fetchError } = await query

    if (fetchError) throw fetchError

    // Build data object
    const dataForAI = adminManager
      ? { employees, vacation_requests: vacations }
      : { vacation_requests: vacations }

    // Convert to YAML
    const yamlData = toYAML(dataForAI)

    // Build context
    const currentDate = getCurrentDate()
    const currentYear = new Date().getFullYear()
    const systemPrompt = SYSTEM_PROMPTS.vacation(userRole, currentDate)
    const userMessage = `Your role: ${userRole}
Your name: ${userName}
Today: ${currentDate}
Current year: ${currentYear}

Data:
${yamlData}

Question: ${message}`

    // Call Haiku
    const response = await callHaiku(systemPrompt, userMessage)

    return new Response(
      JSON.stringify({ success: true, response }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
