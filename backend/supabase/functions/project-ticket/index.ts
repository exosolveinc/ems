import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

    if (!employee) {
      return new Response(
        JSON.stringify({ success: false, error: 'Employee record not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // =====================================================================
    // GET - Retrieve projects and tickets
    // =====================================================================
    if (req.method === 'GET') {
      const url = new URL(req.url)
      const type = url.searchParams.get('type') // 'projects' or 'tickets'

      // Get projects
      if (type === 'projects' || !type) {
        const search = url.searchParams.get('search')
        const status = url.searchParams.get('status') || 'active'

        let query = supabaseAdmin
          .from('projects')
          .select('*')

        if (status && status !== 'all') {
          query = query.eq('status', status)
        }

        if (search) {
          query = query.ilike('project_name', `%${search}%`)
        }

        query = query.order('project_name', { ascending: true })

        const { data, error } = await query

        if (error) throw error

        return new Response(
          JSON.stringify({
            success: true,
            data: data || [],
            type: 'projects'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Get tickets
      if (type === 'tickets') {
        const projectId = url.searchParams.get('project_id')
        const search = url.searchParams.get('search')
        const status = url.searchParams.get('status') || 'open'

        let query = supabaseAdmin
          .from('tickets')
          .select(`
            *,
            project:project_id (
              id,
              project_name
            )
          `)

        if (projectId) {
          query = query.eq('project_id', projectId)
        }

        if (status && status !== 'all') {
          query = query.eq('status', status)
        }

        if (search) {
          query = query.or(`ticket_number.ilike.%${search}%,title.ilike.%${search}%`)
        }

        query = query.order('created_at', { ascending: false })

        const { data, error } = await query

        if (error) throw error

        return new Response(
          JSON.stringify({
            success: true,
            data: data || [],
            type: 'tickets'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ success: false, error: 'Invalid type parameter. Use "projects" or "tickets"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // =====================================================================
    // POST - Add project or ticket
    // =====================================================================
    if (req.method === 'POST') {
      const body = await req.json()
      const { type, project_name, description, ticket_number, project_id, title, jira_url } = body

      // Add project
      if (type === 'project') {
        if (!project_name || project_name.trim() === '') {
          return new Response(
            JSON.stringify({ success: false, error: 'project_name is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Check if project already exists
        const { data: existingProject } = await supabaseAdmin
          .from('projects')
          .select('id, project_name')
          .eq('project_name', project_name.trim())
          .maybeSingle()

        if (existingProject) {
          return new Response(
            JSON.stringify({
              success: true,
              data: existingProject,
              message: 'Project already exists',
              already_exists: true
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Create project
        const { data: project, error: projectError } = await supabaseAdmin
          .from('projects')
          .insert({
            project_name: project_name.trim(),
            description: description?.trim() || null,
            status: 'active',
            created_by: user.id
          })
          .select()
          .single()

        if (projectError) throw projectError

        return new Response(
          JSON.stringify({
            success: true,
            data: project,
            message: 'Project created successfully'
          }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Add ticket
      if (type === 'ticket') {
        if (!project_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'project_id is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        if (!ticket_number || ticket_number.trim() === '') {
          return new Response(
            JSON.stringify({ success: false, error: 'ticket_number is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Check if ticket already exists for this project
        const { data: existingTicket } = await supabaseAdmin
          .from('tickets')
          .select(`
            *,
            project:project_id (
              id,
              project_name
            )
          `)
          .eq('project_id', project_id)
          .eq('ticket_number', ticket_number.trim())
          .maybeSingle()

        if (existingTicket) {
          return new Response(
            JSON.stringify({
              success: true,
              data: existingTicket,
              message: 'Ticket already exists for this project',
              already_exists: true
            }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Create ticket
        const { data: ticket, error: ticketError } = await supabaseAdmin
          .from('tickets')
          .insert({
            project_id,
            ticket_number: ticket_number.trim(),
            title: title?.trim() || null,
            description: description?.trim() || null,
            jira_url: jira_url?.trim() || null,
            status: 'open',
            created_by: user.id
          })
          .select(`
            *,
            project:project_id (
              id,
              project_name
            )
          `)
          .single()

        if (ticketError) throw ticketError

        return new Response(
          JSON.stringify({
            success: true,
            data: ticket,
            message: 'Ticket created successfully'
          }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ success: false, error: 'Invalid type. Use "project" or "ticket"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // =====================================================================
    // PUT - Update project or ticket
    // =====================================================================
    if (req.method === 'PUT') {
      const url = new URL(req.url)
      const id = url.searchParams.get('id')
      const type = url.searchParams.get('type') // 'project' or 'ticket'

      if (!id) {
        return new Response(
          JSON.stringify({ success: false, error: 'ID is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (!type) {
        return new Response(
          JSON.stringify({ success: false, error: 'type parameter is required ("project" or "ticket")' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const body = await req.json()

      // Update project
      if (type === 'project') {
        const { project_name, description, status } = body

        // Check if user has permission to update
        const { data: existingProject } = await supabaseAdmin
          .from('projects')
          .select('created_by')
          .eq('id', id)
          .single()

        if (!existingProject) {
          return new Response(
            JSON.stringify({ success: false, error: 'Project not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Only admins and creators can update
        if (employee.role !== 'admin' && existingProject.created_by !== user.id) {
          return new Response(
            JSON.stringify({ success: false, error: 'You do not have permission to update this project' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Build update object
        const updateData: any = {}
        if (project_name !== undefined) updateData.project_name = project_name.trim()
        if (description !== undefined) updateData.description = description?.trim() || null
        if (status !== undefined) {
          if (!['active', 'inactive', 'archived'].includes(status)) {
            return new Response(
              JSON.stringify({ success: false, error: 'Invalid status. Use "active", "inactive", or "archived"' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          }
          updateData.status = status
        }

        if (Object.keys(updateData).length === 0) {
          return new Response(
            JSON.stringify({ success: false, error: 'No fields to update' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Update project
        const { data: project, error: updateError } = await supabaseAdmin
          .from('projects')
          .update(updateData)
          .eq('id', id)
          .select()
          .single()

        if (updateError) throw updateError

        return new Response(
          JSON.stringify({
            success: true,
            data: project,
            message: 'Project updated successfully'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Update ticket
      if (type === 'ticket') {
        const { ticket_number, title, description, jira_url, status } = body

        // Check if user has permission to update
        const { data: existingTicket } = await supabaseAdmin
          .from('tickets')
          .select('created_by')
          .eq('id', id)
          .single()

        if (!existingTicket) {
          return new Response(
            JSON.stringify({ success: false, error: 'Ticket not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Only admins and creators can update
        if (employee.role !== 'admin' && existingTicket.created_by !== user.id) {
          return new Response(
            JSON.stringify({ success: false, error: 'You do not have permission to update this ticket' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Build update object
        const updateData: any = {}
        if (ticket_number !== undefined) updateData.ticket_number = ticket_number.trim()
        if (title !== undefined) updateData.title = title?.trim() || null
        if (description !== undefined) updateData.description = description?.trim() || null
        if (jira_url !== undefined) updateData.jira_url = jira_url?.trim() || null
        if (status !== undefined) {
          if (!['open', 'in_progress', 'completed', 'closed'].includes(status)) {
            return new Response(
              JSON.stringify({ success: false, error: 'Invalid status. Use "open", "in_progress", "completed", or "closed"' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          }
          updateData.status = status
        }

        if (Object.keys(updateData).length === 0) {
          return new Response(
            JSON.stringify({ success: false, error: 'No fields to update' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Update ticket
        const { data: ticket, error: updateError } = await supabaseAdmin
          .from('tickets')
          .update(updateData)
          .eq('id', id)
          .select(`
            *,
            project:project_id (
              id,
              project_name
            )
          `)
          .single()

        if (updateError) throw updateError

        return new Response(
          JSON.stringify({
            success: true,
            data: ticket,
            message: 'Ticket updated successfully'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ success: false, error: 'Invalid type. Use "project" or "ticket"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // =====================================================================
    // DELETE - Delete project or ticket
    // =====================================================================
    if (req.method === 'DELETE') {
      const url = new URL(req.url)
      const id = url.searchParams.get('id')
      const type = url.searchParams.get('type') // 'project' or 'ticket'

      if (!id) {
        return new Response(
          JSON.stringify({ success: false, error: 'ID is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (!type) {
        return new Response(
          JSON.stringify({ success: false, error: 'type parameter is required ("project" or "ticket")' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Delete project
      if (type === 'project') {
        // Check if user has permission to delete
        const { data: existingProject } = await supabaseAdmin
          .from('projects')
          .select('created_by')
          .eq('id', id)
          .single()

        if (!existingProject) {
          return new Response(
            JSON.stringify({ success: false, error: 'Project not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Only admins can delete projects
        if (employee.role !== 'admin') {
          return new Response(
            JSON.stringify({ success: false, error: 'Only admins can delete projects' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Delete project (will cascade delete all tickets due to ON DELETE CASCADE)
        const { error: deleteError } = await supabaseAdmin
          .from('projects')
          .delete()
          .eq('id', id)

        if (deleteError) throw deleteError

        return new Response(
          JSON.stringify({
            success: true,
            message: 'Project deleted successfully'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Delete ticket
      if (type === 'ticket') {
        // Check if user has permission to delete
        const { data: existingTicket } = await supabaseAdmin
          .from('tickets')
          .select('created_by')
          .eq('id', id)
          .single()

        if (!existingTicket) {
          return new Response(
            JSON.stringify({ success: false, error: 'Ticket not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Admins and creators can delete tickets
        if (employee.role !== 'admin' && existingTicket.created_by !== user.id) {
          return new Response(
            JSON.stringify({ success: false, error: 'You do not have permission to delete this ticket' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Delete ticket
        const { error: deleteError } = await supabaseAdmin
          .from('tickets')
          .delete()
          .eq('id', id)

        if (deleteError) throw deleteError

        return new Response(
          JSON.stringify({
            success: true,
            message: 'Ticket deleted successfully'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ success: false, error: 'Invalid type. Use "project" or "ticket"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
