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
    const { employee_id, location, ip, notes } = await req.json()

    // Validate input
    if (!employee_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'employee_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Check if already checked in today
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const { data: existing, error: checkError } = await supabase
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
    const { data: checkin, error } = await supabase
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

    // Check if late and create violation
    const checkInTime = new Date(checkin.check_in_time)
    const workStart = new Date(checkInTime)
    workStart.setHours(9, 0, 0, 0) // 9 AM work start

    let violation = null
    if (checkInTime > workStart) {
      const minutesLate = Math.floor((checkInTime.getTime() - workStart.getTime()) / (1000 * 60))
      
      let severity = 'low'
      if (minutesLate > 60) severity = 'high'
      else if (minutesLate > 30) severity = 'medium'

      const { data: violationData } = await supabase
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
