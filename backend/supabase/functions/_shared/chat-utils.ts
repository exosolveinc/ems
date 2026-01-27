// Shared utilities for AI chat functions

import { stringify as yamlStringify } from 'https://deno.land/std@0.208.0/yaml/mod.ts'
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.24.3'

// YAML conversion - uses fewer tokens than JSON
export function toYAML(data: any): string {
  return yamlStringify(data)
}

// Date helpers
export function daysAgo(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString().split('T')[0]
}

export function getCurrentDate(): string {
  return new Date().toISOString().split('T')[0]
}

// Time ranges per feature
export const TIME_RANGES: Record<string, number> = {
  hourly_status: 30,
  timesheet: 90,
  vacation: 365,
  project: 90,
  violations: 90
}

// Check if user is admin or manager
export function isAdminOrManager(role: string): boolean {
  return role === 'admin' || role === 'manager'
}

// Call Claude Haiku API using Anthropic SDK
export async function callHaiku(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }

  const anthropic = new Anthropic({
    apiKey: apiKey
  })

  const response = await anthropic.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userMessage }
    ]
  })

  return response.content[0].type === 'text' ? response.content[0].text : ''
}

// System prompts for each feature
const PROMPT_RULES = `RULES:
- Give DIRECT answers only. No explanations of your process.
- Do NOT list out calculations or reasoning steps.
- Only mention dates that exist in the provided data.
- If data is missing or empty, say "No data found for [time period]".
- If asked about unrelated topics, say "I can only answer questions about this data."
- Keep responses brief (1-3 sentences max).`

export const SYSTEM_PROMPTS: Record<string, (role: string, currentDate: string) => string> = {
  hourly_status: (role, currentDate) => `You analyze hourly work status data.
Today: ${currentDate}
${isAdminOrManager(role) ? `User is ${role}. Can ask about any employee.` : 'Answer only about the user\'s own data.'}
${PROMPT_RULES}`,

  timesheet: (role, currentDate) => `You analyze timesheet/hours data.
Today: ${currentDate}
${isAdminOrManager(role) ? `User is ${role}. Can ask about any employee.` : 'Answer only about the user\'s own data.'}
${PROMPT_RULES}`,

  vacation: (role, currentDate) => `You analyze vacation/leave data.
Today: ${currentDate}
${isAdminOrManager(role) ? `User is ${role}. Can ask about any employee.` : 'Answer only about the user\'s own data.'}
${PROMPT_RULES}`,

  project: (role, currentDate) => `You analyze project and task data.
Today: ${currentDate}
User is ${role}. Can ask about any employee, project, or task.
${PROMPT_RULES}`,

  violations: (role, currentDate) => `You analyze employee violations data.
Today: ${currentDate}
Violation types: late_checkin, early_checkout, no_checkin, no_checkout.
Severity: low, medium, high, critical.
${isAdminOrManager(role) ? `User is ${role}. Can ask about any employee.` : 'Answer only about the user\'s own data.'}
${PROMPT_RULES}`
}
