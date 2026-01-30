import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.24.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
}

// Valid enum values
const TASK_TYPES = ['story', 'bug', 'task', 'epic', 'spike']

// Helper function to build full_name from first_name and last_name if full_name is null
function buildFullName(employee: any): any {
  if (!employee) return employee
  if (employee.full_name === null || employee.full_name === undefined) {
    const firstName = employee.first_name || ''
    const lastName = employee.last_name || ''
    const constructedName = `${firstName} ${lastName}`.trim()
    employee.full_name = constructedName || null
  }
  // Remove first_name and last_name from response to keep it clean
  delete employee.first_name
  delete employee.last_name
  return employee
}

// Apply buildFullName to all employee fields in a task
function processTaskEmployeeNames(task: any): any {
  if (task.assigned_employee) {
    task.assigned_employee = buildFullName(task.assigned_employee)
  }
  if (task.reviewer) {
    task.reviewer = buildFullName(task.reviewer)
  }
  if (task.creator) {
    task.creator = buildFullName(task.creator)
  }
  return task
}
const PRIORITIES = ['critical', 'high', 'medium', 'low']
const STORY_POINTS = [1, 2, 3, 5, 8, 13, 21]
const COMPLEXITIES = ['Low', 'Medium', 'High']
const TASK_STATUSES = ['Backlog', 'Ready', 'In Progress', 'In Review', 'Done']
const PROJECT_STATUSES = ['active', 'inactive', 'archived']

// AI auto-fill for task fields based on title, description, and project context
async function aiAutoFillTaskFields(
  title: string,
  description: string | null,
  projectTechStack: string[]
): Promise<{
  description?: string
  task_type?: string
  priority?: string
  story_points?: number
  complexity?: string
  time_estimation_days?: number
  time_estimation_hours?: number
  time_estimation_minutes?: number
  technology_stack?: string[]
}> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return {}

  try {
    const anthropic = new Anthropic({ apiKey })

    const needsDescription = !description || description.trim() === ''
    const hasProjectTech = projectTechStack.length > 0

    const prompt = `Based on this task title${needsDescription ? '' : ' and description'}, suggest appropriate values for the task fields.

Title: ${title}${needsDescription ? '' : `\nDescription: ${description}`}
${hasProjectTech ? `\nProject's existing technology tags: ${projectTechStack.join(', ')}` : ''}

Respond ONLY with a valid JSON object (no markdown, no explanation) with these fields:
${needsDescription ? '- description: a clear, concise description of what needs to be done (1-2 sentences)\n' : ''}- task_type: one of "story", "bug", "task", "epic", "spike"
- priority: one of "critical", "high", "medium", "low"
- story_points: one of 1, 2, 3, 5, 8, 13, 21 (fibonacci based on effort)
- complexity: one of "Low", "Medium", "High"
- time_estimation_days: integer >= 0
- time_estimation_hours: integer 0-23
- time_estimation_minutes: integer 0-59
- technology_stack: array of technology tags relevant to this task (e.g. ["React", "TypeScript", "PostgreSQL"])

Guidelines:
- "bug" for fixes, errors, issues
- "story" for user-facing features
- "task" for internal work, setup, maintenance
- "epic" for large features spanning multiple tasks
- "spike" for research, investigation, POC
- Time estimation should be realistic based on complexity
- For technology_stack: ${hasProjectTech ? 'prefer tags from the project\'s existing technologies, add new ones only if clearly needed' : 'suggest relevant technologies based on the task'}

Example:
{"task_type":"task","priority":"medium","story_points":3,"complexity":"Medium","time_estimation_days":0,"time_estimation_hours":4,"time_estimation_minutes":30,"technology_stack":["React","TypeScript"]${needsDescription ? ',"description":"Implement the feature as specified"' : ''}}`

    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const parsed = JSON.parse(text.trim())

    // Validate and return only valid values
    const result: any = {}

    if (needsDescription && parsed.description && typeof parsed.description === 'string') {
      result.description = parsed.description.trim()
    }
    if (parsed.task_type && TASK_TYPES.includes(parsed.task_type)) {
      result.task_type = parsed.task_type
    }
    if (parsed.priority && PRIORITIES.includes(parsed.priority)) {
      result.priority = parsed.priority
    }
    if (typeof parsed.story_points === 'number' && STORY_POINTS.includes(parsed.story_points)) {
      result.story_points = parsed.story_points
    }
    if (parsed.complexity && COMPLEXITIES.includes(parsed.complexity)) {
      result.complexity = parsed.complexity
    }
    if (typeof parsed.time_estimation_days === 'number' && parsed.time_estimation_days >= 0) {
      result.time_estimation_days = Math.floor(parsed.time_estimation_days)
    }
    if (typeof parsed.time_estimation_hours === 'number' && parsed.time_estimation_hours >= 0 && parsed.time_estimation_hours < 24) {
      result.time_estimation_hours = Math.floor(parsed.time_estimation_hours)
    }
    if (typeof parsed.time_estimation_minutes === 'number' && parsed.time_estimation_minutes >= 0 && parsed.time_estimation_minutes < 60) {
      result.time_estimation_minutes = Math.floor(parsed.time_estimation_minutes)
    }
    if (Array.isArray(parsed.technology_stack) && parsed.technology_stack.every((t: any) => typeof t === 'string')) {
      result.technology_stack = parsed.technology_stack.map((t: string) => t.trim()).filter((t: string) => t.length > 0)
    }

    return result
  } catch {
    return {}
  }
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
    // GET - Retrieve projects and tasks
    // =====================================================================
    if (req.method === 'GET') {
      const url = new URL(req.url)
      const type = url.searchParams.get('type') // 'projects' or 'tasks'

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

      // Get tasks
      if (type === 'tasks') {
        const projectId = url.searchParams.get('project_id')
        const search = url.searchParams.get('search')
        const status = url.searchParams.get('status')
        const assignedEmployeeId = url.searchParams.get('assigned_employee_id')
        const reviewerId = url.searchParams.get('reviewer_id')
        const taskType = url.searchParams.get('task_type')
        const priority = url.searchParams.get('priority')

        let query = supabaseAdmin
          .from('tasks')
          .select(`
            *,
            project:project_id (
              id,
              project_name
            ),
            assigned_employee:assigned_employee_id (
              id,
              full_name,
              first_name,
              last_name,
              email,
              employee_id,
              profile_image_url
            ),
            reviewer:reviewer_id (
              id,
              full_name,
              first_name,
              last_name,
              email,
              employee_id,
              profile_image_url
            ),
            creator:created_by (
              id,
              full_name,
              first_name,
              last_name,
              email,
              employee_id
            )
          `)

        if (projectId) {
          query = query.eq('project_id', projectId)
        }

        if (status && status !== 'all') {
          query = query.eq('status', status)
        }

        if (assignedEmployeeId) {
          query = query.eq('assigned_employee_id', assignedEmployeeId)
        }

        if (reviewerId) {
          query = query.eq('reviewer_id', reviewerId)
        }

        if (taskType) {
          query = query.eq('task_type', taskType)
        }

        if (priority) {
          query = query.eq('priority', priority)
        }

        if (search) {
          query = query.or(`ticket_number.ilike.%${search}%,title.ilike.%${search}%,description.ilike.%${search}%`)
        }

        query = query.order('created_at', { ascending: false })

        const { data, error } = await query

        if (error) throw error

        // Generate signed URLs for file attachments and process employee names
        const tasksWithSignedUrls = await Promise.all(
          (data || []).map(async (task: any) => {
            // Process employee names to build full_name from first_name/last_name if needed
            processTaskEmployeeNames(task)

            if (task.file_urls && task.file_urls.length > 0) {
              const fileAttachments = await Promise.all(
                task.file_urls.map(async (filePath: string) => {
                  const { data: signedUrlData } = await supabaseAdmin
                    .storage
                    .from('task-attachments')
                    .createSignedUrl(filePath, 3600) // 1 hour expiry

                  // Extract filename from path
                  const fileName = filePath.split('/').pop() || filePath

                  return {
                    file_path: filePath,
                    file_name: fileName,
                    signed_url: signedUrlData?.signedUrl || null
                  }
                })
              )
              return { ...task, file_attachments: fileAttachments }
            }
            return { ...task, file_attachments: [] }
          })
        )

        return new Response(
          JSON.stringify({
            success: true,
            data: tasksWithSignedUrls,
            type: 'tasks'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ success: false, error: 'Invalid type parameter. Use "projects" or "tasks"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // =====================================================================
    // POST - Add project or task
    // =====================================================================
    if (req.method === 'POST') {
      const body = await req.json()
      const { type } = body

      // Add project
      if (type === 'project') {
        const { project_name, description } = body

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

      // Upload file to task
      if (type === 'upload') {
        const { task_id, file_name, file_data, content_type } = body

        if (!task_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'task_id is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        if (!file_name || !file_data || !content_type) {
          return new Response(
            JSON.stringify({ success: false, error: 'file_name, file_data (base64), and content_type are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Validate content type
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
        if (!allowedTypes.includes(content_type)) {
          return new Response(
            JSON.stringify({ success: false, error: `Invalid content_type. Allowed: ${allowedTypes.join(', ')}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Check if task exists and user has access
        const { data: task } = await supabaseAdmin
          .from('tasks')
          .select('id, file_urls, created_by, assigned_employee_id, reviewer_id')
          .eq('id', task_id)
          .single()

        if (!task) {
          return new Response(
            JSON.stringify({ success: false, error: 'Task not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Check permission
        const canUpload =
          employee.role === 'admin' ||
          employee.role === 'manager' ||
          task.created_by === user.id ||
          task.assigned_employee_id === user.id ||
          task.reviewer_id === user.id

        if (!canUpload) {
          return new Response(
            JSON.stringify({ success: false, error: 'You do not have permission to upload files to this task' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Decode base64 file data
        const binaryData = Uint8Array.from(atob(file_data), c => c.charCodeAt(0))

        // Generate unique file path: task-attachments/{task_id}/{timestamp}_{filename}
        const timestamp = Date.now()
        const sanitizedFileName = file_name.replace(/[^a-zA-Z0-9.-]/g, '_')
        const filePath = `${task_id}/${timestamp}_${sanitizedFileName}`

        // Upload to Supabase Storage
        const { error: uploadError } = await supabaseAdmin
          .storage
          .from('task-attachments')
          .upload(filePath, binaryData, {
            contentType: content_type,
            upsert: false
          })

        if (uploadError) throw uploadError

        // Update task with new file URL
        const existingUrls = task.file_urls || []
        const newFileUrls = [...existingUrls, filePath] // Store path, not full URL

        const { error: updateError } = await supabaseAdmin
          .from('tasks')
          .update({ file_urls: newFileUrls })
          .eq('id', task_id)
          .select()
          .single()

        if (updateError) throw updateError

        return new Response(
          JSON.stringify({
            success: true,
            data: {
              file_path: filePath,
              file_name: sanitizedFileName,
              content_type,
              task_id
            },
            message: 'File uploaded successfully'
          }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Delete file from task
      if (type === 'delete_file') {
        const { task_id, file_path } = body

        if (!task_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'task_id is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        if (!file_path) {
          return new Response(
            JSON.stringify({ success: false, error: 'file_path is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Check if task exists and user has access
        const { data: task } = await supabaseAdmin
          .from('tasks')
          .select('id, file_urls, created_by, assigned_employee_id, reviewer_id')
          .eq('id', task_id)
          .single()

        if (!task) {
          return new Response(
            JSON.stringify({ success: false, error: 'Task not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Check permission
        const canDelete =
          employee.role === 'admin' ||
          employee.role === 'manager' ||
          task.created_by === user.id ||
          task.assigned_employee_id === user.id ||
          task.reviewer_id === user.id

        if (!canDelete) {
          return new Response(
            JSON.stringify({ success: false, error: 'You do not have permission to delete files from this task' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Check if file exists in task
        const existingUrls = task.file_urls || []
        if (!existingUrls.includes(file_path)) {
          return new Response(
            JSON.stringify({ success: false, error: 'File not found in task' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Delete from storage
        const { error: deleteStorageError } = await supabaseAdmin
          .storage
          .from('task-attachments')
          .remove([file_path])

        if (deleteStorageError) throw deleteStorageError

        // Update task to remove file URL
        const newFileUrls = existingUrls.filter((url: string) => url !== file_path)

        const { error: updateError } = await supabaseAdmin
          .from('tasks')
          .update({ file_urls: newFileUrls })
          .eq('id', task_id)
          .select()
          .single()

        if (updateError) throw updateError

        return new Response(
          JSON.stringify({
            success: true,
            message: 'File deleted successfully'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Get signed URL for file download
      if (type === 'get_file_url') {
        const { task_id, file_path } = body

        if (!task_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'task_id is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        if (!file_path) {
          return new Response(
            JSON.stringify({ success: false, error: 'file_path is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Check if task exists
        const { data: task } = await supabaseAdmin
          .from('tasks')
          .select('id, file_urls')
          .eq('id', task_id)
          .single()

        if (!task) {
          return new Response(
            JSON.stringify({ success: false, error: 'Task not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Check if file exists in task
        const existingUrls = task.file_urls || []
        if (!existingUrls.includes(file_path)) {
          return new Response(
            JSON.stringify({ success: false, error: 'File not found in task' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Generate signed URL (valid for 1 hour)
        const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin
          .storage
          .from('task-attachments')
          .createSignedUrl(file_path, 3600) // 1 hour expiry

        if (signedUrlError) throw signedUrlError

        return new Response(
          JSON.stringify({
            success: true,
            data: {
              signed_url: signedUrlData.signedUrl,
              expires_in: 3600
            }
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Add task
      if (type === 'task') {
        const {
          task_type,
          title,
          description,
          ticket_number,
          project_id,
          priority,
          story_points,
          complexity,
          status: taskStatus,
          assigned_employee_id,
          reviewer_id,
          technology_stack,
          time_estimation_days,
          time_estimation_hours,
          time_estimation_minutes,
          file_urls,
          link_url
        } = body

        // Validate required fields
        // task_type is optional - AI will auto-fill if not provided
        if (task_type && !TASK_TYPES.includes(task_type)) {
          return new Response(
            JSON.stringify({ success: false, error: `Invalid task_type. Use one of: ${TASK_TYPES.join(', ')}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        if (!title || title.trim() === '') {
          return new Response(
            JSON.stringify({ success: false, error: 'title is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        if (!ticket_number || ticket_number.trim() === '') {
          return new Response(
            JSON.stringify({ success: false, error: 'ticket_number is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        if (!project_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'project_id is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Validate optional enum fields
        if (priority && !PRIORITIES.includes(priority)) {
          return new Response(
            JSON.stringify({ success: false, error: `Invalid priority. Use one of: ${PRIORITIES.join(', ')}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        if (story_points !== undefined && story_points !== null && !STORY_POINTS.includes(story_points)) {
          return new Response(
            JSON.stringify({ success: false, error: `Invalid story_points. Use one of: ${STORY_POINTS.join(', ')}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        if (complexity && !COMPLEXITIES.includes(complexity)) {
          return new Response(
            JSON.stringify({ success: false, error: `Invalid complexity. Use one of: ${COMPLEXITIES.join(', ')}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        if (taskStatus && !TASK_STATUSES.includes(taskStatus)) {
          return new Response(
            JSON.stringify({ success: false, error: `Invalid status. Use one of: ${TASK_STATUSES.join(', ')}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Validate time estimation values
        if (time_estimation_hours !== undefined && (time_estimation_hours < 0 || time_estimation_hours >= 24)) {
          return new Response(
            JSON.stringify({ success: false, error: 'time_estimation_hours must be between 0 and 23' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        if (time_estimation_minutes !== undefined && (time_estimation_minutes < 0 || time_estimation_minutes >= 60)) {
          return new Response(
            JSON.stringify({ success: false, error: 'time_estimation_minutes must be between 0 and 59' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Check if task already exists for this project
        const { data: existingTask } = await supabaseAdmin
          .from('tasks')
          .select('id, ticket_number')
          .eq('project_id', project_id)
          .eq('ticket_number', ticket_number.trim())
          .maybeSingle()

        if (existingTask) {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'A task with this ticket number already exists for this project',
              already_exists: true
            }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // AI auto-fill: if title provided and optional fields are empty, use AI to suggest values
        let aiSuggestions: any = {}
        const needsAiFill = title && (
          !description ||
          !task_type ||
          !priority ||
          story_points === undefined ||
          !complexity ||
          time_estimation_days === undefined ||
          time_estimation_hours === undefined ||
          time_estimation_minutes === undefined ||
          !technology_stack || technology_stack.length === 0
        )

        if (needsAiFill) {
          // Fetch project's existing technology tags from other tasks
          const { data: projectTasks } = await supabaseAdmin
            .from('tasks')
            .select('technology_stack')
            .eq('project_id', project_id)
            .not('technology_stack', 'eq', '{}')
            .limit(20)

          // Collect unique tech tags from project
          const projectTechStack = [...new Set(
            (projectTasks || [])
              .flatMap((t: any) => t.technology_stack || [])
              .filter((tag: string) => tag && tag.trim())
          )] as string[]

          aiSuggestions = await aiAutoFillTaskFields(title, description || null, projectTechStack)
        }

        // Create task (AI suggestions fill empty fields only)
        const { data: task, error: taskError } = await supabaseAdmin
          .from('tasks')
          .insert({
            task_type: task_type || aiSuggestions.task_type || 'task',
            title: title.trim(),
            description: description?.trim() || aiSuggestions.description || null,
            ticket_number: ticket_number.trim(),
            project_id,
            priority: priority || aiSuggestions.priority || 'medium',
            story_points: story_points ?? aiSuggestions.story_points ?? null,
            complexity: complexity || aiSuggestions.complexity || null,
            status: taskStatus || 'Backlog',
            assigned_employee_id: assigned_employee_id || user.id, // Default to creator if not assigned
            reviewer_id: reviewer_id || user.id, // Default to current user as reviewer
            technology_stack: (technology_stack && technology_stack.length > 0) ? technology_stack : (aiSuggestions.technology_stack || []),
            time_estimation_days: time_estimation_days ?? aiSuggestions.time_estimation_days ?? 0,
            time_estimation_hours: time_estimation_hours ?? aiSuggestions.time_estimation_hours ?? 0,
            time_estimation_minutes: time_estimation_minutes ?? aiSuggestions.time_estimation_minutes ?? 0,
            file_urls: file_urls || [],
            link_url: link_url?.trim() || null,
            created_by: user.id
          })
          .select(`
            *,
            project:project_id (
              id,
              project_name
            ),
            assigned_employee:assigned_employee_id (
              id,
              full_name,
              first_name,
              last_name,
              email,
              employee_id,
              profile_image_url
            ),
            reviewer:reviewer_id (
              id,
              full_name,
              first_name,
              last_name,
              email,
              employee_id,
              profile_image_url
            ),
            creator:created_by (
              id,
              full_name,
              first_name,
              last_name,
              email,
              employee_id
            )
          `)
          .single()

        if (taskError) throw taskError

        // Process employee names
        processTaskEmployeeNames(task)

        return new Response(
          JSON.stringify({
            success: true,
            data: task,
            message: 'Task created successfully'
          }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ success: false, error: 'Invalid type. Use "project" or "task"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // =====================================================================
    // PUT - Update project or task
    // =====================================================================
    if (req.method === 'PUT') {
      const url = new URL(req.url)
      const id = url.searchParams.get('id')
      const type = url.searchParams.get('type') // 'project' or 'task'

      if (!id) {
        return new Response(
          JSON.stringify({ success: false, error: 'ID is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (!type) {
        return new Response(
          JSON.stringify({ success: false, error: 'type parameter is required ("project" or "task")' }),
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
          if (!PROJECT_STATUSES.includes(status)) {
            return new Response(
              JSON.stringify({ success: false, error: `Invalid status. Use one of: ${PROJECT_STATUSES.join(', ')}` }),
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

      // Update task
      if (type === 'task') {
        const {
          task_type,
          title,
          description,
          ticket_number,
          priority,
          story_points,
          complexity,
          status: taskStatus,
          assigned_employee_id,
          reviewer_id,
          technology_stack,
          time_estimation_days,
          time_estimation_hours,
          time_estimation_minutes,
          file_urls,
          link_url
        } = body

        // Check if user has permission to update
        const { data: existingTask } = await supabaseAdmin
          .from('tasks')
          .select('created_by, assigned_employee_id, reviewer_id')
          .eq('id', id)
          .single()

        if (!existingTask) {
          return new Response(
            JSON.stringify({ success: false, error: 'Task not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Admins, managers, creators, assignees, and reviewers can update
        const canUpdate =
          employee.role === 'admin' ||
          employee.role === 'manager' ||
          existingTask.created_by === user.id ||
          existingTask.assigned_employee_id === user.id ||
          existingTask.reviewer_id === user.id

        if (!canUpdate) {
          return new Response(
            JSON.stringify({ success: false, error: 'You do not have permission to update this task' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Build update object
        const updateData: any = {}

        if (task_type !== undefined) {
          if (!TASK_TYPES.includes(task_type)) {
            return new Response(
              JSON.stringify({ success: false, error: `Invalid task_type. Use one of: ${TASK_TYPES.join(', ')}` }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          }
          updateData.task_type = task_type
        }

        if (title !== undefined) updateData.title = title.trim()
        if (description !== undefined) updateData.description = description?.trim() || null
        if (ticket_number !== undefined) updateData.ticket_number = ticket_number.trim()

        if (priority !== undefined) {
          if (!PRIORITIES.includes(priority)) {
            return new Response(
              JSON.stringify({ success: false, error: `Invalid priority. Use one of: ${PRIORITIES.join(', ')}` }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          }
          updateData.priority = priority
        }

        if (story_points !== undefined) {
          if (story_points !== null && !STORY_POINTS.includes(story_points)) {
            return new Response(
              JSON.stringify({ success: false, error: `Invalid story_points. Use one of: ${STORY_POINTS.join(', ')}` }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          }
          updateData.story_points = story_points
        }

        if (complexity !== undefined) {
          if (complexity !== null && !COMPLEXITIES.includes(complexity)) {
            return new Response(
              JSON.stringify({ success: false, error: `Invalid complexity. Use one of: ${COMPLEXITIES.join(', ')}` }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          }
          updateData.complexity = complexity
        }

        if (taskStatus !== undefined) {
          if (!TASK_STATUSES.includes(taskStatus)) {
            return new Response(
              JSON.stringify({ success: false, error: `Invalid status. Use one of: ${TASK_STATUSES.join(', ')}` }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          }
          updateData.status = taskStatus
        }

        if (assigned_employee_id !== undefined) updateData.assigned_employee_id = assigned_employee_id
        if (reviewer_id !== undefined) updateData.reviewer_id = reviewer_id
        if (technology_stack !== undefined) updateData.technology_stack = technology_stack

        if (time_estimation_days !== undefined) {
          if (time_estimation_days < 0) {
            return new Response(
              JSON.stringify({ success: false, error: 'time_estimation_days must be >= 0' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          }
          updateData.time_estimation_days = time_estimation_days
        }

        if (time_estimation_hours !== undefined) {
          if (time_estimation_hours < 0 || time_estimation_hours >= 24) {
            return new Response(
              JSON.stringify({ success: false, error: 'time_estimation_hours must be between 0 and 23' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          }
          updateData.time_estimation_hours = time_estimation_hours
        }

        if (time_estimation_minutes !== undefined) {
          if (time_estimation_minutes < 0 || time_estimation_minutes >= 60) {
            return new Response(
              JSON.stringify({ success: false, error: 'time_estimation_minutes must be between 0 and 59' }),
              { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
          }
          updateData.time_estimation_minutes = time_estimation_minutes
        }

        if (file_urls !== undefined) updateData.file_urls = file_urls
        if (link_url !== undefined) updateData.link_url = link_url?.trim() || null

        if (Object.keys(updateData).length === 0) {
          return new Response(
            JSON.stringify({ success: false, error: 'No fields to update' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Update task
        const { data: task, error: updateError } = await supabaseAdmin
          .from('tasks')
          .update(updateData)
          .eq('id', id)
          .select(`
            *,
            project:project_id (
              id,
              project_name
            ),
            assigned_employee:assigned_employee_id (
              id,
              full_name,
              first_name,
              last_name,
              email,
              employee_id,
              profile_image_url
            ),
            reviewer:reviewer_id (
              id,
              full_name,
              first_name,
              last_name,
              email,
              employee_id,
              profile_image_url
            ),
            creator:created_by (
              id,
              full_name,
              first_name,
              last_name,
              email,
              employee_id
            )
          `)
          .single()

        if (updateError) throw updateError

        // Process employee names
        processTaskEmployeeNames(task)

        return new Response(
          JSON.stringify({
            success: true,
            data: task,
            message: 'Task updated successfully'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ success: false, error: 'Invalid type. Use "project" or "task"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // =====================================================================
    // DELETE - Delete project or task
    // =====================================================================
    if (req.method === 'DELETE') {
      const url = new URL(req.url)
      const id = url.searchParams.get('id')
      const type = url.searchParams.get('type') // 'project' or 'task'

      if (!id) {
        return new Response(
          JSON.stringify({ success: false, error: 'ID is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (!type) {
        return new Response(
          JSON.stringify({ success: false, error: 'type parameter is required ("project" or "task")' }),
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

        // Delete project (will cascade delete all tasks due to ON DELETE CASCADE)
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

      // Delete task
      if (type === 'task') {
        // Check if user has permission to delete
        const { data: existingTask } = await supabaseAdmin
          .from('tasks')
          .select('created_by, reviewer_id')
          .eq('id', id)
          .single()

        if (!existingTask) {
          return new Response(
            JSON.stringify({ success: false, error: 'Task not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Admins, managers, creators, and reviewers can delete tasks
        const canDelete =
          employee.role === 'admin' ||
          employee.role === 'manager' ||
          existingTask.created_by === user.id ||
          existingTask.reviewer_id === user.id

        if (!canDelete) {
          return new Response(
            JSON.stringify({ success: false, error: 'You do not have permission to delete this task' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }

        // Delete task
        const { error: deleteError } = await supabaseAdmin
          .from('tasks')
          .delete()
          .eq('id', id)

        if (deleteError) throw deleteError

        return new Response(
          JSON.stringify({
            success: true,
            message: 'Task deleted successfully'
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({ success: false, error: 'Invalid type. Use "project" or "task"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error', details: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
