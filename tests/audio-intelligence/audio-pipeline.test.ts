import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AudioPipelineError,
  AuditableAsrFailover,
  SenseVoiceLocalProvider,
  GOLDEN_DEMO_E_EXPECTATION,
  GOLDEN_DEMO_E_TEXT,
  UnconfiguredAsrProvider,
  analyzeAudio,
  transcribeAudio,
  voiceToAction,
  playbackForEvidence,
  toLivingActionRevisionProposal,
  type AsrProvider,
  type AsrInput,
  type TranscriptSegment,
} from '../../services/audio-intelligence/src/index.js';

function wavPcm16(samples: Float32Array, sampleRate: number, channels = 1): Uint8Array {
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataLength = samples.length * blockAlign;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1)
      bytes[offset + index] = value.charCodeAt(index);
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataLength, true);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    for (let channel = 0; channel < channels; channel += 1)
      view.setInt16(
        44 + (index * channels + channel) * bytesPerSample,
        Math.round(value * 0x7fff),
        true,
      );
  }
  return bytes;
}

function toneWithSilence(sampleRate = 8_000): Float32Array {
  const samples = new Float32Array(sampleRate * 3);
  for (let index = 0; index < samples.length; index += 1) {
    const seconds = index / sampleRate;
    if ((seconds >= 0.3 && seconds < 1.1) || (seconds >= 1.8 && seconds < 2.6))
      samples[index] = 0.35 * Math.sin(2 * Math.PI * 220 * seconds);
  }
  return samples;
}

class ScriptedProvider implements AsrProvider {
  readonly name = 'demo-scripted-not-asr';
  async transcribe(input: AsrInput): Promise<TranscriptSegment[]> {
    return [
      {
        segment_id: input.segment.segment_id,
        start_ms: input.segment.start_ms,
        end_ms: input.segment.end_ms,
        text:
          input.segment.segment_id === 'seg-0001'
            ? '实验报告周三之前交学习通。'
            : '刚才截止时间说错了，改成周五晚上八点。',
        confidence: 0.99,
        provider: 'demo-scripted-not-asr',
        source_audio_id: input.audio_id,
      },
    ];
  }
}

function validTranscript(
  input: AsrInput,
  provider: string,
  text = '测试语音',
): TranscriptSegment[] {
  return [
    {
      segment_id: `${input.segment.segment_id}-asr-1`,
      start_ms: input.segment.start_ms,
      end_ms: input.segment.end_ms,
      text,
      confidence: 0.8,
      provider,
      source_audio_id: input.audio_id,
    },
  ];
}

class FixedProvider implements AsrProvider {
  constructor(
    readonly name: string,
    private readonly behavior: 'success' | 'throw' | 'empty' | 'malformed' | 'fail',
  ) {}

  async transcribe(
    input: AsrInput,
  ): Promise<TranscriptSegment[] | { code: 'ASR_UNAVAILABLE'; message: string; retryable: true }> {
    if (this.behavior === 'throw') throw new Error('simulated runtime failure');
    if (this.behavior === 'empty') return [];
    if (this.behavior === 'malformed')
      return [
        {
          ...validTranscript(input, this.name)[0],
          end_ms: input.segment.start_ms,
        },
      ];
    if (this.behavior === 'fail')
      return {
        code: 'ASR_UNAVAILABLE',
        message: 'simulated provider unavailable',
        retryable: true,
      };
    return validTranscript(input, this.name);
  }
}

function silenceWav(sampleRate = 8_000): Uint8Array {
  return wavPcm16(new Float32Array(sampleRate), sampleRate);
}

test('decodes, mono-normalizes, resamples, hashes, and VAD-segments WAV bytes', () => {
  const bytes = wavPcm16(toneWithSilence(), 8_000, 2);
  const result = analyzeAudio(bytes, { audio_id: 'golden-e-audio' });
  assert.equal(result.info.sample_rate, 8_000);
  assert.equal(result.info.channels, 2);
  assert.equal(result.normalized.sample_rate, 16_000);
  assert.equal(result.normalized.channels, 1);
  assert.equal(result.normalized.provenance.raw_audio_hash.length, 64);
  assert.equal(result.normalized.provenance.normalized_audio_hash.length, 64);
  assert.equal(result.segments.length, 2);
  assert.ok(result.segments[0].start_ms < 400);
  assert.ok(result.segments[0].end_ms > 1_000);
  assert.ok(result.segments[1].start_ms > 1_500);
});

test('ASR is an injected boundary and unconfigured mode fails explicitly', async () => {
  const bytes = wavPcm16(toneWithSilence(), 8_000);
  await assert.rejects(
    transcribeAudio(bytes, new UnconfiguredAsrProvider(), { audio_id: 'unconfigured' }),
    (error: unknown) =>
      error instanceof AudioPipelineError && error.code === 'ASR_PROVIDER_NOT_REUSABLE',
  );
});

test('timestamped transcript segments become traceable audio evidence', async () => {
  const bytes = wavPcm16(toneWithSilence(), 8_000);
  const result = await transcribeAudio(bytes, new ScriptedProvider(), {
    audio_id: 'golden-e-audio',
  });
  assert.equal(result.transcript_segments.length, 2);
  assert.equal(result.audio_evidence.length, 2);
  assert.equal(result.audio_evidence[0].audio_id, 'golden-e-audio');
  assert.equal(result.audio_evidence[0].raw_audio_hash, result.provenance.raw_audio_hash);
  assert.ok(result.audio_evidence.every((item) => item.end_ms > item.start_ms));
});

test('Golden Demo E keeps action expectations separate from ASR claims', () => {
  assert.match(GOLDEN_DEMO_E_TEXT, /学习通/);
  assert.deepEqual(GOLDEN_DEMO_E_EXPECTATION, {
    action: '提交实验报告',
    deadline: '周五 20:00',
    platform: '学习通',
    condition: '第二组额外提交数据表',
    revision: '周三 → 周五 20:00',
  });
});

test('Voice-to-Action exposes an injectable compiler boundary with audio evidence', async () => {
  const bytes = wavPcm16(toneWithSilence(), 8_000);
  const result = await voiceToAction(
    bytes,
    new ScriptedProvider(),
    (input) => ({
      text: input.transcript_text,
      evidence_ids: input.audio_evidence.map((item) => item.evidence_id),
      task_ready: true,
    }),
    { audio_id: 'golden-e-audio' },
  );
  assert.equal(result.compiled_action.task_ready, true);
  assert.match(result.compiled_action.text, /学习通/);
  assert.equal(result.compiled_action.evidence_ids.length, 2);
  assert.equal(result.spoken_revisions.length, 1);
  assert.equal(result.spoken_revisions[0].change_type, 'corrected');
  assert.ok(result.spoken_revisions[0].evidence_ids.length > 0);
  const proposal = toLivingActionRevisionProposal('action-demo-e', result.spoken_revisions[0]);
  assert.equal(proposal.status, 'pending_review');
  assert.equal(proposal.requires_confirmation, true);
  assert.deepEqual(proposal.evidence_ids, result.spoken_revisions[0].evidence_ids);
});

test('audio failures are explicit and retain request ID plus raw provenance', async () => {
  const cases: Array<[string, Uint8Array, string | undefined]> = [
    ['empty', new Uint8Array(), 'AUDIO_EMPTY'],
    ['corrupt', new Uint8Array([82, 73, 70, 70]), 'AUDIO_INVALID_CONTAINER'],
    ['unsupported', new TextEncoder().encode('ID3not-a-real-mp3'), 'AUDIO_UNSUPPORTED_FORMAT'],
    ['silence', silenceWav(), 'AUDIO_NO_SPEECH'],
  ];
  for (const [label, bytes, expectedCode] of cases) {
    await assert.rejects(
      transcribeAudio(bytes, new ScriptedProvider(), {
        audio_id: `error-${label}`,
        request_id: `request-${label}`,
      }),
      (error: unknown) =>
        error instanceof AudioPipelineError &&
        error.code === expectedCode &&
        error.details.request_id === `request-${label}` &&
        typeof error.details.raw_audio_hash === 'string',
    );
  }
});

test('missing local model is a clear primary provider failure', async () => {
  const bytes = wavPcm16(toneWithSilence(), 8_000);
  await assert.rejects(
    transcribeAudio(
      bytes,
      new SenseVoiceLocalProvider({ model_dir: 'F:/missing-campus-asr-model' }),
      { audio_id: 'missing-model', request_id: 'request-missing-model' },
    ),
    (error: unknown) =>
      error instanceof AudioPipelineError &&
      error.code === 'ASR_MODEL_MISSING' &&
      error.details.request_id === 'request-missing-model',
  );
});

test('primary runtime failure, empty output, and malformed timestamps trigger audited fallback', async () => {
  const bytes = wavPcm16(toneWithSilence(), 8_000);
  for (const behavior of ['throw', 'empty', 'malformed'] as const) {
    const audit: string[] = [];
    const provider = new AuditableAsrFailover(
      new FixedProvider(`primary-${behavior}`, behavior),
      new FixedProvider(`fallback-${behavior}`, 'success'),
      { on_audit: (event) => audit.push(`${event.event}:${event.provider}:${event.code ?? ''}`) },
    );
    const result = await transcribeAudio(bytes, provider, {
      audio_id: `fallback-${behavior}`,
      request_id: `request-${behavior}`,
    });
    assert.equal(result.transcript_segments[0].provider, `fallback-${behavior}`);
    assert.equal(result.audio_evidence[0].asr_provider, `fallback-${behavior}`);
    assert.equal(result.asr_provider, `fallback-${behavior}`);
    assert.ok(audit.some((item) => item.startsWith('fallback:fallback-')));
    assert.ok(audit.some((item) => item.startsWith('primary_failure:primary-')));
  }
});

test('both ASR providers failed returns an auditable terminal error', async () => {
  const audit: string[] = [];
  const provider = new AuditableAsrFailover(
    new FixedProvider('sensevoice-local', 'fail'),
    new FixedProvider('faster-whisper-local', 'throw'),
    { on_audit: (event) => audit.push(`${event.event}:${event.provider}`) },
  );
  await assert.rejects(
    transcribeAudio(wavPcm16(toneWithSilence(), 8_000), provider, {
      audio_id: 'both-failed',
      request_id: 'request-both-failed',
    }),
    (error: unknown) =>
      error instanceof AudioPipelineError &&
      error.code === 'ASR_BOTH_PROVIDERS_FAILED' &&
      error.details.request_id === 'request-both-failed',
  );
  assert.ok(audit.includes('fallback:faster-whisper-local'));
  assert.ok(audit.includes('failure:sensevoice-local->faster-whisper-local'));
});

test('Action Compiler failure remains explicit after ASR and keeps provenance', async () => {
  await assert.rejects(
    voiceToAction(
      wavPcm16(toneWithSilence(), 8_000),
      new ScriptedProvider(),
      () => {
        throw new Error('compiler unavailable');
      },
      { audio_id: 'compiler-failure', request_id: 'request-compiler-failure' },
    ),
    (error: unknown) =>
      error instanceof AudioPipelineError &&
      error.code === 'ACTION_COMPILER_FAILED' &&
      error.details.request_id === 'request-compiler-failure' &&
      typeof error.details.raw_audio_hash === 'string',
  );
});

test('AudioEvidence exposes the minimal playback handoff contract', async () => {
  const result = await transcribeAudio(wavPcm16(toneWithSilence(), 8_000), new ScriptedProvider(), {
    audio_id: 'playback-demo',
  });
  assert.deepEqual(playbackForEvidence(result.audio_evidence[0]), {
    audio_id: 'playback-demo',
    start_ms: result.audio_evidence[0].start_ms,
    end_ms: result.audio_evidence[0].end_ms,
    label: '播放语音依据',
  });
});
