// Numbers for a practice session, calculated only from data that was recorded
// (answer length, scores, and delivery that was actually measured from audio).
// The AI report is given these numbers; it is not allowed to make up its own.

/** Rule of thumb used everywhere in the app: under 30 s is short, over 150 s is long. */
export const SHORT_ANSWER_SECONDS = 30;
export const LONG_ANSWER_SECONDS = 150;

export type AnswerTiming = "short" | "good" | "long" | "unknown";

export type SessionAnswerInput = {
  question: string;
  transcript: string;
  durationSeconds: number;
  fillerWordCount: number;
  scores: {
    overall: number;
    content: number;
    structure: number;
    confidence: number;
    delivery: number;
  } | null;
  delivery: {
    measured: boolean;
    pauseCount: number;
    longestPauseSeconds: number;
    wordsPerMinute: number | null;
  } | null;
};

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

export const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export function classifyDuration(seconds: number): AnswerTiming {
  if (!Number.isFinite(seconds) || seconds <= 0) return "unknown";
  if (seconds < SHORT_ANSWER_SECONDS) return "short";
  if (seconds > LONG_ANSWER_SECONDS) return "long";
  return "good";
}

const round = (value: number, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function buildSessionStats(answers: SessionAnswerInput[], planned: number): SessionStats {
  const perAnswer: PerAnswerStats[] = answers.map((answer, i) => {
    const measured = answer.delivery?.measured === true;
    return {
      index: i + 1,
      question: answer.question,
      durationSeconds: Math.max(0, Math.round(answer.durationSeconds)),
      timing: classifyDuration(answer.durationSeconds),
      overall: answer.scores ? answer.scores.overall : null,
      wpm: measured ? answer.delivery?.wordsPerMinute ?? null : null,
      pauses: measured ? answer.delivery?.pauseCount ?? null : null,
      longestPauseSeconds: measured ? answer.delivery?.longestPauseSeconds ?? null : null,
      fillers: answer.fillerWordCount,
    };
  });

  const known = perAnswer.filter((p) => p.timing !== "unknown");
  const timingCounts = { short: 0, good: 0, long: 0, unknown: 0 };
  perAnswer.forEach((p) => { timingCounts[p.timing] += 1; });

  const scored = answers.map((a) => a.scores).filter((s): s is NonNullable<typeof s> => s !== null);
  const avgOf = (key: "overall" | "content" | "structure" | "confidence" | "delivery") =>
    round(average(scored.map((s) => s[key])) ?? 0);
  const avgScores = scored.length
    ? { overall: avgOf("overall"), content: avgOf("content"), structure: avgOf("structure"), confidence: avgOf("confidence"), delivery: avgOf("delivery") }
    : null;

  const measuredRows = perAnswer.filter((p) => p.pauses !== null);
  const wpmValues = perAnswer.map((p) => p.wpm).filter((v): v is number => v !== null);
  const totalWords = answers.reduce((sum, a) => sum + countWords(a.transcript), 0);
  const totalFillers = answers.reduce((sum, a) => sum + a.fillerWordCount, 0);
  const avgSeconds = average(known.map((p) => p.durationSeconds));

  return {
    answered: answers.length,
    planned,
    totalSeconds: perAnswer.reduce((sum, p) => sum + p.durationSeconds, 0),
    avgSeconds: avgSeconds === null ? null : round(avgSeconds),
    shortestSeconds: known.length ? Math.min(...known.map((p) => p.durationSeconds)) : null,
    longestSeconds: known.length ? Math.max(...known.map((p) => p.durationSeconds)) : null,
    timingCounts,
    avgScores,
    measuredAnswers: measuredRows.length,
    avgWpm: wpmValues.length ? round(average(wpmValues) ?? 0) : null,
    totalFillers,
    fillersPer100Words: totalWords > 0 ? round((totalFillers / totalWords) * 100, 1) : null,
    totalPauses: measuredRows.length ? measuredRows.reduce((sum, p) => sum + (p.pauses ?? 0), 0) : null,
    longestPauseSeconds: measuredRows.length ? Math.max(...measuredRows.map((p) => p.longestPauseSeconds ?? 0)) : null,
    perAnswer,
  };
}
