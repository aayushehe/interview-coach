# Interview Coach

Interview Coach is a mock interview practice app that records or uploads answer videos, collects a transcript, and returns coaching on content, structure, confidence, delivery, pauses, filler words, improved wording, follow-up questions, and interview risks.

It does not use OpenAI APIs. Provider order:

1. Ollama
2. LM Studio
3. Hugging Face Inference Providers
4. Groq

## Run locally in VS Code

Requirements:

- Node.js 20 or newer
- pnpm
- Ollama for the no-key local path

Install dependencies from the project root:

```bash
pnpm install
```

Pull a supported Ollama model:

```bash
ollama pull qwen3:8b
```

Start Ollama:

```bash
ollama serve
```

In terminal 1, start the API:

```bash
PORT=8080 pnpm --filter @workspace/api-server run dev
```

In terminal 2, start the frontend:

```bash
PORT=5173 BASE_PATH=/ VITE_API_BASE_URL=http://localhost:8080 pnpm --filter @workspace/interview-coach run dev
```

Open:

```text
http://localhost:5173
```

On Windows PowerShell:

```powershell
$env:PORT="8080"; pnpm --filter @workspace/api-server run dev
```

In a second terminal:

```powershell
$env:PORT="5173"; $env:BASE_PATH="/"; $env:VITE_API_BASE_URL="http://localhost:8080"; pnpm --filter @workspace/interview-coach run dev
```

When the app and Ollama run on the same computer, the browser can access local Ollama without the secure-preview limitation.

## Optional hosted providers

Copy the API example file and add values only if you want hosted fallbacks:

```bash
cp artifacts/api-server/.env.example artifacts/api-server/.env
```

Available variables:

- `AI_PROVIDER=ollama|lmstudio|huggingface|groq`
- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`
- `LM_STUDIO_BASE_URL`
- `HF_API_KEY`
- `HF_MODEL`
- `GROQ_API_KEY`
- `GROQ_MODEL`

Never commit `.env` files or provider keys.

## Main code

- `artifacts/interview-coach/src/App.tsx` — frontend application and recording flow
- `artifacts/interview-coach/src/index.css` — visual theme
- `artifacts/api-server/src/routes/interviews.ts` — provider detection and analysis proxy
- `lib/api-spec/openapi.yaml` — API contract

## Checks

```bash
pnpm --filter @workspace/interview-coach run typecheck
pnpm --filter @workspace/api-server run typecheck
```