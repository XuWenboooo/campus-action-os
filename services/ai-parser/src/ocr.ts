import type { Document } from '@campus-action-os/protocol';
import { runLocalOcr } from './file-extractor.js';

export type OcrRequest = Pick<
  Document,
  'document_id' | 'content_type' | 'content_sha256' | 'data_origin'
> & {
  content?: Uint8Array;
};

export type OcrExtraction =
  | {
      status: 'succeeded';
      text: string;
      provider: string;
      version: string;
    }
  | {
      status: 'not_run' | 'failed';
      code:
        | 'OCR_NOT_CONFIGURED'
        | 'NOT_RUN_CREDENTIALS_REQUIRED'
        | 'OCR_FAILED'
        | 'OCR_TIMEOUT'
        | 'OCR_CANCELLED'
        | 'OCR_EMPTY'
        | 'MALFORMED_FILE'
        | 'ENCRYPTED_FILE'
        | 'EMPTY_FILE'
        | 'UNSUPPORTED_FILE';
      message: string;
    };

export interface OcrProvider {
  readonly name: string;
  extract(request: OcrRequest, signal?: AbortSignal): Promise<OcrExtraction>;
}

export const unconfiguredOcrProvider: OcrProvider = {
  name: 'unconfigured',
  async extract() {
    return {
      status: 'not_run',
      code: 'OCR_NOT_CONFIGURED',
      message: '没有配置可审计的 OCR provider；图片/PDF 解析未运行',
    };
  },
};

export type LocalRapidOcrOptions = {
  timeoutMs?: number;
};

export class LocalRapidOcrProvider implements OcrProvider {
  readonly name = 'rapidocr-onnxruntime';
  private readonly timeoutMs: number;

  constructor(options: LocalRapidOcrOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async extract(request: OcrRequest, signal?: AbortSignal): Promise<OcrExtraction> {
    if (!request.content)
      return {
        status: 'failed',
        code: 'EMPTY_FILE',
        message: 'OCR 输入文件内容为空',
      };
    try {
      const result = await runLocalOcr(
        request.content_type,
        request.content,
        this.timeoutMs,
        signal,
      );
      return {
        status: 'succeeded',
        text: result.text,
        provider: result.provider ?? this.name,
        version: result.version ?? 'offline-runtime',
      };
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code)
          : 'OCR_FAILED';
      const supported = [
        'OCR_TIMEOUT',
        'OCR_CANCELLED',
        'OCR_EMPTY',
        'MALFORMED_FILE',
        'ENCRYPTED_FILE',
        'EMPTY_FILE',
        'UNSUPPORTED_FILE',
      ] as const;
      const safeCode = (supported as readonly string[]).includes(code)
        ? (code as (typeof supported)[number])
        : 'OCR_FAILED';
      return {
        status: 'failed',
        code: safeCode,
        message: error instanceof Error ? error.message : '本地 OCR 失败',
      };
    }
  }
}
