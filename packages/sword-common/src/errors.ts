import { JSON_LD, SWORD_CONTEXT } from './constants.js';
import type { ErrorDocument } from './types.js';

/** SWORD v3 error types mapped to their HTTP status codes (spec section 9.3) */
export const ErrorTypes = {
  AuthenticationFailed: 403,
  AuthenticationRequired: 401,
  BadRequest: 400,
  ByReferenceFileSizeExceeded: 400,
  ByReferenceNotAllowed: 412,
  ContentMalformed: 400,
  ContentTypeNotAcceptable: 415,
  DigestMismatch: 412,
  ETagNotMatched: 412,
  ETagRequired: 412,
  Forbidden: 403,
  FormatHeaderMismatch: 415,
  InvalidSegmentSize: 400,
  MaxAssembledSizeExceeded: 400,
  MaxUploadSizeExceeded: 413,
  MetadataFormatNotAcceptable: 415,
  MethodNotAllowed: 405,
  NotFound: 404,
  OnBehalfOfNotAllowed: 412,
  PackagingFormatNotAcceptable: 415,
  SegmentedUploadTimedOut: 410,
  SegmentLimitExceeded: 400,
  UnexpectedSegment: 400,
} as const;
export type ErrorType = keyof typeof ErrorTypes;

export class SwordError extends Error {
  readonly type: ErrorType | string;
  readonly status: number;
  readonly log?: string;

  constructor(type: ErrorType | string, message: string, opts?: { log?: string; status?: number }) {
    super(message);
    this.name = 'SwordError';
    this.type = type;
    this.status = opts?.status ?? ErrorTypes[type as ErrorType] ?? 400;
    this.log = opts?.log;
  }

  toDocument(): ErrorDocument {
    return errorDocument(this.type, this.message, this.log);
  }

  toResponse(headers?: HeadersInit): Response {
    const h = new Headers(headers);
    h.set('Content-Type', JSON_LD);
    return new Response(JSON.stringify(this.toDocument()), { status: this.status, headers: h });
  }

  static fromDocument(doc: Partial<ErrorDocument>, status: number): SwordError {
    return new SwordError(doc['@type'] ?? 'BadRequest', doc.error ?? `HTTP ${status}`, {
      log: doc.log,
      status,
    });
  }
}

export function errorDocument(type: string, error: string, log?: string): ErrorDocument {
  return {
    '@context': SWORD_CONTEXT,
    '@type': type,
    error,
    ...(log ? { log } : {}),
    timestamp: new Date().toISOString(),
  };
}
