import type { Document } from '@campus-action-os/protocol';
import { localDocumentExtractor, type DocumentExtractor } from './file-extractor.js';
import { type OcrProvider, unconfiguredOcrProvider } from './ocr.js';
import { sha256 } from './rule-parser.js';

export type NormalizationSuccess = {
  ok: true;
  text: string;
  content_sha256: string;
  source: 'direct_text' | 'html_text' | 'pdf_text' | 'ocr';
};

export type NormalizationFailure = {
  ok: false;
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
    | 'UNSUPPORTED_FILE'
    | 'EMPTY_TEXT';
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

export async function normalizeDocument(
  document: Document,
  ocrProvider: OcrProvider = unconfiguredOcrProvider,
  content?: Uint8Array,
  extractor: DocumentExtractor = localDocumentExtractor,
  signal?: AbortSignal,
): Promise<NormalizationResult> {
  const inspection = await extractor.inspect(document, content, signal);
  let source: string;
  let sourceType: NormalizationSuccess['source'];
  if (inspection.status === 'failed')
    return { ok: false, code: inspection.code, message: inspection.message };
  if (inspection.status === 'text') {
    source = inspection.text;
    sourceType = inspection.source;
  } else {
    let extraction;
    try {
      extraction = await ocrProvider.extract(
        {
          document_id: document.document_id,
          content_type: document.content_type,
          content_sha256: document.content_sha256,
          data_origin: document.data_origin,
          content,
        },
        signal,
      );
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
