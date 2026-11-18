import { unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildMeca, buildMecaFromFiles, inspectMeca, setTransfer } from '../src/meca.js';
import { ARTICLE, TRANSFER } from './fixtures.js';

const enc = (s: string) => new TextEncoder().encode(s);
const ARTICLE_WITH_FIGURE = ARTICLE.replace(
  '<body><p>Hello</p></body>',
  '<body><fig><graphic xlink:href="figures/fig1.png"/></fig></body>',
);

describe('buildMecaFromFiles', () => {
  it('works out item types from loose files', () => {
    const { inspection, notes, passthrough } = buildMecaFromFiles([
      { path: 'paper.xml', data: enc(ARTICLE_WITH_FIGURE) },
      { path: 'paper.pdf', data: enc('%PDF') },
      { path: 'figures/fig1.png', data: enc('png') },
      { path: 'data.csv', data: enc('a,b') },
      { path: '.DS_Store', data: enc('junk') },
    ]);
    expect(passthrough).toBe(false);
    expect(inspection.valid).toBe(true);
    const types = Object.fromEntries(inspection.manifest!.map((i) => [i.href, i.itemType]));
    expect(types).toEqual({
      'paper.xml': 'article-metadata',
      'paper.pdf': 'manuscript',
      'figures/fig1.png': 'article-supporting-file',
      'data.csv': 'manuscript-supporting-file',
    });
    expect(inspection.manifest!.find((i) => i.href === 'paper.pdf')?.mediaType).toBe(
      'application/pdf',
    );
    expect(inspection.article?.title).toBe('Exchanging Manuscripts over SWORD');
    expect(notes[0]).toBe('paper.xml: article-metadata');
  });

  it('expands a zipped folder', () => {
    const folder = zipSync({
      'submission/article.xml': enc(ARTICLE),
      'submission/manuscript.docx': enc('docx'),
    });
    const { inspection } = buildMecaFromFiles([{ path: 'submission.zip', data: folder }]);
    expect(inspection.manifest!.map((i) => i.href).sort()).toEqual([
      'article.xml',
      'manuscript.docx',
    ]);
  });

  it('passes an existing MECA zip through', () => {
    const meca = buildMeca({ article: ARTICLE });
    const result = buildMecaFromFiles([{ path: 'x-meca.zip', data: meca }]);
    expect(result.passthrough).toBe(true);
    expect(result.data).toBe(meca);
  });

  it('requires a JATS article', () => {
    expect(() => buildMecaFromFiles([{ path: 'a.pdf', data: enc('%PDF') }])).toThrow(/JATS/);
  });
});

describe('setTransfer', () => {
  it('replaces transfer.xml and keeps the manifest consistent', () => {
    const meca = buildMeca({ article: ARTICLE, transfer: TRANSFER });
    const updated = setTransfer(meca, {
      source: { provider: { name: 'Sender' } },
      destination: {
        provider: { name: 'Receiver' },
        publication: { type: 'journal', title: 'Reviews' },
      },
    });
    const inspection = inspectMeca(updated);
    expect(inspection.valid).toBe(true);
    expect(inspection.transfer?.source?.provider?.name).toBe('Sender');
    expect(inspection.transfer?.destination?.publication?.title).toBe('Reviews');
    expect(inspection.manifest!.filter((i) => i.itemType === 'transfer-metadata')).toHaveLength(1);
    expect(Object.keys(unzipSync(updated))).toContain('content/article.xml');
  });
});
