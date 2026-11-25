# BookRecs

Discover books recommended by the people you admire. A Next.js + Supabase pSEO book discovery website.

## Setup

```bash
npm install
cp .env.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_SITE_URL
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon/public key |
| `NEXT_PUBLIC_SITE_URL` | No | Canonical site URL (defaults to `https://bookrecommendations.com`) |

## Tech Stack

- **Next.js 16** (App Router)
- **TypeScript**
- **Tailwind CSS v4**
- **Supabase** (data layer)

## Deployment

```bash
npm run build
npm start
```

Production (bookmentions.net) runs on **Openship on a Netcup VPS** (since mid-November 2026; it was on Railway before). It serves the `main` branch, so a change reaches the live site only after it is merged and Openship has built and deployed that commit. Merges deploy automatically: `.github/workflows/deploy.yml` asks Openship to deploy each commit on `main` once CI has passed on it (needs the `OPENSHIP_TOKEN` repo secret: an Openship **API token** from `openship token create` with the deployment permission; a short-lived sign-in token stops working within a day and every deploy then fails with 401). A failure of the server rather than the build is retried once. If the workflow still fails, start a deploy from Openship instead. Set the environment variables (see `.env.example`) in Openship.

Publishing a page (setting `index_status='published'` in Supabase) does not need a deploy: pages render on request and are cached for up to 5 minutes (`revalidate = 300`).

The Railway host rules in `next.config.js` and `src/app/robots.ts` stay in place so the old `*.up.railway.app` URLs keep redirecting or being blocked from indexing.
