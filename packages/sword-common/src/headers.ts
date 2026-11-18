export type ContentDisposition = {
  type: string;
  filename?: string;
  metadata?: boolean;
  byReference?: boolean;
  segment?: boolean;
  params: Record<string, string>;
};

/**
 * Parse a SWORD Content-Disposition header, e.g.
 * `attachment; filename="example-meca.zip"` or `attachment; metadata=true`
 */
export function parseContentDisposition(header: string | null | undefined): ContentDisposition {
  if (!header) return { type: '', params: {} };
  const [type, ...rest] = splitParams(header);
  const params: Record<string, string> = {};
  rest.forEach((part) => {
    const eq = part.indexOf('=');
    if (eq === -1) {
      params[part.trim().toLowerCase()] = 'true';
      return;
    }
    const key = part.slice(0, eq).trim().toLowerCase();
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\(.)/g, '$1');
    }
    if (key === 'filename*') {
      // RFC 5987: charset'lang'value
      const match = value.match(/^[^']*'[^']*'(.*)$/);
      value = decodeURIComponent(match ? match[1] : value);
      params.filename = value;
      return;
    }
    params[key] = value;
  });
  const bool = (v?: string) => (v === undefined ? undefined : v.toLowerCase() === 'true');
  return {
    type: type.trim().toLowerCase(),
    filename: params.filename,
    metadata: bool(params.metadata),
    byReference: bool(params['by-reference']),
    segment: bool(params.segment),
    params,
  };
}

function splitParams(header: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < header.length; i++) {
    const c = header[i];
    if (c === '"' && header[i - 1] !== '\\') quoted = !quoted;
    if (c === ';' && !quoted) {
      parts.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  parts.push(current);
  return parts.filter((p) => p.trim().length > 0);
}

export function formatContentDisposition(opts: {
  filename?: string;
  metadata?: boolean;
  byReference?: boolean;
}): string {
  const parts = ['attachment'];
  if (opts.filename) {
    const ascii = /^[\x20-\x7e]*$/.test(opts.filename);
    parts.push(`filename="${opts.filename.replace(/(["\\])/g, '\\$1')}"`);
    if (!ascii) parts.push(`filename*=UTF-8''${encodeURIComponent(opts.filename)}`);
  }
  if (opts.metadata) parts.push('metadata=true');
  if (opts.byReference) parts.push('by-reference=true');
  return parts.join('; ');
}

/**
 * Parse an RFC 3230 Digest header, e.g. `SHA-256=abc...=, MD5=...`
 * Algorithm names are upper-cased.
 */
export function parseDigest(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  header.split(',').forEach((part) => {
    const eq = part.indexOf('=');
    if (eq === -1) return;
    out[part.slice(0, eq).trim().toUpperCase()] = part.slice(eq + 1).trim();
  });
  return out;
}

export function formatDigest(digests: Record<string, string>): string {
  return Object.entries(digests)
    .map(([alg, value]) => `${alg}=${value}`)
    .join(', ');
}
