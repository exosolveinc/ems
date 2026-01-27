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
   ### Select 1 hygwacgmveeipjrybqip for ems

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
