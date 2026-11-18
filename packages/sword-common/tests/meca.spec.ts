import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildMeca, inspectMeca, isUnsafePath, mecaToMetadata, unzip } from '../src/meca.js';
import { ARTICLE, TRANSFER } from './fixtures.js';

describe('inspectMeca', () => {
  it('reads manifest, transfer and article metadata', () => {
    const zip = buildMeca({
      article: ARTICLE,
      transfer: TRANSFER,
      files: [{ path: 'content/manuscript.pdf', data: 'PDF', itemType: 'manuscript' }],
    });
    const result = inspectMeca(zip);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.files.sort()).toEqual(
      ['content/article.xml', 'content/manuscript.pdf', 'manifest.xml', 'transfer.xml'].sort(),
    );
    expect(result.manifest?.map((i) => i.href)).toContain('content/manuscript.pdf');
    expect(result.transfer?.source?.provider?.name).toBe('Curvenote');
    expect(result.article?.title).toBe('Exchanging Manuscripts over SWORD');
    expect(result.article?.doi).toBe('10.1234/example.5678');
    expect(result.article?.authors).toEqual(['Ada Lovelace', 'Grace Hopper']);
    expect(result.article?.abstract).toContain('MECA bundle');
  });

  it('rejects non-zip data', () => {
    const result = inspectMeca(new TextEncoder().encode('not a zip'));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/not a zip/);
  });

  it('requires a manifest', () => {
    const result = inspectMeca(zipSync({ 'article.xml': new TextEncoder().encode(ARTICLE) }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/manifest\.xml/);
  });

  it('flags manifest items missing from the bundle', () => {
    const zip = buildMeca({ article: ARTICLE });
    const files = Object.fromEntries(
      Object.entries(unzipSync(zip)).filter(([name]) => name !== 'content/article.xml'),
    );
    const result = inspectMeca(zipSync(files));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/content\/article\.xml/);
  });
});

describe('mecaToMetadata', () => {
  it('maps JATS front matter to Dublin Core', () => {
    const doc = mecaToMetadata(inspectMeca(buildMeca({ article: ARTICLE, transfer: TRANSFER })));
    expect(doc['@type']).toBe('Metadata');
    expect(doc['dc:title']).toBe('Exchanging Manuscripts over SWORD');
    expect(doc['dc:creator']).toBe('Ada Lovelace; Grace Hopper');
    expect(doc['dc:identifier']).toBe('https://doi.org/10.1234/example.5678');
    expect(doc['dcterms:provenance']).toBe('Transferred from Curvenote');
  });
});

describe('untrusted zips and XML', () => {
  const enc = (s: string) => new TextEncoder().encode(s);

  it('refuses zips that expand past the size limit', () => {
    const zip = zipSync({ 'big.bin': new Uint8Array(2 * 1024 * 1024) }, { level: 9 });
    expect(zip.byteLength).toBeLessThan(10_000);
    const result = inspectMeca(zip, { limits: { maxEntries: 100, maxTotalSize: 1024 * 1024 } });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/expands to more than 1 MB/);
  });

  it('refuses zips with too many entries', () => {
    const entries = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) => [`f${i}.txt`, enc('x')]),
    );
    const result = inspectMeca(zipSync(entries), {
      limits: { maxEntries: 10, maxTotalSize: 1024 ** 2 },
    });
    expect(result.errors[0]).toMatch(/more than 10 entries/);
  });

  it('checks the declared size, so an entry cannot inflate past it', () => {
    const zip = zipSync({ 'a.bin': new Uint8Array(4096) }, { level: 9 });
    // Lie about the uncompressed size in the central directory: claim 16 bytes
    const view = new DataView(zip.buffer);
    let cd = zip.byteLength - 22;
    while (view.getUint32(cd, true) !== 0x06054b50) cd -= 1;
    const cdStart = view.getUint32(cd + 16, true);
    view.setUint32(cdStart + 24, 16, true);
    let out: Record<string, Uint8Array> | undefined;
    try {
      out = unzip(zip, { maxEntries: 10, maxTotalSize: 1024 });
    } catch {
      // fflate may also refuse the mismatch outright, which is fine
    }
    if (out) expect(out['a.bin'].byteLength).toBeLessThanOrEqual(16);
  });

  it('flags unsafe paths', () => {
    expect(isUnsafePath('../etc/passwd')).toBe(true);
    expect(isUnsafePath('content/../../x')).toBe(true);
    expect(isUnsafePath('/abs')).toBe(true);
    expect(isUnsafePath('C:/x')).toBe(true);
    expect(isUnsafePath('a\\b')).toBe(true);
    expect(isUnsafePath('content/figure..png')).toBe(false);
    const zip = zipSync({ 'manifest.xml': enc('<manifest/>'), '../evil.txt': enc('x') });
    const result = inspectMeca(zip);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/unsafe file paths: \.\.\/evil\.txt/);
  });

  it('does not expand entities declared in a JATS DTD (billion laughs, XXE)', () => {
    const article = ARTICLE.replace(
      /<!DOCTYPE[^>]*>/,
      `<!DOCTYPE article [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>`,
    ).replace('Exchanging Manuscripts over SWORD', 'Exchanging &lol3; &xxe;');
    const result = inspectMeca(buildMeca({ article, transfer: TRANSFER }));
    const title = result.article?.title ?? '';
    expect(title).not.toMatch(/lollol/);
    expect(title).not.toMatch(/root:/);
  });
});
