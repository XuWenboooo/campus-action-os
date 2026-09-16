export type AudioFormat = 'wav' | 'mp3' | 'm4a' | 'aac' | 'unknown';

export type AudioInfo = {
  format: AudioFormat;
  content_type: string;
  sample_rate: number;
  channels: number;
  frames: number;
  duration_ms: number;
  bits_per_sample?: number;
  encoding?: 'pcm' | 'float' | 'compressed' | 'unknown';
};

export type DecodedAudio = {
  samples: Float32Array;
  sample_rate: number;
  channels: number;
  info: AudioInfo;
};

export type AudioProvenance = {
  raw_audio_hash: string;
  normalized_audio_hash: string;
  decoder: string;
  source_content_type: string;
  original_sample_rate: number;
  normalized_sample_rate: number;
  mono: true;
  peak_before_scaling: number;
};

export type NormalizedAudio = {
  samples: Float32Array;
  sample_rate: number;
  channels: 1;
  duration_ms: number;
  info: AudioInfo;
  provenance: AudioProvenance;
};

export type AudioSegment = {
  segment_id: string;
  start_ms: number;
  end_ms: number;
  samples: Float32Array;
  voiced_ratio: number;
};

export type TranscriptSegment = {
  segment_id: string;
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number | null;
  provider: string;
  speaker_id?: string;
  source_audio_id: string;
};

export type AudioEvidence = {
  evidence_id: string;
  source_type: 'audio';
  audio_id: string;
  start_ms: number;
  end_ms: number;
  transcript_text: string;
  asr_provider: string;
  confidence: number | null;
  raw_audio_hash: string;
};

export type AsrInput = {
  audio_id: string;
  request_id: string;
  segment: AudioSegment;
  sample_rate: number;
  provenance: AudioProvenance;
};

export type AsrFailureCode =
  | 'ASR_PROVIDER_NOT_REUSABLE'
  | 'ASR_UNAVAILABLE'
  | 'ASR_INVALID_RESULT'
  | 'ASR_EMPTY_TRANSCRIPT'
  | 'ASR_MODEL_MISSING'
  | 'ASR_WORKER_MISSING'
  | 'ASR_RUNTIME_UNAVAILABLE'
  | 'ASR_TIMEOUT'
  | 'ASR_BOTH_PROVIDERS_FAILED'
  | 'AUDIO_NO_SPEECH';

export type AsrFailure = {
  code: AsrFailureCode;
  message: string;
  retryable: boolean;
  request_id?: string;
  audio_id?: string;
  raw_audio_hash?: string;
};

export type AsrProvider = {
  readonly name: string;
  transcribe(input: AsrInput, signal?: AbortSignal): Promise<TranscriptSegment[] | AsrFailure>;
};

export type AudioAnalysis = {
  audio_id: string;
  normalized: NormalizedAudio;
  segments: AudioSegment[];
  info: AudioInfo;
};

export type VoiceToTranscriptResult = {
  request_id: string;
  audio_id: string;
  info: AudioInfo;
  provenance: AudioProvenance;
  transcript_segments: TranscriptSegment[];
  audio_evidence: AudioEvidence[];
  spoken_revisions: SpokenRevisionEvent[];
  asr_provider: string;
};

export type AudioActionCompilerInput = {
  request_id: string;
  audio_id: string;
  transcript_text: string;
  transcript_segments: TranscriptSegment[];
  audio_evidence: AudioEvidence[];
  provenance: AudioProvenance;
  spoken_revisions: SpokenRevisionEvent[];
};

export type AudioActionCompiler<TAction> = (
  input: AudioActionCompilerInput,
  signal?: AbortSignal,
) => Promise<TAction> | TAction;

export type VoiceToActionResult<TAction> = VoiceToTranscriptResult & {
  compiled_action: TAction;
};

export type SpokenRevisionChangeType = 'corrected' | 'postponed' | 'revoked' | 'replaced';

export type SpokenRevisionEvent = {
  revision_id: string;
  change_type: SpokenRevisionChangeType;
  source_audio_id: string;
  trigger_segment_id: string;
  evidence_ids: string[];
  trigger_text: string;
  old_fact: string | null;
  new_fact: string | null;
  requires_user_confirmation: true;
};
