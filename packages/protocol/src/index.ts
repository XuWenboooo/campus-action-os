export const protocolVersion = '0.1.0';

export type RequestContext = {
  requestId: string;
  environment: 'local' | 'test' | 'demo' | 'production';
};
export type ApiError = {
  error: { code: string; message: string; requestId: string; retryable: boolean };
};

/** Reserved boundary for the future verified-action contract; intentionally not the final schema. */
export type VerifiedActionContract = unknown;
