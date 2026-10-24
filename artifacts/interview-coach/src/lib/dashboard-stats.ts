import type { ProgressAnswer, ProgressData, SessionReport } from '@/lib/coach-api';

export type DashboardStats = {
  sessionCount: number;
  answerCount: number;
  avgScore: number | null;
  bestScore: number | null;
  practiceSeconds: number;
  streakDays: number;
  /** Average of the latest 5 scored answers minus the 5 before them (needs at least 6 scored answers). */
  improvement: number | null;
  trend: Array<{ label: string; score: number }>;
  weakest: { label: string; score: number } | null;
  latestSessions: SessionReport[];
};

const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const time = (iso: string) => {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
};

export function computeStreak(dates: string[], now: Date = new Date()): number {
  const days = new Set(dates.filter((d) => time(d) > 0).map((d) => dayKey(new Date(d))));
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // practising yesterday but not yet today keeps the streak alive
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function computeDashboardStats(data: ProgressData | undefined, now: Date = new Date()): DashboardStats {
  const answers: ProgressAnswer[] = [...(data?.answers ?? [])].sort((a, b) => time(a.createdAt) - time(b.createdAt));
  const sessions = [...(data?.sessions ?? [])].sort((a, b) => time(b.endedAt || b.startedAt) - time(a.endedAt || a.startedAt));
  const scored = answers.filter((a) => typeof a.overall === 'number') as Array<ProgressAnswer & { overall: number }>;

  const last5 = scored.slice(-5).map((a) => a.overall);
  const prev5 = scored.slice(-10, -5).map((a) => a.overall);
  const improvement = scored.length >= 6 && prev5.length ? Math.round(avg(last5)! - avg(prev5)!) : null;

  const recent = scored.slice(-10);
  const areas: Array<[string, number | null]> = [
    ['Content', avg(recent.map((a) => a.content).filter((v): v is number => typeof v === 'number'))],
    ['Structure', avg(recent.map((a) => a.structure).filter((v): v is number => typeof v === 'number'))],
    ['Confidence', avg(recent.map((a) => a.confidence).filter((v): v is number => typeof v === 'number'))],
    ['Delivery', avg(recent.map((a) => a.delivery).filter((v): v is number => typeof v === 'number'))],
  ];
  const known = areas.filter((a): a is [string, number] => a[1] != null);
  const weakest = known.length ? known.reduce((lo, cur) => (cur[1] < lo[1] ? cur : lo)) : null;

  return {
    sessionCount: sessions.length,
    answerCount: answers.length,
    avgScore: scored.length ? Math.round(avg(scored.map((a) => a.overall))!) : null,
    bestScore: scored.length ? Math.max(...scored.map((a) => a.overall)) : null,
    practiceSeconds: answers.reduce((sum, a) => sum + (Number.isFinite(a.durationSeconds) ? a.durationSeconds : 0), 0),
    streakDays: computeStreak(answers.map((a) => a.createdAt), now),
    improvement,
    trend: scored.slice(-12).map((a, i) => ({ label: String(i + 1), score: a.overall })),
    weakest: weakest ? { label: weakest[0], score: Math.round(weakest[1]) } : null,
    latestSessions: sessions.slice(0, 3),
  };
}
