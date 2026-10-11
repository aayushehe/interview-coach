# Interview Coach

Interview Coach is a private mock-interview workspace that records or uploads answer videos and returns provider-backed coaching on content, structure, confidence, and delivery.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/interview-coach` — React/Vite application with the practice desk, session detail view, and provider settings.
- `artifacts/api-server/src/routes/interviews.ts` — interview sessions, provider detection, and AI analysis proxy.
- `lib/api-spec/openapi.yaml` — source of truth for interview and provider contracts.
- `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/` — generated API hooks and validators.

## Architecture decisions

- Ollama is checked first and selects the first available model in the preferred order `qwen3:8b`, `llama3.1:8b`, `mistral:7b`.
- LM Studio, Hugging Face, and Groq are optional fallbacks; hosted provider credentials are read only from server environment variables.
- Browser video is recorded locally for review; analysis sends the transcript plus delivery signals to the selected text model.
- The first version uses an in-memory session store so Ollama-only local use has no database setup requirement.

## Product

- Create practice rooms with role, company, topic, and resume context.
- Record or upload an answer video, add a transcript, and submit it for analysis.
- Review scores for overall answer quality, content, structure, confidence, and delivery.
- Receive pause/filler signals, strengths, improvements, a sharper answer, follow-up questions, and watch-outs.
- Inspect available model providers and keep Ollama as the no-key path.

## User preferences

- Do not use OpenAI APIs. Support Ollama first, then LM Studio, Hugging Face Inference Providers, and Groq Free Models.

## Gotchas

- The browser needs camera/microphone permission for recording; transcript entry and video upload remain available when permissions are denied.
- `pnpm --filter @workspace/api-spec run codegen` must run after OpenAPI changes.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
