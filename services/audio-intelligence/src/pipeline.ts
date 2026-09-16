import { detectAudioFormat, normalizeAudio, sha256Bytes, WavPcmDecoder } from './audio.js';
import { detectSpokenRevisions } from './spoken-revision.js';
import { segmentVoiceActivity, type VadOptions } from './vad.js';
import type {
  AsrFailure,
  AsrInput,
  AsrProvider,
  AudioAnalysis,
  AudioEvidence,
  AudioActionCompiler,
  AudioInfo,
  DecodedAudio,
  TranscriptSegment,
  VoiceToActionResult,
  VoiceToTranscriptResult,
} from './types.js';

export type AudioErrorDetails = {
  request_id?: string;
  audio_id?: string;
  raw_audio_hash?: string;
};

export class AudioPipelineError extends Error {
  readonly code: string;
  readonly details: AudioErrorDetails;
  constructor(code: string, message: string, details: AudioErrorDetails = {}) {
    super(message);
    this.name = 'AudioPipelineError';
    this.code = code;
    this.details = details;
  }
}

export class UnconfiguredAsrProvider implements AsrProvider {
  readonly name = 'unconfigured';

  async transcribe(_input: AsrInput): Promise<AsrFailure> {
    return {
      code: 'ASR_PROVIDER_NOT_REUSABLE',
      message: 'No production ASR provider is configured; donor research ASR is not reusable',
      retryable: false,
    };
  }
}

export function analyzeAudio(
  bytes: Uint8Array,
  options: {
    content_type?: string;
    target_sample_rate?: number;
    audio_id?: string;
    request_id?: string;
    vad?: VadOptions;
  } = {},
): AudioAnalysis {
  const rawAudioHash = sha256Bytes(bytes);
  if (bytes.length === 0)
    throw new AudioPipelineError('AUDIO_EMPTY', 'Audio bytes are empty', {
      request_id: options.request_id,
      audio_id: options.audio_id,
      raw_audio_hash: rawAudioHash,
    });
  const format = detectAudioFormat(bytes, options.content_type);
  if (format !== 'wav')
    throw new AudioPipelineError(
      'AUDIO_UNSUPPORTED_FORMAT',
      `Built-in decoder does not accept ${format} audio`,
      { request_id: options.request_id, audio_id: options.audio_id, raw_audio_hash: rawAudioHash },
    );
  let decoded: DecodedAudio;
  try {
    decoded = new WavPcmDecoder().decode(bytes, options.content_type ?? 'audio/wav');
  } catch (error) {
    throw new AudioPipelineError(
      error instanceof Error && 'code' in error ? String(error.code) : 'AUDIO_INVALID_CONTAINER',
      error instanceof Error ? error.message : 'Audio decoder failed',
      { request_id: options.request_id, audio_id: options.audio_id, raw_audio_hash: rawAudioHash },
    );
  }
  const normalized = normalizeAudio(decoded, rawAudioHash, options.target_sample_rate ?? 16_000);
  const audioId = options.audio_id ?? `audio-${normalized.provenance.raw_audio_hash.slice(0, 16)}`;
  return {
    audio_id: audioId,
    normalized,
    segments: segmentVoiceActivity(normalized, options.vad),
    info: decoded.info,
  };
}

function validateTranscriptSegment(segment: TranscriptSegment, audioId: string): boolean {
  return (
    segment.source_audio_id === audioId &&
    Number.isFinite(segment.start_ms) &&
    Number.isFinite(segment.end_ms) &&
    segment.start_ms >= 0 &&
    segment.end_ms > segment.start_ms &&
    typeof segment.text === 'string' &&
    segment.text.trim().length > 0 &&
    typeof segment.provider === 'string' &&
    (segment.confidence === null || (segment.confidence >= 0 && segment.confidence <= 1))
  );
}

function evidenceFor(segment: TranscriptSegment, rawAudioHash: string): AudioEvidence {
  return {
    evidence_id: `${segment.source_audio_id}:evidence:${segment.segment_id}`,
    source_type: 'audio',
    audio_id: segment.source_audio_id,
    start_ms: segment.start_ms,
    end_ms: segment.end_ms,
    transcript_text: segment.text,
    asr_provider: segment.provider,
    confidence: segment.confidence,
    raw_audio_hash: rawAudioHash,
  };
}

export async function transcribeAudio(
  bytes: Uint8Array,
  provider: AsrProvider,
  options: {
    content_type?: string;
    target_sample_rate?: number;
    audio_id?: string;
    request_id?: string;
    vad?: VadOptions;
    signal?: AbortSignal;
  } = {},
): Promise<VoiceToTranscriptResult> {
  const requestId = options.request_id ?? `audio-request-${sha256Bytes(bytes).slice(0, 16)}`;
  const analysis = analyzeAudio(bytes, { ...options, request_id: requestId });
  if (analysis.segments.length === 0)
    throw new AudioPipelineError('AUDIO_NO_SPEECH', 'No voiced audio segment was detected', {
      request_id: requestId,
      audio_id: analysis.audio_id,
      raw_audio_hash: analysis.normalized.provenance.raw_audio_hash,
    });
  const transcriptSegments: TranscriptSegment[] = [];
  const transcriptIds = new Set<string>();
  let previousStart = -1;
  for (const segment of analysis.segments) {
    const result = await provider.transcribe(
      {
        audio_id: analysis.audio_id,
        request_id: requestId,
        segment,
        sample_rate: analysis.normalized.sample_rate,
        provenance: analysis.normalized.provenance,
      },
      options.signal,
    );
    if ('code' in result)
      throw new AudioPipelineError(result.code, result.message, {
        request_id: result.request_id ?? requestId,
        audio_id: result.audio_id ?? analysis.audio_id,
        raw_audio_hash: result.raw_audio_hash ?? analysis.normalized.provenance.raw_audio_hash,
      });
    for (const transcript of result) {
      if (
        !validateTranscriptSegment(transcript, analysis.audio_id) ||
        transcriptIds.has(transcript.segment_id) ||
        transcript.start_ms < previousStart
      )
        throw new AudioPipelineError(
          'ASR_INVALID_RESULT',
          'ASR returned an invalid timestamped segment',
          {
            request_id: requestId,
            audio_id: analysis.audio_id,
            raw_audio_hash: analysis.normalized.provenance.raw_audio_hash,
          },
        );
      if (transcript.start_ms < segment.start_ms || transcript.end_ms > segment.end_ms)
        throw new AudioPipelineError(
          'ASR_INVALID_RESULT',
          'ASR segment escaped its audio segment boundary',
          {
            request_id: requestId,
            audio_id: analysis.audio_id,
            raw_audio_hash: analysis.normalized.provenance.raw_audio_hash,
          },
        );
      transcriptIds.add(transcript.segment_id);
      previousStart = transcript.start_ms;
      transcriptSegments.push(transcript);
    }
  }
  transcriptSegments.sort((left, right) => left.start_ms - right.start_ms);
  const audioEvidence = transcriptSegments.map((segment) =>
    evidenceFor(segment, analysis.normalized.provenance.raw_audio_hash),
  );
  return {
    request_id: requestId,
    audio_id: analysis.audio_id,
    info: analysis.info,
    provenance: analysis.normalized.provenance,
    transcript_segments: transcriptSegments,
    audio_evidence: audioEvidence,
    spoken_revisions: detectSpokenRevisions(transcriptSegments, audioEvidence),
    asr_provider: transcriptSegments[0]?.provider ?? provider.name,
  };
}

export function transcriptText(result: VoiceToTranscriptResult): string {
  return result.transcript_segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join('\n');
}

export async function voiceToAction<TAction>(
  bytes: Uint8Array,
  provider: AsrProvider,
  compiler: AudioActionCompiler<TAction>,
  options: {
    content_type?: string;
    target_sample_rate?: number;
    audio_id?: string;
    request_id?: string;
    vad?: VadOptions;
    signal?: AbortSignal;
  } = {},
): Promise<VoiceToActionResult<TAction>> {
  const transcript = await transcribeAudio(bytes, provider, options);
  let compiledAction: TAction;
  try {
    compiledAction = await compiler(
      {
        request_id: transcript.request_id,
        audio_id: transcript.audio_id,
        transcript_text: transcriptText(transcript),
        transcript_segments: transcript.transcript_segments,
        audio_evidence: transcript.audio_evidence,
        provenance: transcript.provenance,
        spoken_revisions: transcript.spoken_revisions,
      },
      options.signal,
    );
  } catch (error) {
    if (error instanceof AudioPipelineError) throw error;
    throw new AudioPipelineError(
      'ACTION_COMPILER_FAILED',
      error instanceof Error ? error.message : 'Action Compiler failed after ASR',
      {
        request_id: transcript.request_id,
        audio_id: transcript.audio_id,
        raw_audio_hash: transcript.provenance.raw_audio_hash,
      },
    );
  }
  return { ...transcript, compiled_action: compiledAction };
}

export function audioInfoForResult(result: VoiceToTranscriptResult): AudioInfo {
  return result.info;
}
