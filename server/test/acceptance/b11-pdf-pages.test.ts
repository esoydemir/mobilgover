import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { client, freshEnv, type Env } from '../support/env';

/**
 * B-11: the audit PDF has no page that carries only the footer, in both a short and a many-page output;
 * the footer says "Sayfa i / n" with the real page count and consecutive numbers.
 */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);
const win = () => `from=${encodeURIComponent(new Date(Date.now() - 864e5).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 864e5).toISOString())}`;

async function pages(buf: Buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) out.push(((await (await doc.getPage(i)).getTextContent()).items as { str: string }[]).map(x => x.str).join(' '));
  return out;
}
const FOOT = /GoverHub denetim dosyası.*Sayfa (\d+) \/ (\d+)/;
const check = (txt: string[]) => {
  expect(txt.length).toBeGreaterThan(0);
  txt.forEach((t, i) => {
    const m = FOOT.exec(t);
    expect(m, `page ${i + 1} footer`).not.toBeNull();
    expect(Number(m![1])).toBe(i + 1);
    expect(Number(m![2])).toBe(txt.length);
    expect(t.replace(FOOT, '').replace(/GoverHub denetim dosyası[^]*$/, '').trim().length, `page ${i + 1} body`).toBeGreaterThan(20);
  });
};

beforeAll(async () => { env = await freshEnv(); await seedPlatform(env.db); demo = await seedDemoCompany(env.db, { isDemo: true }); });
afterAll(async () => { await env?.close(); });

describe('B-11 audit PDF pages', () => {
  it('short output: every page has body text, numbers run 1..n, n is the real count', async () => {
    const r = await owner().get(`${C()}/audit-report?format=pdf&${win()}`);
    expect(r.status).toBe(200);
    check(await pages(Buffer.from(r.body as Buffer)));
  });

  it('many-page output: same checks with dozens of open cases', async () => {
    for (let i = 0; i < 60; i++) {
      await owner().post(`${C()}/nonconformities`, { siteId: demo.siteId, title: `Kritik kayıt numara ${i + 1} için uzun başlık`, description: 'Açıklama metni burada yer alıyor.', hazardType: 'cleaning', severity: 'critical', equipmentId: null, containment: 'Alan kapatıldı ve ürünler ayrıldı.' });
    }
    const r = await owner().get(`${C()}/audit-report?format=pdf&${win()}`);
    const txt = await pages(Buffer.from(r.body as Buffer));
    expect(txt.length).toBeGreaterThan(3);
    check(txt);
  }, 120000);
});
