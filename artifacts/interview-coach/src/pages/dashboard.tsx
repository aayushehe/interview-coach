import { useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronRight, Flame, Loader2, Mic, Plus, Target, TriangleAlert } from 'lucide-react';
import { useListInterviews, getListInterviewsQueryKey } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import { fetchProgress } from '@/lib/coach-api';
import type { SessionReport } from '@/lib/coach-api';
import { computeDashboardStats } from '@/lib/dashboard-stats';
import { DownloadPdfButton, SessionReportView, formatDuration } from '@/components/session-report';

const TEAL = '#1f7a99';
const GRID = '#e6e0d4';
const tone = (score?: number | null) => (score == null ? 'text-muted-foreground' : score >= 80 ? 'text-[#267467]' : score >= 65 ? 'text-[#ae7219]' : 'text-[#b54c42]');
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};
const niceDate = (iso?: string) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '--';
};
const niceMinutes = (seconds: number) => (seconds < 60 ? `${Math.round(seconds)}s` : seconds < 3600 ? `${Math.round(seconds / 60)} min` : `${(seconds / 3600).toFixed(1)} h`);

function Stat({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: string; icon?: ReactNode }) {
  return <div className="rounded-[20px] border border-border bg-card p-5 shadow-sm">
    <div className="flex items-center justify-between"><p className="mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</p>{icon}</div>
    <p className="mt-3 text-3xl font-extrabold tracking-tight">{value}</p>
    {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
  </div>;
}

function SessionRow({ session }: { session: SessionReport }) {
  const [open, setOpen] = useState(false);
  const score = session.stats.avgScores?.overall ?? null;
  return <div className="rounded-2xl border border-border bg-card shadow-sm" data-testid={`dashboard-session-${session.id}`}>
    <div className="flex flex-wrap items-center gap-3 p-4 sm:p-5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{session.interviewTitle || 'Practice session'}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{niceDate(session.startedAt)} · {session.stats.answered} of {session.stats.planned} answered · {formatDuration(session.stats.totalSeconds)} total</p>
      </div>
      <span className={cn('text-2xl font-extrabold tracking-tight', tone(score))}>{score ?? '--'}</span>
      <DownloadPdfButton report={session} />
      <button type="button" onClick={() => setOpen((v) => !v)} data-testid={`button-toggle-report-${session.id}`} className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground hover:bg-secondary">{open ? 'Hide report' : 'View report'}</button>
    </div>
    {open && <div className="border-t border-border p-4 sm:p-5"><SessionReportView report={session} /></div>}
  </div>;
}

export default function DashboardPage({ name, onNew }: { name: string; onNew: () => void }) {
  const progress = useQuery({ queryKey: ['coach-progress'], queryFn: fetchProgress });
  const rooms = useListInterviews({ query: { queryKey: getListInterviewsQueryKey() } });
  const stats = computeDashboardStats(progress.data);
  const first = (name || '').trim().split(/\s+/)[0] || 'there';
  const roomList = Array.isArray(rooms.data) ? rooms.data.slice(0, 4) : [];
  const empty = !progress.isLoading && !progress.isError && stats.answerCount === 0;

  return <div className="mx-auto max-w-[1240px] px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
    <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="mono text-[10px] uppercase tracking-[0.19em] text-primary">Dashboard</p>
        <h1 className="serif mt-2 text-4xl leading-tight sm:text-5xl">{greeting()}, {first}.</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{empty ? 'No sessions yet. Your first mock interview takes about ten minutes.' : 'Here is where your practice stands today.'}</p>
      </div>
      <button onClick={onNew} data-testid="button-new-interview" className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-md transition-transform hover:-translate-y-0.5"><Plus size={16} /> New interview</button>
    </div>

    {progress.isError ? <div className="rounded-2xl border border-[#edc8c3] bg-[#fff2ef] p-6 text-sm text-[#954a42]"><div className="flex items-center gap-2 font-bold"><TriangleAlert size={17} /> We could not load your numbers.</div><button onClick={() => progress.refetch()} className="mt-3 rounded-lg bg-[#a94e45] px-3 py-2 text-xs font-bold text-white">Try again</button></div>
    : progress.isLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading your dashboard</div>
    : empty ? <div className="rounded-[24px] border border-dashed border-border bg-card/60 px-6 py-14 text-center">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary"><Mic size={20} /></div>
        <h2 className="serif text-2xl">Say your first answer out loud.</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">Create a practice room, let the interviewer ask five questions, and you will get a timed report with a PDF you can keep.</p>
        <button onClick={onNew} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-md"><Plus size={16} /> Start a mock interview</button>
      </div>
    : <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="dashboard-stats">
        <Stat label="Sessions" value={stats.sessionCount} hint={`${stats.answerCount} answers recorded`} />
        <Stat label="Average score" value={stats.avgScore ?? '--'} hint={stats.bestScore != null ? `Best answer ${stats.bestScore}` : undefined} />
        <Stat label="Practice time" value={niceMinutes(stats.practiceSeconds)} hint="Total speaking time" />
        <Stat label="Day streak" value={stats.streakDays} hint={stats.streakDays > 0 ? 'Keep it going' : 'Practise today to start one'} icon={<Flame size={16} className={stats.streakDays > 0 ? 'text-[#d49a40]' : 'text-muted-foreground'} />} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="rounded-[22px] border border-border bg-card p-6 shadow-sm">
          <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-extrabold">Score trend</h3><p className="mt-1 text-xs text-muted-foreground">Overall score of your latest answers.</p></div>
            {stats.improvement != null && <span className={cn('rounded-full px-3 py-1 text-xs font-bold', stats.improvement >= 0 ? 'bg-[#e2f0e8] text-[#267467]' : 'bg-[#fdeae6] text-[#a5412f]')}>{stats.improvement >= 0 ? '+' : ''}{stats.improvement} vs earlier</span>}</div>
          {stats.trend.length < 2 ? <p className="mt-5 rounded-xl bg-secondary/60 p-5 text-sm text-muted-foreground">Answer at least two questions to see a trend.</p>
          : <div className="mt-4 h-[220px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={stats.trend} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
            <defs><linearGradient id="dash-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={TEAL} stopOpacity={0.25} /><stop offset="100%" stopColor={TEAL} stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} /><YAxis domain={[0, 100]} tickLine={false} axisLine={false} fontSize={11} /><Tooltip formatter={(v) => [`${v}`, 'Score']} labelFormatter={(l) => `Answer ${l}`} />
            <Area type="monotone" dataKey="score" stroke={TEAL} strokeWidth={2.5} fill="url(#dash-fill)" dot={{ r: 3, fill: TEAL }} /></AreaChart></ResponsiveContainer></div>}
        </div>
        <div className="space-y-5">
          <div className="rounded-[22px] border border-border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-extrabold"><Target size={16} className="text-primary" /> Focus next</div>
            {stats.weakest ? <><p className="mt-3 text-sm leading-6">Your lowest area over the last answers is <b>{stats.weakest.label}</b> at <b className={tone(stats.weakest.score)}>{stats.weakest.score}</b>.</p><p className="mt-2 text-xs leading-5 text-muted-foreground">Pick one answer in your next session and work only on this.</p></> : <p className="mt-3 text-sm text-muted-foreground">Complete a scored answer to see what to work on.</p>}
          </div>
          <Link href="/progress" data-testid="link-dashboard-progress" className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-4 text-sm font-bold shadow-sm transition-colors hover:border-primary/40"><span>Full progress charts</span><ChevronRight size={17} className="text-muted-foreground" /></Link>
        </div>
      </div>

      <div>
        <div className="mb-4 flex items-end justify-between"><div><p className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Latest sessions</p><h2 className="serif mt-2 text-2xl">Reports you can download.</h2></div></div>
        {stats.latestSessions.length === 0 ? <p className="rounded-xl bg-secondary/60 p-5 text-sm text-muted-foreground">Finish a 5-question session to get a report with a PDF.</p> : <div className="space-y-3">{stats.latestSessions.map((s) => <SessionRow key={s.id} session={s} />)}</div>}
      </div>
    </div>}

    {roomList.length > 0 && <div className="mt-10">
      <div className="mb-4 flex items-end justify-between"><div><p className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Practice rooms</p><h2 className="serif mt-2 text-2xl">Jump back in.</h2></div><Link href="/history" data-testid="link-past-interviews" className="text-xs font-bold text-primary hover:underline">All past interviews</Link></div>
      <div className="grid gap-3 sm:grid-cols-2">{roomList.map((r) => <Link key={r.id} href={`/interviews/${r.id}`} className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-4 shadow-sm transition-colors hover:border-primary/40"><span className="min-w-0"><span className="block truncate text-sm font-bold">{r.title}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{r.role} · {r.answerCount} answers</span></span><ChevronRight size={17} className="shrink-0 text-muted-foreground" /></Link>)}</div>
    </div>}
  </div>;
}
