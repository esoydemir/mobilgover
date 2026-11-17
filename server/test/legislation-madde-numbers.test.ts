import { describe, expect, it } from 'vitest';
import { parseConsolidated } from '../src/services/legislation-sources';

/**
 * Kanun 5996 (Mevzuat, 18.11.2026) has 61 "MADDE" occurrences in its text but 60 provisions:
 *  - "MADDE 10/Ç" is a REAL provision (ıslah amaçlı yetiştirici birlikleri). Its number carries a Turkish letter, which the first parser
 *    version did not accept: the provision was skipped and its text was folded into the article before it. FIXED here.
 *  - The second "GEÇİCİ MADDE 2" occurrence is NOT a provision: it sits in the amendment-history table ("10, 10/A, ..., GEÇİCİ MADDE 2")
 *    that lists which articles a later law changed. It is not at the start of a line and has no dash, so it is not an article.
 * The sample below keeps the real shape (CRLF, trailing heading of the next article, history table).
 */
const page = [
  '<body><p><b>10559 VETERİNER HİZMETLERİ, BİTKİ SAĞLIĞI, GIDA VE YEM KANUNU</b></p>',
  '<p>Kanun Numarası : 5996</p>',
  '<p>MADDE 10/B- (Ek: 28/1/2015-6589/4 md.) (1) Birlik üyeliği şartları yönetmelikle belirlenir.</p>',
  '<p>Islah amaçlı yetiştirici birliklerine üyelik</p>',
  '<p>MADDE 10/Ç- (Ek: 28/1/2015-6589/4 md.) </p><p>(1) Birlik, Bakanlıkça belirlenen kriterler doğrultusunda asgari sayıda hayvan,</p><p>kovan gibi varlığa sahip kendi türünün ıslah programına katılır.</p>',
  '<p>MADDE 10/D- (Ek: 28/1/2015-6589/4 md.) (1) Birlik denetimi Bakanlıkça yapılır.</p>',
  '<p>GEÇİCİ MADDE 2- (1) Geçiş hükmü metni.</p>',
  '<table><tr><td>6589</td><td>10, 10/A, 10/B, 10/C, 10/Ç, 10/D, 10/E, 10/F, GEÇİCİ MADDE</td></tr><tr><td>2</td><td>7/1/2014 tarihinden geçerli olmak üzere yayımı tarihinde</td></tr></table></body>',
].join('\r\n');

describe('Mevzuat article numbers', () => {
  const a = parseConsolidated(page).articles;
  it('"10/Ç" (Turkish letter suffix) is its own article and does not leak into 10/B', () => {
    expect(Object.keys(a)).toEqual(expect.arrayContaining(['10/B', '10/Ç', '10/D', 'G2']));
    expect(a['10/Ç']).toContain('ıslah programına katılır');
    expect(a['10/B']).not.toContain('ıslah programına');
    expect(a['10/B']).toContain('yönetmelikle belirlenir');
  });
  it('the amendment-history table is not an article: "GEÇİCİ MADDE 2" appears once, with the real text', () => {
    expect(Object.keys(a).filter(k => k === 'G2')).toHaveLength(1);
    expect(a['G2']).toContain('Geçiş hükmü metni');
  });
});
