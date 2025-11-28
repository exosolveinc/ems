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

    // Get user role from employees table
    const { data: employee } = await supabaseAdmin
      .from('employees')
      .select('role, employee_id, full_name')
      .eq('id', user.id)
      .single()

    const userRole = employee?.role || 'employee'

    // Only employees can check out (not admins checking out on behalf of others)
    if (userRole !== 'employee' && userRole !== 'manager' && userRole !== 'hr') {
      return new Response(
        JSON.stringify({ success: false, error: 'Only employees can check out' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { location, ip, notes } = await req.json()

    // Employee can only check out themselves
    const employee_id = user.id

    // Get today's check-in (using EST)
    const now = new Date()
    const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const today = new Date(estTime)
    today.setHours(0, 0, 0, 0)

    const { data: checkin, error: checkinError } = await supabaseAdmin
      .from('check_ins')
      .select('id, check_in_time')
      .eq('employee_id', employee_id)
      .gte('check_in_time', today.toISOString())
      .single()

    if (!checkin) {
      return new Response(
        JSON.stringify({ success: false, error: 'No check-in found for today' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if already checked out
    const { data: existingCheckout } = await supabaseAdmin
      .from('check_outs')
      .select('id')
      .eq('check_in_id', checkin.id)
      .single()

    if (existingCheckout) {
      return new Response(
        JSON.stringify({ success: false, error: 'Already checked out today' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Calculate total hours (using EST)
    const checkInTime = new Date(checkin.check_in_time)
    const checkOutTimeUTC = new Date()
    const checkOutTime = new Date(checkOutTimeUTC.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const totalHours = (checkOutTime.getTime() - checkInTime.getTime()) / (1000 * 60 * 60)

    // Create check-out record
    const { data: checkout, error } = await supabaseAdmin
      .from('check_outs')
      .insert({
        employee_id,
        check_in_id: checkin.id,
        check_out_location: location,
        check_out_ip: ip,
        check_out_notes: notes,
        total_hours: Math.round(totalHours * 100) / 100,
      })
      .select()
      .single()

    if (error) throw error

    return new Response(
      JSON.stringify({
        success: true,
        data: checkout,
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
