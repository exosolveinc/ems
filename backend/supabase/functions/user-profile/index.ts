import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
}

// Valid work days
const VALID_WORK_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

// Validate time format (HH:MM or HH:MM:SS)
function isValidTime(time: string): boolean {
  const timeRegex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])(:[0-5][0-9])?$/
  return timeRegex.test(time)
}

// Normalize time to HH:MM:SS format
function normalizeTime(time: string): string {
  if (time.length === 5) {
    return `${time}:00`
  }
  return time
}

// Compare times (returns true if time1 < time2)
function isTimeBefore(time1: string, time2: string): boolean {
  const t1 = normalizeTime(time1)
  const t2 = normalizeTime(time2)
  return t1 < t2
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

    // GET - Retrieve user profile
    if (req.method === 'GET') {
      const { data: employee, error } = await supabaseAdmin
        .from('employees')
        .select(`
          id,
          email,
          phone,
          first_name,
          last_name,
          full_name,
          employee_id,
          designation,
          department,
          division,
          join_date,
          status,
          profile_image_url,
          role,
          work_start_time,
          work_end_time,
          work_days,
          created_at,
          updated_at
        `)
        .eq('id', user.id)
        .single()

      if (error) throw error

      if (!employee) {
        return new Response(
          JSON.stringify({ success: false, error: 'Employee profile not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({
          success: true,
          data: employee
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // PUT - Update user profile
    if (req.method === 'PUT') {
      const body = await req.json()

      // Fields that users can update
      const {
        phone,
        profile_image_url,
        work_start_time,
        work_end_time,
        work_days
      } = body

      // Build update object with only provided fields
      const updateData: Record<string, any> = {}

      if (phone !== undefined) {
        updateData.phone = phone
      }

      if (profile_image_url !== undefined) {
        updateData.profile_image_url = profile_image_url
      }

      // Validate and set work_start_time
      if (work_start_time !== undefined) {
        if (!isValidTime(work_start_time)) {
          return new Response(
            JSON.stringify({ success: false, error: 'Invalid work_start_time format. Use HH:MM or HH:MM:SS' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        updateData.work_start_time = normalizeTime(work_start_time)
      }

      // Validate and set work_end_time
      if (work_end_time !== undefined) {
        if (!isValidTime(work_end_time)) {
          return new Response(
            JSON.stringify({ success: false, error: 'Invalid work_end_time format. Use HH:MM or HH:MM:SS' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
        updateData.work_end_time = normalizeTime(work_end_time)
      }

      // Validate that work_end_time is after work_start_time
      if (updateData.work_start_time || updateData.work_end_time) {
        // Get current values if not being updated
        const { data: currentEmployee } = await supabaseAdmin
          .from('employees')
          .select('work_start_time, work_end_time')
          .eq('id', user.id)
          .single()

        const startTime = updateData.work_start_time || currentEmployee?.work_start_time || '09:00:00'
        const endTime = updateData.work_end_time || currentEmployee?.work_end_time || '17:00:00'

        if (!isTimeBefore(startTime, endTime)) {
          return new Response(
            JSON.stringify({ success: false, error: 'work_end_time must be after work_start_time' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      }

      // Validate and set work_days
      if (work_days !== undefined) {
        if (!Array.isArray(work_days)) {
          return new Response(
            JSON.stringify({ success: false, error: 'work_days must be an array' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        if (work_days.length === 0) {
          return new Response(
            JSON.stringify({ success: false, error: 'work_days must have at least one day' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Normalize to lowercase and validate
        const normalizedDays = work_days.map((day: string) => day.toLowerCase())
        const invalidDays = normalizedDays.filter((day: string) => !VALID_WORK_DAYS.includes(day))

        if (invalidDays.length > 0) {
          return new Response(
            JSON.stringify({
              success: false,
              error: `Invalid work days: ${invalidDays.join(', ')}. Valid days are: ${VALID_WORK_DAYS.join(', ')}`
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        updateData.work_days = normalizedDays
      }

      // Check if there's anything to update
      if (Object.keys(updateData).length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: 'No valid fields to update' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Perform update
      const { data: updatedEmployee, error } = await supabaseAdmin
        .from('employees')
        .update(updateData)
        .eq('id', user.id)
        .select(`
          id,
          email,
          phone,
          first_name,
          last_name,
          full_name,
          employee_id,
          designation,
          department,
          division,
          join_date,
          status,
          profile_image_url,
          role,
          work_start_time,
          work_end_time,
          work_days,
          created_at,
          updated_at
        `)
        .single()

      if (error) throw error

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Profile updated successfully',
          data: updatedEmployee
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Method not allowed
    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
