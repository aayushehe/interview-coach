import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode, RefObject } from 'react';
import { AuthError, authenticate } from '@/lib/auth-client';

/*
 * Login: "Mic check".
 * The left side is a small oscilloscope that you drive by typing and moving the
 * pointer, with a rotating interview prompt under it. The right side is a
 * call-sheet style form with an ON AIR lamp that lights up once the form is valid.
 *
 * Real accounts: the form talks to /api/auth/login and /api/auth/register
 * (see lib/auth-client.ts). On success the token is saved and onLogin({ name, email }) fires.
 */

type User = { name: string; email: string };
interface LoginPageProps {
  onLogin: (user: User) => void;
}

const PROMPTS = [
  'Tell me about yourself, in under a minute.',
  'Walk me through a project you are actually proud of.',
  'What is the difference between a process and a thread?',
  'Describe a time you disagreed with a teammate.',
  'Why should we pick you over someone with a higher CGPA?',
];
const PROMPT_MS = 7000;

const BG = '15,19,31';
const AMBER = '#f5b942';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* ───────────────────────── oscilloscope ───────────────────────── */

function Scope({ energy }: { energy: RefObject<number> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const dbRef = useRef<HTMLSpanElement>(null);
  const meterRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const ctx: CanvasRenderingContext2D = context;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let h = 0;
    let raf = 0;
    let lastSecond = -1;
    const t0 = performance.now();
    let last = t0;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = r.width;
      h = r.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = `rgb(${BG})`;
      ctx.fillRect(0, 0, w, h);
      if (reduce) frame(performance.now());
    };

    const trace = (t: number, amp: number, k: number, phase: number, stroke: string, width: number) => {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 2) {
        const u = x / w;
        const taper = Math.sin(Math.PI * u);
        const env = 0.55 + 0.45 * Math.sin(u * 9 - t * 1.6 * k + phase);
        const y = h / 2 + Math.sin(u * 70 * k - t * (7 + k * 2) + phase) * env * taper * amp * h * 0.34;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.stroke();
    };

    function frame(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = reduce ? 2 : (now - t0) / 1000;

      if (!reduce) energy.current = (energy.current ?? 0) * Math.pow(0.1, dt);
      const e = reduce ? 0.45 : energy.current ?? 0;
      // slow "speech" bursts so it never looks dead, plus whatever you type
      const speech = Math.pow(Math.max(0, Math.sin(t * 1.3) * Math.sin(t * 0.47 + 1.2)), 2);
      const amp = Math.min(1, 0.06 + speech * 0.42 + e * 0.9);

      ctx.fillStyle = `rgba(${BG},${reduce ? 1 : 0.24})`; // phosphor trail
      ctx.fillRect(0, 0, w, h);
      trace(t, amp * 0.8, 1.7, 1.9, 'rgba(255,255,255,0.13)', 1);
      trace(t, amp * 0.9, 1.25, 0.8, 'rgba(76,192,220,0.55)', 1.2);
      trace(t, amp, 1, 0, AMBER, 1.8);

      const sec = Math.floor(t);
      if (sec !== lastSecond && clockRef.current) {
        lastSecond = sec;
        const mm = String(Math.floor(sec / 60)).padStart(2, '0');
        const ss = String(sec % 60).padStart(2, '0');
        clockRef.current.textContent = `00:${mm}:${ss}`;
      }
      if (meterRef.current) meterRef.current.style.transform = `scaleX(${amp.toFixed(3)})`;
      if (dbRef.current) dbRef.current.textContent = `${(-48 + amp * 42).toFixed(0)} dB`;

      if (!reduce) raf = requestAnimationFrame(frame);
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    if (!reduce) raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [energy]);

  return (
    <div className="il-scope">
      <div className="il-scope-top">
        <span className="il-rec">
          <i /> REC <span ref={clockRef}>00:00:00</span>
        </span>
        <span className="il-level">
          <span className="il-meter">
            <span ref={meterRef} />
          </span>
          <span ref={dbRef}>-42 dB</span>
        </span>
      </div>
      <div className="il-scope-body">
        <canvas ref={canvasRef} aria-hidden="true" />
      </div>
      <div className="il-ruler" aria-hidden="true">
        {['0s', '10s', '20s', '30s', '40s', '50s'].map((s) => (
          <span key={s}>{s}</span>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── rotating prompt ───────────────────────── */

function Prompter() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setI((n) => (n + 1) % PROMPTS.length), PROMPT_MS);
    return () => window.clearInterval(id);
  }, []);
  const words = useMemo(() => PROMPTS[i].split(' '), [i]);
  return (
    <div className="il-prompt" aria-live="off">
      <div className="il-prompt-meta">
        <span>
          Sample prompt {String(i + 1).padStart(2, '0')}/{String(PROMPTS.length).padStart(2, '0')}
        </span>
        <span className="il-pbar">
          <i key={i} style={{ animationDuration: `${PROMPT_MS}ms` }} />
        </span>
      </div>
      <p className="il-q" key={i}>
        {words.map((w, n) => (
          <span key={n} style={{ animationDelay: `${n * 55}ms` }}>
            {w}{' '}
          </span>
        ))}
      </p>
    </div>
  );
}

/* ───────────────────────── page ───────────────────────── */

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState(false);
  const [shake, setShake] = useState(false);
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState('');

  const energy = useRef(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);

  const signup = mode === 'signup';
  const errors = {
    name: signup && name.trim().length < 2 ? 'Tell us what to call you.' : '',
    email: !EMAIL_RE.test(email.trim()) ? 'That email does not look right.' : '',
    password: signup ? (password.length < 6 ? 'At least 6 characters.' : '') : password.length < 1 ? 'Enter your password.' : '',
  };
  const ready = !errors.name && !errors.email && !errors.password;
  const showErr = (k: keyof typeof errors) => ((touched[k] || attempted) && errors[k] ? errors[k] : '');

  // the scope reacts to typing and pointer movement
  useEffect(() => {
    let lx = 0;
    let ly = 0;
    const key = () => (energy.current = Math.min(1, energy.current + 0.32));
    const move = (e: PointerEvent) => {
      const d = Math.hypot(e.clientX - lx, e.clientY - ly);
      lx = e.clientX;
      ly = e.clientY;
      energy.current = Math.min(1, energy.current + Math.min(0.05, d / 900));
    };
    window.addEventListener('keydown', key);
    window.addEventListener('pointermove', move, { passive: true });
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointermove', move);
    };
  }, []);

  useEffect(() => {
    (signup ? nameRef : emailRef).current?.focus({ preventScroll: true });
  }, [signup]);

  useEffect(() => () => { alive.current = false; }, []);

  const switchMode = () => {
    setMode((m) => (m === 'login' ? 'signup' : 'login'));
    setTouched({});
    setAttempted(false);
    setServerError('');
  };

  const onCaps = (e: KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState('CapsLock'));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setAttempted(true);
    if (!ready) {
      setShake(true);
      window.setTimeout(() => setShake(false), 450);
      const first = errors.name ? nameRef : errors.email ? emailRef : passRef;
      first.current?.focus();
      return;
    }
    setLoading(true);
    setServerError('');
    energy.current = 1;
    authenticate(mode, { name: signup ? name.trim() : undefined, email: email.trim(), password })
      .then((user) => onLogin({ name: user.name, email: user.email }))
      .catch((error) => {
        if (!alive.current) return;
        setLoading(false);
        setServerError(error instanceof AuthError ? error.message : 'Something went wrong. Please try again.');
        setShake(true);
        window.setTimeout(() => setShake(false), 450);
      });
  };

  return (
    <div className="il-root">
      <style>{CSS}</style>

      {/* ── stage ── */}
      <section className="il-stage" aria-hidden="false">
        <i className="il-crop tl" />
        <i className="il-crop tr" />
        <i className="il-crop bl" />
        <i className="il-crop br" />

        <header className="il-brand il-in" style={{ ['--d' as string]: '0ms' }}>
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <rect x="1" y="8" width="3" height="6" rx="1.5" fill={AMBER} />
            <rect x="6" y="4" width="3" height="14" rx="1.5" fill={AMBER} />
            <rect x="11" y="1" width="3" height="20" rx="1.5" fill={AMBER} />
            <rect x="16" y="6" width="3" height="10" rx="1.5" fill={AMBER} />
          </svg>
          <span>Interview Coach</span>
        </header>

        <h1 className="il-head il-in" style={{ ['--d' as string]: '120ms' }}>
          Say it out loud
          <br />
          <em>before</em> it counts.
        </h1>

        <div className="il-in il-grow" style={{ ['--d' as string]: '260ms' }}>
          <Scope energy={energy} />
        </div>

        <div className="il-in" style={{ ['--d' as string]: '400ms' }}>
          <Prompter />
        </div>
      </section>

      {/* ── call sheet ── */}
      <main className="il-pane">
        <form className={`il-sheet${shake ? ' shake' : ''}`} onSubmit={submit} noValidate>
          <div className="il-sheet-top il-in" style={{ ['--d' as string]: '80ms' }}>
            <span className="il-take">{signup ? 'Take 02 · first time' : 'Take 01 · returning'}</span>
            <span className={`il-air${ready ? ' on' : ''}`} role="status">
              <i />
              {ready ? 'On air' : 'Standby'}
            </span>
          </div>

          <div key={mode} className="il-title">
            <h2>{signup ? 'Set up your room.' : 'Welcome back to the room.'}</h2>
            <p>{signup ? 'Ten seconds. No card, no OTP.' : 'Pick up where your last answer ended.'}</p>
          </div>

          {signup && (
            <Field id="il-name" label="Your name" error={showErr('name')}>
              <input
                id="il-name"
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                autoComplete="name"
                placeholder="Aayush Sharma"
                aria-invalid={!!showErr('name')}
              />
            </Field>
          )}

          <Field id="il-email" label="Email" error={showErr('email')}>
            <input
              id="il-email"
              ref={emailRef}
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, email: true }))}
              autoComplete="email"
              placeholder="you@college.edu"
              aria-invalid={!!showErr('email')}
            />
          </Field>

          <Field
            id="il-pass"
            label="Password"
            error={showErr('password')}
            note={caps ? 'Caps Lock is on' : ''}
            action={
              <button type="button" className="il-show" onClick={() => setShow((s) => !s)} aria-pressed={show}>
                {show ? 'hide' : 'show'}
              </button>
            }
          >
            <input
              id="il-pass"
              ref={passRef}
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, password: true }))}
              onKeyDown={onCaps}
              onKeyUp={onCaps}
              autoComplete={signup ? 'new-password' : 'current-password'}
              placeholder={signup ? 'min. 6 characters' : '••••••••'}
              aria-invalid={!!showErr('password')}
            />
          </Field>

          {serverError && <p className="il-server-err" role="alert">{serverError}</p>}

          <button type="submit" className="il-btn" disabled={loading}>
            <span>{loading ? (signup ? 'Creating your room' : 'Checking levels') : signup ? 'Create my room' : 'Start rehearsal'}</span>
            {loading ? (
              <span className="il-bars" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            )}
          </button>

          <p className="il-switch">
            {signup ? 'Already have a room?' : 'First time here?'}{' '}
            <button type="button" onClick={switchMode}>
              {signup ? 'Sign in' : 'Create one'}
            </button>
          </p>

          <p className="il-foot">Your rooms, answers and reports are private to your account.</p>
        </form>
      </main>
    </div>
  );
}

function Field({
  id,
  label,
  error,
  note,
  action,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  note?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`il-field il-in${error ? ' bad' : ''}`}>
      <div className="il-label">
        <label htmlFor={id}>{label}</label>
        {note && <span className="il-note">{note}</span>}
      </div>
      <div className="il-input">
        {children}
        {action}
      </div>
      {error && (
        <p className="il-err" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ───────────────────────── styles ───────────────────────── */

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap');

.il-root{
  --ink:222 31% 14%; --paper:42 38% 95%; --amber:38 88% 61%; --red:4 70% 52%;
  --serif:'Instrument Serif','Playfair Display',Georgia,serif;
  --mono:'DM Mono',ui-monospace,monospace; --sans:'Manrope',system-ui,sans-serif;
  min-height:100dvh; display:grid; grid-template-columns:minmax(0,1.12fr) minmax(0,.88fr);
  font-family:var(--sans); color:hsl(var(--ink)); background:hsl(var(--paper));
}

/* stage */
.il-stage{
  position:relative; display:flex; flex-direction:column; gap:28px; overflow:hidden;
  padding:34px clamp(28px,4vw,64px) 38px; color:#f3ecdc; background:rgb(${BG});
}
.il-stage::before{ /* soft pool of light behind the scope */
  content:''; position:absolute; inset:0; pointer-events:none;
  background:radial-gradient(55% 32% at 50% 56%, rgba(245,185,66,.10), transparent 72%);
}
.il-stage::after{ /* film grain */
  content:''; position:absolute; inset:0; pointer-events:none; opacity:.09; mix-blend-mode:screen;
  background-image:${GRAIN};
}
.il-stage > *{position:relative; z-index:1}
.il-crop{position:absolute!important; width:14px; height:14px; border:0 solid rgba(243,236,220,.28); z-index:1}
.il-crop.tl{top:16px; left:16px; border-top-width:1px; border-left-width:1px}
.il-crop.tr{top:16px; right:16px; border-top-width:1px; border-right-width:1px}
.il-crop.bl{bottom:16px; left:16px; border-bottom-width:1px; border-left-width:1px}
.il-crop.br{bottom:16px; right:16px; border-bottom-width:1px; border-right-width:1px}

.il-brand{display:flex; align-items:center; gap:12px; font-weight:800; letter-spacing:-.01em; font-size:15px}
.il-head{
  margin:0; font-family:var(--serif); font-weight:400; letter-spacing:-.02em; line-height:.98;
  font-size:clamp(44px,5.2vw,86px);
}
.il-head em{font-style:italic; color:${AMBER}}
.il-grow{flex:1; min-height:170px; display:flex}

.il-scope{flex:1; display:flex; flex-direction:column; min-width:0}
.il-scope-top{display:flex; justify-content:space-between; align-items:center; font:500 11px/1 var(--mono); letter-spacing:.14em; text-transform:uppercase; color:rgba(243,236,220,.6); padding-bottom:12px}
.il-rec{display:inline-flex; align-items:center; gap:8px}
.il-rec i{width:8px; height:8px; border-radius:50%; background:hsl(var(--red)); animation:il-blink 1.4s steps(2,jump-none) infinite}
.il-rec span{color:#f3ecdc; font-variant-numeric:tabular-nums}
.il-level{display:inline-flex; align-items:center; gap:10px; font-variant-numeric:tabular-nums}
.il-meter{width:86px; height:4px; background:rgba(243,236,220,.12); border-radius:2px; overflow:hidden; display:block}
.il-meter span{display:block; height:100%; background:${AMBER}; transform-origin:left; transform:scaleX(.1)}
.il-scope-body{position:relative; flex:1; min-height:120px; border-top:1px solid rgba(243,236,220,.14); border-bottom:1px solid rgba(243,236,220,.14)}
.il-scope-body canvas{position:absolute; inset:0; width:100%; height:100%; display:block}
.il-ruler{display:grid; grid-template-columns:repeat(6,1fr); padding-top:8px; font:500 10px/1 var(--mono); color:rgba(243,236,220,.4); letter-spacing:.08em;
  background:repeating-linear-gradient(90deg, rgba(243,236,220,.22) 0 1px, transparent 1px 16.6667%) top/100% 6px no-repeat}
.il-ruler span{padding-top:6px}

.il-prompt{padding-top:2px}
.il-prompt-meta{display:flex; align-items:center; gap:14px; font:500 10.5px/1 var(--mono); letter-spacing:.16em; text-transform:uppercase; color:rgba(243,236,220,.5)}
.il-pbar{flex:1; height:1px; background:rgba(243,236,220,.16); position:relative; overflow:hidden}
.il-pbar i{position:absolute; inset:0; background:${AMBER}; transform-origin:left; animation:il-fill linear forwards}
.il-q{margin:14px 0 0; min-height:2.5em; font:italic 400 clamp(22px,2.3vw,32px)/1.18 var(--serif); letter-spacing:-.005em; max-width:34ch}
.il-q span{display:inline-block; opacity:0; transform:translateY(.4em); animation:il-word .55s cubic-bezier(.2,.8,.2,1) forwards}

/* pane */
.il-pane{display:flex; align-items:center; justify-content:center; padding:48px clamp(24px,5vw,72px)}
.il-sheet{width:100%; max-width:392px}
.il-sheet.shake{animation:il-shake .42s cubic-bezier(.36,.07,.19,.97)}
.il-sheet-top{display:flex; justify-content:space-between; align-items:center; margin-bottom:34px;
  font:500 10.5px/1 var(--mono); letter-spacing:.16em; text-transform:uppercase}
.il-take{color:hsl(var(--ink)/.55)}
.il-air{display:inline-flex; align-items:center; gap:8px; padding:7px 11px 7px 9px; border:1px solid hsl(var(--ink)/.22); border-radius:99px; color:hsl(var(--ink)/.55); transition:color .3s,border-color .3s,background .3s}
.il-air i{width:8px; height:8px; border-radius:50%; background:hsl(var(--ink)/.25); transition:background .3s, box-shadow .3s}
.il-air.on{color:hsl(var(--red)); border-color:hsl(var(--red)/.5); background:hsl(var(--red)/.07)}
.il-air.on i{background:hsl(var(--red)); box-shadow:0 0 0 3px hsl(var(--red)/.18), 0 0 12px hsl(var(--red)/.7)}

.il-title{margin-bottom:30px; animation:il-fade .45s ease both}
.il-title h2{margin:0; font:400 clamp(34px,3.4vw,46px)/1.02 var(--serif); letter-spacing:-.02em}
.il-title p{margin:12px 0 0; font-size:14.5px; line-height:1.5; color:hsl(var(--ink)/.62)}

.il-field{margin-bottom:22px}
.il-label{display:flex; justify-content:space-between; align-items:baseline; margin-bottom:2px}
.il-label label{font:500 10.5px/1 var(--mono); letter-spacing:.16em; text-transform:uppercase; color:hsl(var(--ink)/.6)}
.il-note{font:500 10.5px/1 var(--mono); letter-spacing:.06em; color:hsl(var(--red))}
.il-input{position:relative; display:flex; align-items:center; border-bottom:1.5px solid hsl(var(--ink)/.2)}
.il-input::after{content:''; position:absolute; left:0; right:0; bottom:-1.5px; height:1.5px; background:hsl(var(--ink)); transform:scaleX(0); transform-origin:left; transition:transform .38s cubic-bezier(.2,.8,.2,1)}
.il-input:focus-within::after{transform:scaleX(1)}
.il-field.bad .il-input{border-color:hsl(var(--red)/.55)}
.il-field.bad .il-input::after{background:hsl(var(--red))}
.il-input input{flex:1; min-width:0; border:0; outline:0; background:transparent; padding:11px 0 12px; font:500 19px/1.2 var(--sans); letter-spacing:-.01em; color:hsl(var(--ink))}
.il-input input::placeholder{color:hsl(var(--ink)/.3); font-weight:400}
.il-input input:-webkit-autofill{-webkit-box-shadow:0 0 0 40px hsl(var(--paper)) inset; -webkit-text-fill-color:hsl(var(--ink))}
.il-show{border:0; background:none; padding:6px 0 6px 10px; font:500 11px/1 var(--mono); letter-spacing:.1em; text-transform:uppercase; color:hsl(var(--ink)/.55); border-radius:4px}
.il-show:hover{color:hsl(var(--ink))}
.il-server-err{margin:4px 0 16px; padding:11px 14px; border-radius:4px; background:hsl(var(--red)/.08); border-left:3px solid hsl(var(--red)); font-size:13.5px; line-height:1.45; color:hsl(var(--red)); animation:il-fade .25s ease both}
.il-err{margin:8px 0 0; font-size:12.5px; color:hsl(var(--red)); animation:il-fade .25s ease both}

.il-btn{position:relative; overflow:hidden; width:100%; margin-top:10px; display:flex; align-items:center; justify-content:space-between; padding:19px 22px; border:0; border-radius:4px;
  background:hsl(var(--ink)); color:hsl(var(--paper)); font:500 12px/1 var(--mono); letter-spacing:.16em; text-transform:uppercase; isolation:isolate; transition:transform .2s}
.il-btn::before{content:''; position:absolute; inset:0; z-index:-1; background:${AMBER}; transform:translateY(101%); transition:transform .38s cubic-bezier(.2,.8,.2,1)}
.il-btn:hover:not(:disabled)::before{transform:translateY(0)}
.il-btn:hover:not(:disabled){color:hsl(var(--ink))}
.il-btn:active:not(:disabled){transform:scale(.99)}
.il-btn svg{transition:transform .3s cubic-bezier(.2,.8,.2,1)}
.il-btn:hover:not(:disabled) svg{transform:translateX(5px)}
.il-btn:disabled{cursor:progress}
.il-bars{display:inline-flex; align-items:center; gap:3px; height:16px}
.il-bars i{width:3px; height:100%; background:currentColor; border-radius:2px; animation:il-bar .7s ease-in-out infinite alternate}
.il-bars i:nth-child(2){animation-delay:.15s}
.il-bars i:nth-child(3){animation-delay:.3s}

.il-switch{margin:22px 0 0; font-size:14px; color:hsl(var(--ink)/.62)}
.il-switch button{border:0; background:none; padding:0; font:inherit; font-weight:700; color:hsl(var(--ink)); text-decoration:underline; text-underline-offset:4px; text-decoration-thickness:1.5px; text-decoration-color:${AMBER}}
.il-switch button:hover{text-decoration-color:hsl(var(--ink))}
.il-foot{margin:34px 0 0; padding-top:16px; border-top:1px dashed hsl(var(--ink)/.2); font:400 11px/1.6 var(--mono); letter-spacing:.02em; color:hsl(var(--ink)/.5)}

.il-root :is(button,input,a):focus-visible{outline:2px solid hsl(var(--ink)); outline-offset:3px}
.il-btn:focus-visible{outline-color:${AMBER}}

.il-in{animation:il-rise .8s cubic-bezier(.16,1,.3,1) both; animation-delay:var(--d,0ms)}
.il-field.il-in{--d:220ms}

@keyframes il-rise{from{opacity:0; transform:translateY(18px)} to{opacity:1; transform:none}}
@keyframes il-fade{from{opacity:0; transform:translateY(6px)} to{opacity:1; transform:none}}
@keyframes il-word{to{opacity:1; transform:none}}
@keyframes il-fill{from{transform:scaleX(0)} to{transform:scaleX(1)}}
@keyframes il-blink{50%{opacity:.15}}
@keyframes il-bar{from{transform:scaleY(.25)} to{transform:scaleY(1)}}
@keyframes il-shake{10%,90%{transform:translateX(-2px)} 20%,80%{transform:translateX(4px)} 30%,50%,70%{transform:translateX(-7px)} 40%,60%{transform:translateX(7px)}}

@media (max-width:959px){
  .il-root{grid-template-columns:1fr}
  .il-stage{padding:26px 24px 24px; gap:20px}
  .il-head{font-size:clamp(36px,10vw,52px)}
  .il-grow{min-height:150px; flex:none; height:170px}
  .il-prompt,.il-ruler,.il-crop{display:none}
  .il-pane{padding:36px 24px 56px}
}
@media (prefers-reduced-motion:reduce){
  .il-root *,.il-root *::before,.il-root *::after{animation-duration:.001ms!important; animation-delay:0ms!important; transition-duration:.001ms!important}
  .il-q span{opacity:1; transform:none}
}
`;
