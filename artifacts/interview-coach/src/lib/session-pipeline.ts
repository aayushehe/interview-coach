// After a session is recorded as ONE video, this cuts out each answer,
// measures pauses/pace from the audio, transcribes it, has the AI review it,
// and finally asks for the session report.

import { analyzeSamples, computeWpm, countFillers, countWords } from './audio-metrics';
import { encodeWav16k, sliceSamples } from './audio-segments';
import * as api from './coach-api';
import type { SessionReport } from './coach-api';

export const MIN_ANSWER_SECONDS = 2;
const MIN_WORDS = 3;

export type AnswerWindow = { index: number; question: string; startSec: number; endSec: number; skipped: boolean; note?: string };
export type AnswerOutcome = {
  index: number;
  question: string;
  startSec: number;
  endSec: number;
  status: 'saved' | 'skipped' | 'failed';
  message: string;
};

export type PipelineProgress = { phase: 'answers' | 'report'; current: number; total: number; label: string };

export type PipelineDeps = {
  transcribe: (wav: Blob) => Promise<string>;
  analyze: (interviewId: string, body: Record<string, unknown>) => Promise<void>;
  report: (interviewId: string, sessionId: string, planned: number) => Promise<SessionReport>;
};

const liveDeps: PipelineDeps = {
  transcribe: api.transcribeWav,
  analyze: api.analyzeAnswer,
  report: api.requestSessionReport,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const RATE_LIMIT = /rate.?limit|too many requests|\b429\b|tokens per (minute|day)|requests per (minute|day)|try again in/i;

/** Providers often say "Please try again in 6.2s" or "in 1m6.4s". Returns seconds, or null if there is no hint. */
export function retryHintSeconds(message: string): number | null {
  if (!/try again in/i.test(message)) return null;
  const tail = message.slice(message.search(/try again in/i));
  const minutes = /(\d+(?:\.\d+)?)\s*m(?!s)/i.exec(tail);
  const seconds = /(\d+(?:\.\d+)?)\s*s(?![a-z])/i.exec(tail);
  const millis = /(\d+(?:\.\d+)?)\s*ms/i.exec(tail);
  const total = (minutes ? parseFloat(minutes[1]) * 60 : 0) + (seconds ? parseFloat(seconds[1]) : 0) + (millis ? parseFloat(millis[1]) / 1000 : 0);
  return total > 0 ? total : null;
}

/** Turns a server or provider error into a short message that is fine to show on screen. */
export function friendlyError(message: string): string {
  if (/GROQ_API_KEY/i.test(message)) return 'Speech-to-text is not set up on the server.';
  if (RATE_LIMIT.test(message)) return 'The AI service is busy right now (too many requests). Please wait a minute and try again.';
  if (/failed to fetch|networkerror|load failed/i.test(message)) return 'Could not reach the server.';
  if (/no ai provider|returned no analysis|rejected the request|not reachable/i.test(message)) return 'The AI reviewer is not reachable right now.';
  if (/transcription failed|whisper/i.test(message)) return 'The speech could not be turned into text.';
  return message.length > 160 ? `${message.slice(0, 157)}...` : message || 'This answer could not be reviewed.';
}

/**
 * Runs a task, retrying once after a short pause. If the failure is a rate limit
 * (common with free AI plans when five answers are reviewed back to back) it waits as long
 * as the provider asks and tries up to four times in total.
 */
async function withRetry<T>(task: () => Promise<T>, delayMs: number, opts: { fixedWait?: number; onWait?: (seconds: number) => void } = {}): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const limited = RATE_LIMIT.test(message);
      if (attempt >= (limited ? 4 : 2)) throw error;
      let wait = delayMs;
      if (limited) {
        const hinted = retryHintSeconds(message);
        if (hinted != null && hinted > 90) throw error; // a long wait (like a daily limit) will not clear in this session
        wait = opts.fixedWait ?? Math.min(45_000, Math.max(5_000, (hinted ?? 15) * 1000 + 1000));
        opts.onWait?.(Math.round(wait / 1000));
      }
      await sleep(wait);
    }
  }
}

export async function processSession(args: {
  samples: Float32Array;
  sampleRate: number;
  windows: AnswerWindow[];
  interview: { id: string; resumeContext?: string; topic?: string };
  sessionId: string;
  planned: number;
  onProgress?: (progress: PipelineProgress) => void;
  deps?: PipelineDeps;
  retryDelayMs?: number;
}): Promise<{ outcomes: AnswerOutcome[]; report: SessionReport | null; reportError: string }> {
  const deps = args.deps ?? liveDeps;
  const retryDelay = args.retryDelayMs ?? 1500;
  const fixedWait = args.retryDelayMs; // tests pass a tiny value so rate-limit waits stay short
  const outcomes: AnswerOutcome[] = [];
  const total = args.windows.length;

  for (let i = 0; i < total; i++) {
    const window = args.windows[i];
    args.onProgress?.({ phase: 'answers', current: i + 1, total, label: `Reviewing answer ${i + 1} of ${total}` });
    const base = { index: window.index, question: window.question, startSec: window.startSec, endSec: window.endSec };
    const length = window.endSec - window.startSec;
    if (window.skipped || length < MIN_ANSWER_SECONDS) {
      outcomes.push({ ...base, status: 'skipped', message: window.note || (window.skipped ? 'Skipped.' : 'Too short to review.') });
      continue;
    }
    try {
      const slice = sliceSamples(args.samples, args.sampleRate, window.startSec, window.endSec);
      const metrics = analyzeSamples(slice, args.sampleRate);
      const waiting = (seconds: number) => args.onProgress?.({ phase: 'answers', current: i + 1, total, label: `The AI service is busy. Waiting ${seconds}s, then continuing with answer ${i + 1} of ${total}` });
      const transcript = await withRetry(() => deps.transcribe(encodeWav16k(slice, args.sampleRate)), retryDelay, { fixedWait, onWait: waiting });
      const words = countWords(transcript);
      if (words < MIN_WORDS) {
        outcomes.push({ ...base, status: 'skipped', message: 'No clear speech was heard.' });
        continue;
      }
      const fillers = countFillers(transcript);
      const measured = metrics.reliable;
      const delivery = {
        measured,
        pauseCount: measured ? metrics.pauseCount : 0,
        totalPauseSeconds: measured ? metrics.totalPauseSeconds : 0,
        longestPauseSeconds: measured ? metrics.longestPauseSeconds : 0,
        speakingSeconds: measured ? metrics.speakingSeconds : 0,
        spanSeconds: measured ? metrics.spanSeconds : 0,
        wordsPerMinute: computeWpm(words, measured ? metrics : null),
        fillerWordCount: fillers.total,
        fillerBreakdown: fillers.breakdown,
      };
      await withRetry(
        () =>
          deps.analyze(args.interview.id, {
            question: window.question,
            transcript,
            durationSeconds: Math.round(length),
            pauseCount: delivery.pauseCount,
            fillerWordCount: fillers.total,
            resumeContext: args.interview.resumeContext ?? '',
            topic: args.interview.topic ?? '',
            delivery,
            sessionId: args.sessionId,
          }),
        retryDelay,
        { fixedWait, onWait: waiting },
      );
      outcomes.push({ ...base, status: 'saved', message: 'Reviewed.' });
    } catch (error) {
      console.error(`Answer ${window.index} could not be reviewed:`, error);
      outcomes.push({ ...base, status: 'failed', message: friendlyError(error instanceof Error ? error.message : '') });
    }
  }

  if (!outcomes.some((o) => o.status === 'saved')) {
    const reasons = Array.from(new Set(outcomes.map((o) => o.message.replace(/\.$/, '')))).slice(0, 3).join('; ');
    return { outcomes, report: null, reportError: `None of the answers could be reviewed, so there is no report.${reasons ? ` Reason: ${reasons}.` : ''}` };
  }
  args.onProgress?.({ phase: 'report', current: total, total, label: 'Writing your session report' });
  try {
    const report = await withRetry(() => deps.report(args.interview.id, args.sessionId, args.planned), retryDelay, { fixedWait });
    return { outcomes, report, reportError: '' };
  } catch (error) {
    console.error('The session report could not be created:', error);
    return { outcomes, report: null, reportError: friendlyError(error instanceof Error ? error.message : 'The report could not be created.') };
  }
}
