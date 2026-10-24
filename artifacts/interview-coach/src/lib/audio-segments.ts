// Cuts one long recording into per-answer pieces, so a whole practice session
// can be recorded as ONE video and still be analysed answer by answer.

export type DecodedAudio = { samples: Float32Array; sampleRate: number; durationSeconds: number };

/** Decodes the audio of a recorded blob into mono samples. Throws if the browser cannot decode it. */
export async function decodeToMono(blob: Blob): Promise<DecodedAudio> {
  const AudioContextClass: typeof AudioContext | undefined =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) throw new Error('This browser cannot read audio.');
  const context = new AudioContextClass();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    let samples = buffer.getChannelData(0);
    if (buffer.numberOfChannels > 1) {
      const mixed = new Float32Array(buffer.length);
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < mixed.length; i++) mixed[i] += data[i] / buffer.numberOfChannels;
      }
      samples = mixed;
    }
    return { samples, sampleRate: buffer.sampleRate, durationSeconds: buffer.duration };
  } finally {
    void context.close();
  }
}

export function sliceSamples(samples: Float32Array, sampleRate: number, startSec: number, endSec: number): Float32Array {
  const start = Math.max(0, Math.floor(startSec * sampleRate));
  const end = Math.min(samples.length, Math.ceil(endSec * sampleRate));
  return end > start ? samples.subarray(start, end) : new Float32Array(0);
}

/** Turns samples into a small 16 kHz mono WAV file (what the transcription service needs). */
export function encodeWav16k(samples: Float32Array, sampleRate: number): Blob {
  const targetRate = 16000;
  const ratio = sampleRate / targetRate;
  const outLength = Math.max(0, Math.floor(samples.length / ratio));
  const buffer = new ArrayBuffer(44 + outLength * 2);
  const view = new DataView(buffer);
  const writeText = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + outLength * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, outLength * 2, true);
  for (let i = 0; i < outLength; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.min(samples.length, Math.max(from + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = from; j < to; j++) sum += samples[j];
    const value = Math.max(-1, Math.min(1, sum / (to - from)));
    view.setInt16(44 + i * 2, Math.round(value * 0x7fff), true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
