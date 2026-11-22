/**
 * Isolated acceptance environment: the real API (buildApp) with a SYNTHETIC official-looking legislation source (host sentetik.test, so
 * everything it yields is an EXAMPLE). One synthetic Resmî Gazete item is published for today; nothing is ever sent to a real source.
 * Run: DEMO_MODE=true DATABASE_URL=... PORT=3078 npx tsx scripts/synthetic-legislation-env.ts
 */
import { loadConfig } from '../src/config';
import { assertDemoDatabase } from '../src/db/guards';
import { Db } from '../src/db/pool';
import { buildApp } from '../src/http/app';
import { istanbulDay } from '../src/services/legislation-sources';
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
const app = buildApp({ db, store: new LocalStore(config.evidenceDir), mailer: new DevOutboxMailer(db), config, legislation: src.config() });
await app.listen({ port: config.port, host: config.host });
console.log(`Synthetic legislation env http://localhost:${config.port} (source ${src.rg}, day ${today})`);
