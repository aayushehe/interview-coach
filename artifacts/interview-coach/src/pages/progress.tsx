import { useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Loader2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LONG_ANSWER_SECONDS, SHORT_ANSWER_SECONDS, fetchProgress } from '@/lib/coach-api';
import type { ProgressData } from '@/lib/coach-api';
import { SessionReportView, formatDuration } from '@/components/session-report';
import { PAUSE_MIN_SECONDS } from '@/lib/audio-metrics';

const TEAL = '#1f7a99';
const AMBER = '#d49a40';
const GRID = '#e6e0d4';

const average = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const rounded = (value: number | null) => (value == null ? null : Math.round(value));
const shortDate = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return <div className="rounded-[22px] border border-border bg-card p-6 shadow-sm"><h3 className="text-sm font-extrabold">{title}</h3>{note && <p className="mt-1 text-xs leading-5 text-muted-foreground">{note}</p>}<div className="mt-4">{children}</div></div>;
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl bg-secondary/60 p-5 text-sm text-muted-foreground">{text}</p>;
}

function Summary({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5 shadow-sm"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{label}</p><p className="mono mt-3 text-3xl font-medium">{value}</p>{note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}</div>;
}

export function ProgressView({ data }: { data: ProgressData }) {
  const [openSession, setOpenSession] = useState('');
  const { answers, sessions } = data;

  const rows = answers.map((answer, index) => ({ n: index + 1, date: shortDate(answer.createdAt), ...answer }));
  const scored = rows.filter((row) => row.overall != null);
  const overallAvg = rounded(average(scored.map((row) => row.overall as number)));
  const latest = scored.slice(-5);
  const earlier = scored.slice(0, -5);
  const trend = earlier.length && latest.length ? Math.round((average(latest.map((r) => r.overall as number)) ?? 0) - (average(earlier.map((r) => r.overall as number)) ?? 0)) : null;
  const wpmRows = rows.filter((row) => row.wpm != null);
  const fillerRows = rows.filter((row) => row.fillersPer100Words != null);
  const lengthRows = rows.filter((row) => row.durationSeconds > 0);
  const pauseRows = rows.filter((row) => row.longestPauseSeconds != null);
  const longestPauseEver = pauseRows.length ? Math.max(...pauseRows.map((row) => row.longestPauseSeconds as number)) : null;
  const levelByInterview = new Map<string, string>();
  for (const answer of answers) if (answer.level) levelByInterview.set(answer.interviewId, answer.level);
  const sortedSessions = [...sessions].sort((a, b) => b.endedAt.localeCompare(a.endedAt));

  if (!answers.length) {
    return <div className="rounded-[24px] border border-dashed border-border bg-card/60 px-6 py-16 text-center"><h2 className="serif text-2xl">Nothing to chart yet.</h2><p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">Answer a few questions or run a practice session. Your scores, pace and answer lengths will show up here.</p><Link href="/" data-testid="link-progress-start" className="mt-6 inline-flex rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground">Go to the practice desk</Link></div>;
  }

  return <div className="space-y-6" data-testid="progress-view">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <Summary label="Answers" value={String(answers.length)} note={`${new Set(answers.map((a) => a.interviewId)).size} interview${new Set(answers.map((a) => a.interviewId)).size === 1 ? '' : 's'}`} />
      <Summary label="Sessions" value={String(sessions.length)} note="5-question runs" />
      <Summary label="Average score" value={overallAvg != null ? String(overallAvg) : '—'} note={trend != null ? `${trend >= 0 ? '+' : ''}${trend} vs earlier answers` : 'out of 100'} />
      <Summary label="Average pace" value={wpmRows.length ? String(rounded(average(wpmRows.map((r) => r.wpm as number)))) : '—'} note="words per minute (measured)" />
      <Summary label="Longest pause" value={longestPauseEver != null ? `${longestPauseEver.toFixed(1)}s` : '—'} note={`silence of ${PAUSE_MIN_SECONDS}s or more (measured)`} />
      <Summary label="Fillers" value={fillerRows.length ? String(Math.round((average(fillerRows.map((r) => r.fillersPer100Words as number)) ?? 0) * 10) / 10) : '—'} note="per 100 words (transcript)" />
    </div>

    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Scores over time" note="Overall and delivery score for every answer, oldest to newest.">
        {scored.length < 2 ? <Empty text="Answer at least two questions to see a trend." /> : <div className="h-[250px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={scored} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}><CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="n" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 11 }} /><Tooltip /><Line type="monotone" dataKey="overall" name="Overall" stroke={TEAL} strokeWidth={2.5} dot={{ r: 3 }} /><Line type="monotone" dataKey="delivery" name="Delivery" stroke={AMBER} strokeWidth={2} dot={{ r: 3 }} /></LineChart></ResponsiveContainer></div>}
      </Card>
      <Card title="Speaking pace" note="Words per minute, only for answers where audio was measured. The shaded band is a comfortable range (110 to 170).">
        {wpmRows.length < 2 ? <Empty text="Record at least two answers with the camera to see your pace." /> : <div className="h-[250px]"><ResponsiveContainer width="100%" height="100%"><LineChart data={wpmRows} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}><CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="n" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} domain={[0, 'auto']} /><Tooltip /><ReferenceArea y1={110} y2={170} fill={TEAL} fillOpacity={0.09} /><Line type="monotone" dataKey="wpm" name="Words per minute" stroke={TEAL} strokeWidth={2.5} dot={{ r: 3 }} /></LineChart></ResponsiveContainer></div>}
      </Card>
      <Card title="Filler words" note="Fillers per 100 words, counted in the transcript. Lower is better.">
        {fillerRows.length < 2 ? <Empty text="Answer at least two questions to see a trend." /> : <div className="h-[250px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={fillerRows} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}><CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="n" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="fillersPer100Words" name="Fillers per 100 words" fill={AMBER} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>}
      </Card>
      <Card title="Longest pause" note={`The longest silence inside each answer, in seconds. Only silences of ${PAUSE_MIN_SECONDS}s or more count, and only for answers where audio was measured. Lower is smoother.`}>
        {pauseRows.length < 2 ? <Empty text="Record at least two answers with the camera to see your pauses." /> : <div className="h-[250px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={pauseRows} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}><CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="n" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} domain={[0, 'auto']} /><Tooltip /><Bar dataKey="longestPauseSeconds" name="Longest pause (s)" fill={AMBER} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>}
      </Card>
      <Card title="Answer length" note={`Seconds per answer. Dashed lines mark ${SHORT_ANSWER_SECONDS}s (too short) and ${LONG_ANSWER_SECONDS}s (too long).`}>
        {lengthRows.length < 2 ? <Empty text="Record at least two answers to see how long you speak." /> : <div className="h-[250px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={lengthRows} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}><CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="n" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><ReferenceLine y={SHORT_ANSWER_SECONDS} stroke="#a5412f" strokeDasharray="4 4" /><ReferenceLine y={LONG_ANSWER_SECONDS} stroke="#a5412f" strokeDasharray="4 4" /><Bar dataKey="durationSeconds" name="Seconds" fill={TEAL} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>}
      </Card>
    </div>

    <div>
      <p className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Practice sessions</p>
      <h2 className="serif mt-2 text-2xl">Your session reports.</h2>
      {sortedSessions.length === 0 ? <div className="mt-4"><Empty text="No session yet. Start a 5-question session from any interview room." /></div> : <div className="mt-4 space-y-3">{sortedSessions.map((session) => {
        const open = openSession === session.id;
        return <div key={session.id} className="rounded-2xl border border-border bg-card shadow-sm">
          <button type="button" onClick={() => setOpenSession(open ? '' : session.id)} data-testid={`button-session-${session.id}`} className="flex w-full flex-wrap items-center justify-between gap-3 px-5 py-4 text-left">
            <div><p className="text-sm font-bold">{session.interviewTitle || 'Interview'}</p><p className="mt-1 text-xs text-muted-foreground">{shortDate(session.endedAt)} · {session.stats.answered} of {session.stats.planned} questions · {formatDuration(session.stats.totalSeconds)} total</p>
              <p className="mt-1 text-xs text-muted-foreground">{[
                levelByInterview.get(session.interviewId ?? '') ? `Level: ${levelByInterview.get(session.interviewId ?? '')}` : null,
                session.stats.avgWpm != null ? `${Math.round(session.stats.avgWpm)} wpm` : null,
                session.stats.longestPauseSeconds != null ? `longest pause ${session.stats.longestPauseSeconds.toFixed(1)}s` : null,
              ].filter(Boolean).join(' · ') || 'Pace and pauses: no measured audio in this session'}</p></div>
            <div className="flex items-center gap-4"><span className="mono text-xl font-medium">{session.stats.avgScores ? session.stats.avgScores.overall : '—'}<span className="ml-1 text-[10px] text-muted-foreground">avg</span></span><span className={cn('text-xs font-bold text-primary')}>{open ? 'Hide report' : 'View report'}</span></div>
          </button>
          {open && <div className="border-t border-border p-4 sm:p-5"><SessionReportView report={session} /></div>}
        </div>;
      })}</div>}
    </div>
  </div>;
}

export default function ProgressPage() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['coach-progress'], queryFn: fetchProgress });
  return <div className="mx-auto max-w-[1240px] px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
    <div className="mb-8"><p className="mono text-[10px] uppercase tracking-[0.2em] text-primary">Progress</p><h1 className="serif mt-3 text-4xl leading-[1.05] sm:text-5xl">See yourself improve.</h1></div>
    {isLoading ? <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground"><Loader2 size={18} className="animate-spin text-primary" /> Loading your progress…</div>
      : isError || !data ? <div className="rounded-2xl border border-[#edc8c3] bg-[#fff2ef] p-6"><div className="flex items-center gap-2 font-bold text-[#a94e45]"><TriangleAlert size={17} /> We could not load your progress.</div><button type="button" onClick={() => refetch()} data-testid="button-retry-progress" className="mt-4 rounded-lg bg-[#a94e45] px-3 py-2 text-xs font-bold text-white">Try again</button></div>
      : <ProgressView data={data} />}
  </div>;
}
