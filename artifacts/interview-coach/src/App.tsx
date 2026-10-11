import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowUpRight, BookOpen, ChevronRight, CircleHelp,
  Clock3, FileText, Gauge, Info, Loader2, Mic, Play, Plus, Radio, RotateCcw,
  RefreshCw, Settings2, ShieldCheck, Sparkles, Square, TimerReset, TriangleAlert, Waves,
} from 'lucide-react';
import {
  getGetInterviewQueryKey, getGetProviderStatusQueryKey, getListInterviewsQueryKey,
  setBaseUrl,
  useAnalyzeInterviewAnswer, useCreateInterview, useGetInterview, useGetProviderStatus,
  useListInterviews,
} from '@workspace/api-client-react';
import type {
  AnswerAnalysis, Interview, InterviewInput, InterviewSummary, Provider,
} from '@workspace/api-client-react';
import { Link, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { PAUSE_MIN_SECONDS, analyzeAudioDelivery, computeWpm, countFillers, countWords } from '@/lib/audio-metrics';
import type { AudioMetrics } from '@/lib/audio-metrics';

const queryClient = new QueryClient();
if (import.meta.env.VITE_API_BASE_URL) {
  setBaseUrl(import.meta.env.VITE_API_BASE_URL);
}

const cn = (...classes: Array<string | false | undefined>) => classes.filter(Boolean).join(' ');
const formatDate = (value?: string) => value ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(value)) : '—';
const formatTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
const scoreTone = (score?: number | null) => score == null ? 'text-muted-foreground' : score >= 80 ? 'text-[#267467]' : score >= 65 ? 'text-[#ae7219]' : 'text-[#b54c42]';
const asAnalysis = (value: unknown): AnswerAnalysis | null => value && typeof value === 'object' ? value as AnswerAnalysis : null;
const browserPreferredModels = ['qwen3:8b', 'llama3.1:8b', 'mistral:7b'];
const readableProviderError = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return 'This secure preview cannot connect directly to HTTP Ollama on your computer. Run the app locally with Ollama, or configure a reachable HTTPS provider.';
  }
  return message || 'No AI provider is available. Start Ollama and try again.';
};

async function analyzeWithBrowserOllama(input: {
  question: string;
  transcript: string;
  durationSeconds: number;
  pauseCount: number;
  fillerWordCount: number;
  resumeContext?: string;
  topic?: string;
}): Promise<AnswerAnalysis> {
  const tagsResponse = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2500) });
  if (!tagsResponse.ok) throw new Error('Ollama is not reachable from this browser.');
  const tags = await tagsResponse.json() as { models?: Array<{ name?: string }> };
  const installedModels = (tags.models || []).map((model) => model.name).filter((model): model is string => Boolean(model));
  const model = browserPreferredModels.find((candidate) => installedModels.some((installed) => installed === candidate || installed.startsWith(`${candidate}:`)));
  if (!model) throw new Error('Ollama is running, but qwen3:8b, llama3.1:8b, or mistral:7b is not installed.');
  const prompt = `You are a rigorous but encouraging mock interview coach. Return ONLY valid JSON with this exact shape:
{"scores":{"overall":0,"content":0,"structure":0,"confidence":0,"delivery":0},"summary":"","strengths":[],"improvements":[],"improvedAnswer":"","followUpQuestions":[],"riskFlags":[]}
Scores are integers from 0 to 100. Be specific and actionable. Evaluate correctness, relevance, structure, confidence, clarity, concision, pauses, filler words, and real-interview risks. Do not diagnose personality or protected traits. Use only facts from the transcript and resume context; never invent projects, employers or achievements, and use [bracketed placeholders] for missing details in improvedAnswer.

Question: ${input.question}
Transcript: ${input.transcript}
Duration seconds: ${input.durationSeconds}
Detected pauses: ${input.pauseCount}
Detected filler words: ${input.fillerWordCount}
Resume context: ${input.resumeContext || 'Not provided'}
Topic: ${input.topic || 'General interview'}`;
  const chatResponse = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: 'json',
      think: false,
      messages: [{ role: 'system', content: 'Return only JSON.' }, { role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!chatResponse.ok) throw new Error('Ollama could not analyze this answer.');
  const payload = await chatResponse.json() as { message?: { content?: string } };
  const content = payload.message?.content;
  if (!content) throw new Error('Ollama returned an empty analysis.');
  const cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(cleaned) as Omit<AnswerAnalysis, 'provider' | 'model' | 'pauseCount' | 'fillerWordCount'>;
  return { ...parsed, provider: 'Ollama (browser)', model, pauseCount: input.pauseCount, fillerWordCount: input.fillerWordCount };
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return (
    <div className="noise min-h-[100dvh] bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[238px] flex-col bg-sidebar px-5 py-6 text-sidebar-foreground md:flex">
        <Link href="/" data-testid="link-brand" className="mb-12 flex items-center gap-3 no-underline">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"><Waves size={19} strokeWidth={2.5} /></span>
          <span className="text-[15px] font-extrabold tracking-[-0.02em]">Interview Coach</span>
        </Link>
        <p className="mono mb-3 px-3 text-[10px] uppercase tracking-[0.2em] text-sidebar-foreground/45">Your room</p>
        <nav className="space-y-1">
          <Link href="/" data-testid="link-dashboard" className={cn('flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition-colors', location === '/' ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/65 hover:bg-white/5 hover:text-sidebar-foreground')}>
            <Gauge size={17} /> Practice desk
          </Link>
          <Link href="/settings" data-testid="link-settings" className={cn('flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition-colors', location === '/settings' ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground/65 hover:bg-white/5 hover:text-sidebar-foreground')}>
            <Settings2 size={17} /> Providers & settings
          </Link>
        </nav>
        <div className="mt-auto rounded-2xl border border-white/10 bg-white/[0.045] p-4">
          <div className="mb-3 flex items-center gap-2 text-sidebar-primary"><ShieldCheck size={16} /><span className="mono text-[10px] uppercase tracking-[0.15em]">Private by default</span></div>
          <p className="text-xs leading-5 text-sidebar-foreground/55">Your practice stays yours. Choose a local model when you want no-key, offline analysis.</p>
        </div>
      </aside>
      <header className="flex items-center justify-between border-b border-border bg-background/90 px-5 py-4 backdrop-blur md:hidden">
        <Link href="/" data-testid="link-mobile-brand" className="flex items-center gap-2 text-sm font-extrabold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-sidebar text-sidebar-primary"><Waves size={16} /></span> Interview Coach</Link>
        <Link href="/settings" data-testid="link-mobile-settings" className="rounded-lg p-2 text-muted-foreground"><Settings2 size={18} /></Link>
      </header>
      <main className="min-h-[100dvh] md:pl-[238px]">{children}</main>
    </div>
  );
}

function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
    <div><p className="mono mb-3 text-[10px] uppercase tracking-[0.19em] text-primary">{eyebrow}</p><h1 className="serif text-4xl leading-[1.05] tracking-[-0.035em] text-foreground sm:text-[46px]">{title}</h1></div>
    {children}
  </div>;
}

function EmptyState({ onCreate, compact }: { onCreate: () => void; compact?: boolean }) {
  return <div className={cn('animate-rise-in rounded-[24px] border border-dashed border-border bg-card/60 px-6 text-center shadow-sm sm:px-16', compact ? 'py-8' : 'py-16')}>
    <span className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-primary"><BookOpen size={23} /></span>
    <h2 className="serif text-2xl">Your rehearsal room is ready.</h2>
    <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Start with one role and one honest answer. Coach will look at the words and the way you delivered them.</p>
    <button onClick={onCreate} data-testid="button-empty-create" className="mt-7 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-md transition-transform hover:-translate-y-0.5"><Plus size={16} /> New interview</button>
  </div>;
}

function SkeletonRows() {
  return <div className="space-y-3">{[1, 2, 3].map((item) => <div key={item} className="h-[74px] animate-pulse rounded-2xl bg-secondary/70" />)}</div>;
}

function NewInterviewDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreateInterview();
  const [, setLocation] = useLocation();
  const [form, setForm] = useState<InterviewInput>({ title: '', role: '', company: '', topic: 'Behavioral', resumeContext: '' });
  if (!open) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.title.trim() || !form.role.trim()) return;
    create.mutate({ data: form }, { onSuccess: (interview) => { queryClient.invalidateQueries({ queryKey: getListInterviewsQueryKey() }); onClose(); setLocation(`/interviews/${interview.id}`); } });
  };
  return <div className="fixed inset-0 z-50 grid items-start justify-items-center overflow-y-auto bg-[#172333]/50 p-4 backdrop-blur-sm sm:items-center">
    <div role="dialog" aria-modal="true" className="animate-rise-in my-0 max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-[24px] border border-border bg-card p-6 shadow-lg sm:my-4 sm:p-8">
      <div className="mb-7 flex items-start justify-between"><div><p className="mono text-[10px] uppercase tracking-[0.18em] text-primary">New rehearsal</p><h2 className="serif mt-2 text-3xl">Set the room.</h2></div><button onClick={onClose} data-testid="button-close-dialog" className="rounded-lg p-2 text-muted-foreground hover:bg-secondary">×</button></div>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Session name" value={form.title} placeholder="Product sense warm-up" onChange={(value) => setForm({ ...form, title: value })} testId="input-interview-title" />
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Role" value={form.role} placeholder="Product designer" onChange={(value) => setForm({ ...form, role: value })} testId="input-interview-role" /><Field label="Company (optional)" value={form.company || ''} placeholder="Northstar" onChange={(value) => setForm({ ...form, company: value })} testId="input-interview-company" /></div>
        <div><label className="mb-2 block text-xs font-bold text-foreground/70">Focus</label><select value={form.topic} onChange={(event) => setForm({ ...form, topic: event.target.value })} data-testid="select-interview-topic" className="w-full rounded-xl border border-input bg-background px-3.5 py-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"><option>Behavioral</option><option>Technical: Java &amp; DSA</option><option>Technical: Web development</option><option>HR &amp; introduction</option><option>Product thinking</option><option>Leadership</option><option>Technical communication</option></select></div>
        <div><label className="mb-2 block text-xs font-bold text-foreground/70">Context (optional)</label><textarea value={form.resumeContext || ''} onChange={(event) => setForm({ ...form, resumeContext: event.target.value })} data-testid="textarea-resume-context" rows={3} placeholder="Paste a few lines from your resume or the job brief…" className="w-full resize-none rounded-xl border border-input bg-background px-3.5 py-3 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/15" /></div>
        <button disabled={create.isPending} data-testid="button-create-interview" className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-bold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60">{create.isPending ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Create room</button>
        {create.isError && <p className="text-center text-xs text-destructive">Couldn’t create this room. Try again.</p>}
      </form>
    </div>
  </div>;
}

function Field({ label, value, placeholder, onChange, testId }: { label: string; value: string; placeholder: string; onChange: (value: string) => void; testId: string }) {
  return <div><label className="mb-2 block text-xs font-bold text-foreground/70">{label}</label><input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} data-testid={testId} className="w-full rounded-xl border border-input bg-background px-3.5 py-3 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/15" /></div>;
}

function InterviewRow({ interview }: { interview: InterviewSummary }) {
  return <Link href={`/interviews/${interview.id}`} data-testid={`link-interview-${interview.id}`} className="group grid grid-cols-[1fr_auto] items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md sm:grid-cols-[1fr_130px_100px_72px]">
    <div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate text-sm font-bold">{interview.title}</h3><span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', interview.status === 'completed' ? 'bg-[#e2f0e8] text-[#267467]' : 'bg-[#fff0d2] text-[#9b6819]')}>{interview.status === 'completed' ? 'Completed' : 'In practice'}</span></div><p className="mt-1 truncate text-xs text-muted-foreground">{interview.role}{interview.company ? ` · ${interview.company}` : ''}</p></div>
    <span className="hidden text-xs text-muted-foreground sm:block">{interview.answerCount || 0} answers</span><span className="hidden text-xs text-muted-foreground sm:block">Updated {formatDate(interview.updatedAt)}</span><span className={cn('text-right text-xl font-extrabold tracking-tight', scoreTone(interview.score))}>{interview.score != null ? `${Math.round(interview.score)}` : '—'}<span className="ml-1 text-[10px] font-semibold text-muted-foreground">/100</span></span>
    <ChevronRight size={17} className="absolute right-2 opacity-0 transition-opacity group-hover:opacity-60 sm:static" />
  </Link>;
}

function PracticeWorkspace({ interview }: { interview: Interview }) {
  const [, setLocation] = useLocation();
  const analyze = useAnalyzeInterviewAnswer();
  const [question, setQuestion] = useState('');
  const [questionMode, setQuestionMode] = useState<'ai' | 'bank'>('ai');
  const [questionSource, setQuestionSource] = useState<'ai' | 'bank' | ''>('');
  const [questionNote, setQuestionNote] = useState('');
  const [questionLoading, setQuestionLoading] = useState(false);
  const [audioMetrics, setAudioMetrics] = useState<AudioMetrics | null>(null);
  const [audioNote, setAudioNote] = useState('');
  const firstQuestionLoadedFor = useRef('');
  const [transcript, setTranscript] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [recordError, setRecordError] = useState('');
  const [recordedVideoUrl, setRecordedVideoUrl] = useState('');
  const [analysisError, setAnalysisError] = useState('');
  const [isLocalAnalyzing, setIsLocalAnalyzing] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);

  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    if (recordedVideoUrl) URL.revokeObjectURL(recordedVideoUrl);
  }, [recordedVideoUrl]);

  const loadQuestion = async (fresh: boolean, mode: 'ai' | 'bank' = questionMode) => {
    setQuestionLoading(true);
    setQuestionNote('');
    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL || '';
      const res = await fetch(`${apiBase}/api/interviews/${interview.id}/next-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, fresh }),
      });
      if (!res.ok) throw new Error('Could not load a question.');
      const data = await res.json() as { question: string; source: 'ai' | 'bank'; note?: string };
      setQuestion(data.question);
      setQuestionSource(data.source);
      setQuestionNote(data.note || '');
    } catch {
      setQuestionNote('Could not load a question. You can type your own question above.');
    } finally {
      setQuestionLoading(false);
    }
  };

  // Load the current (or a first) question once per interview.
  useEffect(() => {
    if (firstQuestionLoadedFor.current === interview.id) return;
    firstQuestionLoadedFor.current = interview.id;
    loadQuestion(false);
  }, [interview.id]);

  const measureAudio = async (blob: Blob) => {
    setAudioMetrics(null);
    setAudioNote('Measuring pauses and pace from the audio...');
    try {
      const metrics = await analyzeAudioDelivery(blob);
      setAudioMetrics(metrics);
      setAudioNote(metrics.reliable ? '' : 'The audio was too quiet or too short to measure pauses reliably.');
    } catch {
      setAudioNote('This browser could not read the audio track, so pauses and pace were not measured.');
    }
  };

  const fillerInfo = useMemo(() => countFillers(transcript), [transcript]);
  const wordCount = useMemo(() => countWords(transcript), [transcript]);
  const measured = audioMetrics && audioMetrics.reliable ? audioMetrics : null;
  const wpm = computeWpm(wordCount, measured);

  const resetAnswer = () => {
    setTranscript('');
    setSeconds(0);
    setAudioMetrics(null);
    setAudioNote('');
    setAnalysisError('');
    setRecordedVideoUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return ''; });
  };

  const transcribeAudio = async (blob: Blob) => {
    setIsTranscribing(true);
    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL || '';
      const res = await fetch(`${apiBase}/api/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': blob.type || 'audio/webm',
        },
        body: blob,
      });
      if (res.ok) {
        const data = await res.json() as { transcript?: string };
        if (data.transcript) {
          setTranscript(data.transcript);
          setRecordError('');
        }
      } else {
        const err = await res.json().catch(() => ({}));
        console.warn('Transcription service error:', err);
      }
    } catch (err) {
      console.error('Auto-transcribe network error:', err);
    } finally {
      setIsTranscribing(false);
    }
  };

  const startRecording = async () => {
    setRecordError('');
    setAudioMetrics(null);
    setAudioNote('');
    if (!navigator.mediaDevices?.getUserMedia) { setRecordError('Camera and microphone access is not available here. Use the transcript below instead.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder; chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const recordedBlob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' });
        setRecordedVideoUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return URL.createObjectURL(recordedBlob); });
        transcribeAudio(recordedBlob);
        measureAudio(recordedBlob);
      };

      // Live speech recognition in browser as the user talks
      const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognitionClass) {
        try {
          const recognition = new SpeechRecognitionClass();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = 'en-US';
          recognition.onresult = (event: any) => {
            let full = '';
            for (let i = 0; i < event.results.length; i++) {
              full += event.results[i][0].transcript + ' ';
            }
            setTranscript(full.trim());
          };
          recognition.onerror = (e: any) => {
            console.warn('Live SpeechRecognition error:', e);
          };
          recognition.start();
          recognitionRef.current = recognition;
        } catch (e) {
          console.warn('Could not initialize SpeechRecognition:', e);
        }
      }

      recorder.start(); setSeconds(0); setIsRecording(true);
      timerRef.current = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    } catch { setRecordError('We could not access your camera or microphone. Check browser permissions, then try again.'); }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    if (timerRef.current) window.clearInterval(timerRef.current);
    setIsRecording(false);
  };

  const uploadVideo = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setRecordedVideoUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return URL.createObjectURL(file); });
    setRecordError('');
    transcribeAudio(file);
    measureAudio(file);
  };

  const submitAnswer = async (event: FormEvent) => {
    event.preventDefault();
    if (!question.trim() || !transcript.trim()) return;
    setAnalysisError('');
    const delivery = {
      measured: !!measured,
      pauseCount: measured?.pauseCount ?? 0,
      totalPauseSeconds: measured?.totalPauseSeconds ?? 0,
      longestPauseSeconds: measured?.longestPauseSeconds ?? 0,
      speakingSeconds: measured?.speakingSeconds ?? 0,
      spanSeconds: measured?.spanSeconds ?? 0,
      wordsPerMinute: wpm,
      fillerWordCount: fillerInfo.total,
      fillerBreakdown: fillerInfo.breakdown,
    };
    const data = { question, transcript, durationSeconds: Math.round(audioMetrics?.durationSeconds ?? seconds), pauseCount: delivery.pauseCount, fillerWordCount: fillerInfo.total, resumeContext: interview.resumeContext, topic: interview.topic, delivery };
    const finish = (analysis: AnswerAnalysis) => {
      sessionStorage.setItem(`interview-analysis-${interview.id}`, JSON.stringify(analysis));
      queryClient.invalidateQueries({ queryKey: getGetInterviewQueryKey(interview.id) });
      queryClient.invalidateQueries({ queryKey: getListInterviewsQueryKey() });
      setLocation(`/interviews/${interview.id}`);
      resetAnswer();
      loadQuestion(true);
      window.setTimeout(() => document.getElementById('analysis-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 600);
    };
    try {
      finish(await analyze.mutateAsync({ id: interview.id, data }));
    } catch (err: any) {
      const serverMessage = err?.response?.data?.error || err?.message;
      setIsLocalAnalyzing(true);
      try {
        const browserAnalysis = await analyzeWithBrowserOllama(data);
        finish(await analyze.mutateAsync({ id: interview.id, data: { ...data, clientAnalysis: browserAnalysis } }));
      } catch (browserError) {
        setAnalysisError(serverMessage || readableProviderError(browserError));
      } finally {
        setIsLocalAnalyzing(false);
      }
    }
  };
  return <section className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(310px,.65fr)]">
    <div className="overflow-hidden rounded-[24px] border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-[#edf3ef] px-6 py-5 sm:px-8"><div className="flex items-center justify-between gap-4"><div><p className="mono text-[10px] uppercase tracking-[0.18em] text-primary">On deck · {interview.topic || 'Open practice'}</p><h2 className="serif mt-2 text-2xl leading-tight">One answer at a time.</h2></div><span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-card text-primary shadow-sm"><Mic size={19} /></span></div></div>
      <form onSubmit={submitAnswer} className="p-6 sm:p-8">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <label className="block text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground">The question</label>
          <div className="flex items-center gap-2">
            <select value={questionMode} onChange={(event) => { const mode = event.target.value as 'ai' | 'bank'; setQuestionMode(mode); loadQuestion(true, mode); }} disabled={isRecording} data-testid="select-question-mode" className="rounded-lg border border-input bg-background px-2 py-1.5 text-xs font-semibold outline-none"><option value="ai">AI-generated questions</option><option value="bank">Built-in question bank</option></select>
            <button type="button" onClick={() => loadQuestion(true)} disabled={questionLoading || isRecording} data-testid="button-new-question" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-primary hover:bg-secondary disabled:opacity-50">{questionLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} New question</button>
          </div>
        </div>
        <textarea value={question} onChange={(event) => setQuestion(event.target.value)} data-testid="textarea-question" rows={3} className="w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-lg font-semibold leading-7 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
         {(questionNote || questionSource) && <p className="mt-2 text-xs text-muted-foreground" data-testid="text-question-note">{questionSource ? `Source: ${questionSource === 'ai' ? 'AI-generated' : 'built-in question bank'}. ` : ''}{questionNote}</p>}
         <div className="relative mt-6 aspect-[16/8] min-h-[190px] overflow-hidden rounded-2xl bg-[#1e2b35]">
           {recordedVideoUrl && !isRecording && <video src={recordedVideoUrl} controls playsInline data-testid="video-recorded-answer" className="absolute inset-0 h-full w-full object-cover opacity-80" />}
          <video ref={videoRef} autoPlay muted playsInline data-testid="video-camera-preview" className={cn('absolute inset-0 h-full w-full object-cover', isRecording ? 'opacity-70' : 'opacity-0')} />
          <div className="relative flex h-full flex-col items-center justify-center bg-[#1e2b35]/45 text-center text-white/75">
            <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5"><span className={cn('h-2 w-2 rounded-full', isRecording ? 'animate-pulse bg-[#e97b64]' : 'bg-white/35')} /><span className="mono text-[10px] uppercase tracking-[0.17em]">{isRecording ? 'Recording' : 'Camera ready'}</span></div>
            <div className="mb-3 grid h-16 w-16 place-items-center rounded-full border border-white/10 bg-white/[0.07]">{isRecording ? <span className="mono text-lg text-[#f3c66f]">{formatTime(seconds)}</span> : <Play size={22} className="ml-1 text-[#f3c66f]" />}</div>
             <p className="text-xs">{isRecording ? 'Take your time. Clarity over speed.' : isTranscribing ? 'Transcribing your answer with AI...' : recordedVideoUrl ? 'Your recorded answer is ready to review.' : 'Your camera preview will appear here.'}</p>
            {!isRecording ? <button type="button" onClick={startRecording} data-testid="button-start-recording" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#f3c66f] px-4 py-2 text-xs font-extrabold text-[#1e2b35]"><Radio size={14} /> Start recording</button> : <button type="button" onClick={stopRecording} data-testid="button-stop-recording" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#e97b64] px-4 py-2 text-xs font-extrabold text-white"><Square size={13} fill="currentColor" /> Stop & review</button>}
             {!isRecording && <label htmlFor="video-upload" className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-xs font-bold text-white hover:bg-white/15"><FileText size={14} /> Upload a video<input id="video-upload" type="file" accept="video/*" onChange={uploadVideo} className="sr-only" /></label>}
          </div>
        </div>
        {recordError && <div className="mt-3 flex items-start gap-2 rounded-xl bg-[#fff2df] px-3 py-2.5 text-xs leading-5 text-[#8b5d1a]"><Info size={15} className="mt-0.5 shrink-0" /> {recordError}</div>}
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-[0.1em] text-muted-foreground flex items-center gap-2">
              Transcript
              {isTranscribing && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary"><Loader2 size={12} className="animate-spin" /> Transcribing with AI...</span>}
            </label>
            <span className="text-[11px] text-muted-foreground">{transcript.length} characters</span>
          </div>
          <textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} data-testid="textarea-transcript" rows={5} placeholder="Your spoken answer will be transcribed automatically as you speak, or you can paste/edit here." className="w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm leading-6 outline-none placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-primary/15" />
        </div>
         <div className="mt-5 grid grid-cols-3 gap-2 rounded-2xl bg-secondary/60 p-3">
           <Signal label="Recorded" value={formatTime(Math.round(measured?.durationSeconds ?? seconds))} icon={<Clock3 size={14} />} />
           <Signal label="Speaking" value={measured ? formatTime(Math.round(measured.speakingSeconds)) : '--'} icon={<Mic size={14} />} />
           <Signal label="Pace (WPM)" value={wpm != null ? String(wpm) : '--'} icon={<Gauge size={14} />} />
           <Signal label="Pauses" value={measured ? String(measured.pauseCount) : '--'} icon={<TimerReset size={14} />} />
           <Signal label="Longest pause" value={measured ? `${measured.longestPauseSeconds.toFixed(1)}s` : '--'} icon={<TimerReset size={14} />} />
           <Signal label="Fillers" value={String(fillerInfo.total)} icon={<FileText size={14} />} />
         </div>
         <p className="mt-2 text-right text-[10px] text-muted-foreground" data-testid="text-delivery-note">{audioNote || (measured ? `Pauses (silence of ${PAUSE_MIN_SECONDS}s or more), speaking time and pace are measured from your recorded audio. Fillers are counted in the transcript.` : 'Record or upload a video to measure pauses and pace from the audio. Fillers are counted in the transcript.')}</p>
         <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
           <button type="button" onClick={resetAnswer} data-testid="button-reset-answer" className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-muted-foreground hover:bg-secondary"><RotateCcw size={15} /> Reset</button>
           <button disabled={analyze.isPending || isLocalAnalyzing || isTranscribing || !transcript.trim() || !question.trim()} data-testid="button-analyze-answer" className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-md transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45">
             {analyze.isPending || isLocalAnalyzing ? (
               <><Loader2 size={16} className="animate-spin" /> {isLocalAnalyzing ? 'Checking local Ollama' : 'Analyzing your answer...'}</>
             ) : isTranscribing ? (
               <><Loader2 size={16} className="animate-spin" /> Transcribing audio...</>
             ) : (
               <><Sparkles size={16} /> Analyze this answer</>
             )}
           </button>
         </div>
         {(analysisError || analyze.isError) && <p className="mt-3 text-right text-xs text-destructive">{analysisError || 'Analysis could not run. Check your provider in settings and try again.'}</p>}
      </form>
    </div>
    <div className="space-y-5"><div className="rounded-[24px] border border-border bg-card p-6 shadow-sm"><div className="mb-5 flex items-center gap-2"><CircleHelp size={17} className="text-primary" /><h3 className="text-sm font-extrabold">A useful rhythm</h3></div><div className="space-y-4">{[['01', 'Frame it', 'Lead with the situation, not the backstory.'], ['02', 'Show your work', 'Name the choice you made and why.'], ['03', 'Land the learning', 'Close with the result or what changed.']].map(([number, title, body]) => <div key={number} className="flex gap-3"><span className="mono pt-0.5 text-[10px] text-primary">{number}</span><div><p className="text-sm font-bold">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{body}</p></div></div>)}</div></div><div className="rounded-[24px] border border-[#d9e8e0] bg-[#eef6f0] p-6"><div className="flex items-start gap-3"><ShieldCheck size={18} className="mt-0.5 shrink-0 text-[#267467]" /><div><h3 className="text-sm font-extrabold text-[#225b52]">Your private rehearsal room</h3><p className="mt-2 text-xs leading-5 text-[#47756c]">Coach scores content and delivery together. Start with local Ollama for a no-key path.</p><Link href="/settings" data-testid="link-workspace-settings" className="mt-4 inline-flex items-center gap-1 text-xs font-extrabold text-[#267467]">Check providers <ArrowUpRight size={13} /></Link></div></div></div></div>
  </section>;
}

function Signal({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return <div className="text-center"><div className="mb-1 flex items-center justify-center gap-1 text-muted-foreground">{icon}<span className="text-[10px] font-bold uppercase tracking-wide">{label}</span></div><p className="mono text-sm font-medium">{value}</p></div>;
}

function Dashboard() {
  const { data: interviewsData, isLoading, isError, refetch } = useListInterviews({ query: { queryKey: getListInterviewsQueryKey() } });
  const interviews = Array.isArray(interviewsData) ? interviewsData : [];
  const [isDialogOpen, setDialogOpen] = useState(false);
   return <div className="mx-auto max-w-[1440px] px-5 py-8 sm:px-8 sm:py-12 lg:px-12">
    <PageHeader eyebrow="Practice desk" title="Make the next answer clearer."><button onClick={() => setDialogOpen(true)} data-testid="button-new-interview" className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground shadow-md transition-transform hover:-translate-y-0.5"><Plus size={16} /> New interview</button></PageHeader>
    {isError ? <div className="rounded-2xl border border-[#edc8c3] bg-[#fff2ef] p-6"><div className="flex items-center gap-2 font-bold text-[#a94e45]"><TriangleAlert size={17} /> We could not load your practice rooms.</div><button onClick={() => refetch()} data-testid="button-retry-interviews" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#a94e45] px-3 py-2 text-xs font-bold text-white">Try again <RotateCcw size={13} /></button></div> : isLoading ? <SkeletonRows /> : <div className="space-y-8"><EmptyState compact={interviews.length > 0} onCreate={() => setDialogOpen(true)} />{interviews.length > 0 && (
      <section className="animate-rise-in" style={{ animationDelay: '100ms' }}><div className="mb-4 flex items-end justify-between"><div><p className="mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Your rooms</p><h2 className="serif mt-2 text-2xl">Keep the thread.</h2></div><span className="text-xs text-muted-foreground">{interviews.length} total</span></div><div className="space-y-2">{interviews.map((interview) => <InterviewRow key={interview.id} interview={interview} />)}</div></section>)}
    </div>}
    <NewInterviewDialog open={isDialogOpen} onClose={() => setDialogOpen(false)} />
  </div>;
}

function ScoreGrid({ scores }: { scores: AnswerAnalysis['scores'] }) {
  const entries = [['overall', 'Overall'], ['content', 'Content'], ['structure', 'Structure'], ['confidence', 'Confidence'], ['delivery', 'Delivery']] as const;
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{entries.map(([key, label]) => <div key={key} className={cn('rounded-2xl p-4', key === 'overall' ? 'bg-primary text-primary-foreground' : 'bg-secondary/70')}><p className="text-[10px] font-bold uppercase tracking-[0.1em] opacity-70">{label}</p><p className="mt-2 text-2xl font-extrabold">{Math.round(scores[key])}<span className="ml-1 text-xs font-medium opacity-60">/100</span></p></div>)}</div>;
}

function AnalysisPanel({ analysis }: { analysis: AnswerAnalysis }) {
  return <div className="space-y-5 animate-rise-in"><ScoreGrid scores={analysis.scores} /><div className="grid gap-5 lg:grid-cols-2"><div className="rounded-[22px] border border-border bg-card p-6 shadow-sm"><div className="mb-3 flex items-center gap-2"><Sparkles size={17} className="text-primary" /><h3 className="text-sm font-extrabold">Coach’s read</h3></div><p className="text-sm leading-7 text-muted-foreground">{analysis.summary}</p><div className="mt-5 flex flex-wrap gap-2 text-[10px] text-muted-foreground"><span className="rounded-full bg-secondary px-2.5 py-1">Provider · {analysis.provider}</span><span className="rounded-full bg-secondary px-2.5 py-1">Model · {analysis.model}</span></div></div><div className="rounded-[22px] border border-border bg-card p-6 shadow-sm"><h3 className="mb-4 text-sm font-extrabold">Delivery signals</h3><div className="grid grid-cols-2 gap-3"><Metric label="Pauses" value={`${analysis.pauseCount ?? 0}`} note="intentional beats help" /><Metric label="Filler words" value={`${analysis.fillerWordCount ?? 0}`} note="watch the default phrases" /></div></div></div><div className="grid gap-5 lg:grid-cols-2"><ListBlock title="What landed" items={analysis.strengths} tone="good" /><ListBlock title="Try next time" items={analysis.improvements} tone="warn" /></div><div className="rounded-[22px] border border-[#d9e8e0] bg-[#eef6f0] p-6"><p className="mono text-[10px] uppercase tracking-[0.16em] text-[#267467]">A sharper version</p><p className="mt-3 text-sm leading-7 text-[#315e57]">{analysis.improvedAnswer}</p></div>{analysis.followUpQuestions?.length > 0 && <div className="rounded-[22px] border border-border bg-card p-6 shadow-sm"><h3 className="mb-4 text-sm font-extrabold">Possible follow-ups</h3><div className="space-y-3">{analysis.followUpQuestions.map((question, index) => <div key={question} className="flex gap-3 text-sm"><span className="mono text-[10px] text-primary">0{index + 1}</span><p>{question}</p></div>)}</div></div>}{analysis.riskFlags?.length > 0 && <div className="rounded-[22px] border border-[#edc8c3] bg-[#fff2ef] p-5 text-sm text-[#954a42]"><div className="mb-3 flex items-center gap-2 font-extrabold"><TriangleAlert size={16} /> Watch-outs</div><ul className="list-disc space-y-1 pl-5">{analysis.riskFlags.map((flag) => <li key={flag}>{flag}</li>)}</ul></div>}</div>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="rounded-xl bg-secondary/70 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mono mt-2 text-xl font-medium">{value}</p><p className="mt-1 text-[10px] text-muted-foreground">{note}</p></div>;
}

function ListBlock({ title, items, tone }: { title: string; items: string[]; tone: 'good' | 'warn' }) {
  return <div className="rounded-[22px] border border-border bg-card p-6 shadow-sm"><h3 className="mb-4 text-sm font-extrabold">{title}</h3><ul className="space-y-3">{items?.map((item) => <li key={item} className="flex gap-3 text-sm leading-6 text-muted-foreground"><span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', tone === 'good' ? 'bg-[#4c9a89]' : 'bg-[#d49a40]')} />{item}</li>)}</ul></div>;
}

function InterviewDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id || '';
  const { data: interview, isLoading, isError, refetch } = useGetInterview(id, { query: { enabled: !!id, queryKey: getGetInterviewQueryKey(id) } });
  const [selectedId, setSelectedId] = useState('');
  const [localAnalysis, setLocalAnalysis] = useState<AnswerAnalysis | null>(null);
  useEffect(() => { const stored = sessionStorage.getItem(`interview-analysis-${id}`); if (stored) { try { setLocalAnalysis(JSON.parse(stored) as AnswerAnalysis); } catch { setLocalAnalysis(null); } } }, [id]);
  const selected = useMemo(() => interview?.answers?.find((answer) => answer.id === selectedId) || interview?.answers?.[Math.max((interview?.answers?.length || 1) - 1, 0)], [interview, selectedId]);
  const analysis = asAnalysis(selected?.analysis) || localAnalysis;
  if (isLoading) return <div className="mx-auto max-w-5xl px-5 py-12"><SkeletonRows /></div>;
  if (isError || !interview) return <div className="mx-auto max-w-5xl px-5 py-12"><div className="rounded-2xl border border-[#edc8c3] bg-[#fff2ef] p-6 text-sm text-[#954a42]">This interview could not be opened. <button onClick={() => refetch()} data-testid="button-retry-detail" className="ml-2 font-bold underline">Try again</button></div></div>;
  return <div className="mx-auto max-w-[1240px] px-5 py-8 sm:px-8 sm:py-12 lg:px-12"><Link href="/" data-testid="link-back-dashboard" className="mb-8 inline-flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-foreground"><ArrowLeft size={15} /> Back to practice desk</Link><PageHeader eyebrow={`${interview.role}${interview.company ? ` · ${interview.company}` : ''}`} title={interview.title}><span className="rounded-full bg-[#e2f0e8] px-3 py-1.5 text-xs font-bold text-[#267467]">{interview.answerCount || interview.answers.length} answers logged</span></PageHeader><div className="mb-8"><PracticeWorkspace interview={interview} /></div><div className="grid gap-5 xl:grid-cols-[290px_minmax(0,1fr)]"><aside className="h-fit rounded-[22px] border border-border bg-card p-4 shadow-sm"><div className="mb-4 flex items-center justify-between px-2"><p className="mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Answer history</p><span className="text-xs text-muted-foreground">{interview.answers.length}</span></div>{interview.answers.length ? <div className="space-y-1">{interview.answers.map((answer, index) => { const answerAnalysis = asAnalysis(answer.analysis); return <button key={answer.id} onClick={() => { setSelectedId(answer.id); setLocalAnalysis(null); }} data-testid={`button-answer-${answer.id}`} className={cn('w-full rounded-xl p-3 text-left transition-colors', selected?.id === answer.id ? 'bg-secondary' : 'hover:bg-secondary/60')}><div className="flex items-center justify-between gap-2"><span className="mono text-[10px] text-primary">0{index + 1}</span><span className={cn('text-sm font-extrabold', scoreTone(answerAnalysis?.scores?.overall))}>{answerAnalysis?.scores?.overall ? Math.round(answerAnalysis.scores.overall) : '—'}</span></div><p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{answer.question}</p><p className="mt-2 text-[10px] text-muted-foreground">{formatTime(answer.durationSeconds)}</p></button>; })}</div> : <div className="px-2 py-8 text-center text-xs leading-5 text-muted-foreground">No answers yet. Record your first one above.</div>}<button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} data-testid="button-detail-new-answer" className="w-full mt-4 flex items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 px-3 py-3 text-xs font-bold text-primary hover:bg-secondary"><Plus size={14} /> Practice another</button></aside><section id="analysis-result" className="min-w-0">{selected ? <div className="space-y-5"><div className="rounded-[22px] border border-border bg-card p-6 shadow-sm sm:p-7"><p className="mono text-[10px] uppercase tracking-[0.17em] text-primary">The answer</p><h2 className="serif mt-3 text-2xl leading-tight">{selected.question}</h2><div className="mt-5 flex flex-wrap gap-2"><span className="rounded-full bg-secondary px-3 py-1.5 text-[11px] font-bold">{formatTime(selected.durationSeconds)} spoken</span><span className="rounded-full bg-secondary px-3 py-1.5 text-[11px] font-bold">{selected.pauseCount} pauses</span><span className="rounded-full bg-secondary px-3 py-1.5 text-[11px] font-bold">{selected.fillerWordCount} filler words</span></div><p className="mt-6 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{selected.transcript}</p></div>{analysis ? <AnalysisPanel analysis={analysis} /> : <div className="rounded-[22px] border border-dashed border-border bg-card/60 p-10 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-primary"><Sparkles size={20} /></span><h3 className="serif mt-4 text-xl">Analysis is waiting.</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">This answer has not been read by a provider yet. Return to the desk to send it for analysis.</p><Link href="/" data-testid="link-detail-analyze" className="mt-5 inline-flex rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground">Go to practice desk</Link></div>}</div> : <div className="rounded-[22px] border border-dashed border-border bg-card/60 p-10 text-center text-sm leading-6 text-muted-foreground">Record or upload your first answer above. Your analysis will appear here.</div>}</section></div></div>;
}

function ProviderCard({ provider }: { provider: Provider }) {
  const available = provider.status === 'available' || provider.status === 'configured';
  return <div className="rounded-2xl border border-border bg-card p-5 shadow-sm"><div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2"><span className={cn('h-2 w-2 rounded-full', provider.status === 'configured' ? 'bg-[#4c9a89]' : available ? 'bg-[#d49a40]' : 'bg-muted-foreground/40')} /><h3 className="text-sm font-extrabold">{provider.label}</h3></div><p className="mono mt-2 text-[11px] text-muted-foreground">{provider.model}</p></div><span className={cn('rounded-full px-2 py-1 text-[10px] font-bold', provider.status === 'configured' ? 'bg-[#e2f0e8] text-[#267467]' : available ? 'bg-[#fff0d2] text-[#9b6819]' : 'bg-secondary text-muted-foreground')}>{provider.status}</span></div><p className="mt-4 text-xs leading-5 text-muted-foreground">{provider.detail || 'Provider availability is checked by the server.'}</p></div>;
}

function Settings() {
  const { data: providerStatus, isLoading, isError, refetch } = useGetProviderStatus({ query: { queryKey: getGetProviderStatusQueryKey() } });
  const [preference, setPreference] = useState(() => localStorage.getItem('interview-coach-provider') || 'ollama');
  const savePreference = (value: string) => { setPreference(value); localStorage.setItem('interview-coach-provider', value); };
  return <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12 lg:px-12"><PageHeader eyebrow="The quiet controls" title="Providers & settings" /><div className="space-y-5"><div className="rounded-[24px] border border-[#d9e8e0] bg-[#eef6f0] p-6 sm:p-7"><div className="flex items-start gap-4"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#d7eadd] text-[#267467]"><ShieldCheck size={20} /></span><div><h2 className="text-base font-extrabold text-[#225b52]">Local first. No key required.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[#47756c]">Ollama is the preferred path for private practice: models run on your machine, your transcript stays close, and there is no provider key to manage. LM Studio is another local option. Hugging Face and Groq are available when you prefer hosted speed.</p><p className="mt-3 max-w-2xl text-xs leading-5 text-[#47756c]">If you are using this secure preview, the browser cannot call plain HTTP Ollama directly. Run the app locally or provide a reachable HTTPS model endpoint.</p></div></div></div><section className="rounded-[24px] border border-border bg-card p-6 shadow-sm sm:p-7"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mono text-[10px] uppercase tracking-[0.17em] text-primary">Active route</p><h2 className="serif mt-2 text-2xl">How Coach reads your answers</h2></div>{providerStatus && <span className="rounded-full bg-secondary px-3 py-1.5 text-[11px] font-bold">Server: {providerStatus.activeProvider} · {providerStatus.activeModel}</span>}</div><div className="mt-6"><label className="mb-2 block text-xs font-bold text-foreground/70">Preferred provider</label><select value={preference} onChange={(event) => savePreference(event.target.value)} data-testid="select-provider-preference" className="w-full rounded-xl border border-input bg-background px-3.5 py-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"><option value="ollama">Ollama · local and private</option><option value="lmstudio">LM Studio · local and private</option><option value="huggingface">Hugging Face · hosted</option><option value="groq">Groq · hosted</option></select><p className="mt-2 text-xs text-muted-foreground">This preference is saved on this device. The server’s active provider is shown above.</p></div></section><section><div className="mb-4 flex items-end justify-between"><div><p className="mono text-[10px] uppercase tracking-[0.17em] text-muted-foreground">Provider status</p><h2 className="serif mt-2 text-2xl">Available paths.</h2></div>{isError && <button onClick={() => refetch()} data-testid="button-retry-providers" className="inline-flex items-center gap-1 text-xs font-bold text-primary"><RotateCcw size={13} /> Retry</button>}</div>{isLoading ? <SkeletonRows /> : isError ? <div className="rounded-2xl border border-[#edc8c3] bg-[#fff2ef] p-5 text-sm text-[#954a42]">Provider status is unavailable right now.</div> : <div className="grid gap-3 sm:grid-cols-2">{providerStatus?.providers?.map((provider) => <ProviderCard key={provider.id} provider={provider} />)}</div>}</section><div className="flex items-start gap-3 rounded-2xl border border-border bg-secondary/45 p-5 text-xs leading-5 text-muted-foreground"><Info size={16} className="mt-0.5 shrink-0 text-primary" /><p>Coach looks at the answer itself and delivery signals like pauses and filler words. It is practice feedback, not a hiring decision.</p></div></div></div>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function Router() {
  return <RoutedErrorBoundary><Shell><Switch><Route path="/" component={Dashboard} /><Route path="/interviews/:id" component={InterviewDetail} /><Route path="/settings" component={Settings} /><Route component={NotFound} /></Switch></Shell></RoutedErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;
