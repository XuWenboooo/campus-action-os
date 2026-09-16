import { readFile } from 'node:fs/promises';
import {
  AudioPipelineError,
  createLocalAsrFailover,
  transcribeAudio,
  type AsrAuditEvent,
} from '../services/audio-intelligence/src/index.js';

type Arguments = {
  audio: string;
  sensevoiceModel: string;
  fasterWhisperModel: string;
  python: string;
  vadMaxSilenceMs?: number;
};

function argumentValue(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
  return value;
}

function parseArguments(args: string[]): Arguments {
  return {
    audio: argumentValue(args, '--audio'),
    sensevoiceModel: argumentValue(args, '--sensevoice-model'),
    fasterWhisperModel: argumentValue(args, '--faster-whisper-model'),
    python: args.includes('--python') ? argumentValue(args, '--python') : 'python',
    vadMaxSilenceMs: args.includes('--vad-max-silence-ms')
      ? Number(argumentValue(args, '--vad-max-silence-ms'))
      : undefined,
  };
}

async function main(): Promise<void> {
  const parsed = parseArguments(process.argv.slice(2));
  const audit: AsrAuditEvent[] = [];
  const provider = createLocalAsrFailover({
    primary: { model_dir: parsed.sensevoiceModel, python_command: parsed.python },
    fallback: { model_dir: parsed.fasterWhisperModel, python_command: parsed.python },
    on_audit: (event) => audit.push(event),
  });
  const bytes = await readFile(parsed.audio);
  const result = await transcribeAudio(bytes, provider, {
    audio_id: `demo-${Buffer.from(parsed.audio).toString('base64url').slice(0, 16)}`,
    request_id: `voice-demo-${Date.now()}`,
    content_type: 'audio/wav',
    ...(parsed.vadMaxSilenceMs && Number.isFinite(parsed.vadMaxSilenceMs)
      ? { vad: { max_silence_ms: parsed.vadMaxSilenceMs } }
      : {}),
  });
  process.stdout.write(
    `${JSON.stringify({
      audio_id: result.audio_id,
      info: result.info,
      provenance: result.provenance,
      transcript_segments: result.transcript_segments,
      audio_evidence: result.audio_evidence,
      spoken_revisions: result.spoken_revisions,
      asr_audit: audit,
    }, null, 2)}\n`,
  );
}

main().catch((error: unknown) => {
  const output =
    error instanceof AudioPipelineError
      ? { error: { code: error.code, message: error.message, details: error.details } }
      : { error: { code: 'VOICE_DEMO_FAILED', message: error instanceof Error ? error.message : 'Demo failed' } };
  process.stderr.write(`${JSON.stringify(output)}\n`);
  process.exitCode = 1;
});
