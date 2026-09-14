import type { Document } from '@campus-action-os/protocol';
import { type OcrProvider, unconfiguredOcrProvider } from './ocr.js';
import { sha256 } from './rule-parser.js';

export type NormalizationSuccess = {
  ok: true;
  text: string;
  content_sha256: string;
  source: 'direct_text' | 'html_text' | 'ocr';
};

export type NormalizationFailure = {
  ok: false;
  code: 'OCR_NOT_CONFIGURED' | 'NOT_RUN_CREDENTIALS_REQUIRED' | 'OCR_FAILED' | 'EMPTY_TEXT';
  message: string;
};

export type NormalizationResult = NormalizationSuccess | NormalizationFailure;

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

export async function normalizeDocument(
  document: Document,
  ocrProvider: OcrProvider = unconfiguredOcrProvider,
): Promise<NormalizationResult> {
  let source: string;
  let sourceType: NormalizationSuccess['source'];
  if (document.content_type === 'image/png' || document.content_type === 'application/pdf') {
    let extraction;
    try {
      extraction = await ocrProvider.extract({
        document_id: document.document_id,
        content_type: document.content_type,
        content_sha256: document.content_sha256,
        data_origin: document.data_origin,
      });
    } catch {
      return {
        ok: false,
        code: 'OCR_FAILED',
        message: `OCR provider ${ocrProvider.name} failed without a usable result`,
      };
    }
    if (extraction.status !== 'succeeded')
      return { ok: false, code: extraction.code, message: extraction.message };
    source = extraction.text;
    sourceType = 'ocr';
  } else {
    source = document.content_type === 'text/html' ? htmlToText(document.text) : document.text;
    sourceType = document.content_type === 'text/html' ? 'html_text' : 'direct_text';
  }
  const text = normalizeWhitespace(source);
  if (!text)
    return {
      ok: false,
      code: 'EMPTY_TEXT',
      message: '标准化后没有可解析文本',
    };
  return {
    ok: true,
    text,
    content_sha256: sha256(text),
    source: sourceType,
  };
}
