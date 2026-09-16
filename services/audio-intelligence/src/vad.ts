import type { AudioSegment, NormalizedAudio } from './types.js';

export type VadOptions = {
  frame_ms?: number;
  hop_ms?: number;
  threshold_ratio?: number;
  min_speech_ms?: number;
  max_silence_ms?: number;
  padding_ms?: number;
};

function quantile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function energyVad(
  samples: Float32Array,
  sampleRate: number,
  options: VadOptions = {},
): boolean[] {
  const frameMs = options.frame_ms ?? 25;
  const hopMs = options.hop_ms ?? 10;
  const thresholdRatio = options.threshold_ratio ?? 0.25;
  if (sampleRate <= 0 || frameMs <= 0 || hopMs <= 0) throw new RangeError('Invalid VAD timing');
  if (thresholdRatio < 0 || thresholdRatio > 1)
    throw new RangeError('threshold_ratio must be in [0, 1]');
  const frameSize = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const hop = Math.max(1, Math.round((sampleRate * hopMs) / 1000));
  if (samples.length === 0) return [];
  const energies: number[] = [];
  for (let start = 0; start < samples.length; start += hop) {
    const end = Math.min(samples.length, start + frameSize);
    let sum = 0;
    for (let index = start; index < end; index += 1) sum += samples[index] ** 2;
    energies.push(sum / Math.max(1, end - start));
    if (end === samples.length) break;
  }
  const peak = Math.max(...energies);
  if (peak <= 1e-12) return energies.map(() => false);
  const floor = quantile(energies, 0.2);
  const threshold =
    Math.abs(peak - floor) < 1e-12 ? peak * 0.5 : floor + thresholdRatio * (peak - floor);
  return energies.map((energy) => energy >= threshold);
}

export function voicedRatio(
  samples: Float32Array,
  sampleRate: number,
  options: VadOptions = {},
): number {
  const mask = energyVad(samples, sampleRate, options);
  return mask.length === 0 ? 0 : mask.filter(Boolean).length / mask.length;
}

export function segmentVoiceActivity(
  normalized: NormalizedAudio,
  options: VadOptions = {},
): AudioSegment[] {
  const frameMs = options.frame_ms ?? 25;
  const hopMs = options.hop_ms ?? 10;
  const minSpeechMs = options.min_speech_ms ?? 160;
  const maxSilenceMs = options.max_silence_ms ?? 420;
  const paddingMs = options.padding_ms ?? 80;
  const mask = energyVad(normalized.samples, normalized.sample_rate, options);
  const hop = Math.max(1, Math.round((normalized.sample_rate * hopMs) / 1000));
  const frameSize = Math.max(1, Math.round((normalized.sample_rate * frameMs) / 1000));
  const maxSilentFrames = Math.max(0, Math.floor(maxSilenceMs / hopMs));
  const intervals: Array<[number, number]> = [];
  let startFrame: number | null = null;
  let lastVoicedFrame = -1;
  let silentFrames = 0;
  for (let frame = 0; frame < mask.length; frame += 1) {
    if (mask[frame]) {
      if (startFrame === null) startFrame = frame;
      lastVoicedFrame = frame;
      silentFrames = 0;
    } else if (startFrame !== null) {
      silentFrames += 1;
      if (silentFrames > maxSilentFrames) {
        intervals.push([startFrame, lastVoicedFrame]);
        startFrame = null;
        lastVoicedFrame = -1;
        silentFrames = 0;
      }
    }
  }
  if (startFrame !== null) intervals.push([startFrame, lastVoicedFrame]);
  return intervals
    .map(([first, last], index): AudioSegment | null => {
      const rawStart = (first * hop * 1000) / normalized.sample_rate - paddingMs;
      const rawEnd = ((last * hop + frameSize) * 1000) / normalized.sample_rate + paddingMs;
      const startMs = Math.max(0, Math.round(rawStart));
      const endMs = Math.min(normalized.duration_ms, Math.round(rawEnd));
      if (endMs - startMs < minSpeechMs) return null;
      const start = Math.round((startMs * normalized.sample_rate) / 1000);
      const end = Math.min(
        normalized.samples.length,
        Math.round((endMs * normalized.sample_rate) / 1000),
      );
      return {
        segment_id: `seg-${String(index + 1).padStart(4, '0')}`,
        start_ms: startMs,
        end_ms: endMs,
        samples: normalized.samples.slice(start, end),
        voiced_ratio: voicedRatio(
          normalized.samples.slice(start, end),
          normalized.sample_rate,
          options,
        ),
      };
    })
    .filter((segment): segment is AudioSegment => segment !== null);
}
