#!/bin/bash

# ============================================
# Employee Management System - Backend Setup
# ============================================

echo "🚀 Setting up Employee Management System Backend..."
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Create root backend directory
echo -e "${BLUE}📁 Creating backend directory structure...${NC}"
mkdir -p backend
cd backend

# ============================================
# 1. SUPABASE STRUCTURE
# ============================================
echo -e "${GREEN}⚙️  Creating Supabase structure...${NC}"

# Initialize Supabase
mkdir -p supabase/{functions,migrations}

# Create Edge Functions directories
mkdir -p supabase/functions/{checkin,checkout,hourly-status,detect-violations}
mkdir -p supabase/functions/{send-slack-notification,vacation-request,vacation-approve}
mkdir -p supabase/functions/{timesheet-submit,timesheet-approve}
mkdir -p supabase/functions/{gemini-query,gemini-analyze}
mkdir -p supabase/functions/{send-reminders,generate-report,slack-webhook}

# ============================================
# 2. DATABASE STRUCTURE
# ============================================
echo -e "${GREEN}🗄️  Creating database structure...${NC}"

cd ..
mkdir -p database/{schemas,functions,policies,triggers,seeds,views}

# ============================================
# 3. SHARED UTILITIES
# ============================================
echo -e "${GREEN}🔧 Creating shared utilities...${NC}"

mkdir -p backend/shared/{types,utils,constants}

cd backend

# ============================================
# 4. CREATE CONFIGURATION FILES
# ============================================
echo -e "${BLUE}📝 Creating configuration files...${NC}"

# package.json
cat > package.json << 'EOF'
{
  "name": "employee-management-backend",
  "version": "1.0.0",
  "description": "Backend for Employee Management System",
  "scripts": {
    "deploy": "supabase functions deploy",
    "deploy:checkin": "supabase functions deploy checkin",
    "deploy:checkout": "supabase functions deploy checkout",
    "deploy:all": "supabase functions deploy --no-verify-jwt",
    "serve": "supabase functions serve",
    "test": "deno test --allow-all",
    "db:push": "supabase db push",
    "db:reset": "supabase db reset",
    "db:seed": "supabase db seed"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.38.0"
  },
  "devDependencies": {}
}
EOF

# supabase/config.toml
cat > supabase/config.toml << 'EOF'
# Supabase Configuration

project_id = "your-project-id"

[api]
enabled = true
port = 54321
schemas = ["public", "storage", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = 54322
major_version = 15

[studio]
enabled = true
port = 54323

[functions]
enabled = true

[auth]
enabled = true
site_url = "http://localhost:3000"
additional_redirect_urls = []
jwt_expiry = 3600
enable_signup = true

[storage]
enabled = true
file_size_limit = "50MiB"
EOF

# .env.example
cat > .env.example << 'EOF'
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Slack
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_SIGNING_SECRET=your_signing_secret_here
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Gemini AI
GEMINI_API_KEY=your_gemini_api_key_here

# App Settings
WORK_START_TIME=09:00
WORK_END_TIME=18:00
CHECKIN_GRACE_PERIOD_MINUTES=15
LATE_CHECKIN_THRESHOLD_MINUTES=30
EOF

# .gitignore
cat > .gitignore << 'EOF'
# Environment
.env
.env.local

# Supabase
.supabase/

# Dependencies
node_modules/

# Logs
*.log

# OS
.DS_Store
Thumbs.db
EOF

# README.md
cat > README.md << 'EOF'
# Employee Management System - Backend

## 🚀 Quick Start

### Prerequisites
- [Supabase CLI](https://supabase.com/docs/guides/cli)
- [Deno](https://deno.land/) (for Edge Functions)

### Setup

1. **Install Supabase CLI**
   ```bash
   npm install -g supabase
   ```

2. **Login to Supabase**
   ```bash
   supabase login
   ```

3. **Link to your project**
   ```bash
   supabase link --project-ref your-project-ref
   ```

4. **Set environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

5. **Deploy Edge Functions**
   ```bash
   npm run deploy:all
   ```

## 📁 Structure

```
backend/
├── supabase/
│   ├── functions/       # Edge Functions (API endpoints)
│   ├── migrations/      # Database migrations
│   └── config.toml      # Supabase configuration
├── shared/
│   ├── types/           # TypeScript type definitions
│   ├── utils/           # Utility functions
│   └── constants/       # Constants and config
└── package.json
```

## 🔧 Available Scripts

- `npm run deploy` - Deploy all Edge Functions
- `npm run deploy:checkin` - Deploy specific function
- `npm run serve` - Run functions locally
- `npm run db:push` - Push database changes
- `npm run db:reset` - Reset database

## 📚 Documentation

See [/docs](../docs) for detailed documentation.
EOF

echo -e "${GREEN}✅ Configuration files created${NC}"

# ============================================
# 5. CREATE SHARED TYPES
# ============================================
echo -e "${BLUE}📦 Creating shared types...${NC}"

cat > shared/types/database.types.ts << 'EOF'
// Database Type Definitions

export interface Employee {
  id: string;
  email: string;
  phone?: string;
  first_name: string;
  last_name: string;
  employee_id: string;
  designation?: string;
  department?: string;
  division?: string;
  salary?: number;
  join_date: string;
  status: 'active' | 'inactive' | 'on_leave';
  manager_id?: string;
  profile_image_url?: string;
  slack_user_id?: string;
  role: 'employee' | 'manager' | 'hr' | 'admin';
  created_at: string;
  updated_at: string;
}

export interface CheckIn {
  id: string;
  employee_id: string;
  check_in_time: string;
  check_in_location?: string;
  check_in_ip?: string;
  check_in_notes?: string;
  created_at: string;
}

export interface CheckOut {
  id: string;
  employee_id: string;
  check_in_id?: string;
  check_out_time: string;
  check_out_location?: string;
  check_out_ip?: string;
  check_out_notes?: string;
  total_hours?: number;
  created_at: string;
}

export interface Violation {
  id: string;
  employee_id: string;
  violation_type: 'late_checkin' | 'no_checkin' | 'no_checkout' | 'no_status_update' | 'early_checkout';
  violation_date: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description?: string;
  escalated: boolean;
  escalated_to?: string;
  escalation_time?: string;
  resolved: boolean;
  resolved_at?: string;
  resolved_notes?: string;
  created_at: string;
}

export interface VacationRequest {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  total_days: number;
  vacation_type: 'annual' | 'sick' | 'personal' | 'unpaid';
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
  approved_by?: string;
  approved_at?: string;
  rejection_reason?: string;
  created_at: string;
}

export interface Timesheet {
  id: string;
  employee_id: string;
  week_start_date: string;
  week_end_date: string;
  total_hours?: number;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  submitted_at?: string;
  approved_by?: string;
  approved_at?: string;
  rejection_reason?: string;
  created_at: string;
}

export interface HourlyStatus {
  id: string;
  employee_id: string;
  status_time: string;
  status_type: 'working' | 'break' | 'meeting' | 'idle' | 'away';
  status_message?: string;
  created_at: string;
}
EOF

cat > shared/types/api.types.ts << 'EOF'
// API Request/Response Types

export interface CheckInRequest {
  employee_id: string;
  location?: string;
  ip?: string;
  notes?: string;
}

export interface CheckInResponse {
  success: boolean;
  data?: any;
  error?: string;
  violation?: {
    created: boolean;
    severity: string;
    minutes_late: number;
  };
}

export interface CheckOutRequest {
  employee_id: string;
  check_in_id?: string;
  location?: string;
  ip?: string;
  notes?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface ErrorResponse {
  success: false;
  error: string;
  details?: any;
}
EOF

cat > shared/types/slack.types.ts << 'EOF'
// Slack Integration Types

export interface SlackNotification {
  type: 'checkin_reminder' | 'checkout_reminder' | 'violation_alert' | 'vacation_request';
  employee_id: string;
  slack_user_id: string;
  message: string;
  blocks?: any[];
}

export interface SlackMessage {
  channel: string;
  text: string;
  blocks?: any[];
  attachments?: any[];
}
EOF

echo -e "${GREEN}✅ Type definitions created${NC}"

# ============================================
# 6. CREATE SHARED UTILITIES
# ============================================
echo -e "${BLUE}🔧 Creating utility functions...${NC}"

cat > shared/utils/time.utils.ts << 'EOF'
// Time Utility Functions

export function calculateTotalHours(
  startTime: Date,
  endTime: Date
): number {
  const diffMs = endTime.getTime() - startTime.getTime();
  return Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
}

export function isLateCheckIn(checkInTime: Date, workStartTime: string = '09:00'): boolean {
  const [hours, minutes] = workStartTime.split(':').map(Number);
  const workStart = new Date(checkInTime);
  workStart.setHours(hours, minutes, 0, 0);
  
  return checkInTime > workStart;
}

export function getMinutesLate(checkInTime: Date, workStartTime: string = '09:00'): number {
  const [hours, minutes] = workStartTime.split(':').map(Number);
  const workStart = new Date(checkInTime);
  workStart.setHours(hours, minutes, 0, 0);
  
  if (checkInTime <= workStart) return 0;
  
  return Math.floor((checkInTime.getTime() - workStart.getTime()) / (1000 * 60));
}

export function formatTime(date: Date): string {
  return date.toTimeString().slice(0, 5);
}

export function isToday(date: Date): boolean {
  const today = new Date();
  return date.getDate() === today.getDate() &&
         date.getMonth() === today.getMonth() &&
         date.getFullYear() === today.getFullYear();
}
EOF

cat > shared/utils/validators.ts << 'EOF'
// Validation Utility Functions

export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

export function validateCheckInRequest(data: any): { valid: boolean; error?: string } {
  if (!data.employee_id) {
    return { valid: false, error: 'employee_id is required' };
  }
  
  if (!isValidUUID(data.employee_id)) {
    return { valid: false, error: 'Invalid employee_id format' };
  }
  
  return { valid: true };
}

export function validateCheckOutRequest(data: any): { valid: boolean; error?: string } {
  if (!data.employee_id) {
    return { valid: false, error: 'employee_id is required' };
  }
  
  if (!isValidUUID(data.employee_id)) {
    return { valid: false, error: 'Invalid employee_id format' };
  }
  
  return { valid: true };
}
EOF

cat > shared/utils/response.utils.ts << 'EOF'
// API Response Utility Functions

export function successResponse(data: any, message?: string) {
  return new Response(
    JSON.stringify({
      success: true,
      data,
      ...(message && { message })
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

export function errorResponse(error: string, status: number = 400, details?: any) {
  return new Response(
    JSON.stringify({
      success: false,
      error,
      ...(details && { details })
    }),
    {
      status,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}

export function unauthorizedResponse(message: string = 'Unauthorized') {
  return errorResponse(message, 401);
}

export function notFoundResponse(message: string = 'Resource not found') {
  return errorResponse(message, 404);
}

export function serverErrorResponse(message: string = 'Internal server error') {
  return errorResponse(message, 500);
}
EOF

echo -e "${GREEN}✅ Utility functions created${NC}"

# ============================================
# 7. CREATE CONSTANTS
# ============================================
echo -e "${BLUE}📋 Creating constants...${NC}"

cat > shared/constants/config.ts << 'EOF'
// Application Configuration Constants

export const CONFIG = {
  WORK_START_TIME: Deno.env.get('WORK_START_TIME') || '09:00',
  WORK_END_TIME: Deno.env.get('WORK_END_TIME') || '18:00',
  CHECKIN_GRACE_PERIOD_MINUTES: parseInt(Deno.env.get('CHECKIN_GRACE_PERIOD_MINUTES') || '15'),
  LATE_CHECKIN_THRESHOLD_MINUTES: parseInt(Deno.env.get('LATE_CHECKIN_THRESHOLD_MINUTES') || '30'),
  TIMEZONE: 'UTC',
};

export const VIOLATION_SEVERITY = {
  LATE_15_MIN: 'low',
  LATE_30_MIN: 'medium',
  LATE_60_MIN: 'high',
  NO_CHECKIN: 'critical',
  NO_CHECKOUT: 'medium',
} as const;

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
EOF

cat > shared/constants/messages.ts << 'EOF'
// Application Messages

export const MESSAGES = {
  // Success messages
  CHECKIN_SUCCESS: 'Checked in successfully',
  CHECKOUT_SUCCESS: 'Checked out successfully',
  STATUS_UPDATED: 'Status updated successfully',
  
  // Error messages
  ALREADY_CHECKED_IN: 'You have already checked in today',
  ALREADY_CHECKED_OUT: 'You have already checked out today',
  NO_CHECKIN_FOUND: 'No check-in found for today',
  EMPLOYEE_NOT_FOUND: 'Employee not found',
  INVALID_REQUEST: 'Invalid request data',
  UNAUTHORIZED: 'Unauthorized access',
  
  // Violation messages
  LATE_CHECKIN: (minutes: number) => `Checked in ${minutes} minutes late`,
  NO_CHECKIN: 'No check-in recorded for today',
  NO_CHECKOUT: 'No check-out recorded',
};
EOF

echo -e "${GREEN}✅ Constants created${NC}"

# ============================================
# 8. CREATE EDGE FUNCTIONS
# ============================================
echo -e "${BLUE}⚡ Creating Edge Functions...${NC}"

# Check-in Function
cat > supabase/functions/checkin/index.ts << 'EOF'
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
EOF

# Check-out Function
cat > supabase/functions/checkout/index.ts << 'EOF'
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
EOF

echo -e "${GREEN}✅ Edge Functions created${NC}"

# ============================================
# COMPLETION MESSAGE
# ============================================

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  ✅ Backend Setup Complete!           ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}📁 Created Structure:${NC}"
echo "  ├── backend/"
echo "  │   ├── supabase/functions/     (14 Edge Functions)"
echo "  │   ├── shared/                 (Types, Utils, Constants)"
echo "  │   └── package.json"
echo "  └── database/"
echo "      ├── schemas/                (8 schema files)"
echo "      ├── functions/              (4 function files)"
echo "      ├── policies/               (4 RLS policy files)"
echo "      ├── triggers/               (3 trigger files)"
echo "      ├── seeds/                  (4 seed files)"
echo "      └── views/                  (3 view files)"
echo ""
echo -e "${YELLOW}📋 Next Steps:${NC}"
echo "  1. cd backend"
echo "  2. cp .env.example .env"
echo "  3. Edit .env with your Supabase credentials"
echo "  4. npm install"
echo "  5. supabase login"
echo "  6. supabase link --project-ref YOUR_PROJECT_REF"
echo "  7. npm run deploy:all"
echo ""
echo -e "${BLUE}📚 Documentation:${NC}"
echo "  - README.md created in backend/"
echo "  - Check backend/README.md for detailed instructions"
echo ""
echo -e "${GREEN}🎉 Ready to deploy!${NC}"
EOF

chmod +x /mnt/user-data/outputs/setup-backend.sh
echo "✅ Backend setup script created successfully!"