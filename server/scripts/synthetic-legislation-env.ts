/**
 * Isolated acceptance environment: the real API (buildApp) with a SYNTHETIC official-looking legislation source (host sentetik.test, so
 * everything it yields is an EXAMPLE). One synthetic Resmî Gazete item is published for today; nothing is ever sent to a real source.
 * Run: DEMO_MODE=true DATABASE_URL=... PORT=3078 npx tsx scripts/synthetic-legislation-env.ts
 */
import { loadConfig } from '../src/config';
import { assertDemoDatabase } from '../src/db/guards';
import { Db } from '../src/db/pool';
import { buildApp } from '../src/http/app';
import { startLegislationScheduler } from '../src/services/legislation';
import { istanbulDay } from '../src/services/legislation-sources';
import { existsSync, readFileSync } from 'node:fs';
import { DevOutboxMailer } from '../src/services/mail';
import { LocalStore } from '../src/storage/local';
import { SyntheticSource } from '../test/support/legislation-fixtures';

const config = loadConfig();
if (!config.demoMode) throw new Error('Synthetic legislation environment runs only with DEMO_MODE=true.');
const db = Db.connect(config.databaseUrl);
await assertDemoDatabase(db);
const src = new SyntheticSource();
const today = istanbulDay(new Date());
src.publish(today, { id: `${today.replaceAll('-', '')}-1`, category: 'YÖNETMELİKLER', title: 'Sentetik Gıda İşletmelerinde LPG Tüpü Güvenliği Yönetmeliği', sayi: 99001,
  articles: ['LPG tüpü kullanan işletmeler tüp bağlantılarını ve hortumlarını her ay kontrol eder; kayıt altına alır.', 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.'] });
// Multi-sector discovery: natural titles (no food keyword), one uncertain (general words only) and one out of every supported sector.
const mk = (n: number, title: string, body: string) => src.publish(today, { id: `${today.replaceAll('-', '')}-${n}`, category: 'YÖNETMELİKLER', title, sayi: 99000 + n, articles: [body, 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.'] });
mk(2, 'Sentetik Elektrik Tesislerinde Topraklama Ölçümleri Yönetmeliği', 'Elektrik tesislerinde topraklama direnci her yıl ölçülür ve kaydedilir.');
mk(3, 'Sentetik Taşınmaz Ticareti Aracılık Yönetmeliği', 'Taşınmaz ticareti yapanlar yetki sözleşmelerinin dosyasını saklar.');
mk(4, 'Sentetik İşyeri Denetim Esasları Yönetmeliği', 'İşyerlerinde denetim esasları belirlenir.');
mk(5, 'Sentetik Orman Yangınlarıyla Mücadele Yönetmeliği', 'Orman yangınlarıyla mücadele esasları.');
src.consolidated.set('1.5.9001', { title: 'SENTETİK GIDA KANUNU', articles: { '1': 'Amaç: gıda güvenliği.', '2': 'Soğuk zincir kesintisiz sürdürülür.' } });
// ── Acceptance-only controls (this script never runs outside DEMO_MODE) ──
// 1) The daily SCHEDULER runs here (no "Şimdi tara" button): every SYNTH_TICK_MS it applies what is due and runs the daily scan once the scan hour has come.
//    The scan hour is SYNTH_SCAN_HOUR (default 23), so nothing is scanned until the TEST CLOCK is moved past it.
// 2) TEST CLOCK: SYNTH_CLOCK_FILE holds {"offsetMs": n}; the scheduler's "now" is real time + offsetMs. Only the scheduler is shifted; HTTP requests (approval, login) use real time.
// 3) PUBLISH FILE: SYNTH_PUBLISH_FILE is a JSON array of {id, title, sayi, articles[], category?, dayOffset?, unreadable?}; each new id is published on the real Istanbul day (+dayOffset days, so it shows on the TEST-CLOCK day) as a new Resmî Gazete item; unreadable:true makes its text fail to load.
const legCfg = src.config({ enabled: true, scanHour: Number(process.env.SYNTH_SCAN_HOUR ?? 23) });
const clockFile = process.env.SYNTH_CLOCK_FILE, pubFile = process.env.SYNTH_PUBLISH_FILE;
const clock = () => { let off = 0; try { if (clockFile && existsSync(clockFile)) off = Number(JSON.parse(readFileSync(clockFile, 'utf8')).offsetMs) || 0; } catch { /* keep 0 */ } return new Date(Date.now() + off); };
const published = new Set<string>();
const pollPublish = () => { try { if (!pubFile || !existsSync(pubFile)) return; for (const it of JSON.parse(readFileSync(pubFile, 'utf8')) as { id: string; title: string; sayi: number; articles: string[]; category?: string; dayOffset?: number; unreadable?: boolean }[]) {
  if (published.has(it.id)) continue; published.add(it.id); if (it.unreadable) src.unreadable.add(it.id); src.publish(istanbulDay(new Date(Date.now() + (it.dayOffset ?? 0) * 86_400_000)), { id: it.id, category: it.category ?? 'YÖNETMELİKLER', title: it.title, sayi: it.sayi, articles: it.articles }); console.log(`published ${it.id} ${it.title}`); } } catch (e) { console.log('publish file unreadable', (e as Error).message); } };
setInterval(pollPublish, 2000).unref();
const app = buildApp({ db, store: new LocalStore(config.evidenceDir), mailer: new DevOutboxMailer(db), config, legislation: legCfg });
if (process.env.SYNTH_SCHEDULER === '1') startLegislationScheduler(db, legCfg, l => console.log(JSON.stringify(l).slice(0, 600)), Number(process.env.SYNTH_TICK_MS ?? 10_000), { firstMs: 3000, clock });
await app.listen({ port: config.port, host: config.host });
console.log(`Synthetic legislation env http://localhost:${config.port} (source ${src.rg}, day ${today})`);
