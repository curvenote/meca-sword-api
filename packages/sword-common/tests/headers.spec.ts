import { describe, expect, it } from 'vitest';
import {
  formatContentDisposition,
  formatDigest,
  parseContentDisposition,
  parseDigest,
} from '../src/headers.js';
import { computeDigest } from '../src/digest.js';

describe('Content-Disposition', () => {
  it('parses a binary deposit', () => {
    const cd = parseContentDisposition('attachment; filename="a b-meca.zip"');
    expect(cd.type).toBe('attachment');
    expect(cd.filename).toBe('a b-meca.zip');
    expect(cd.metadata).toBeUndefined();
  });
  it('parses metadata and by-reference flags', () => {
    const cd = parseContentDisposition('attachment; metadata=true; by-reference=true');
    expect(cd.metadata).toBe(true);
    expect(cd.byReference).toBe(true);
  });
  it('handles quoted semicolons and RFC 5987 filenames', () => {
    expect(parseContentDisposition('attachment; filename="a;b.zip"').filename).toBe('a;b.zip');
    expect(
      parseContentDisposition("attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.zip").filename,
    ).toBe('résumé.zip');
  });
  it('round-trips', () => {
    const header = formatContentDisposition({ filename: 'x"y.zip', metadata: true });
    const cd = parseContentDisposition(header);
    expect(cd.filename).toBe('x"y.zip');
    expect(cd.metadata).toBe(true);
  });
  it('handles empty headers', () => {
    expect(parseContentDisposition(null)).toEqual({ type: '', params: {} });
  });
});

describe('Digest', () => {
  it('parses and formats', () => {
    const d = parseDigest('sha-256=abc=, MD5=xyz');
    expect(d).toEqual({ 'SHA-256': 'abc=', MD5: 'xyz' });
    expect(formatDigest(d)).toBe('SHA-256=abc=, MD5=xyz');
  });
  it('computes a SHA-256 base64 digest', async () => {
    const digest = await computeDigest(new TextEncoder().encode('hello'));
    expect(digest).toBe('LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=');
  });
  it('computes SHA-1', async () => {
    expect(await computeDigest(new TextEncoder().encode('hello'), 'SHA')).toBe(
      'qvTGHdzF6KLavt4PO0gs2a6pQ00=',
    );
  });
});
