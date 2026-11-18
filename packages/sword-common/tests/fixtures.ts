export const ARTICLE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE article PUBLIC "-//NLM//DTD JATS (Z39.96) Journal Archiving and Interchange DTD v1.3 20210610//EN" "JATS-archivearticle1-3.dtd">
<article xmlns:xlink="http://www.w3.org/1999/xlink" article-type="research-article">
  <front>
    <journal-meta>
      <journal-title-group><journal-title>Journal of Examples</journal-title></journal-title-group>
    </journal-meta>
    <article-meta>
      <article-id pub-id-type="doi">10.1234/example.5678</article-id>
      <title-group><article-title>Exchanging Manuscripts over SWORD</article-title></title-group>
      <contrib-group>
        <contrib contrib-type="author"><name><surname>Lovelace</surname><given-names>Ada</given-names></name></contrib>
        <contrib contrib-type="author"><name><surname>Hopper</surname><given-names>Grace</given-names></name></contrib>
      </contrib-group>
      <abstract><p>We send a MECA bundle from one system to another.</p></abstract>
    </article-meta>
  </front>
  <body><p>Hello</p></body>
</article>
`;

export const TRANSFER = {
  source: { provider: { name: 'Curvenote' } },
  destination: {
    provider: { name: 'Example Journal Platform' },
    publication: { type: 'journal', title: 'Journal of Examples' },
  },
};
