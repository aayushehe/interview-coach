// Builds the downloadable PDF for a session report (jsPDF, runs fully in the browser).
// jsPDF's built-in fonts only cover Latin-1, so text is cleaned first (see clean()).
import type { jsPDF as JsPdfType } from 'jspdf';
import type { AnswerTiming, SessionReport } from '@/lib/coach-api';

export type ReportMeta = { candidate?: string; interviewTitle?: string };

const INK: [number, number, number] = [26, 32, 49];
const MUTED: [number, number, number] = [104, 112, 126];
const LINE: [number, number, number] = [221, 214, 198];
const SOFT: [number, number, number] = [244, 240, 230];
const AMBER: [number, number, number] = [245, 185, 66];
const TEAL: [number, number, number] = [27, 122, 151];
const GREEN: [number, number, number] = [38, 116, 103];
const RED: [number, number, number] = [181, 76, 66];

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 44;
const BOTTOM = PAGE_H - 54;
const CONTENT_W = PAGE_W - M * 2;

const REPLACEMENTS: Record<string, string> = {
  '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"', '\u2013': '-', '\u2014': '-', '\u2026': '...',
  '\u2022': '-', '\u00A0': ' ', '\u2605': '*', '\u25BC': 'v', '\u2192': '->',
};

/** Keep only characters the built-in PDF fonts can draw. */
export const clean = (value: unknown): string =>
  String(value ?? '')
    .replace(/[\u2018\u2019\u201C\u201D\u2013\u2014\u2026\u2022\u00A0\u2605\u25BC\u2192]/g, (c) => REPLACEMENTS[c] ?? '')
    .replace(/[^\x09\x0A\x20-\x7E\xA1-\xFF]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();

const fmtDuration = (seconds: number | null | undefined) => {
  if (seconds == null || !Number.isFinite(seconds)) return '--';
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const timingLabel: Record<AnswerTiming, string> = { short: 'Short', good: 'Good length', long: 'Long', unknown: 'Not timed' };
const timingColor: Record<AnswerTiming, [number, number, number]> = { short: [155, 104, 25], good: GREEN, long: RED, unknown: MUTED };

const fmtDate = (iso: string | undefined) => {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
};

const slug = (value: string) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'session';

export async function buildSessionPdf(report: SessionReport, meta: ReportMeta = {}): Promise<JsPdfType> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const { stats, review } = report;
  let y = 0;

  const color = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const fill = (c: [number, number, number]) => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = (c: [number, number, number]) => doc.setDrawColor(c[0], c[1], c[2]);
  const ensure = (h: number) => {
    if (y + h > BOTTOM) {
      doc.addPage();
      y = M;
    }
  };
  const wrap = (text: string, width: number, size: number, font: string = 'helvetica', style: string = 'normal'): string[] => {
    doc.setFont(font, style);
    doc.setFontSize(size);
    return doc.splitTextToSize(clean(text), width) as string[];
  };
  const paragraph = (text: string, opts: { size?: number; lead?: number; x?: number; width?: number; c?: [number, number, number]; style?: string } = {}) => {
    const size = opts.size ?? 10.5;
    const lead = opts.lead ?? size * 1.5;
    const x = opts.x ?? M;
    const lines = wrap(text, opts.width ?? CONTENT_W, size, 'helvetica', opts.style ?? 'normal');
    color(opts.c ?? INK);
    for (const line of lines) {
      ensure(lead);
      doc.text(line, x, y + size);
      y += lead;
    }
  };
  const heading = (text: string) => {
    ensure(34);
    y += 10;
    doc.setFont('courier', 'bold');
    doc.setFontSize(8.5);
    color(TEAL);
    doc.text(clean(text).toUpperCase().split('').join(' '), M, y + 8);
    stroke(LINE);
    doc.setLineWidth(0.6);
    doc.line(M, y + 15, PAGE_W - M, y + 15);
    y += 26;
  };

  /* header band */
  fill(INK);
  doc.rect(0, 0, PAGE_W, 112, 'F');
  fill(AMBER);
  [[0, 8, 16], [8, 0, 32], [16, 4, 24], [24, 10, 12]].forEach(([dx, dy, h]) => doc.roundedRect(M + dx, 34 + dy, 4, h, 2, 2, 'F'));
  doc.setFont('courier', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(AMBER[0], AMBER[1], AMBER[2]);
  doc.text('I N T E R V I E W   C O A C H', M + 44, 44);
  doc.setFont('times', 'normal');
  doc.setFontSize(31);
  doc.setTextColor(250, 246, 236);
  doc.text('Session report', M + 44, 78);
  y = 112 + 22;

  /* meta row */
  const duration = report.startedAt && report.endedAt ? (new Date(report.endedAt).getTime() - new Date(report.startedAt).getTime()) / 1000 : null;
  const metaItems: Array<[string, string]> = [
    ['Candidate', meta.candidate || '--'],
    ['Interview', meta.interviewTitle || report.interviewTitle || '--'],
    ['Date', fmtDate(report.startedAt)],
    ['Session length', duration != null && duration >= 0 ? fmtDuration(duration) : '--'],
  ];
  const colW = CONTENT_W / 4;
  metaItems.forEach(([label, value], i) => {
    const x = M + i * colW;
    doc.setFont('courier', 'normal');
    doc.setFontSize(7.5);
    color(MUTED);
    doc.text(label.toUpperCase(), x, y);
    const lines = wrap(value, colW - 10, 10.5, 'helvetica', 'bold').slice(0, 2);
    color(INK);
    lines.forEach((line, n) => doc.text(line, x, y + 14 + n * 13));
  });
  y += 46;

  /* KPI boxes */
  const kpis: Array<[string, string]> = [
    ['Answered', `${stats.answered} of ${stats.planned}`],
    ['Total time', fmtDuration(stats.totalSeconds)],
    ['Average answer', fmtDuration(stats.avgSeconds)],
    ['Average score', stats.avgScores ? `${stats.avgScores.overall}/100` : '--'],
  ];
  const gap = 10;
  const boxW = (CONTENT_W - gap * 3) / 4;
  kpis.forEach(([label, value], i) => {
    const x = M + i * (boxW + gap);
    fill(SOFT);
    doc.roundedRect(x, y, boxW, 58, 6, 6, 'F');
    doc.setFont('courier', 'normal');
    doc.setFontSize(7.5);
    color(MUTED);
    doc.text(label.toUpperCase(), x + 12, y + 18);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(19);
    color(INK);
    doc.text(clean(value), x + 12, y + 44);
  });
  y += 58 + 8;
  if (report.endedEarly) {
    paragraph('This session was ended early.', { size: 9, c: MUTED });
  }

  /* score breakdown */
  if (stats.avgScores) {
    heading('Score breakdown');
    const rows: Array<[string, number]> = [
      ['Content', stats.avgScores.content],
      ['Structure', stats.avgScores.structure],
      ['Confidence', stats.avgScores.confidence],
      ['Delivery', stats.avgScores.delivery],
    ];
    for (const [label, value] of rows) {
      ensure(22);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      color(INK);
      doc.text(label, M, y + 9);
      const barX = M + 90;
      const barW = CONTENT_W - 90 - 40;
      fill(SOFT);
      doc.roundedRect(barX, y + 2, barW, 8, 4, 4, 'F');
      fill(value >= 80 ? GREEN : value >= 65 ? AMBER : RED);
      doc.roundedRect(barX, y + 2, Math.max(8, (barW * Math.min(100, Math.max(0, value))) / 100), 8, 4, 4, 'F');
      doc.setFont('helvetica', 'bold');
      color(INK);
      doc.text(String(value), PAGE_W - M, y + 10, { align: 'right' });
      y += 22;
    }
  }

  /* review */
  heading('Summary');
  if (review) {
    paragraph(review.summary);
    if (review.timeManagement) {
      y += 6;
      const lines = wrap(review.timeManagement, CONTENT_W - 28, 10);
      const note = wrap(`Rule of thumb: under 30 seconds is short, over 150 seconds is long. ${stats.timingCounts.short} short, ${stats.timingCounts.good} good, ${stats.timingCounts.long} long.`, CONTENT_W - 28, 8.5);
      const boxH = 16 + 12 + lines.length * 15 + 6 + note.length * 12 + 12;
      ensure(boxH);
      fill(SOFT);
      doc.roundedRect(M, y, CONTENT_W, boxH, 6, 6, 'F');
      fill(AMBER);
      doc.rect(M, y + 6, 3, boxH - 12, 'F');
      doc.setFont('courier', 'bold');
      doc.setFontSize(7.5);
      color(MUTED);
      doc.text('T I M E   A N A L Y S I S', M + 14, y + 17);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      color(INK);
      lines.forEach((line, n) => doc.text(line, M + 14, y + 36 + n * 15));
      doc.setFontSize(8.5);
      color(MUTED);
      note.forEach((line, n) => doc.text(line, M + 14, y + 36 + lines.length * 15 + 8 + n * 12));
      y += boxH + 4;
    }
    const lists: Array<[string, string[]]> = [['What worked', review.strengths], ['Work on', review.improvements], ['Next session', review.nextSteps]];
    for (const [title, items] of lists) {
      if (!items?.length) continue;
      heading(title);
      for (const item of items) {
        const lines = wrap(item, CONTENT_W - 16, 10.5);
        ensure(lines.length * 15 + 4);
        fill(TEAL);
        doc.circle(M + 3, y + 7, 2, 'F');
        color(INK);
        lines.forEach((line, n) => doc.text(line, M + 16, y + 10.5 + n * 15));
        y += lines.length * 15 + 4;
      }
    }
  } else {
    paragraph(report.reviewNote || 'The AI review was not available for this session. The measured numbers below are still correct.', { c: MUTED });
  }

  /* per-answer table */
  heading('Answer by answer');
  const cols = [
    { label: '#', w: 24 },
    { label: 'Question', w: CONTENT_W - 24 - 62 - 38 - 52 - 74 - 38 },
    { label: 'Time', w: 62 },
    { label: 'Score', w: 38 },
    { label: 'Pace', w: 52 },
    { label: 'Pauses', w: 74 },
    { label: 'Fillers', w: 38 },
  ];
  const drawHead = () => {
    ensure(26);
    let x = M;
    doc.setFont('courier', 'bold');
    doc.setFontSize(7.5);
    color(MUTED);
    cols.forEach((c) => {
      doc.text(c.label.toUpperCase(), x, y + 8);
      x += c.w;
    });
    stroke(INK);
    doc.setLineWidth(0.8);
    doc.line(M, y + 14, PAGE_W - M, y + 14);
    y += 20;
  };
  drawHead();
  const best = review?.bestAnswerIndex ?? null;
  const weakest = review?.weakestAnswerIndex ?? null;
  for (const row of stats.perAnswer) {
    const qLines = wrap(row.question, cols[1].w - 10, 8.5);
    const rowH = Math.max(34, qLines.length * 11 + 14);
    if (y + rowH > BOTTOM) {
      doc.addPage();
      y = M;
      drawHead();
    }
    let x = M;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    color(INK);
    doc.text(`${row.index}${row.index === best ? ' *' : row.index === weakest ? ' v' : ''}`, x, y + 10);
    x += cols[0].w;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    color(MUTED);
    qLines.forEach((line, n) => doc.text(line, x, y + 10 + n * 11));
    x += cols[1].w;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    color(INK);
    doc.text(fmtDuration(row.durationSeconds), x, y + 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    color(timingColor[row.timing]);
    doc.text(timingLabel[row.timing], x, y + 21);
    x += cols[2].w;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    color(INK);
    doc.text(row.overall != null ? String(row.overall) : '--', x, y + 10);
    x += cols[3].w;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(row.wpm != null ? `${row.wpm} wpm` : '--', x, y + 10);
    x += cols[4].w;
    doc.text(row.pauses != null ? String(row.pauses) : '--', x, y + 10);
    if (row.pauses != null && row.longestPauseSeconds != null) {
      doc.setFontSize(7.5);
      color(MUTED);
      doc.text(`longest ${row.longestPauseSeconds.toFixed(1)}s`, x, y + 21);
    }
    x += cols[5].w;
    doc.setFontSize(9);
    color(INK);
    doc.text(String(row.fillers), x, y + 10);
    stroke(LINE);
    doc.setLineWidth(0.5);
    doc.line(M, y + rowH - 4, PAGE_W - M, y + rowH - 4);
    y += rowH;
  }
  y += 4;
  paragraph('Pace and pauses are measured from your audio; a dash means that answer could not be measured. * best answer, v needs the most work.', { size: 8, c: MUTED, lead: 11 });

  /* footer on every page */
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    stroke(LINE);
    doc.setLineWidth(0.5);
    doc.line(M, PAGE_H - 38, PAGE_W - M, PAGE_H - 38);
    doc.setFont('courier', 'normal');
    doc.setFontSize(7.5);
    color(MUTED);
    doc.text('INTERVIEW COACH', M, PAGE_H - 24);
    doc.text(`PAGE ${p} OF ${pages}`, PAGE_W - M, PAGE_H - 24, { align: 'right' });
  }
  return doc;
}

function storedCandidate(): string | undefined {
  try {
    const raw = localStorage.getItem('interview-coach-user');
    const name = raw ? (JSON.parse(raw) as { name?: string }).name : undefined;
    return name || undefined;
  } catch {
    return undefined;
  }
}

export async function downloadSessionPdf(report: SessionReport, meta: ReportMeta = {}): Promise<void> {
  const doc = await buildSessionPdf(report, { candidate: storedCandidate(), ...meta });
  const day = (report.startedAt || new Date().toISOString()).slice(0, 10);
  doc.save(`interview-report-${slug(meta.interviewTitle || report.interviewTitle || 'session')}-${day}.pdf`);
}
