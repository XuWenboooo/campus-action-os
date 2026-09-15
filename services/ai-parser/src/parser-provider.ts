import {
  validateTextParseExchange,
  validateTextParseResponseAgainstText,
  type TextParseRequest,
  type TextParseResponse,
} from '@campus-action-os/protocol';
import { inspectCriticalErrors } from './error-shield.js';
import { parseText, type ParserFailure } from './rule-parser.js';

export type ProviderFailureCode =
  | ParserFailure['code']
  | 'PARSER_TIMEOUT'
  | 'PARSER_CANCELLED'
  | 'PARSER_UNAVAILABLE'
  | 'PARSER_RATE_LIMITED'
  | 'PARSER_RESPONSE_INVALID';

export type ProviderFailure = {
  code: ProviderFailureCode;
  message: string;
  retryable: boolean;
  status?: number;
};

export type ParserProviderResult = TextParseResponse | ProviderFailure;

export type ParserProvider = {
  readonly name: string;
  parse(request: TextParseRequest, signal?: AbortSignal): Promise<ParserProviderResult>;
};

export class RuleBasedProvider implements ParserProvider {
  readonly name = 'rule-based';

  async parse(request: TextParseRequest, signal?: AbortSignal): Promise<ParserProviderResult> {
    if (signal?.aborted)
      return {
        code: 'PARSER_CANCELLED',
        message: 'Parser request was cancelled',
        retryable: false,
      };
    const result = parseText(request);
    if ('code' in result)
      return {
        ...result,
        retryable: false,
      };
    return result;
  }
}

export type SafeProviderLog = {
  event: 'request' | 'retry' | 'failure' | 'success' | 'fallback';
  provider: string;
  requestId: string;
  attempt: number;
  status?: number;
  code?: string;
  retryable?: boolean;
};

export type ExternalProviderOptions = {
  endpoint: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  backoffMs?: (attempt: number, response?: Response) => number;
  log?: (event: SafeProviderLog) => void;
};

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function defaultBackoff(attempt: number, response?: Response): number {
  const retryAfter = response?.headers.get('retry-after');
  const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 5_000);
  return Math.min(250 * 2 ** attempt, 2_000);
}

function failure(
  code: ProviderFailureCode,
  message: string,
  retryable: boolean,
  status?: number,
): ProviderFailure {
  return { code, message, retryable, status };
}

function validResponse(
  request: TextParseRequest,
  value: unknown,
): TextParseResponse | ProviderFailure {
  const exchange = validateTextParseExchange(request, value);
  if (!exchange.ok)
    return failure(
      'PARSER_RESPONSE_INVALID',
      'External parser response failed protocol validation',
      false,
    );
  const aligned = validateTextParseResponseAgainstText(
    exchange.value.response,
    request.document.text,
  );
  if (!aligned.ok)
    return failure(
      'PARSER_RESPONSE_INVALID',
      'External parser response failed evidence alignment validation',
      false,
    );
  for (const action of exchange.value.response.verified_actions) {
    const errors = inspectCriticalErrors(action);
    if (errors.length > 0)
      return failure(
        'PARSER_RESPONSE_INVALID',
        'External parser response failed Critical Error Shield validation',
        false,
      );
  }
  return aligned.value;
}

export class ExternalProvider implements ParserProvider {
  readonly name: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly backoffMs: (attempt: number, response?: Response) => number;
  private readonly log: (event: SafeProviderLog) => void;

  constructor(options: ExternalProviderOptions) {
    this.name = `external:${options.endpoint}`;
    this.endpoint = options.endpoint.replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maxRetries = Math.max(0, Math.min(options.maxRetries ?? 2, 5));
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.backoffMs = options.backoffMs ?? defaultBackoff;
    this.log = options.log ?? (() => undefined);
  }

  async parse(request: TextParseRequest, signal?: AbortSignal): Promise<ParserProviderResult> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const result = await this.tryOnce(request, signal, attempt);
      if (!('code' in result)) {
        this.log({ event: 'success', provider: this.name, requestId: request.request_id, attempt });
        return result;
      }
      if (result.code === 'PARSER_CANCELLED' || !result.retryable || attempt >= this.maxRetries) {
        this.log({
          event: 'failure',
          provider: this.name,
          requestId: request.request_id,
          attempt,
          status: result.status,
          code: result.code,
          retryable: result.retryable,
        });
        return result;
      }
      const delay = this.backoffMs(attempt);
      this.log({
        event: 'retry',
        provider: this.name,
        requestId: request.request_id,
        attempt,
        status: result.status,
        code: result.code,
        retryable: result.retryable,
      });
      if (delay > 0) await this.sleep(delay);
    }
    return failure('PARSER_UNAVAILABLE', 'External parser exhausted retries', true);
  }

  private async tryOnce(
    request: TextParseRequest,
    parentSignal: AbortSignal | undefined,
    attempt: number,
  ): Promise<TextParseResponse | ProviderFailure> {
    if (parentSignal?.aborted)
      return failure('PARSER_CANCELLED', 'Parser request was cancelled', false);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const abortParent = (): void => controller.abort();
    parentSignal?.addEventListener('abort', abortParent, { once: true });
    this.log({ event: 'request', provider: this.name, requestId: request.request_id, attempt });
    try {
      const response = await this.fetchImpl(`${this.endpoint}/v1/parse`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': request.request_id,
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (response.status === 429)
        return failure('PARSER_RATE_LIMITED', 'External parser rate limit reached', true, 429);
      if (response.status >= 500)
        return failure(
          'PARSER_UNAVAILABLE',
          'External parser service unavailable',
          true,
          response.status,
        );
      if (!response.ok)
        return failure(
          'INVALID_REQUEST',
          `External parser rejected request (${response.status})`,
          false,
          response.status,
        );
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return failure(
          'PARSER_RESPONSE_INVALID',
          'External parser returned malformed JSON',
          false,
          response.status,
        );
      }
      return validResponse(request, payload);
    } catch (error) {
      if (parentSignal?.aborted)
        return failure('PARSER_CANCELLED', 'Parser request was cancelled', false);
      if (timedOut) return failure('PARSER_TIMEOUT', 'External parser request timed out', true);
      return failure(
        'PARSER_UNAVAILABLE',
        error instanceof Error
          ? 'External parser network request failed'
          : 'External parser unavailable',
        true,
      );
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortParent);
    }
  }
}

export type FallbackPolicyOptions = {
  primary: ParserProvider;
  fallback: ParserProvider;
  fallbackCodes?: readonly ProviderFailureCode[];
  log?: (event: SafeProviderLog) => void;
};

export class FallbackPolicy implements ParserProvider {
  readonly name: string;
  private readonly primary: ParserProvider;
  private readonly fallback: ParserProvider;
  private readonly fallbackCodes: ReadonlySet<ProviderFailureCode>;
  private readonly log: (event: SafeProviderLog) => void;

  constructor(options: FallbackPolicyOptions) {
    this.primary = options.primary;
    this.fallback = options.fallback;
    this.name = `${this.primary.name}->${this.fallback.name}`;
    this.fallbackCodes = new Set(
      options.fallbackCodes ?? ['PARSER_TIMEOUT', 'PARSER_UNAVAILABLE', 'PARSER_RATE_LIMITED'],
    );
    this.log = options.log ?? (() => undefined);
  }

  async parse(request: TextParseRequest, signal?: AbortSignal): Promise<ParserProviderResult> {
    const primary = await this.primary.parse(request, signal);
    if (!('code' in primary)) return primary;
    if (!this.fallbackCodes.has(primary.code) || signal?.aborted) return primary;
    const fallback = await this.fallback.parse(request, signal);
    this.log({
      event: 'fallback',
      provider: this.name,
      requestId: request.request_id,
      attempt: 0,
      code: primary.code,
      retryable: primary.retryable,
    });
    return fallback;
  }
}
