import express, { Router, type IRouter, type Request, type Response as ExpressResponse } from "express";
import {
  AnalyzeInterviewAnswerBody,
  AnalyzeInterviewAnswerParams,
  AnalyzeInterviewAnswerResponse,
  CreateInterviewBody,
  CreateInterviewResponse,
  GetInterviewParams,
  GetInterviewResponse,
  GetProviderStatusResponse,
  ListInterviewsResponse,
} from "@workspace/api-zod";
import { isRepeatQuestion, pickBankQuestion } from "../lib/question-bank";
import { logger } from "../lib/logger";
import { userIdOf } from "../lib/auth";
import { buildSessionStats, countWords, LONG_ANSWER_SECONDS, SHORT_ANSWER_SECONDS, type SessionStats } from "../lib/session-stats";
import {
  deleteInterviewFor,
  insertInterview,
  listInterviewsFor,
  loadAllInterviewsFor,
  loadInterview,
  saveInterview,
} from "../lib/store";

type ProviderId = "ollama" | "lmstudio" | "huggingface" | "groq";

export type Score = {
  overall: number;
  content: number;
  structure: number;
  confidence: number;
  delivery: number;
};

export type Analysis = {
  provider: string;
  model: string;
  scores: Score;
  summary: string;
  strengths: string[];
  improvements: string[];
  improvedAnswer: string;
  followUpQuestions: string[];
  riskFlags: string[];
  pauseCount: number;
  fillerWordCount: number;
};

export type StoredAnswer = {
  id: string;
  question: string;
  transcript: string;
  durationSeconds: number;
  pauseCount: number;
  fillerWordCount: number;
  analysis: Analysis | null;
  createdAt: string;
  sessionId: string | null;
  delivery: Delivery | null;
};

export type SessionReview = {
  summary: string;
  timeManagement: string;
  strengths: string[];
  improvements: string[];
  nextSteps: string[];
  bestAnswerIndex: number | null;
  weakestAnswerIndex: number | null;
};

export type StoredSession = {
  id: string;
  startedAt: string;
  endedAt: string;
  plannedQuestions: number;
  answeredCount: number;
  endedEarly: boolean;
  stats: SessionStats;
  review: SessionReview | null;
  reviewNote?: string;
};

export type StoredInterview = {
  ownerId?: string; // id of the account that owns this room (set when it is created)
  id: string;
  title: string;
  role: string;
  company: string | null;
  status: "active" | "completed";
  answerCount: number;
  score: number | null;
  updatedAt: string;
  resumeContext: string;
  topic: string;
  level: string;
  jobDescription: string;
  answers: StoredAnswer[];
  sessions: StoredSession[];
  askedQuestions: string[];
  currentQuestion: { text: string; source: "ai" | "bank" } | null;
};

type ProviderInfo = {
  id: ProviderId;
  label: string;
  status: "available" | "configured" | "unavailable";
  model: string;
  detail: string;
};

const router: IRouter = Router();
const preferredModels = ["qwen3:8b", "llama3.1:8b", "mistral:7b"];
/** An interview is only visible to the account that created it; anyone else gets "not found". */
const ownedInterview = (res: ExpressResponse, id: string): Promise<StoredInterview | undefined> => loadInterview(userIdOf(res), id);

// Interview level and job description are read straight from the raw request body
// (the generated API schema would strip them), then cleaned here.
const LEVELS = ["Intern / Fresher", "Junior (1-3 years)", "Mid-level (3-6 years)", "Senior (6+ years)"] as const;
const DEFAULT_LEVEL = LEVELS[0];
const MAX_TEXT_CHARS = 6000;

const cleanLevel = (value: unknown): string =>
  typeof value === "string" && (LEVELS as readonly string[]).includes(value) ? value : DEFAULT_LEVEL;

const cleanText = (value: unknown, max = MAX_TEXT_CHARS): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";


const now = () => new Date().toISOString();

function interviewSummary(interview: StoredInterview) {
  return {
    id: interview.id,
    title: interview.title,
    role: interview.role,
    company: interview.company,
    status: interview.status,
    answerCount: interview.answerCount,
    score: interview.score,
    updatedAt: interview.updatedAt,
  };
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getOllamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(
    /\/$/,
    "",
  );
}

function getLmStudioBaseUrl() {
  return (process.env.LM_STUDIO_BASE_URL ?? "http://127.0.0.1:1234").replace(
    /\/$/,
    "",
  );
}

async function getOllamaProvider(): Promise<ProviderInfo> {
  const modelOverride = process.env.OLLAMA_MODEL;
  try {
    const response = await fetch(`${getOllamaBaseUrl()}/api/tags`, {
      signal: AbortSignal.timeout(1200),
    });
    if (!response.ok) throw new Error("Ollama is not reachable");
    const payload = (await readJson(response)) as {
      models?: Array<{ name?: string }>;
    };
    const installed = (payload.models ?? [])
      .map((model) => model.name)
      .filter((name): name is string => Boolean(name));
    const model =
      modelOverride ??
      preferredModels.find((candidate) =>
        installed.some(
          (installedModel) =>
            installedModel === candidate ||
            installedModel.startsWith(`${candidate}:`),
        ),
      );
    if (!model) {
      return {
        id: "ollama",
        label: "Ollama",
        status: "configured",
        model: preferredModels[0],
        detail: "Ollama is running, but none of the preferred models are installed.",
      };
    }
    return {
      id: "ollama",
      label: "Ollama",
      status: "available",
      model,
      detail: "Local inference. Your transcript stays on this machine.",
    };
  } catch {
    return {
      id: "ollama",
      label: "Ollama",
      status: "unavailable",
      model: modelOverride ?? preferredModels[0],
      detail: "Start Ollama locally to use the no-key inference path.",
    };
  }
}

async function getOpenAiCompatibleProvider(
  id: "lmstudio" | "huggingface" | "groq",
  label: string,
  baseUrl: string,
  apiKey: string | undefined,
  defaultModel: string,
): Promise<ProviderInfo> {
  if (!apiKey && id !== "lmstudio") {
    return {
      id,
      label,
      status: "unavailable",
      model: defaultModel,
      detail: "Optional provider. Add its server-side API key to enable it.",
    };
  }
  try {
    const response = await fetch(`${baseUrl}/v1/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      signal: AbortSignal.timeout(1200),
    });
    if (!response.ok) throw new Error("Provider is not reachable");
    const payload = (await readJson(response)) as {
      data?: Array<{ id?: string }>;
    };
    const installed = (payload.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
    const model =
      defaultModel && (installed.length === 0 || installed.includes(defaultModel))
        ? defaultModel
        : installed[0] ?? defaultModel;
    return {
      id,
      label,
      status: "available",
      model,
      detail:
        id === "lmstudio"
          ? "Local OpenAI-compatible inference."
          : "Hosted inference provider.",
    };
  } catch {
    return {
      id,
      label,
      status: "unavailable",
      model: defaultModel,
      detail: "Provider is not reachable or is not configured.",
    };
  }
}

async function getProviders() {
  const [ollama, lmstudio, huggingface, groq] = await Promise.all([
    getOllamaProvider(),
    getOpenAiCompatibleProvider(
      "lmstudio",
      "LM Studio",
      getLmStudioBaseUrl(),
      undefined,
      "local-model",
    ),
    getOpenAiCompatibleProvider(
      "huggingface",
      "Hugging Face",
      "https://router.huggingface.co",
      process.env.HF_API_KEY,
      process.env.HF_MODEL ?? "meta-llama/Llama-3.1-8B-Instruct",
    ),
    getOpenAiCompatibleProvider(
      "groq",
      "Groq",
      "https://api.groq.com/openai",
      process.env.GROQ_API_KEY,
      process.env.GROQ_MODEL ?? "qwen/qwen3.8-27b",
    ),
  ]);
  return [ollama, lmstudio, huggingface, groq];
}

export type Delivery = {
  measured: boolean;
  pauseCount: number;
  totalPauseSeconds: number;
  longestPauseSeconds: number;
  speakingSeconds: number;
  spanSeconds: number;
  wordsPerMinute: number | null;
  fillerWordCount: number;
  fillerBreakdown: Record<string, number>;
};

type AnalysisInput = {
  question: string;
  transcript: string;
  durationSeconds: number;
  pauseCount: number;
  fillerWordCount: number;
  resumeContext?: string;
  topic?: string;
  level?: string;
  jobDescription?: string;
  delivery?: Delivery | null;
  askedQuestions?: string[];
};

const PAUSE_MIN_SECONDS = 0.8; // keep in sync with the frontend (audio-metrics.ts)

const num = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;

// The generated API schema strips unknown fields, so the extra "delivery"
// measurements are read straight from the raw request body and validated here.
function readDelivery(raw: unknown): Delivery | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const breakdown: Record<string, number> = {};
  if (d.fillerBreakdown && typeof d.fillerBreakdown === "object") {
    for (const [key, value] of Object.entries(d.fillerBreakdown as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) breakdown[key.slice(0, 40)] = value;
    }
  }
  return {
    measured: d.measured === true,
    pauseCount: num(d.pauseCount),
    totalPauseSeconds: num(d.totalPauseSeconds),
    longestPauseSeconds: num(d.longestPauseSeconds),
    speakingSeconds: num(d.speakingSeconds),
    spanSeconds: num(d.spanSeconds),
    wordsPerMinute: typeof d.wordsPerMinute === "number" && Number.isFinite(d.wordsPerMinute) ? d.wordsPerMinute : null,
    fillerWordCount: num(d.fillerWordCount),
    fillerBreakdown: breakdown,
  };
}

// Simple rule-of-thumb scoring from MEASURED data only. The numbers below are
// starting points and can be tuned.
function deliveryScoreFrom(d: Delivery, wordCount: number): number {
  let score = 100;
  if (d.wordsPerMinute != null) {
    if (d.wordsPerMinute < 110) score -= Math.min(25, (110 - d.wordsPerMinute) * 0.6);
    else if (d.wordsPerMinute > 170) score -= Math.min(25, (d.wordsPerMinute - 170) * 0.6);
  }
  if (wordCount > 0) {
    const fillersPer100Words = (d.fillerWordCount / wordCount) * 100;
    score -= Math.min(30, Math.max(0, fillersPer100Words - 1) * 5);
  }
  if (d.longestPauseSeconds > 2.5) score -= Math.min(20, (d.longestPauseSeconds - 2.5) * 5);
  if (d.spanSeconds > 0) {
    const pausesPerMinute = d.pauseCount / (d.spanSeconds / 60);
    if (pausesPerMinute > 6) score -= Math.min(15, (pausesPerMinute - 6) * 2);
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function providerPrompt(input: AnalysisInput) {
  const d = input.delivery;
  const breakdown = d && Object.keys(d.fillerBreakdown).length
    ? ` (${Object.entries(d.fillerBreakdown).map(([k, v]) => `${k}: ${v}`).join(", ")})`
    : "";
  const deliveryBlock = d?.measured
    ? `MEASURED from the recorded audio and transcript. Treat these as facts; do not estimate your own:
- Pauses of ${PAUSE_MIN_SECONDS}s or longer: ${d.pauseCount}; longest pause: ${d.longestPauseSeconds.toFixed(1)}s
- Speaking time: ${Math.round(d.speakingSeconds)}s; pace: ${d.wordsPerMinute ?? "not available"} words per minute
- Filler words counted in the transcript: ${d.fillerWordCount}${breakdown}`
    : `Audio was NOT measured for this answer (typed or pasted transcript). Do not comment on pauses, pace or filler words. Judge "delivery" only from clarity, concision and wording.`;
  const asked = (input.askedQuestions ?? []).filter((q) => q.trim());
  return `You are a rigorous but encouraging mock interview coach. Analyze this answer and return ONLY valid JSON with this exact shape:
{"scores":{"overall":0,"content":0,"structure":0,"confidence":0,"delivery":0},"summary":"","strengths":[],"improvements":[],"improvedAnswer":"","followUpQuestions":[],"riskFlags":[]}

Rules:
1. Base every score and comment ONLY on what the candidate actually said in the transcript. Refer to their real words. If the answer is short, vague or does not answer the question, score it low and say so plainly.
2. Do NOT invent projects, internships, employers, technologies, numbers or achievements. The resume context may be used only to suggest what the candidate could mention; never present it as something they already said.
3. "improvedAnswer": rewrite the candidate's own answer in the first person so that it directly answers the interview question, using only facts from the transcript or the resume context. Where a useful detail is missing, put a bracketed placeholder such as [add the result or a number here] instead of making something up.
4. "improvements": 2-4 practical, specific things to do on the next attempt (what to add, cut or reorder), not generic advice.
5. "followUpQuestions": 2-3 follow-ups an interviewer could plausibly ask based on THIS answer. Do not repeat or rephrase any question in the already-asked list.
6. "riskFlags": only real concerns visible in the transcript or the measured data. Use an empty list if there are none.
7. Do not diagnose personality or protected traits.
8. Scores are integers from 0 to 100. "delivery" reflects the measured data when it is provided.
9. Judge the answer against the interview level below. If a job description is given, say which of its requirements the answer supported or missed. Never credit the candidate with skills that are not in the transcript or the resume.

Question: ${input.question}
Topic: ${input.topic ?? "General interview"}
Interview level: ${input.level ?? DEFAULT_LEVEL}
Job description: ${input.jobDescription?.trim() ? input.jobDescription : "Not provided"}
Transcript: ${input.transcript}
Total recording length (seconds): ${input.durationSeconds}
${deliveryBlock}
Resume context: ${input.resumeContext?.trim() ? input.resumeContext : "Not provided"}
Questions already asked in this interview (do not repeat for follow-ups):
${asked.length ? asked.map((q) => `- ${q}`).join("\n") : "- none"}
`;
}

function extractJson(content: string): unknown {
  const cleaned = content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
}

function parseAnalysis(content: string, provider: ProviderInfo, input: {
  pauseCount: number;
  fillerWordCount: number;
}) {
  const parsed = extractJson(content) as Omit<Analysis, "provider" | "model" | "pauseCount" | "fillerWordCount">;
  return AnalyzeInterviewAnswerResponse.parse({
    ...parsed,
    provider: provider.label,
    model: provider.model,
    pauseCount: input.pauseCount,
    fillerWordCount: input.fillerWordCount,
  });
}

// One place that talks to whichever provider is active and returns the raw text.
const RATE_LIMITED = /rate.?limit|too many requests|\b429\b|tokens per (minute|day)|requests per (minute|day)|try again in/i;

/** Providers say things like "Please try again in 6.2s" or "in 1m6.4s". Returns milliseconds, or null. */
function retryHintMs(message: string): number | null {
  const at = message.search(/try again in/i);
  if (at < 0) return null;
  const tail = message.slice(at);
  const minutes = /(\d+(?:\.\d+)?)\s*m(?!s)/i.exec(tail);
  const seconds = /(\d+(?:\.\d+)?)\s*s(?![a-z])/i.exec(tail);
  const millis = /(\d+(?:\.\d+)?)\s*ms/i.exec(tail);
  const total = (minutes ? parseFloat(minutes[1]) * 60_000 : 0) + (seconds ? parseFloat(seconds[1]) * 1000 : 0) + (millis ? parseFloat(millis[1]) : 0);
  return total > 0 ? total : null;
}

/** Calls the AI provider. Free plans have per-minute limits, so a rate limit is waited out (up to 4 tries). */
async function callProvider(provider: ProviderInfo, prompt: string, temperature = 0.2): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await callProviderOnce(provider, prompt, temperature);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (attempt >= 4 || !RATE_LIMITED.test(message)) throw error;
      const hint = retryHintMs(message);
      if (hint != null && hint > 60_000) throw error; // e.g. a daily limit: waiting a minute will not help
      const wait = Math.min(30_000, Math.max(3_000, (hint ?? 10_000) + 1_000));
      logger.warn({ attempt, waitMs: wait }, "AI provider is rate limited, waiting before trying again");
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

async function callProviderOnce(provider: ProviderInfo, prompt: string, temperature: number): Promise<string> {
  let response: Response;
  if (provider.id === "ollama") {
    response = await fetch(`${getOllamaBaseUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: provider.model,
        stream: false,
        format: "json",
        options: { temperature },
        messages: [
          { role: "system", content: "Return only JSON." },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } else {
    const baseUrl =
      provider.id === "lmstudio"
        ? getLmStudioBaseUrl()
        : provider.id === "groq"
          ? "https://api.groq.com/openai"
          : "https://router.huggingface.co";
    const apiKey =
      provider.id === "groq"
        ? process.env.GROQ_API_KEY
        : process.env.HF_API_KEY;
    response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: provider.model,
        temperature,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Return only JSON." },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    });
  }
  const payload = (await readJson(response)) as {
    message?: { content?: string };
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `The selected provider rejected the request (HTTP ${response.status}).`);
  }
  const content = payload.message?.content ?? payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("The selected provider returned no analysis.");
  return content;
}

async function generateAnalysis(provider: ProviderInfo, input: AnalysisInput) {
  const content = await callProvider(provider, providerPrompt(input));
  const analysis = parseAnalysis(content, provider, input);
  if (input.delivery?.measured) {
    const wordCount = input.transcript.trim().split(/\s+/).filter(Boolean).length;
    analysis.scores.delivery = deliveryScoreFrom(input.delivery, wordCount);
  }
  return analysis;
}

async function generateQuestion(provider: ProviderInfo, interview: StoredInterview, asked: string[]) {
  const lastAnswer = interview.answers[interview.answers.length - 1];
  const resume = interview.resumeContext.trim();
  const jd = interview.jobDescription.trim();
  // Alternate: every other question is personal to the resume / job description.
  const personal = Boolean(resume || jd) && asked.length % 2 === 0;
  const focus = personal
    ? "THIS question must be about something specific: a project, skill or experience that is actually written on the resume, or a skill the job description asks for."
    : "THIS question should be on the focus topic and suited to the level." +
      (/core cs/i.test(interview.topic) && /mixed/i.test(interview.topic)
        ? " The focus is mixed core CS: choose whichever of DBMS, operating systems, computer networks or OOP has been asked the least so far."
        : "");
  const prompt = `You are a human interviewer running a mock interview. Write ONE new interview question.

Role: ${interview.role}
Company: ${interview.company ?? "not specified"}
Focus topic: ${interview.topic}
Interview level: ${interview.level} (match difficulty and expectations to this level; for Intern / Fresher use fundamentals, projects and learning ability rather than system design)

Job description:
${jd || "not provided"}

Candidate resume or background:
${resume || "not provided; assume an entry-level candidate such as a student"}

Questions already asked (do NOT repeat or rephrase any of them):
${asked.length ? asked.map((q) => `- ${q}`).join("\n") : "- none yet"}
${lastAnswer ? `\nThe candidate's previous answer, for context (ask a natural follow-up only if it clearly opens one; otherwise move to a different area):\n${lastAnswer.transcript.slice(0, 500)}\n` : ""}
Rules:
- ${focus}
- Never assume experience, projects or skills that are not on the resume.
- Keep it under 40 words and ask only one thing.
- Return ONLY JSON: {"question": "..."}`;
  const content = await callProvider(provider, prompt, 0.8);
  const parsed = extractJson(content) as { question?: unknown };
  return typeof parsed.question === "string" ? parsed.question.trim() : "";
}

async function activeProvider() {
  const providers = await getProviders();
  const forced = process.env.AI_PROVIDER as ProviderId | undefined;
  if (forced) {
    const selected = providers.find((provider) => provider.id === forced);
    if (selected?.status === "available") return selected;
  }
  return providers.find((provider) => provider.status === "available") ?? providers[0];
}

router.get("/interviews", async (_req, res) => {
  const data = (await listInterviewsFor(userIdOf(res))).map(interviewSummary);
  res.json(ListInterviewsResponse.parse(data));
});

router.post("/interviews", async (req, res) => {
  const input = CreateInterviewBody.parse(req.body);
  const interview: StoredInterview = {
    id: crypto.randomUUID(),
    ownerId: userIdOf(res),
    title: input.title,
    role: input.role,
    company: input.company || null,
    status: "active",
    answerCount: 0,
    score: null,
    updatedAt: now(),
    resumeContext: cleanText(input.resumeContext),
    topic: input.topic ?? "General interview",
    level: cleanLevel((req.body as { level?: unknown } | undefined)?.level),
    jobDescription: cleanText((req.body as { jobDescription?: unknown } | undefined)?.jobDescription),
    answers: [],
    sessions: [],
    askedQuestions: [],
    currentQuestion: null,
  };
  await insertInterview(interview, userIdOf(res));
  res.status(201).json(CreateInterviewResponse.parse(interview));
});

router.get("/interviews/:id", async (req, res) => {
  const params = GetInterviewParams.parse(req.params);
  const interview = await ownedInterview(res, params.id);
  if (!interview) {
    res.status(404).json({ error: "Interview not found" });
    return;
  }
  res.json(GetInterviewResponse.parse(interview));
});

router.post("/interviews/:id/next-question", async (req: Request, res) => {
  const interview = await ownedInterview(res, String(req.params.id));
  if (!interview) {
    res.status(404).json({ error: "Interview not found" });
    return;
  }
  const body = (req.body ?? {}) as { mode?: unknown; fresh?: unknown };
  const mode = body.mode === "bank" ? "bank" : "ai";
  const fresh = body.fresh === true;
  const answered = interview.answers.map((answer) => answer.question);

  // Re-opening the page should show the same unanswered question, not burn a new one.
  const current = interview.currentQuestion;
  if (!fresh && current && !isRepeatQuestion(current.text, answered)) {
    res.json({ question: current.text, source: current.source });
    return;
  }

  const asked = [...interview.askedQuestions, ...answered];
  const remember = async (text: string, source: "ai" | "bank") => {
    interview.currentQuestion = { text, source };
    interview.askedQuestions.push(text);
    await saveInterview(interview);
  };

  let note = "";
  if (mode === "ai") {
    try {
      const provider = await activeProvider();
      if (provider.status !== "available") throw new Error("No AI provider is available.");
      for (let attempt = 0; attempt < 2; attempt++) {
        const question = await generateQuestion(provider, interview, asked);
        if (question && !isRepeatQuestion(question, asked)) {
          await remember(question, "ai");
          res.json({ question, source: "ai" });
          return;
        }
      }
      note = "The AI kept repeating earlier questions, so this one comes from the built-in question bank.";
    } catch (error) {
      req.log.warn({ err: error }, "AI question generation failed; using the question bank");
      note = "AI question generation is not available right now, so this question comes from the built-in bank.";
    }
  }

  const picked = pickBankQuestion(interview, asked);
  await remember(picked.question, "bank");
  if (!note && picked.usedGeneralPool) note = "You have used every bank question for this topic, so this is a general interview question.";
  if (!note && picked.startedOver) note = "You have seen every bank question, so questions may repeat from now on.";
  res.json({ question: picked.question, source: "bank", note: note || undefined });
});

router.post("/interviews/:id/analyze", async (req: Request, res) => {
  const params = AnalyzeInterviewAnswerParams.parse(req.params);
  const input = AnalyzeInterviewAnswerBody.parse(req.body);
  const interview = await ownedInterview(res, params.id);
  if (!interview) {
    res.status(404).json({ error: "Interview not found" });
    return;
  }
  try {
    const rawBody = req.body as { delivery?: unknown; sessionId?: unknown } | undefined;
    const delivery = readDelivery(rawBody?.delivery);
    const sessionId = cleanSessionId(rawBody?.sessionId);
    const provider = await activeProvider();
    let analysis: Analysis;
    if (input.clientAnalysis) {
      analysis = AnalyzeInterviewAnswerResponse.parse(input.clientAnalysis);
    } else if (provider.status !== "available") {
      res.status(503).json({
        error:
          "No AI provider is available. Start Ollama locally with one preferred model, or configure an optional provider.",
      });
      return;
    } else {
      analysis = await generateAnalysis(provider, {
        ...input,
        level: interview.level,
        jobDescription: interview.jobDescription,
        delivery,
        askedQuestions: [...interview.askedQuestions, ...interview.answers.map((a) => a.question)],
      });
    }
    const answer: StoredAnswer = {
      id: crypto.randomUUID(),
      question: input.question,
      transcript: input.transcript,
      durationSeconds: input.durationSeconds,
      pauseCount: input.pauseCount,
      fillerWordCount: input.fillerWordCount,
      analysis,
      createdAt: now(),
      sessionId,
      delivery,
    };
    interview.answers.push(answer);
    interview.currentQuestion = null;
    if (!interview.askedQuestions.includes(input.question)) interview.askedQuestions.push(input.question);
    interview.answerCount = interview.answers.length;
    interview.score = Math.round(
      interview.answers.reduce(
        (total, current) => total + (current.analysis?.scores.overall ?? 0),
        0,
      ) / interview.answers.length,
    );
    interview.updatedAt = now();
    interview.status = "completed";
    await saveInterview(interview);
    res.json(AnalyzeInterviewAnswerResponse.parse(analysis));
  } catch (error) {
    req.log.error({ err: error }, "Interview answer analysis failed");
    res.status(502).json({
      error:
        error instanceof Error
          ? error.message
          : "The AI provider could not analyze this answer.",
    });
  }
});

// ---------- Practice sessions, progress and deleting ----------

const cleanSessionId = (value: unknown): string | null =>
  typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : null;

const strText = (value: unknown, max = 900) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const strList = (value: unknown, maxItems = 5, maxLen = 300): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string").map((v) => v.trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems)
    : [];
const indexOrNull = (value: unknown, count: number) =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= count ? value : null;

function sanitizeReview(raw: unknown, answerCount: number): SessionReview {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const review: SessionReview = {
    summary: strText(r.summary),
    timeManagement: strText(r.timeManagement),
    strengths: strList(r.strengths, 4),
    improvements: strList(r.improvements, 5),
    nextSteps: strList(r.nextSteps, 4),
    bestAnswerIndex: indexOrNull(r.bestAnswerIndex, answerCount),
    weakestAnswerIndex: indexOrNull(r.weakestAnswerIndex, answerCount),
  };
  if (!review.summary) throw new Error("The AI returned an empty session review.");
  return review;
}


const fmtSeconds = (seconds: number | null) => (seconds == null ? "--" : `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`);

/** Used when the AI review cannot be generated. Written only from numbers that were measured. */
function fallbackReview(stats: SessionStats): SessionReview {
  const per = stats.perAnswer;
  const scored = per.filter((a) => a.overall != null);
  const best = scored.length > 1 ? scored.reduce((hi, cur) => ((cur.overall ?? 0) > (hi.overall ?? 0) ? cur : hi)) : null;
  const weakest = scored.length > 1 ? scored.reduce((lo, cur) => ((cur.overall ?? 0) < (lo.overall ?? 0) ? cur : lo)) : null;
  const { short, good, long } = stats.timingCounts;

  const timing: string[] = [];
  if (stats.shortestSeconds != null && stats.longestSeconds != null) {
    timing.push(`Your answers ranged from ${fmtSeconds(stats.shortestSeconds)} to ${fmtSeconds(stats.longestSeconds)}, averaging ${fmtSeconds(stats.avgSeconds)}.`);
  }
  if (short) timing.push(`${short} answer${short > 1 ? "s were" : " was"} under ${SHORT_ANSWER_SECONDS} seconds: add one concrete example and the result so each answer reaches about 45 to 90 seconds.`);
  if (long) timing.push(`${long} answer${long > 1 ? "s ran" : " ran"} over ${LONG_ANSWER_SECONDS} seconds: lead with the point and cut the background.`);
  if (!short && !long && stats.answered) timing.push("All answers were a comfortable length.");

  const strengths: string[] = [];
  if (good) strengths.push(`${good} of ${stats.answered} answers were a comfortable length.`);
  if (stats.avgWpm != null && stats.avgWpm >= 110 && stats.avgWpm <= 160) strengths.push(`Your speaking pace (${stats.avgWpm} words per minute) is easy to follow.`);
  if (stats.fillersPer100Words != null && stats.fillersPer100Words < 2) strengths.push(`Very few filler words (${stats.fillersPer100Words} per 100 words).`);
  if (best) strengths.push(`Answer ${best.index} was your strongest, with a score of ${best.overall}.`);
  if (!strengths.length) strengths.push("You completed the session and recorded your answers.");

  const improvements: string[] = [];
  if (short) improvements.push("Extend short answers with an example and a result.");
  if (long) improvements.push("Tighten long answers: state the point first, then one example.");
  if (stats.fillersPer100Words != null && stats.fillersPer100Words >= 3) improvements.push(`Reduce filler words (${stats.fillersPer100Words} per 100 words). A silent pause sounds more confident.`);
  if (stats.avgWpm != null && stats.avgWpm > 160) improvements.push(`Slow down a little: ${stats.avgWpm} words per minute is fast.`);
  if (stats.avgWpm != null && stats.avgWpm < 100) improvements.push(`Your pace (${stats.avgWpm} words per minute) is slow. Try to keep the answer flowing.`);
  if (stats.longestPauseSeconds != null && stats.longestPauseSeconds >= 3) improvements.push(`Your longest pause was ${stats.longestPauseSeconds.toFixed(1)} seconds. Practise a short bridging phrase to recover.`);
  if (stats.avgScores) {
    const areas: Array<[string, number]> = [["content", stats.avgScores.content], ["structure", stats.avgScores.structure], ["confidence", stats.avgScores.confidence], ["delivery", stats.avgScores.delivery]];
    const [name, value] = areas.reduce((lo, cur) => (cur[1] < lo[1] ? cur : lo));
    improvements.push(`Your lowest area was ${name} (${value}). Work on that first.`);
  }
  if (!improvements.length) improvements.push("Nothing stood out in the numbers. Keep practising with harder questions.");

  const nextSteps: string[] = [];
  if (weakest) nextSteps.push(`Redo answer ${weakest.index} and aim for 60 to 90 seconds.`);
  nextSteps.push(stats.avgScores ? `Record another session and try to beat your average score of ${stats.avgScores.overall}.` : "Record another session to compare your numbers.");

  return {
    summary: `You answered ${stats.answered} of ${stats.planned} questions in ${fmtSeconds(stats.totalSeconds)} of speaking time${stats.avgScores ? `, with an average score of ${stats.avgScores.overall} out of 100` : ""}.`,
    timeManagement: timing.join(" "),
    strengths,
    improvements,
    nextSteps,
    bestAnswerIndex: best ? best.index : null,
    weakestAnswerIndex: weakest && weakest !== best ? weakest.index : null,
  };
}

async function generateSessionReview(
  provider: ProviderInfo,
  interview: StoredInterview,
  stats: SessionStats,
  answers: StoredAnswer[],
): Promise<SessionReview> {
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const lines = stats.perAnswer.map((p, i) => {
    const a = answers[i];
    const pace = p.wpm !== null ? `${p.wpm} wpm, ${p.pauses} pauses (longest ${p.longestPauseSeconds?.toFixed(1)}s)` : "pace and pauses not measured";
    return `Answer ${p.index}: "${p.question}"\n  length ${p.durationSeconds}s (${p.timing}); overall score ${p.overall ?? "n/a"}; ${pace}; fillers ${p.fillers}\n  coach summary: ${a.analysis?.summary ?? "n/a"}\n  top improvement: ${a.analysis?.improvements?.[0] ?? "n/a"}`;
  });
  const prompt = `You are a rigorous but encouraging mock-interview coach writing the end-of-session report for a candidate.
Return ONLY valid JSON with this exact shape:
{"summary":"","timeManagement":"","strengths":[],"improvements":[],"nextSteps":[],"bestAnswerIndex":1,"weakestAnswerIndex":2}

Rules:
1. Use ONLY the data below. Do not invent numbers, projects or experience.
2. "timeManagement": 2-4 sentences analysing the answer lengths with the exact measured numbers (total time, average, shortest, longest, how many answers were short or long). Say what to change. The rule of thumb is: under ${30} seconds is too short, over ${150} seconds is too long.
3. Do not comment on pace, pauses or fillers for answers marked "not measured".
4. "strengths": 2-3 items. "improvements": 3 specific, practical items. "nextSteps": 2-3 concrete things to practise in the next session.
5. "bestAnswerIndex" and "weakestAnswerIndex" are the 1-based answer numbers from the list, or null.

Role: ${interview.role}; level: ${interview.level}; focus topic: ${interview.topic}
Questions answered: ${stats.answered} of ${stats.planned}
Total speaking time: ${mmss(stats.totalSeconds)}; average ${stats.avgSeconds ?? "n/a"}s; shortest ${stats.shortestSeconds ?? "n/a"}s; longest ${stats.longestSeconds ?? "n/a"}s
Answer lengths: ${stats.timingCounts.short} short, ${stats.timingCounts.good} good, ${stats.timingCounts.long} long
Average scores: ${stats.avgScores ? JSON.stringify(stats.avgScores) : "n/a"}
Measured delivery (${stats.measuredAnswers} answers): average ${stats.avgWpm ?? "n/a"} wpm; total pauses ${stats.totalPauses ?? "n/a"}; longest pause ${stats.longestPauseSeconds ?? "n/a"}s
Filler words: ${stats.totalFillers} total (${stats.fillersPer100Words ?? "n/a"} per 100 words)

${lines.join("\n")}
`;
  const content = await callProvider(provider, prompt, 0.3);
  return sanitizeReview(extractJson(content), stats.answered);
}

router.post("/interviews/:id/session-report", async (req: Request, res) => {
  const interview = await ownedInterview(res, String(req.params.id));
  if (!interview) {
    res.status(404).json({ error: "Interview not found" });
    return;
  }
  const body = (req.body ?? {}) as { sessionId?: unknown; plannedQuestions?: unknown };
  const sessionId = cleanSessionId(body.sessionId);
  if (!sessionId) {
    res.status(400).json({ error: "A valid sessionId is required." });
    return;
  }
  const existing = interview.sessions.find((s) => s.id === sessionId);
  if (existing && existing.review && !existing.reviewNote) {
    res.json({ session: existing });
    return;
  }
  const answers = interview.answers.filter((a) => a.sessionId === sessionId);
  if (!answers.length) {
    res.status(400).json({ error: "No answered questions were found for this session." });
    return;
  }
  const requested = typeof body.plannedQuestions === "number" && Number.isInteger(body.plannedQuestions) ? body.plannedQuestions : answers.length;
  const planned = Math.min(20, Math.max(answers.length, requested));
  const stats = buildSessionStats(
    answers.map((a) => ({
      question: a.question,
      transcript: a.transcript,
      durationSeconds: a.durationSeconds,
      fillerWordCount: a.fillerWordCount,
      scores: a.analysis?.scores ?? null,
      delivery: a.delivery,
    })),
    planned,
  );

  let review: SessionReview | null = null;
  let reviewNote: string | undefined;
  try {
    const provider = await activeProvider();
    if (provider.status !== "available") throw new Error("No AI provider is available.");
    review = await generateSessionReview(provider, interview, stats, answers);
  } catch (error) {
    req.log.warn({ err: error }, "Session review could not be generated");
    review = fallbackReview(stats);
    reviewNote = "The AI review was not available, so this summary was written automatically from your measured numbers. All scores and timings are real.";
  }

  const session: StoredSession = {
    id: sessionId,
    startedAt: answers[0].createdAt,
    endedAt: now(),
    plannedQuestions: planned,
    answeredCount: answers.length,
    endedEarly: answers.length < planned,
    stats,
    review,
    reviewNote,
  };
  interview.sessions = interview.sessions.filter((s) => s.id !== sessionId);
  interview.sessions.push(session);
  await saveInterview(interview);
  res.json({ session: { ...session, interviewId: interview.id, interviewTitle: interview.title } });
});

router.get("/interviews/:id/sessions", async (req, res) => {
  const interview = await ownedInterview(res, String(req.params.id));
  if (!interview) {
    res.status(404).json({ error: "Interview not found" });
    return;
  }
  res.json({ sessions: interview.sessions });
});

router.get("/progress", async (_req, res) => {
  const me = userIdOf(res);
  const round1 = (value: number) => Math.round(value * 10) / 10;
  const answers: unknown[] = [];
  const sessions: unknown[] = [];
  for (const interview of await loadAllInterviewsFor(me)) {
    for (const answer of interview.answers) {
      const scores = answer.analysis?.scores;
      const words = countWords(answer.transcript);
      const measured = answer.delivery?.measured === true;
      answers.push({
        interviewId: interview.id,
        interviewTitle: interview.title,
        role: interview.role,
        topic: interview.topic,
        level: interview.level,
        createdAt: answer.createdAt,
        question: answer.question,
        overall: scores?.overall ?? null,
        content: scores?.content ?? null,
        structure: scores?.structure ?? null,
        confidence: scores?.confidence ?? null,
        delivery: scores?.delivery ?? null,
        durationSeconds: answer.durationSeconds,
        words,
        fillers: answer.fillerWordCount,
        fillersPer100Words: words > 0 ? round1((answer.fillerWordCount / words) * 100) : null,
        measured,
        wpm: measured ? answer.delivery?.wordsPerMinute ?? null : null,
        pauseCount: measured ? answer.delivery?.pauseCount ?? null : null,
        longestPauseSeconds: measured ? answer.delivery?.longestPauseSeconds ?? null : null,
        sessionId: answer.sessionId,
      });
    }
    for (const session of interview.sessions) {
      sessions.push({ ...session, interviewId: interview.id, interviewTitle: interview.title });
    }
  }
  answers.sort((a, b) => String((a as { createdAt: string }).createdAt).localeCompare(String((b as { createdAt: string }).createdAt)));
  sessions.sort((a, b) => String((a as { endedAt: string }).endedAt).localeCompare(String((b as { endedAt: string }).endedAt)));
  res.json({ answers, sessions });
});

router.delete("/interviews/:id", async (req, res) => {
  const id = String(req.params.id);
  if (!(await deleteInterviewFor(userIdOf(res), id))) {
    res.status(404).json({ error: "Interview not found" });
    return;
  }
  res.json({ deleted: true, id });
});

router.get("/providers/status", async (_req, res) => {
  const providers = await getProviders();
  const active = providers.find((provider) => provider.status === "available") ?? providers[0];
  res.json(
    GetProviderStatusResponse.parse({
      activeProvider: active.id,
      activeModel: active.model,
      providers,
    }),
  );
});

router.post(
  "/transcribe",
  express.raw({ type: "*/*", limit: "100mb" }),
  async (req: Request, res) => {
    try {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        res.status(400).json({ error: "GROQ_API_KEY is not configured on the server." });
        return;
      }
      const buffer = req.body as Buffer;
      if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
        res.status(400).json({ error: "No audio or video data provided." });
        return;
      }
      const contentType = (req.headers["content-type"] as string) || "audio/webm";
      const ext = contentType.includes("mp4") ? "mp4" : contentType.includes("wav") ? "wav" : "webm";
      const file = new File([buffer], `audio.${ext}`, { type: contentType });
      const formData = new FormData();
      formData.append("file", file);
      formData.append("model", "whisper-large-v3-turbo");
      formData.append("response_format", "json");
      formData.append("temperature", "0");
      // Whisper tends to drop "um" and "uh". A prompt written with fillers nudges it to keep them.
      formData.append("prompt", "Umm, let me think, like, hmm... Okay, so, uh, here is what I did, you know, and I mean, basically it worked.");

      const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        req.log.error({ err: errorText }, "Groq Whisper transcription failed");
        res.status(502).json({ error: `Groq Whisper failed: ${errorText}` });
        return;
      }

      const data = (await response.json()) as { text?: string };
      res.json({ transcript: (data.text ?? "").trim() });
    } catch (error) {
      req.log.error({ err: error }, "Transcription route error");
      res.status(500).json({
        error: error instanceof Error ? error.message : "Transcription failed",
      });
    }
  },
);

export default router;
