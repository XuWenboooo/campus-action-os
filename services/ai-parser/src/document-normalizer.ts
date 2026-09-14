import type { Document } from '@campus-action-os/protocol';
import { sha256 } from './rule-parser.js';

export type NormalizationSuccess = {
  ok: true;
  text: string;
  content_sha256: string;
  source: 'direct_text' | 'html_text';
};

export type NormalizationFailure = {
  ok: false;
  code: 'OCR_NOT_CONFIGURED' | 'EMPTY_TEXT';
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

export function normalizeDocument(document: Document): NormalizationResult {
  if (document.content_type === 'image/png' || document.content_type === 'application/pdf') {
    return {
      ok: false,
      code: 'OCR_NOT_CONFIGURED',
      message: '图片/PDF 需要经过已配置并可审计的 OCR/版面解析器；当前环境未启用该能力',
    };
  }
  const source = document.content_type === 'text/html' ? htmlToText(document.text) : document.text;
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
    source: document.content_type === 'text/html' ? 'html_text' : 'direct_text',
  };
}
