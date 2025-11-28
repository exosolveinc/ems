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
    const { email, password, first_name, last_name, full_name, employee_id, role, phone, designation, department, division, salary, join_date, manager_id } = await req.json()

    // Validate input
    if (!email || !password || !employee_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Email, password, and employee_id are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate that we have either full_name OR (first_name and last_name)
    if (!full_name && (!first_name || !last_name)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Either full_name or both first_name and last_name are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate password strength
    if (password.length < 6) {
      return new Response(
        JSON.stringify({ success: false, error: 'Password must be at least 6 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate role if provided
    const validRoles = ['employee', 'manager', 'hr', 'admin']
    const userRole = role || 'employee'

    if (!validRoles.includes(userRole)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid role. Must be one of: employee, manager, hr, admin' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Generate full_name if not provided
    const computedFullName = full_name || `${first_name} ${last_name}`.trim()

    // Extract first_name and last_name if only full_name provided
    let computedFirstName = first_name
    let computedLastName = last_name

    if (!first_name && !last_name && full_name) {
      const nameParts = full_name.trim().split(/\s+/)
      computedFirstName = nameParts[0]
      computedLastName = nameParts.slice(1).join(' ') || ''
    }

    // Create Supabase admin client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Check if employee_id already exists
    const { data: existingEmployee } = await supabaseAdmin
      .from('employees')
      .select('employee_id')
      .eq('employee_id', employee_id)
      .maybeSingle()

    if (existingEmployee) {
      return new Response(
        JSON.stringify({ success: false, error: 'Employee ID already exists' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: computedFullName,
        first_name: computedFirstName,
        last_name: computedLastName,
        employee_id,
        role: userRole,
      }
    })

    if (authError) {
      return new Response(
        JSON.stringify({ success: false, error: authError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create employee record
    const { data: employeeData, error: employeeError } = await supabaseAdmin
      .from('employees')
      .insert({
        id: authData.user.id,
        employee_id,
        email,
        first_name: computedFirstName,
        last_name: computedLastName,
        phone: phone || null,
        designation: designation || null,
        department: department || null,
        division: division || null,
        salary: salary || null,
        join_date: join_date || new Date().toISOString().split('T')[0],
        role: userRole,
        status: 'active',
        manager_id: manager_id || null,
      })
      .select()
      .single()

    if (employeeError) {
      // Rollback: delete auth user if employee creation fails
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id)

      return new Response(
        JSON.stringify({ success: false, error: employeeError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'User created successfully',
        user: {
          id: employeeData.id,
          email: employeeData.email,
          employee_id: employeeData.employee_id,
          first_name: employeeData.first_name,
          last_name: employeeData.last_name,
          full_name: employeeData.full_name,
          role: employeeData.role,
          designation: employeeData.designation,
          department: employeeData.department,
          status: employeeData.status,
        },
      }),
      { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})