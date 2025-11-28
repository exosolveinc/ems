import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
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
        JSON.stringify({ success: false, error: 'Unauthorized', user: user, authError: authError }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get user role from employees table
    const { data: employee } = await supabaseAdmin
      .from('employees')
      .select('role, employee_id, full_name')
      .eq('id', user.id)
      .single()

    const userRole = employee?.role || 'employee'

    // Only employees can check in (not admins checking in on behalf of others)
    if (userRole !== 'employee' && userRole !== 'manager' && userRole !== 'hr') {
      return new Response(
        JSON.stringify({ success: false, error: 'Only employees can check in' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { location, ip, notes } = await req.json()

    // Employee can only check in themselves
    const employee_id = user.id

    // Check if already checked in today (using EST)
    const now = new Date()
    const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const today = new Date(estTime)
    today.setHours(0, 0, 0, 0)

    const { data: existing, error: checkError } = await supabaseAdmin
      .from('check_ins')
      .select('id')
      .eq('employee_id', employee_id)
      .gte('check_in_time', today.toISOString())
      .single()

    if (existing) {
      return new Response(
        JSON.stringify({ success: false, error: 'Already checked in today' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create check-in record
    const { data: checkin, error } = await supabaseAdmin
      .from('check_ins')
      .insert({
        employee_id,
        check_in_location: location,
        check_in_ip: ip,
        check_in_notes: notes,
      })
      .select()
      .single()

    if (error) throw error

    // Check if late and create violation (using EST)
    const checkInTimeUTC = new Date(checkin.check_in_time)
    const checkInTime = new Date(checkInTimeUTC.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const workStart = new Date(checkInTime)
    workStart.setHours(9, 0, 0, 0) // 9 AM EST work start

    let violation = null
    if (checkInTime > workStart) {
      const minutesLate = Math.floor((checkInTime.getTime() - workStart.getTime()) / (1000 * 60))

      let severity = 'low'
      if (minutesLate > 60) severity = 'high'
      else if (minutesLate > 30) severity = 'medium'

      const { data: violationData } = await supabaseAdmin
        .from('violations')
        .insert({
          employee_id,
          violation_type: 'late_checkin',
          violation_date: new Date().toISOString().split('T')[0],
          severity,
          description: `Checked in ${minutesLate} minutes late`,
        })
        .select()
        .single()

      violation = {
        created: true,
        severity,
        minutes_late: minutesLate,
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: checkin,
        violation,
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
