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
      .select('*')
      .eq('id', user.id)
      .single()

    if (!employee) {
      return new Response(
        JSON.stringify({ success: false, error: 'Employee not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get today's date (EST)
    const now = new Date()
    const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const today = new Date(estTime)
    today.setHours(0, 0, 0, 0)

    // Get today's check-in with standup entries
    const { data: checkin } = await supabaseAdmin
      .from('check_ins')
      .select(`
        *,
        standup_entries (*)
      `)
      .eq('employee_id', user.id)
      .gte('check_in_time', today.toISOString())
      .single()

    // Get today's check-out if exists
    let checkout = null
    if (checkin) {
      const { data: checkoutData } = await supabaseAdmin
        .from('check_outs')
        .select('*')
        .eq('check_in_id', checkin.id)
        .single()
      checkout = checkoutData
    }

    // Determine status
    let status = 'not_checked_in'
    if (checkin && checkout) {
      status = 'checked_out'
    } else if (checkin) {
      status = 'checked_in'
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          employee: {
            id: employee.id,
            name: employee.full_name,
            employee_id: employee.employee_id,
            role: employee.role,
          },
          status,
          checkin,
          checkout,
          standup: checkin?.standup_entries || [],
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