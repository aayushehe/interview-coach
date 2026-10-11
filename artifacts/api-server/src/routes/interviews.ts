import express, { Router, type IRouter, type Request } from "express";
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
import fs from "node:fs";
import path from "node:path";

type ProviderId = "ollama" | "lmstudio" | "huggingface" | "groq";

type Score = {
  overall: number;
  content: number;
  structure: number;
  confidence: number;
  delivery: number;
};

type Analysis = {
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

type StoredAnswer = {
  id: string;
  question: string;
  transcript: string;
  durationSeconds: number;
  pauseCount: number;
  fillerWordCount: number;
  analysis: Analysis | null;
};

type StoredInterview = {
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
  answers: StoredAnswer[];
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
const interviews = new Map<string, StoredInterview>();

// History is kept in memory AND saved to a JSON file, so it survives restarts.
// Default location: <api-server folder>/data/interviews.json (override with INTERVIEWS_FILE in .env).
const DATA_FILE = process.env.INTERVIEWS_FILE
  ? path.resolve(process.env.INTERVIEWS_FILE)
  : path.resolve(process.cwd(), "data", "interviews.json");

function saveInterviews() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Array.from(interviews.values()), null, 2), "utf-8");
    fs.renameSync(tmp, DATA_FILE); // write-then-rename so a crash never leaves a half-written file
  } catch (error) {
    logger.error({ err: error }, "Could not save interviews to disk");
  }
}

function loadInterviews() {
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")) as unknown;
    if (!Array.isArray(parsed)) throw new Error("Saved interviews file is not a list");
    for (const item of parsed as Partial<StoredInterview>[]) {
      if (!item || typeof item.id !== "string") continue;
      const answers = Array.isArray(item.answers) ? item.answers : [];
      interviews.set(item.id, {
        id: item.id,
        title: item.title ?? "Untitled interview",
        role: item.role ?? "",
        company: item.company ?? null,
        status: item.status === "completed" ? "completed" : "active",
        answerCount: answers.length,
        score: item.score ?? null,
        updatedAt: item.updatedAt ?? new Date().toISOString(),
        resumeContext: item.resumeContext ?? "",
        topic: item.topic ?? "General interview",
        answers,
        askedQuestions: Array.isArray(item.askedQuestions) ? item.askedQuestions : [],
        currentQuestion: item.currentQuestion ?? null,
      });
    }
    logger.info({ count: interviews.size, file: DATA_FILE }, "Loaded saved interviews");
  } catch (error) {
    // Keep the unreadable file instead of overwriting it, then start fresh.
    const backup = `${DATA_FILE}.corrupt-${Date.now()}`;
    try { fs.renameSync(DATA_FILE, backup); } catch { /* ignore */ }
    logger.error({ err: error, backup }, "Saved interviews could not be read; started with an empty history");
  }
}

loadInterviews();

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

type Delivery = {
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

Question: ${input.question}
Topic: ${input.topic ?? "General interview"}
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
async function callProvider(provider: ProviderInfo, prompt: string, temperature = 0.2): Promise<string> {
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
    throw new Error(payload.error?.message ?? "The selected provider rejected the request.");
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
  const prompt = `You are a human interviewer running a mock interview. Write ONE new interview question.

Role: ${interview.role}
Company: ${interview.company ?? "not specified"}
Focus topic: ${interview.topic}
Candidate background (from their resume or notes): ${interview.resumeContext.trim() || "not provided; assume an entry-level candidate such as a student"}

Questions already asked (do NOT repeat or rephrase any of them):
${asked.length ? asked.map((q) => `- ${q}`).join("\n") : "- none yet"}
${lastAnswer ? `\nThe candidate's previous answer, for context (ask a natural follow-up only if it clearly opens one; otherwise move to a different area of the topic):\n${lastAnswer.transcript.slice(0, 500)}\n` : ""}
Rules:
- The question must fit the role and the focus topic, and be realistic for the candidate's level.
- Do not assume the candidate has experience that is not in their background.
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

router.get("/interviews", (_req, res) => {
  const data = Array.from(interviews.values())
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(interviewSummary);
  res.json(ListInterviewsResponse.parse(data));
});

router.post("/interviews", (req, res) => {
  const input = CreateInterviewBody.parse(req.body);
  const interview: StoredInterview = {
    id: crypto.randomUUID(),
    title: input.title,
    role: input.role,
    company: input.company || null,
    status: "active",
    answerCount: 0,
    score: null,
    updatedAt: now(),
    resumeContext: input.resumeContext ?? "",
    topic: input.topic ?? "General interview",
    answers: [],
    askedQuestions: [],
    currentQuestion: null,
  };
  interviews.set(interview.id, interview);
  saveInterviews();
  res.status(201).json(CreateInterviewResponse.parse(interview));
});

router.get("/interviews/:id", (req, res) => {
  const params = GetInterviewParams.parse(req.params);
  const interview = interviews.get(params.id);
  if (!interview) {
    res.status(404).json({ error: "Interview not found" });
    return;
  }
  res.json(GetInterviewResponse.parse(interview));
});

router.post("/interviews/:id/next-question", async (req: Request, res) => {
  const interview = interviews.get(String(req.params.id));
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
  const remember = (text: string, source: "ai" | "bank") => {
    interview.currentQuestion = { text, source };
    interview.askedQuestions.push(text);
    saveInterviews();
  };

  let note = "";
  if (mode === "ai") {
    try {
      const provider = await activeProvider();
      if (provider.status !== "available") throw new Error("No AI provider is available.");
      for (let attempt = 0; attempt < 2; attempt++) {
        const question = await generateQuestion(provider, interview, asked);
        if (question && !isRepeatQuestion(question, asked)) {
          remember(question, "ai");
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
  remember(picked.question, "bank");
  if (!note && picked.usedGeneralPool) note = "You have used every bank question for this topic, so this is a general interview question.";
  if (!note && picked.startedOver) note = "You have seen every bank question, so questions may repeat from now on.";
  res.json({ question: picked.question, source: "bank", note: note || undefined });
});

router.post("/interviews/:id/analyze", async (req: Request, res) => {
  const params = AnalyzeInterviewAnswerParams.parse(req.params);
  const input = AnalyzeInterviewAnswerBody.parse(req.body);
  const interview = interviews.get(params.id);
  if (!interview) {
    res.status(404).json({ error: "Interview not found" });
    return;
  }
  try {
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
        delivery: readDelivery((req.body as { delivery?: unknown } | undefined)?.delivery),
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
    saveInterviews();
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
