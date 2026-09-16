import type { AudioEvidence } from './types.js';

export type AudioEvidencePlayback = {
  audio_id: string;
  start_ms: number;
  end_ms: number;
  label: string;
};

export function playbackForEvidence(
  evidence: AudioEvidence,
  label = '播放语音依据',
): AudioEvidencePlayback {
  return {
    audio_id: evidence.audio_id,
    start_ms: evidence.start_ms,
    end_ms: evidence.end_ms,
    label,
  };
}
