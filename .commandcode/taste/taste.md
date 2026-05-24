# supabase
- Before writing Supabase queries, read the actual database schema — never guess column names, relationship table names, or join structures. Confidence: 0.85
- Never throw Supabase errors in public-facing pages. All queries must return safe fallbacks: `[]` for list queries, `null` for detail queries, and log errors with console.error. Homepage must always render fallback data on query failure. Confidence: 0.85

# ui
- Hide recommendation/book count badges on cards when the value is 0 or null — never render "0 recs" or "0 books". Confidence: 0.70
- Never show a book cover image that does not match the book title. Fallback data covers must match their titles, or use a neutral placeholder instead. Confidence: 0.70

# design
- Design theme: purple accent color, warm background tones, rounded cards, editorial typography style. Confidence: 0.75

# workflow
- When a Figma URL cannot be accessed, provide detailed text design specs proactively — do not ask the user for screenshots or workarounds. Confidence: 0.65
