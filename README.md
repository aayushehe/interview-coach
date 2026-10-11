# AI Interview Coach

A local mock-interview practice tool. You pick a role and topic, answer questions on camera, and get an AI review of what you said plus **measurements of how you said it** (pauses, pace, filler words).

> Built as a placement-preparation project with React, TypeScript, Node.js and the Groq API.

<!-- Add screenshots here, e.g. ![Practice desk](docs/screenshots/practice-desk.png) -->

## Features

**Implemented and tested on a real recording**

- **Practice desk**: landing page with your saved interview rooms. A saved room only opens when you click it.
- **Interview rooms**: create a room with a role, company, focus topic (Behavioral, Java & DSA, Web development, HR, Product, Leadership, Technical communication) and optional resume context.
- **Questions that don't repeat**: choose between AI-generated questions (based on role, topic and background) and a built-in question bank. If the AI is unavailable or repeats itself, the app falls back to the bank. Every asked question is tracked per interview.
- **Webcam recording and playback**, or upload an existing video.
- **Automatic transcription** of your answer (Groq Whisper, called from the backend so the API key never reaches the browser).
- **Delivery measured from the audio**: number of pauses (silences of 0.8 s or longer), longest pause, speaking time and speaking pace in words per minute.
- **Filler words counted in the transcript**: um / uh / er / hmm, "you know", "I mean", "sort of / kind of", "basically".
- **AI feedback**: overall, content, structure, confidence and delivery scores, strengths, improvements, an improved answer and likely follow-up questions. The prompt tells the model to use only what you actually said and to leave `[placeholders]` instead of inventing projects or experience.
- **Delivery score from measured data**: when audio was measured, the delivery score is calculated from pace, filler rate and pauses rather than guessed by the AI.
- **History survives restarts**: rooms and answers are saved to a local JSON file.

## Tech stack

| Part | Technology |
| --- | --- |
| Frontend | React, TypeScript, Vite, Wouter, TanStack Query, Tailwind CSS |
| Backend | Node.js, Express |
| AI | Groq (speech-to-text and analysis). The backend can also use Ollama, LM Studio or Hugging Face |
| Audio analysis | Web Audio API in the browser (silence detection on the recorded audio) |
| Monorepo | pnpm workspace (`artifacts/interview-coach`, `artifacts/api-server`, `lib/*`) |

## How the delivery numbers are produced

| Metric | Source |
| --- | --- |
| Pauses, longest pause, speaking time | **Measured** from the recorded audio (loudness per 30 ms frame against an adaptive threshold) |
| Words per minute | Transcript word count divided by the measured speaking span |
| Filler words | **Counted in the transcript**, so they depend on what Whisper transcribes |

If audio could not be measured (for example a typed transcript), the app shows `--` instead of a number.

## Getting started (Windows / PowerShell)

### Prerequisites

- Node.js 20 or newer
- pnpm (`npm install -g pnpm`)
- A [Groq](https://console.groq.com) API key

### 1. Install

```powershell
pnpm install
```

### 2. Configure the backend

Create `artifacts/api-server/.env` (this file is git-ignored, never commit it):

```
PORT=8080
GROQ_API_KEY=your_key_here
AI_PROVIDER=groq
GROQ_MODEL=your_chosen_groq_model
```

Optional: `INTERVIEWS_FILE` to change where history is saved (default: `artifacts/api-server/data/interviews.json`).

### 3. Start the backend

```powershell
pnpm --filter @workspace/api-server run dev
```

### 4. Start the frontend (second terminal)

```powershell
$env:PORT = "5173"
$env:BASE_PATH = "/"
$env:VITE_API_BASE_URL = "http://localhost:8080"
pnpm --filter @workspace/interview-coach run dev
```

Open http://localhost:5173.

## Privacy

- Recordings are handled in your browser. The audio is sent to Groq only to be transcribed, and the transcript is sent to the configured AI provider for feedback.
- Rooms, transcripts and AI feedback are stored in a local JSON file that is git-ignored.
- The Groq API key lives only in the backend `.env`.

## Known limitations

- Longest pause, speaking time and WPM are shown live on the recording page but are **not yet saved** in the answer history. Saved answers keep the pause and filler counts only.
- Answers recorded without audio measurement are stored with a pause count of 0.
- Whisper sometimes drops filler words, so filler counts can be lower than what was actually said.
- Pause detection was tested on synthetic signals and on real recordings in a quiet room; a very noisy room may need the threshold tuned (`artifacts/interview-coach/src/lib/audio-metrics.ts`).
- Runs locally only. There is no deployed version or user login.

## Roadmap

- [ ] Save all delivery metrics with each answer
- [ ] Replace the JSON file with a database
- [ ] Progress charts across sessions
- [ ] Deployment

## Project structure

```
artifacts/
  interview-coach/   React + Vite frontend (src/App.tsx, src/lib/audio-metrics.ts)
  api-server/        Express backend (src/routes/interviews.ts, src/lib/question-bank.ts)
lib/                 Shared API schemas and client
```
