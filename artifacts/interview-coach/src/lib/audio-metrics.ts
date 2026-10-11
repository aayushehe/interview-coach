// Delivery measurements for a recorded answer.
//
// MEASURED FROM THE AUDIO (analyzeAudioDelivery): recording length, speaking
// time, number of pauses, pause lengths and the longest pause.
// COUNTED IN THE TRANSCRIPT (countFillers / countWords): filler words and word
// count. Words-per-minute combines the word count with the measured speaking
// span, so it needs both a transcript and audio.

/** A silence of at least this long counts as a pause. Tune here if needed. */
export const PAUSE_MIN_SECONDS = 0.8;

const FRAME_SECONDS = 0.03;
const MIN_VOICED_RUN_FRAMES = 4; // ~120 ms: shorter blips are treated as noise

export type AudioMetrics = {
  /** false when the audio was too quiet/flat to tell speech from silence. */
  reliable: boolean;
  /** Length of the whole recording. */
  durationSeconds: number;
  /** First spoken sound to last spoken sound. */
  spanSeconds: number;
  /** spanSeconds minus the pauses inside it. */
  speakingSeconds: number;
  pauseCount: number;
  totalPauseSeconds: number;
  longestPauseSeconds: number;
  pauses: Array<{ startSeconds: number; durationSeconds: number }>;
};

const emptyMetrics = (durationSeconds: number): AudioMetrics => ({
  reliable: false,
  durationSeconds,
  spanSeconds: 0,
  speakingSeconds: 0,
  pauseCount: 0,
  totalPauseSeconds: 0,
  longestPauseSeconds: 0,
  pauses: [],
});

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))];

/** Pure function: works on raw mono samples, so it can be tested without a browser. */
export function analyzeSamples(samples: Float32Array, sampleRate: number): AudioMetrics {
  const durationSeconds = samples.length / sampleRate;
  const frameLength = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const frameCount = Math.floor(samples.length / frameLength);
  if (frameCount < 20) return emptyMetrics(durationSeconds);
  const frameSeconds = frameLength / sampleRate;

  // Loudness (dB) of every 30 ms frame.
  const db = new Array<number>(frameCount);
  for (let frame = 0; frame < frameCount; frame++) {
    let sum = 0;
    const start = frame * frameLength;
    for (let i = start; i < start + frameLength; i++) sum += samples[i] * samples[i];
    db[frame] = 20 * Math.log10(Math.max(Math.sqrt(sum / frameLength), 1e-8));
  }

  // Adaptive threshold between the room's noise floor and the speaker's level.
  const sorted = [...db].sort((a, b) => a - b);
  const floor = percentile(sorted, 0.1);
  const peak = percentile(sorted, 0.95);
  const range = peak - floor;
  if (range < 12) return emptyMetrics(durationSeconds);
  const threshold = floor + Math.max(6, range * 0.3);

  const voiced = db.map((value) => value >= threshold);

  // Ignore very short loud blips (clicks, breaths) inside silence.
  let index = 0;
  while (index < frameCount) {
    if (!voiced[index]) { index++; continue; }
    let end = index;
    while (end < frameCount && voiced[end]) end++;
    if (end - index < MIN_VOICED_RUN_FRAMES) for (let k = index; k < end; k++) voiced[k] = false;
    index = end;
  }

  const first = voiced.indexOf(true);
  const last = voiced.lastIndexOf(true);
  if (first === -1) return emptyMetrics(durationSeconds);

  // Silent runs between the first and last spoken sound are candidate pauses.
  // Silence before the first word and after the last word is NOT a pause.
  const pauses: AudioMetrics['pauses'] = [];
  index = first;
  while (index <= last) {
    if (voiced[index]) { index++; continue; }
    let end = index;
    while (end <= last && !voiced[end]) end++;
    const length = (end - index) * frameSeconds;
    if (length >= PAUSE_MIN_SECONDS) {
      pauses.push({ startSeconds: round1(index * frameSeconds), durationSeconds: round1(length) });
    }
    index = end;
  }

  const spanSeconds = (last - first + 1) * frameSeconds;
  const totalPauseSeconds = pauses.reduce((sum, pause) => sum + pause.durationSeconds, 0);
  const longestPauseSeconds = pauses.reduce((max, pause) => Math.max(max, pause.durationSeconds), 0);

  return {
    reliable: spanSeconds >= 2,
    durationSeconds,
    spanSeconds,
    speakingSeconds: Math.max(0, spanSeconds - totalPauseSeconds),
    pauseCount: pauses.length,
    totalPauseSeconds: round1(totalPauseSeconds),
    longestPauseSeconds,
    pauses,
  };
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/** Decodes the audio track of a recorded/uploaded video and measures it. Throws if the browser cannot decode it. */
export async function analyzeAudioDelivery(blob: Blob): Promise<AudioMetrics> {
  const AudioContextClass: typeof AudioContext | undefined =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error('This browser cannot read audio.');
  const context = new AudioContextClass();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const channels = buffer.numberOfChannels;
    let samples = buffer.getChannelData(0);
    if (channels > 1) {
      const mixed = new Float32Array(buffer.length);
      for (let c = 0; c < channels; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < mixed.length; i++) mixed[i] += data[i] / channels;
      }
      samples = mixed;
    }
    return analyzeSamples(samples, buffer.sampleRate);
  } finally {
    void context.close();
  }
}

export const countWords = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

const FILLER_PATTERNS: Array<[label: string, pattern: RegExp]> = [
  ['um / uh / er / hmm', /\b(?:u+m+|u+h+|e+r+m*|h+m+)\b/gi],
  ['you know', /\byou know\b/gi],
  ['I mean', /\bi mean\b/gi],
  ['sort of / kind of', /\b(?:sort|kind) of\b/gi],
  ['basically', /\bbasically\b/gi],
];

/** Counts filler words in the transcript. "like" and "actually" are skipped on purpose: they are often real words. */
export function countFillers(text: string): { total: number; breakdown: Record<string, number> } {
  const breakdown: Record<string, number> = {};
  let total = 0;
  for (const [label, pattern] of FILLER_PATTERNS) {
    const count = (text.match(pattern) || []).length;
    if (count > 0) { breakdown[label] = count; total += count; }
  }
  return { total, breakdown };
}

/** Words per minute over the time between the first and last spoken sound. null if it cannot be measured. */
export function computeWpm(words: number, metrics: AudioMetrics | null): number | null {
  if (!metrics || !metrics.reliable || metrics.spanSeconds < 3 || words < 5) return null;
  return Math.round(words / (metrics.spanSeconds / 60));
}
