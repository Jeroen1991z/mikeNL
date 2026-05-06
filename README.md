# MikeNL

Open-source release containing the MikeNL frontend and backend. MikeNL is a Dutch-focused legal AI assistant, forked from Will Chen's Mike (https://github.com/willchen96/mike)  — an open-source recreation of Harvey and Legora built in two weeks. Will's original work forms the entire foundation of this project.

On top of that base, MikeNL adds:

- Direct integration with rechtspraak.nl — search and retrieve published Dutch court judgments
- Direct integration with wetten.overheid.nl — access all articles from Dutch legislation including the Burgerlijk Wetboek
- Side panel with passage highlighting — opens the full judgment or statutory article and marks the cited passage in yellow

- MikeNL also incorporates redline/tracked-changes extraction from Jamie Tso's fork (https://github.com/jamietso/mike-redline), which adds support for surfacing    insertions, deletions, and comment bubbles from redlined DOCX and PDF documents.

## Contents

- `frontend/` - Next.js application
- `backend/` - Express API, Supabase access, document processing, and migrations
- `backend/migrations/000_one_shot_schema.sql` - one-shot Supabase schema for fresh databases

## Setup

Install dependencies:

```bash
npm install --prefix backend
npm install --prefix frontend
```

Create local env files from the examples:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local
```

Run `backend/migrations/000_one_shot_schema.sql` in the Supabase SQL editor for a fresh database.

Start the backend:

```bash
npm run dev --prefix backend
```

Start the frontend:

```bash
npm run dev --prefix frontend
```

Open `http://localhost:3000`.

## Required Services

- Supabase Auth and Postgres
- S3-compatible object storage, such as Cloudflare R2
- At least one supported model provider key, depending on which models you enable
- LibreOffice for DOC/DOCX to PDF conversion

## Checks

```bash
npm run build --prefix backend
npm run build --prefix frontend
npm run lint --prefix frontend
```

## License

AGPL-3.0-only. See `LICENSE`.
