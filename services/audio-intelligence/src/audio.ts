import { createHash } from 'node:crypto';
import type { AudioFormat, AudioInfo, DecodedAudio, NormalizedAudio } from './types.js';

export class AudioDecodeError extends Error {
  readonly code:
    | 'AUDIO_EMPTY'
    | 'AUDIO_UNSUPPORTED_FORMAT'
    | 'AUDIO_INVALID_CONTAINER'
    | 'AUDIO_UNSUPPORTED_ENCODING';

  constructor(code: AudioDecodeError['code'], message: string) {
    super(message);
    this.name = 'AudioDecodeError';
    this.code = code;
  }
}

export type AudioDecoder = {
  readonly name: string;
  decode(bytes: Uint8Array, contentType?: string): DecodedAudio;
};

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function formatFromContentType(contentType?: string): AudioFormat {
  switch (contentType?.toLowerCase()) {
    case 'audio/wav':
    case 'audio/wave':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/mp4':
    case 'audio/x-m4a':
      return 'm4a';
    case 'audio/aac':
      return 'aac';
    default:
      return 'unknown';
  }
}

export function detectAudioFormat(bytes: Uint8Array, contentType?: string): AudioFormat {
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === 'RIFF') return 'wav';
  if (bytes.length >= 3 && ascii(bytes, 0, 3) === 'ID3') return 'mp3';
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'mp3';
  const byType = formatFromContentType(contentType);
  return byType;
}

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function signed24(view: DataView, offset: number): number {
  const value =
    view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
  return (value & 0x800000 ? value - 0x1000000 : value) / 0x800000;
}

function decodeSample(
  view: DataView,
  offset: number,
  bits: number,
  encoding: 'pcm' | 'float',
): number {
  if (encoding === 'float' && bits === 32) return view.getFloat32(offset, true);
  if (encoding !== 'pcm')
    throw new AudioDecodeError('AUDIO_UNSUPPORTED_ENCODING', 'Unsupported WAV encoding');
  if (bits === 8) return (view.getUint8(offset) - 128) / 128;
  if (bits === 16) return view.getInt16(offset, true) / 0x8000;
  if (bits === 24) return signed24(view, offset);
  if (bits === 32) return view.getInt32(offset, true) / 0x80000000;
  throw new AudioDecodeError('AUDIO_UNSUPPORTED_ENCODING', `Unsupported PCM bit depth: ${bits}`);
}

export class WavPcmDecoder implements AudioDecoder {
  readonly name = 'wav-pcm-independent';

  decode(bytes: Uint8Array, contentType = 'audio/wav'): DecodedAudio {
    if (bytes.length === 0) throw new AudioDecodeError('AUDIO_EMPTY', 'Audio bytes are empty');
    if (detectAudioFormat(bytes, contentType) !== 'wav')
      throw new AudioDecodeError(
        'AUDIO_UNSUPPORTED_FORMAT',
        'Only WAV is decoded by the built-in adapter',
      );
    if (bytes.length < 12)
      throw new AudioDecodeError('AUDIO_INVALID_CONTAINER', 'WAV header is truncated');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 12;
    let channels = 0;
    let sampleRate = 0;
    let bitsPerSample = 0;
    let encoding: 'pcm' | 'float' = 'pcm';
    let dataStart = -1;
    let dataLength = 0;
    while (offset + 8 <= bytes.length) {
      const chunkId = ascii(bytes, offset, 4);
      const chunkLength = readU32(view, offset + 4);
      const chunkStart = offset + 8;
      const chunkEnd = chunkStart + chunkLength;
      if (chunkEnd > bytes.length)
        throw new AudioDecodeError('AUDIO_INVALID_CONTAINER', 'WAV chunk exceeds input');
      if (chunkId === 'fmt ') {
        if (chunkLength < 16)
          throw new AudioDecodeError('AUDIO_INVALID_CONTAINER', 'WAV fmt chunk is truncated');
        const audioFormat = readU16(view, chunkStart);
        channels = readU16(view, chunkStart + 2);
        sampleRate = readU32(view, chunkStart + 4);
        bitsPerSample = readU16(view, chunkStart + 14);
        if (audioFormat === 1) encoding = 'pcm';
        else if (audioFormat === 3) encoding = 'float';
        else if (audioFormat === 0xfffe && chunkLength >= 40) {
          const subFormat = readU16(view, chunkStart + 24);
          if (subFormat === 1) encoding = 'pcm';
          else if (subFormat === 3) encoding = 'float';
          else
            throw new AudioDecodeError(
              'AUDIO_UNSUPPORTED_ENCODING',
              'Unsupported extensible WAV subtype',
            );
        } else
          throw new AudioDecodeError(
            'AUDIO_UNSUPPORTED_ENCODING',
            `Unsupported WAV format code: ${audioFormat}`,
          );
      } else if (chunkId === 'data') {
        dataStart = chunkStart;
        dataLength = chunkLength;
      }
      offset = chunkEnd + (chunkLength % 2);
    }
    if (channels < 1 || sampleRate < 1 || bitsPerSample < 1 || dataStart < 0)
      throw new AudioDecodeError('AUDIO_INVALID_CONTAINER', 'WAV is missing fmt or data metadata');
    const bytesPerSample = Math.ceil(bitsPerSample / 8);
    const blockAlign = channels * bytesPerSample;
    if (blockAlign <= 0 || dataLength % blockAlign !== 0)
      throw new AudioDecodeError(
        'AUDIO_INVALID_CONTAINER',
        'WAV data is not aligned to complete frames',
      );
    const frames = dataLength / blockAlign;
    const samples = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame += 1) {
      let sum = 0;
      for (let channel = 0; channel < channels; channel += 1) {
        sum += decodeSample(
          view,
          dataStart + frame * blockAlign + channel * bytesPerSample,
          bitsPerSample,
          encoding,
        );
      }
      samples[frame] = sum / channels;
    }
    const info: AudioInfo = {
      format: 'wav',
      content_type: contentType,
      sample_rate: sampleRate,
      channels,
      frames,
      duration_ms: Math.round((frames / sampleRate) * 1000),
      bits_per_sample: bitsPerSample,
      encoding,
    };
    return { samples, sample_rate: sampleRate, channels: 1, info };
  }
}

export function resampleAudio(
  samples: Float32Array,
  originalRate: number,
  targetRate: number,
): Float32Array {
  if (originalRate <= 0 || targetRate <= 0) throw new RangeError('Sample rates must be positive');
  if (originalRate === targetRate) return new Float32Array(samples);
  if (samples.length === 0) return new Float32Array();
  const outputLength = Math.max(1, Math.round((samples.length * targetRate) / originalRate));
  const output = new Float32Array(outputLength);
  const ratio = originalRate / targetRate;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.min(samples.length - 1, Math.floor(position));
    const right = Math.min(samples.length - 1, left + 1);
    const fraction = position - left;
    output[index] = samples[left] * (1 - fraction) + samples[right] * fraction;
  }
  return output;
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function sha256Float32(samples: Float32Array): string {
  return sha256Bytes(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
}

export function normalizeAudio(
  decoded: DecodedAudio,
  rawAudioHash: string,
  targetSampleRate = 16_000,
): NormalizedAudio {
  const resampled = resampleAudio(decoded.samples, decoded.sample_rate, targetSampleRate);
  let peak = 0;
  for (const value of resampled) peak = Math.max(peak, Math.abs(value));
  const normalized = new Float32Array(resampled);
  if (peak > 1)
    for (let index = 0; index < normalized.length; index += 1) normalized[index] /= peak;
  const info: AudioInfo = {
    ...decoded.info,
    sample_rate: targetSampleRate,
    frames: normalized.length,
    duration_ms: Math.round((normalized.length / targetSampleRate) * 1000),
    channels: 1,
  };
  return {
    samples: normalized,
    sample_rate: targetSampleRate,
    channels: 1,
    duration_ms: info.duration_ms,
    info,
    provenance: {
      raw_audio_hash: rawAudioHash,
      normalized_audio_hash: sha256Float32(normalized),
      decoder: 'wav-pcm-independent',
      source_content_type: decoded.info.content_type,
      original_sample_rate: decoded.sample_rate,
      normalized_sample_rate: targetSampleRate,
      mono: true,
      peak_before_scaling: peak,
    },
  };
}
