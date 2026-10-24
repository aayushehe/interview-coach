import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { downloadSessionPdf } from '@/lib/report-pdf';
import type { AnswerTiming, SessionReport } from '@/lib/coach-api';

export const formatDuration = (seconds: number | null | undefined) => {
  if (seconds == null || !Number.isFinite(seconds)) return '--';
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const timingStyle: Record<AnswerTiming, string> = {
  short: 'bg-[#fff0d2] text-[#9b6819]',
  good: 'bg-[#e2f0e8] text-[#267467]',
  long: 'bg-[#fdeae6] text-[#a5412f]',
  unknown: 'bg-secondary text-muted-foreground',
};
const timingLabel: Record<AnswerTiming, string> = { short: 'Short', good: 'Good length', long: 'Long', unknown: 'Not timed' };

function Bullets({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <div>
    <p className="mono mb-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{title}</p>
    <ul className="space-y-1.5 text-sm leading-6">{items.map((item, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" /><span>{item}</span></li>)}</ul>
  </div>;
}

export function DownloadPdfButton({ report, className }: { report: SessionReport; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = async () => {
    setBusy(true);
    setFailed(false);
    try { await downloadSessionPdf(report); } catch (error) { console.error('PDF download failed:', error); setFailed(true); } finally { setBusy(false); }
  };
  return <span className="inline-flex flex-col items-end">
    <button type="button" onClick={run} disabled={busy} data-testid="button-download-pdf" className={cn('inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60', className)}>
      {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} {busy ? 'Preparing PDF' : 'Download PDF'}
    </button>
    {failed && <span className="mt-1 text-[11px] text-destructive">The PDF could not be created. Try again.</span>}
  </span>;
}

export function SessionReportView({ report, onClose }: { report: SessionReport; onClose?: () => void }) {
  const { stats, review } = report;
  const best = review?.bestAnswerIndex ?? null;
  const weakest = review?.weakestAnswerIndex ?? null;
  return <div className="rounded-[24px] border border-border bg-card p-6 shadow-sm sm:p-8" data-testid="session-report">
    <div className="flex items-start justify-between gap-4">
      <div><p className="mono text-[10px] uppercase tracking-[0.19em] text-primary">Session report</p><h2 className="serif mt-2 text-3xl">How the session went.</h2></div>
      <div className="flex shrink-0 items-start gap-2"><DownloadPdfButton report={report} />{onClose && <button type="button" onClick={onClose} data-testid="button-close-report" className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground hover:bg-secondary">Close</button>}</div>
    </div>

    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[
        ['Answered', `${stats.answered} of ${stats.planned}`],
        ['Total time', formatDuration(stats.totalSeconds)],
        ['Average answer', formatDuration(stats.avgSeconds)],
        ['Average score', stats.avgScores ? `${stats.avgScores.overall}/100` : '--'],
      ].map(([label, value]) => <div key={label} className="rounded-2xl bg-secondary/60 p-4"><p className="mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-extrabold tracking-tight">{value}</p></div>)}
    </div>

    {report.endedEarly && <p className="mt-4 text-xs text-muted-foreground">You ended this session early.</p>}

    {review ? <div className="mt-6 space-y-5">
      {report.reviewNote && <p className="rounded-xl border border-[#ecd9a8] bg-[#fff8e6] px-4 py-3 text-xs leading-5 text-[#8a6417]" data-testid="text-review-note">{report.reviewNote}</p>}
      <p className="text-[15px] leading-7" data-testid="text-session-summary">{review.summary}</p>
      <div className="rounded-2xl border border-border p-4">
        <p className="mono mb-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Time analysis</p>
        <p className="text-sm leading-6" data-testid="text-time-analysis">{review.timeManagement || 'No time analysis was returned.'}</p>
        <p className="mt-3 text-xs text-muted-foreground">Rule of thumb used: under 30 seconds is short, over 150 seconds is long. {stats.timingCounts.short} short, {stats.timingCounts.good} good, {stats.timingCounts.long} long.</p>
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        <Bullets title="What worked" items={review.strengths} />
        <Bullets title="Work on" items={review.improvements} />
        <Bullets title="Next session" items={review.nextSteps} />
      </div>
    </div> : <p className="mt-6 rounded-2xl border border-[#edc8c3] bg-[#fff2ef] p-4 text-sm text-[#954a42]">{report.reviewNote || 'The AI review is not available, but the numbers below were measured.'}</p>}

    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm" data-testid="table-session-answers">
        <thead><tr className="mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"><th className="py-2 pr-3">#</th><th className="py-2 pr-3">Question</th><th className="py-2 pr-3">Time</th><th className="py-2 pr-3">Score</th><th className="py-2 pr-3">Pace</th><th className="py-2 pr-3">Pauses</th><th className="py-2">Fillers</th></tr></thead>
        <tbody>{stats.perAnswer.map((row) => <tr key={row.index} className="border-t border-border align-top">
          <td className="py-3 pr-3 font-bold">{row.index}{row.index === best && <span className="ml-1 text-[#267467]" title="Best answer">★</span>}{row.index === weakest && <span className="ml-1 text-[#a5412f]" title="Needs most work">▼</span>}</td>
          <td className="max-w-[260px] py-3 pr-3 text-xs leading-5 text-muted-foreground">{row.question}</td>
          <td className="py-3 pr-3"><span className="font-bold">{formatDuration(row.durationSeconds)}</span><span className={cn('ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold', timingStyle[row.timing])}>{timingLabel[row.timing]}</span></td>
          <td className="py-3 pr-3 font-bold">{row.overall ?? '--'}</td>
          <td className="py-3 pr-3">{row.wpm != null ? `${row.wpm} wpm` : '--'}</td>
          <td className="py-3 pr-3">{row.pauses != null ? `${row.pauses} (longest ${row.longestPauseSeconds?.toFixed(1)}s)` : '--'}</td>
          <td className="py-3">{row.fillers}</td>
        </tr>)}</tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted-foreground">Pace and pauses are measured from your audio. A dash means that answer could not be measured. ★ best answer, ▼ needs the most work.</p>
    </div>
  </div>;
}
