# supabase
- Before writing Supabase queries, read the actual database schema — never guess column names, relationship table names, or join structures. Confidence: 0.85
- Never throw Supabase errors in public-facing pages. All queries must return safe fallbacks: `[]` for list queries, `null` for detail queries, and log errors with console.error. Homepage must always render fallback data on query failure. Confidence: 0.85

# workflow
- When a Figma URL cannot be accessed, provide detailed text design specs proactively — do not ask the user for screenshots or workarounds. Confidence: 0.65
