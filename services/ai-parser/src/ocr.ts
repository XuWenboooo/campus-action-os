import type { Document } from '@campus-action-os/protocol';

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
      code: 'OCR_NOT_CONFIGURED' | 'NOT_RUN_CREDENTIALS_REQUIRED' | 'OCR_FAILED';
      message: string;
    };

export interface OcrProvider {
  readonly name: string;
  extract(request: OcrRequest): Promise<OcrExtraction>;
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
