import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { Document } from '@campus-action-os/protocol';

export type ExtractionFailureCode =
  | 'EMPTY_FILE'
  | 'MALFORMED_FILE'
  | 'ENCRYPTED_FILE'
  | 'UNSUPPORTED_FILE'
  | 'OCR_EMPTY'
  | 'OCR_FAILED'
  | 'OCR_TIMEOUT'
  | 'OCR_CANCELLED';

export type FileInspection =
  | {
      status: 'text';
      text: string;
      source: 'direct_text' | 'html_text' | 'pdf_text';
      provider?: string;
      version?: string;
    }
  | {
      status: 'ocr_required';
      reason: 'image' | 'scanned_pdf' | 'missing_content';
    }
  | {
      status: 'failed';
      code: ExtractionFailureCode;
      message: string;
    };

export interface DocumentExtractor {
  inspect(document: Document, content?: Uint8Array, signal?: AbortSignal): Promise<FileInspection>;
}

type WorkerResponse = {
  status: 'text' | 'ocr_required' | 'succeeded' | 'failed';
  text?: string;
  source?: 'pdf_text' | 'png' | 'jpeg' | 'scanned_pdf';
  provider?: string;
  version?: string;
  code?: ExtractionFailureCode;
  message?: string;
};

type WorkerSuccess = WorkerResponse & { status: 'succeeded'; text: string };

class WorkerFailure extends Error {
  constructor(
    readonly code: ExtractionFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'WorkerFailure';
  }
}

const projectRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const workerPath = resolve(projectRoot, 'tools/local-document-worker.py');

function pythonCommand(): string {
  return process.env.PHASE2_PYTHON_BIN ?? process.env.PYTHON_BIN ?? 'python';
}

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|li|p|section|article|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"');
}

function worker(
  mode: 'inspect' | 'ocr',
  contentType: Document['content_type'],
  content: Uint8Array,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<WorkerResponse> {
  if (signal?.aborted) return Promise.reject(new WorkerFailure('OCR_CANCELLED', '文件提取已取消'));
  return new Promise((resolveWorker, reject) => {
    const child = spawn(pythonCommand(), ['-X', 'utf8', workerPath], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = (): void => {
      child.kill();
      finish(() => reject(new WorkerFailure('OCR_CANCELLED', '文件提取已取消')));
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new WorkerFailure('OCR_TIMEOUT', '本地文件提取超过时间限制')));
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 3_000_000) child.kill();
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
    });
    child.on('error', (error) => {
      finish(() =>
        reject(
          new WorkerFailure(
            'OCR_FAILED',
            `本地文件 worker 不可用: ${error instanceof Error ? error.message : String(error)}`,
          ),
        ),
      );
    });
    child.on('close', (code) => {
      if (settled) return;
      let parsed: WorkerResponse;
      try {
        parsed = JSON.parse(stdout) as WorkerResponse;
      } catch {
        finish(() =>
          reject(
            new WorkerFailure(
              'OCR_FAILED',
              `本地文件 worker 返回了不可解析结果${code === 0 ? '' : ` (exit ${code})`}`,
            ),
          ),
        );
        return;
      }
      if (parsed.status === 'failed') {
        finish(() =>
          reject(
            new WorkerFailure(
              parsed.code ?? 'OCR_FAILED',
              parsed.message ?? (stderr || '本地文件 worker 提取失败'),
            ),
          ),
        );
        return;
      }
      finish(() => resolveWorker(parsed));
    });
    child.stdin.end(
      JSON.stringify({
        mode,
        content_type: contentType,
        content_base64: Buffer.from(content).toString('base64'),
      }),
    );
  });
}

export class LocalDocumentExtractor implements DocumentExtractor {
  constructor(readonly timeoutMs = 30_000) {}

  async inspect(
    document: Document,
    content?: Uint8Array,
    signal?: AbortSignal,
  ): Promise<FileInspection> {
    if (document.content_type === 'text/plain') {
      return document.text.trim()
        ? { status: 'text', text: document.text, source: 'direct_text' }
        : { status: 'failed', code: 'EMPTY_FILE', message: '文本文件内容为空' };
    }
    if (document.content_type === 'text/html') {
      const text = htmlToText(document.text);
      return text.trim()
        ? { status: 'text', text, source: 'html_text' }
        : { status: 'failed', code: 'EMPTY_FILE', message: 'HTML 文件内容为空' };
    }
    if (document.content_type !== 'application/pdf' && !document.content_type.startsWith('image/'))
      return { status: 'failed', code: 'UNSUPPORTED_FILE', message: '不支持的文件类型' };
    if (!content) return { status: 'ocr_required', reason: 'missing_content' };
    try {
      const result = await worker(
        'inspect',
        document.content_type,
        content,
        this.timeoutMs,
        signal,
      );
      if (result.status === 'text' && typeof result.text === 'string')
        return {
          status: 'text',
          text: result.text,
          source: result.source === 'pdf_text' ? 'pdf_text' : 'direct_text',
          provider: result.provider,
          version: result.version,
        };
      if (result.status === 'ocr_required')
        return {
          status: 'ocr_required',
          reason: result.source === 'scanned_pdf' ? 'scanned_pdf' : 'image',
        };
      return { status: 'failed', code: 'MALFORMED_FILE', message: '文件检查失败' };
    } catch (error) {
      const failure = error instanceof WorkerFailure ? error : undefined;
      return {
        status: 'failed',
        code: failure?.code ?? 'MALFORMED_FILE',
        message: failure?.message ?? '文件检查失败',
      };
    }
  }
}

export const localDocumentExtractor = new LocalDocumentExtractor();

export async function inspectLocalFile(
  document: Document,
  content?: Uint8Array,
  timeoutMs = 30_000,
  signal?: AbortSignal,
): Promise<FileInspection> {
  return new LocalDocumentExtractor(timeoutMs).inspect(document, content, signal);
}

export async function runLocalOcr(
  contentType: Document['content_type'],
  content: Uint8Array,
  timeoutMs = 30_000,
  signal?: AbortSignal,
): Promise<WorkerSuccess> {
  try {
    const result = await worker('ocr', contentType, content, timeoutMs, signal);
    if (result.status !== 'succeeded' || typeof result.text !== 'string')
      throw new WorkerFailure('OCR_FAILED', '本地 OCR 返回了不可用结果');
    return result as WorkerSuccess;
  } catch (error) {
    if (error instanceof WorkerFailure) throw error;
    throw new WorkerFailure('OCR_FAILED', '本地 OCR 失败');
  }
}
