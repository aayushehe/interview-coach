// The AI "reads" a question aloud using the voice built into the browser.
// Nothing is sent anywhere: the browser's own text-to-speech does it.

export const speechSupported = (): boolean =>
  typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance !== 'undefined';

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const rank = (voice: SpeechSynthesisVoice) => {
    const lang = voice.lang.toLowerCase();
    let score = 0;
    if (lang === 'en-in') score += 4;
    else if (lang.startsWith('en-')) score += 2;
    else if (lang.startsWith('en')) score += 1;
    if (/natural|google|online/i.test(voice.name)) score += 1;
    return score;
  };
  const best = [...voices].sort((a, b) => rank(b) - rank(a))[0];
  return best && rank(best) > 0 ? best : null;
}

/**
 * Speaks the text and resolves when it has finished.
 * It never rejects, and a safety timer guarantees it always resolves,
 * because some browsers forget to say the speech has ended.
 */
export function speak(text: string): Promise<void> {
  const clean = text.trim();
  if (!clean || !speechSupported()) return Promise.resolve();
  const synth = window.speechSynthesis;
  synth.cancel();
  return new Promise<void>((resolve) => {
    let finished = false;
    const words = clean.split(/\s+/).length;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, Math.max(4000, words * 600 + 3000));
    const utterance = new SpeechSynthesisUtterance(clean);
    const voice = pickVoice();
    if (voice) { utterance.voice = voice; utterance.lang = voice.lang; } else { utterance.lang = 'en-US'; }
    utterance.rate = 0.95;
    utterance.onend = finish;
    utterance.onerror = finish;
    synth.speak(utterance);
  });
}

export function stopSpeaking() {
  if (speechSupported()) window.speechSynthesis.cancel();
}
