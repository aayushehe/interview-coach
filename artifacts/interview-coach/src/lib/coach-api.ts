// Small helpers that talk to the backend for sessions, progress and deleting.
import { authFetch } from '@/lib/auth-client';

export const apiUrl = (path: string) => `${import.meta.env.VITE_API_BASE_URL || ''}${path}`;

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

/** Rule of thumb used everywhere: under 30 s is a short answer, over 150 s is long. */
export const SHORT_ANSWER_SECONDS = 30;
export const LONG_ANSWER_SECONDS = 150;

export type AnswerTiming = 'short' | 'good' | 'long' | 'unknown';

export type PerAnswerStats = {
  index: number;
  question: string;
  durationSeconds: number;
  timing: AnswerTiming;
  overall: number | null;
  wpm: number | null;
  pauses: number | null;
  longestPauseSeconds: number | null;
  fillers: number;
};

export type SessionStats = {
  answered: number;
  planned: number;
  totalSeconds: number;
  avgSeconds: number | null;
  shortestSeconds: number | null;
  longestSeconds: number | null;
  timingCounts: { short: number; good: number; long: number; unknown: number };
  avgScores: { overall: number; content: number; structure: number; confidence: number; delivery: number } | null;
  measuredAnswers: number;
  avgWpm: number | null;
  totalFillers: number;
  fillersPer100Words: number | null;
  totalPauses: number | null;
  longestPauseSeconds: number | null;
  perAnswer: PerAnswerStats[];
};

export type SessionReview = {
  summary: string;
  timeManagement: string;
  strengths: string[];
  improvements: string[];
  nextSteps: string[];
  bestAnswerIndex: number | null;
  weakestAnswerIndex: number | null;
};

export type SessionReport = {
  id: string;
  startedAt: string;
  endedAt: string;
  plannedQuestions: number;
  answeredCount: number;
  endedEarly: boolean;
  stats: SessionStats;
  review: SessionReview | null;
  reviewNote?: string;
  interviewId?: string;
  interviewTitle?: string;
};

export type ProgressAnswer = {
  interviewId: string;
  interviewTitle: string;
  role: string;
  topic: string;
  level: string;
  createdAt: string;
  question: string;
  overall: number | null;
  content: number | null;
  structure: number | null;
  confidence: number | null;
  delivery: number | null;
  durationSeconds: number;
  words: number;
  fillers: number;
  fillersPer100Words: number | null;
  measured: boolean;
  wpm: number | null;
  pauseCount: number | null;
  longestPauseSeconds: number | null;
  sessionId: string | null;
};

export type ProgressData = { answers: ProgressAnswer[]; sessions: SessionReport[] };

export async function fetchNextQuestion(interviewId: string, mode: 'ai' | 'bank', fresh: boolean) {
  const res = await authFetch(apiUrl(`/api/interviews/${interviewId}/next-question`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, fresh }),
  });
  if (!res.ok) throw new Error(await readError(res, 'Could not load a question.'));
  return (await res.json()) as { question: string; source: 'ai' | 'bank'; note?: string };
}

export async function transcribeWav(wav: Blob): Promise<string> {
  const res = await authFetch(apiUrl('/api/transcribe'), { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wav });
  if (!res.ok) throw new Error(await readError(res, 'Transcription failed.'));
  const data = (await res.json()) as { transcript?: string };
  return (data.transcript || '').trim();
}

export async function analyzeAnswer(interviewId: string, body: Record<string, unknown>): Promise<void> {
  const res = await authFetch(apiUrl(`/api/interviews/${interviewId}/analyze`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res, 'The answer could not be reviewed.'));
}

export async function requestSessionReport(interviewId: string, sessionId: string, plannedQuestions: number): Promise<SessionReport> {
  const res = await authFetch(apiUrl(`/api/interviews/${interviewId}/session-report`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, plannedQuestions }),
  });
  if (!res.ok) throw new Error(await readError(res, 'The session report could not be created.'));
  return ((await res.json()) as { session: SessionReport }).session;
}

export async function fetchProgress(): Promise<ProgressData> {
  const res = await authFetch(apiUrl('/api/progress'));
  if (!res.ok) throw new Error(await readError(res, 'Progress could not be loaded.'));
  return (await res.json()) as ProgressData;
}

export async function deleteInterview(id: string): Promise<void> {
  const res = await authFetch(apiUrl(`/api/interviews/${id}`), { method: 'DELETE' });
  if (!res.ok) throw new Error(await readError(res, 'The interview could not be deleted.'));
}
