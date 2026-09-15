import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Document } from '@campus-action-os/protocol';
import { LocalDocumentExtractor } from '../../services/ai-parser/src/file-extractor.js';
import { LocalRapidOcrProvider } from '../../services/ai-parser/src/ocr.js';
import { normalizeDocument } from '../../services/ai-parser/src/document-normalizer.js';

const execFile = promisify(execFileCallback);
const fixtureScript = join(process.cwd(), 'tools', 'create-phase2-synthetic-fixtures.py');

function document(contentType: Document['content_type'], id: string, text = ''): Document {
  return {
    schema_version: 'document/v1',
    document_id: id,
    owner_user_id: 'synthetic-phase2-user',
    title: `Synthetic ${id}`,
    content_type: contentType,
    text,
    content_sha256: '0'.repeat(64),
    data_origin: 'synthetic',
    created_at: '2099-01-01T00:00:00.000Z',
  };
}

async function fixtures(): Promise<{ directory: string; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), 'campus-action-os-phase2-'));
  await execFile(process.env.PHASE2_PYTHON_BIN ?? process.env.PYTHON_BIN ?? 'python', [
    '-X',
    'utf8',
    fixtureScript,
    directory,
  ]);
  return { directory, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test('LocalDocumentExtractor extracts PDF text layers and classifies scanned files', async () => {
  const { directory, cleanup } = await fixtures();
  try {
    const extractor = new LocalDocumentExtractor(30_000);
    const textPdf = await extractor.inspect(
      document('application/pdf', 'synthetic-text-pdf'),
      await readFile(join(directory, 'text-layer.pdf')),
    );
    assert.equal(textPdf.status, 'text');
    if (textPdf.status === 'text') {
      assert.equal(textPdf.source, 'pdf_text');
      assert.match(textPdf.text, /Submit materials by 2099-10-03/);
      assert.equal(textPdf.provider, 'pymupdf');
    }

    const scannedPdf = await extractor.inspect(
      document('application/pdf', 'synthetic-scanned-pdf'),
      await readFile(join(directory, 'scanned.pdf')),
    );
    assert.deepEqual(scannedPdf, { status: 'ocr_required', reason: 'scanned_pdf' });
  } finally {
    await cleanup();
  }
});

test('LocalRapidOcrProvider runs offline OCR on PNG, JPEG, and scanned PDF', async () => {
  const { directory, cleanup } = await fixtures();
  try {
    const provider = new LocalRapidOcrProvider({ timeoutMs: 30_000 });
    for (const [contentType, filename] of [
      ['image/png', 'synthetic-screenshot.png'],
      ['image/jpeg', 'synthetic-screenshot.jpg'],
      ['application/pdf', 'scanned.pdf'],
    ] as const) {
      const extraction = await provider.extract({
        document_id: `synthetic-${filename}`,
        content_type: contentType,
        content_sha256: '0'.repeat(64),
        data_origin: 'synthetic',
        content: await readFile(join(directory, filename)),
      });
      assert.equal(extraction.status, 'succeeded', `${filename} must use local OCR`);
      if (extraction.status === 'succeeded') {
        assert.match(extraction.text, /本科生/);
        assert.match(extraction.text, /2099-10-03/);
        assert.equal(extraction.provider, 'rapidocr-onnxruntime');
      }
    }
  } finally {
    await cleanup();
  }
});

test('file extraction rejects malformed, encrypted, empty, and unsupported files', async () => {
  const { directory, cleanup } = await fixtures();
  try {
    const extractor = new LocalDocumentExtractor(30_000);
    const malformed = await extractor.inspect(
      document('application/pdf', 'synthetic-malformed-pdf'),
      await readFile(join(directory, 'malformed.pdf')),
    );
    assert.equal(malformed.status, 'failed');
    if (malformed.status === 'failed') assert.equal(malformed.code, 'MALFORMED_FILE');

    const encrypted = await extractor.inspect(
      document('application/pdf', 'synthetic-encrypted-pdf'),
      await readFile(join(directory, 'encrypted.pdf')),
    );
    assert.equal(encrypted.status, 'failed');
    if (encrypted.status === 'failed') assert.equal(encrypted.code, 'ENCRYPTED_FILE');

    const emptyPdf = await extractor.inspect(
      document('application/pdf', 'synthetic-empty-pdf'),
      await readFile(join(directory, 'empty.pdf')),
    );
    assert.equal(emptyPdf.status, 'failed');
    if (emptyPdf.status === 'failed') assert.equal(emptyPdf.code, 'EMPTY_FILE');

    const corruptedPng = await extractor.inspect(
      document('image/png', 'synthetic-corrupted-png'),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]),
    );
    assert.equal(corruptedPng.status, 'failed');
    if (corruptedPng.status === 'failed') assert.equal(corruptedPng.code, 'MALFORMED_FILE');

    const unsupported = await extractor.inspect(
      {
        ...document('text/plain', 'synthetic-unsupported'),
        content_type: 'image/gif',
      } as unknown as Document,
      Buffer.from([1]),
    );
    assert.equal(unsupported.status, 'failed');
    if (unsupported.status === 'failed') assert.equal(unsupported.code, 'UNSUPPORTED_FILE');

    const emptyText = await extractor.inspect(
      document('text/plain', 'synthetic-empty-text'),
      Buffer.from(''),
    );
    assert.equal(emptyText.status, 'failed');
    if (emptyText.status === 'failed') assert.equal(emptyText.code, 'EMPTY_FILE');

    const normalization = await normalizeDocument(
      document('image/png', 'synthetic-ocr-timeout'),
      {
        name: 'synthetic-timeout-ocr',
        async extract() {
          return {
            status: 'failed' as const,
            code: 'OCR_TIMEOUT' as const,
            message: 'synthetic OCR timeout',
          };
        },
      },
      Buffer.from([1]),
      {
        async inspect() {
          return { status: 'ocr_required' as const, reason: 'image' as const };
        },
      },
    );
    assert.deepEqual(normalization, {
      ok: false,
      code: 'OCR_TIMEOUT',
      message: 'synthetic OCR timeout',
    });
  } finally {
    await cleanup();
  }
});
