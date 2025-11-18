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
    const { employee_id, location, ip, notes } = await req.json()

    if (!employee_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'employee_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get today's check-in
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const { data: checkin, error: checkinError } = await supabase
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
    const { data: existingCheckout } = await supabase
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

    // Calculate total hours
    const checkInTime = new Date(checkin.check_in_time)
    const checkOutTime = new Date()
    const totalHours = (checkOutTime.getTime() - checkInTime.getTime()) / (1000 * 60 * 60)

    // Create check-out record
    const { data: checkout, error } = await supabase
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
