const ALGORITHMS: Record<string, string> = {
  'SHA-256': 'SHA-256',
  SHA: 'SHA-1',
  'SHA-1': 'SHA-1',
  'SHA-512': 'SHA-512',
};

/** Compute a base64 digest using WebCrypto (works in Node >= 20, Bun and browsers) */
export async function computeDigest(
  data: Uint8Array | ArrayBuffer,
  algorithm = 'SHA-256',
): Promise<string> {
  const alg = ALGORITHMS[algorithm.toUpperCase()];
  if (!alg) throw new Error(`Unsupported digest algorithm: ${algorithm}`);
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const hash = await crypto.subtle.digest(alg, bytes as Uint8Array<ArrayBuffer>);
  return toBase64(new Uint8Array(hash));
}

export function isSupportedDigest(algorithm: string): boolean {
  return !!ALGORITHMS[algorithm.toUpperCase()];
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
