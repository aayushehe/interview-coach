import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Loader2, Mic, Play, SkipForward, Square, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { speak, speechSupported, stopSpeaking } from '@/lib/speech';
import { decodeToMono } from '@/lib/audio-segments';
import { processSession, type AnswerOutcome, type AnswerWindow, type PipelineProgress } from '@/lib/session-pipeline';
import { fetchNextQuestion, type SessionReport } from '@/lib/coach-api';
import { SessionReportView, formatDuration } from '@/components/session-report';

const TOTAL_QUESTIONS = 5;
const ANSWER_GUARD_SECONDS = 0.4; // the answer clock starts a moment after the question has been read

type Phase = 'idle' | 'starting' | 'running' | 'processing' | 'done';
type Question = { question: string; source: 'ai' | 'bank'; note?: string };

const newSessionId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s${Date.now()}${Math.random().toString(36).slice(2, 10)}`;

function stopRecorder(recorder: MediaRecorder | null, chunks: Blob[], fallbackType: string): Promise<Blob | null> {
  if (!recorder) return Promise.resolve(null);
  return new Promise((resolve) => {
    const finish = () => resolve(new Blob(chunks, { type: recorder.mimeType || fallbackType }));
    if (recorder.state === 'inactive') { finish(); return; }
    recorder.onstop = finish;
    recorder.stop();
  });
}

export function SessionRunner({ interviewId, resumeContext, topic, onFinished, onActiveChange }: {
  interviewId: string;
  resumeContext?: string;
  topic?: string;
  onFinished?: () => void;
  onActiveChange?: (active: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'ai' | 'bank'>('ai');
  const [readAloud, setReadAloud] = useState(() => { try { return localStorage.getItem('ic-read-aloud') !== 'off'; } catch { return true; } });
  const [qIndex, setQIndex] = useState(1);
  const [question, setQuestion] = useState('');
  const [source, setSource] = useState<'ai' | 'bank' | ''>('');
  const [note, setNote] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [answerSeconds, setAnswerSeconds] = useState(0);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [advancing, setAdvancing] = useState(false);
  const [hasVideo, setHasVideo] = useState(true);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [outcomes, setOutcomes] = useState<AnswerOutcome[]>([]);
  const [report, setReport] = useState<SessionReport | null>(null);
  const [reportError, setReportError] = useState('');
  const [videoUrl, setVideoUrl] = useState('');

  const previewRef = useRef<HTMLVideoElement | null>(null);
  const playbackRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRecRef = useRef<MediaRecorder | null>(null);
  const videoRecRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const videoChunksRef = useRef<Blob[]>([]);
  const t0Ref = useRef(0);
  const windowsRef = useRef<AnswerWindow[]>([]);
  const sessionIdRef = useRef('');
  const qIndexRef = useRef(1);
  const questionRef = useRef('');
  const answeringRef = useRef(false);
  const answerStartRef = useRef(0);
  const presentTokenRef = useRef(0);
  const busyRef = useRef(false);
  const nextRef = useRef<Promise<Question> | null>(null);
  const modeRef = useRef(mode);
  const readAloudRef = useRef(readAloud);
  const videoUrlRef = useRef('');
  modeRef.current = mode;
  readAloudRef.current = readAloud;

  const nowSec = () => (performance.now() - t0Ref.current) / 1000;
  const active = phase === 'starting' || phase === 'running' || phase === 'processing';

  useEffect(() => { onActiveChange?.(active); }, [active]);

  useEffect(() => {
    if (phase === 'running' && previewRef.current && streamRef.current) previewRef.current.srcObject = streamRef.current;
  }, [phase]);

  useEffect(() => {
    if (phase !== 'running') return;
    const id = window.setInterval(() => {
      const now = nowSec();
      setSessionSeconds(now);
      if (answeringRef.current) setAnswerSeconds(Math.max(0, now - answerStartRef.current));
    }, 200);
    return () => window.clearInterval(id);
  }, [phase]);

  useEffect(() => () => {
    presentTokenRef.current++;
    stopSpeaking();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
  }, []);

  const loadQuestion = async (): Promise<Question> => {
    try {
      return await fetchNextQuestion(interviewId, modeRef.current, true);
    } catch {
      const fallback = await fetchNextQuestion(interviewId, 'bank', true);
      return { ...fallback, note: 'AI questions were not available, so this one comes from the question bank.' };
    }
  };

  const prefetchNext = () => {
    const promise = loadQuestion();
    promise.catch(() => undefined);
    nextRef.current = promise;
  };

  const present = async (text: string) => {
    const token = ++presentTokenRef.current;
    answeringRef.current = false;
    setAnswerSeconds(0);
    setSpeaking(true);
    if (readAloudRef.current) await speak(text);
    if (token !== presentTokenRef.current) return; // the user moved on while it was being read
    answerStartRef.current = nowSec() + ANSWER_GUARD_SECONDS;
    answeringRef.current = true;
    setSpeaking(false);
  };

  const showQuestion = (index: number, q: Question) => {
    qIndexRef.current = index;
    questionRef.current = q.question;
    setQIndex(index);
    setQuestion(q.question);
    setSource(q.source);
    setNote(q.note || '');
    if (index < TOTAL_QUESTIONS) prefetchNext();
    void present(q.question);
  };

  const startSession = async () => {
    setError('');
    setPhase('starting');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera and microphone are not available in this browser.');
      let stream: MediaStream;
      let video = true;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      } catch {
        video = false;
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      streamRef.current = stream;
      setHasVideo(video);

      const first = await loadQuestion(); // fetched before recording starts, so waiting does not count
      sessionIdRef.current = newSessionId();
      windowsRef.current = [];
      audioChunksRef.current = [];
      videoChunksRef.current = [];

      const audioMime = typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      const audioRecorder = new MediaRecorder(new MediaStream(stream.getAudioTracks()), audioMime ? { mimeType: audioMime } : undefined);
      audioRecorder.ondataavailable = (event) => { if (event.data.size) audioChunksRef.current.push(event.data); };
      audioRecRef.current = audioRecorder;
      let videoRecorder: MediaRecorder | null = null;
      if (video) {
        videoRecorder = new MediaRecorder(stream, { videoBitsPerSecond: 1_000_000 });
        videoRecorder.ondataavailable = (event) => { if (event.data.size) videoChunksRef.current.push(event.data); };
      }
      videoRecRef.current = videoRecorder;
      audioRecorder.start(1000);
      videoRecorder?.start(1000);
      t0Ref.current = performance.now();

      busyRef.current = false;
      setAdvancing(false);
      setSessionSeconds(0);
      setOutcomes([]);
      setReport(null);
      setReportError('');
      setVideoUrl((previous) => { if (previous) URL.revokeObjectURL(previous); videoUrlRef.current = ''; return ''; });
      setPhase('running');
      showQuestion(1, first);
    } catch (e) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setError(e instanceof Error ? e.message : 'The session could not be started.');
      setPhase('idle');
    }
  };

  const finish = async () => {
    presentTokenRef.current++;
    stopSpeaking();
    answeringRef.current = false;
    setPhase('processing');
    setProgress({ phase: 'answers', current: 0, total: windowsRef.current.length, label: 'Saving the recording' });
    const [audioBlob, videoBlob] = await Promise.all([
      stopRecorder(audioRecRef.current, audioChunksRef.current, 'audio/webm'),
      stopRecorder(videoRecRef.current, videoChunksRef.current, 'video/webm'),
    ]);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoBlob && videoBlob.size) {
      const url = URL.createObjectURL(videoBlob);
      videoUrlRef.current = url;
      setVideoUrl(url);
    }
    try {
      if (!audioBlob || !audioBlob.size) throw new Error('No audio was recorded.');
      setProgress({ phase: 'answers', current: 0, total: windowsRef.current.length, label: 'Reading the recording' });
      const decoded = await decodeToMono(audioBlob);
      const result = await processSession({
        samples: decoded.samples,
        sampleRate: decoded.sampleRate,
        windows: windowsRef.current,
        interview: { id: interviewId, resumeContext, topic },
        sessionId: sessionIdRef.current,
        planned: TOTAL_QUESTIONS,
        onProgress: setProgress,
      });
      setOutcomes(result.outcomes);
      setReport(result.report);
      setReportError(result.reportError);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : 'The recording could not be reviewed.');
    }
    busyRef.current = false;
    setPhase('done');
    onFinished?.();
  };

  const goNext = async (skipped: boolean) => {
    if (busyRef.current || phase !== 'running') return;
    busyRef.current = true;
    setAdvancing(true);
    presentTokenRef.current++;
    stopSpeaking();
    const end = nowSec();
    const wasAnswering = answeringRef.current;
    windowsRef.current.push({
      index: qIndexRef.current,
      question: questionRef.current,
      startSec: wasAnswering ? answerStartRef.current : end,
      endSec: end,
      skipped: skipped || !wasAnswering,
      note: skipped ? 'You skipped this question.' : !wasAnswering ? 'Next was pressed before the question finished being read, so the answer clock had not started. Wait for the timer to start, then answer.' : undefined,
    });
    answeringRef.current = false;
    if (qIndexRef.current >= TOTAL_QUESTIONS) { await finish(); return; }
    try {
      const next = await (nextRef.current ?? loadQuestion());
      nextRef.current = null;
      busyRef.current = false;
      setAdvancing(false);
      showQuestion(qIndexRef.current + 1, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The next question could not be loaded.');
      await finish();
    }
  };

  const endEarly = async () => {
    if (busyRef.current || phase !== 'running') return;
    busyRef.current = true;
    setAdvancing(true);
    presentTokenRef.current++;
    stopSpeaking();
    const end = nowSec();
    if (answeringRef.current) {
      windowsRef.current.push({ index: qIndexRef.current, question: questionRef.current, startSec: answerStartRef.current, endSec: end, skipped: false });
    }
    await finish();
  };

  const replay = () => { void present(questionRef.current); };

  const toggleReadAloud = (value: boolean) => {
    setReadAloud(value);
    try { localStorage.setItem('ic-read-aloud', value ? 'on' : 'off'); } catch { /* ignore */ }
    if (!value) stopSpeaking();
  };

  const answerHint = speaking
    ? 'The AI is reading the question…'
    : answerSeconds < 30 ? 'Your answer is being timed. A full answer is usually 1 to 2 minutes.'
    : answerSeconds <= 150 ? 'Good length. Finish your point, then press Next.'
    : 'This is getting long. Start wrapping up.';
  const clockTone = speaking ? 'text-muted-foreground' : answerSeconds < 30 ? 'text-[#9b6819]' : answerSeconds <= 150 ? 'text-[#267467]' : 'text-[#a5412f]';

  if (phase === 'idle' || phase === 'starting') {
    return <section className="rounded-[26px] border border-border bg-card p-6 shadow-sm sm:p-8" data-testid="session-runner-idle">
      <p className="mono text-[10px] uppercase tracking-[0.19em] text-primary">Full session</p>
      <h2 className="serif mt-2 text-3xl">Five questions, one recording.</h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">The AI reads each question aloud. You answer on camera and press Next. Everything is recorded as one video. Afterwards every answer is cut out, timed, transcribed and reviewed, and you get a session report. Use headphones so the microphone does not pick up the question voice.</p>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <select value={mode} onChange={(event) => setMode(event.target.value as 'ai' | 'bank')} disabled={phase === 'starting'} data-testid="select-session-mode" className="rounded-xl border border-input bg-background px-3 py-2.5 text-sm font-semibold outline-none"><option value="ai">AI-generated questions</option><option value="bank">Built-in question bank</option></select>
        {speechSupported()
          ? <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={readAloud} onChange={(event) => toggleReadAloud(event.target.checked)} data-testid="checkbox-read-aloud" /> Read questions aloud</label>
          : <span className="text-xs text-muted-foreground">This browser cannot read aloud, so questions will only be shown.</span>}
        <button type="button" onClick={startSession} disabled={phase === 'starting'} data-testid="button-start-session" className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-md disabled:opacity-60">{phase === 'starting' ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />} Start 5-question session</button>
      </div>
      {error && <p className="mt-4 rounded-xl border border-[#edc8c3] bg-[#fff2ef] p-3 text-sm text-[#954a42]" data-testid="text-session-error">{error}</p>}
    </section>;
  }

  if (phase === 'running') {
    return <section className="overflow-hidden rounded-[26px] border border-border bg-card shadow-sm" data-testid="session-runner-running">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div className="flex items-center gap-3"><span className="flex items-center gap-1.5 text-xs font-bold text-[#a5412f]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#d6453a]" /> REC</span><span className="font-bold" data-testid="text-question-number">Question {qIndex} of {TOTAL_QUESTIONS}</span><span className="flex gap-1">{Array.from({ length: TOTAL_QUESTIONS }, (_, i) => <span key={i} className={cn('h-1.5 w-6 rounded-full', i + 1 < qIndex ? 'bg-primary' : i + 1 === qIndex ? 'bg-primary/60' : 'bg-secondary')} />)}</span></div>
        <div className="flex items-center gap-3"><span className="text-xs text-muted-foreground">Session {formatDuration(sessionSeconds)}</span><button type="button" onClick={endEarly} disabled={advancing} data-testid="button-end-session" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground hover:bg-secondary disabled:opacity-50"><Square size={12} /> End session</button></div>
      </div>
      <div className="grid gap-6 p-6 md:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)]">
        <div>
          <div className="aspect-video overflow-hidden rounded-2xl bg-black">{hasVideo ? <video ref={previewRef} autoPlay muted playsInline className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-sm text-white/70"><Mic size={28} /> Audio only</div>}</div>
          <div className="mt-4 rounded-2xl bg-secondary/60 p-4 text-center">
            <p className="mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">This answer</p>
            <p className={cn('mt-1 text-5xl font-extrabold tabular-nums tracking-tight', clockTone)} data-testid="text-answer-clock">{formatDuration(answerSeconds)}</p>
            <p className="mt-2 text-xs text-muted-foreground" data-testid="text-answer-hint">{answerHint}</p>
          </div>
        </div>
        <div className="flex flex-col">
          <p className="mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{speaking ? <span className="inline-flex items-center gap-1.5 text-primary"><Volume2 size={13} /> Reading aloud</span> : 'Your question'}</p>
          <h3 className="serif mt-3 text-2xl leading-snug" data-testid="text-session-question">{question}</h3>
          {(source || note) && <p className="mt-3 text-xs text-muted-foreground">{source ? `Source: ${source === 'ai' ? 'AI-generated' : 'built-in question bank'}. ` : ''}{note}</p>}
          <div className="mt-auto flex flex-wrap gap-3 pt-6">
            <button type="button" onClick={() => goNext(false)} disabled={advancing} data-testid="button-next-question" className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-primary-foreground shadow-md disabled:opacity-60">{advancing ? <Loader2 size={16} className="animate-spin" /> : <ChevronRight size={16} />} {qIndex >= TOTAL_QUESTIONS ? 'Finish session' : 'Next question'}</button>
            <button type="button" onClick={() => goNext(true)} disabled={advancing} data-testid="button-skip-question" className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-bold disabled:opacity-60"><SkipForward size={15} /> Skip</button>
            {speechSupported() && <button type="button" onClick={replay} disabled={advancing || speaking} data-testid="button-replay-question" className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-bold disabled:opacity-60"><Volume2 size={15} /> Read again</button>}
          </div>
          {error && <p className="mt-3 text-xs text-[#954a42]">{error}</p>}
        </div>
      </div>
    </section>;
  }

  if (phase === 'processing') {
    const pct = progress && progress.total ? Math.round((progress.current / progress.total) * 100) : 5;
    return <section className="rounded-[26px] border border-border bg-card p-8 shadow-sm" data-testid="session-processing">
      <p className="mono text-[10px] uppercase tracking-[0.19em] text-primary">Working on it</p>
      <h2 className="serif mt-2 text-3xl">Reviewing your session…</h2>
      <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> <span data-testid="text-processing-label">{progress?.label ?? 'Starting'}</span></p>
      <div className="mt-5 h-2 w-full max-w-md overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} /></div>
      <p className="mt-4 text-xs text-muted-foreground">Each answer is cut out of the recording, transcribed, measured and scored. This can take a minute. Please keep this page open.</p>
    </section>;
  }

  return <section className="space-y-5" data-testid="session-runner-done">
    {report ? <SessionReportView report={report} /> : <div className="rounded-[24px] border border-[#edc8c3] bg-[#fff2ef] p-6 text-sm text-[#954a42]" data-testid="text-report-error">{reportError || 'No report was created for this session.'}</div>}
    <div className="rounded-[24px] border border-border bg-card p-6 shadow-sm">
      <p className="mono mb-3 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Your recording</p>
      {videoUrl ? <video ref={playbackRef} src={videoUrl} controls className="w-full max-w-3xl rounded-2xl bg-black" data-testid="video-session-playback" /> : <p className="text-sm text-muted-foreground">No video was kept for this session.</p>}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">{outcomes.map((o) => <div key={o.index} className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5 text-xs">
        <div className="min-w-0"><p className="font-bold">Q{o.index} <span className={cn('ml-1 rounded-full px-2 py-0.5 text-[10px]', o.status === 'saved' ? 'bg-[#e2f0e8] text-[#267467]' : o.status === 'skipped' ? 'bg-secondary text-muted-foreground' : 'bg-[#fdeae6] text-[#a5412f]')}>{o.status === 'saved' ? 'Reviewed' : o.status === 'skipped' ? 'Not reviewed' : 'Failed'}</span></p><p className="mt-1 break-words text-muted-foreground" data-testid={`text-outcome-${o.index}`}>{o.message}</p></div>
        {videoUrl && <button type="button" onClick={() => { const v = playbackRef.current; if (v) { v.currentTime = Math.max(0, o.startSec - 1); void v.play(); } }} className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 font-bold text-primary hover:bg-secondary" data-testid={`button-jump-${o.index}`}>Watch {formatDuration(o.startSec)}</button>}
      </div>)}</div>
      <p className="mt-4 text-xs text-muted-foreground">The video is only kept while this page is open. The scores and report are saved.</p>
      <button type="button" onClick={() => setPhase('idle')} data-testid="button-new-session" className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-bold hover:bg-secondary"><Play size={14} /> Start another session</button>
    </div>
  </section>;
}
