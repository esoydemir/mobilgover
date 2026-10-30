import type { Sev, Status } from '../theme';

/** Mock data for the prototype business "Kahve Durağı" (Kadıköy). */

export type Persona = 'owner' | 'hq' | 'employee' | 'provider';

export const PERSONAS: { key: Persona; tr: string; en: string }[] = [
  { key: 'owner', tr: 'İşletme sahibi', en: 'Business owner · single' },
  { key: 'hq', tr: 'Merkez / çok şube', en: 'Multi-location HQ' },
  { key: 'employee', tr: 'Personel', en: 'Employee' },
  { key: 'provider', tr: 'Uzman / servis', en: 'Professional' },
];

export const PERSONA_HEADER: Record<Persona, { greeting: string; org: string }> = {
  owner: { greeting: 'Günaydın, Ahmet', org: 'Kahve Durağı' },
  hq: { greeting: 'Merkez görünümü', org: 'Kahve Durağı Grup' },
  employee: { greeting: 'Günaydın, Elif', org: 'Kahve Durağı' },
  provider: { greeting: 'Bugün 3 işin var', org: 'Murat Yıldız' },
};

export type Task = {
  id: string;
  title: string;
  meta: string;
  sev: Sev;
  due: string;
  bucket: 'today' | 'late' | 'upcoming';
  what: string;
  /** Tasks that need a measured value and a photo before they can close. */
  needsEvidence?: boolean;
};

export const TASKS: Task[] = [
  { id: 't1', title: 'Soğuk zincir sıcaklık kaydı', meta: 'Günlük · Mutfak · 18:00', sev: 'crit', due: 'Bugün 18:00', bucket: 'today', needsEvidence: true,
    what: 'Mutfak arkasındaki buzdolabının sıcaklığını ölç, değeri gir ve termometre fotoğrafını ekle.' },
  { id: 't2', title: 'Personel hijyen eldiven kontrolü', meta: 'Günlük · Servis', sev: 'imp', due: 'Bugün', bucket: 'today',
    what: 'Vardiyadaki personelin eldiven ve önlük durumunu kontrol et, tamamlandı olarak işaretle.' },
  { id: 't3', title: 'Menü alerjen listesi güncelleme', meta: 'Tebliğ değişikliği · 30 gün', sev: 'imp', due: '14 gün kaldı', bucket: 'upcoming',
    what: 'Alerjen Etiketleme Tebliği güncellendi. 14 alerjen için yeni formatı menü kartlarına işle.' },
  { id: 't4', title: 'Yangın tüpü periyodik kontrolü', meta: 'Gecikmiş · 3 gün', sev: 'crit', due: '3 gün gecikmiş', bucket: 'late',
    what: 'Yetkili servisin periyodik kontrolünü yapması ve etiketi yenilemesi gerekiyor.' },
  { id: 't5', title: 'Su deposu temizlik kaydı', meta: 'Aylık · Depo', sev: 'low', due: 'Bu ay', bucket: 'upcoming',
    what: 'Depo temizliği sonrası tarih ve sorumlu personeli kaydet.' },
];

export const TEMP_LIMIT = 4;
export const TEMP_OPTIONS = [0, 2, 4, 12];
/** Last 14 days of the cold-chain log: 0 = nonconformity, 1 = ok, 2 = borderline. */
export const TEMP_HISTORY = [1, 1, 0, 1, 1, 1, 2, 1, 1, 1, 0, 1, 1, 2];

export const TIMELINE = [
  { date: '28.08', title: 'Portör muayenesi yenileme', meta: 'Elif K. · randevu al', tone: 'warn' as const },
  { date: '01.09', title: 'Alerjen formatı yürürlükte', meta: 'Menü kartları güncellenmeli', tone: 'info' as const },
  { date: '14.09', title: 'Yangın tüpü kontrol tarihi', meta: 'Servis planlanmadı', tone: 'crit' as const },
];

export type DocFilter = 'all' | 'exp' | 'missing' | 'review';
export const DOC_FILTERS: [DocFilter, string][] = [['all', 'Tümü'], ['exp', 'Süresi doluyor'], ['missing', 'Eksik'], ['review', 'İnceleme']];

export const DOCS: { id: string; icon: string; title: string; meta: string; status: string; st: Status; cat: DocFilter }[] = [
  { id: 'd1', icon: '🧯', title: 'Yangın tüpü kontrol etiketi', meta: '3 gün içinde doluyor', status: 'DOLUYOR', st: 'crit', cat: 'exp' },
  { id: 'd2', icon: '🩺', title: 'Portör muayenesi · Elif K.', meta: '21 gün içinde doluyor', status: 'DOLUYOR', st: 'warn', cat: 'exp' },
  { id: 'd3', icon: '📜', title: 'İşletme kayıt belgesi', meta: 'Geçerli · 14.02.2027', status: 'GEÇERLİ', st: 'ok', cat: 'all' },
  { id: 'd4', icon: '🎓', title: 'Hijyen eğitim sertifikası ×3', meta: 'Geçerli · doğrulandı', status: 'DOĞRULANDI', st: 'ok', cat: 'all' },
  { id: 'd5', icon: '🪲', title: 'Haşere mücadele raporu', meta: 'Eksik — hiç yüklenmedi', status: 'EKSİK', st: 'crit', cat: 'missing' },
  { id: 'd6', icon: '💧', title: 'Su analiz raporu', meta: 'İnceleme bekliyor · QR okunamadı', status: 'İNCELEME', st: 'warn', cat: 'review' },
];

export const SCAN_STEPS = ['Güvenlik ve tür kontrolü', 'Metin okuma (OCR)', 'Belge sınıflandırma', 'Alan çıkarımı ve güven puanı'];
export const SCAN_STATUS = ['Belge okunuyor…', 'Alanlar çıkarılıyor…', 'Sınıflandırıldı: İşletme kayıt belgesi'];

export const OCR_FIELDS = [
  { label: 'TİCARİ UNVAN', value: 'Kahve Durağı Gıda Ltd. Şti.', conf: '%98', low: false },
  { label: 'VERGİ NO', value: '472 018 5566', conf: '%96', low: false },
  { label: 'ADRES', value: 'Caferağa Mah. Moda Cad. 41/A Kadıköy', conf: '%94', low: false },
  { label: 'NACE / FAALİYET', value: '56.10.13 — Kafe faaliyeti', conf: '%91', low: true },
  { label: 'GEÇERLİLİK', value: '14.02.2027', conf: '%88', low: true },
];

export type Pro = {
  id: string; initials: string; name: string; role: string; rating: string; jobs: number;
  dist: string; price: string; eta: string; verified: boolean;
};
export const PROS: Pro[] = [
  { id: 'p1', initials: 'MY', name: 'Murat Yıldız', role: 'Soğutma teknik servisi · Kadıköy', rating: '4.9', jobs: 184, dist: '2,1 km', price: '₺850', eta: 'Bugün 11:30', verified: true },
  { id: 'p2', initials: 'SC', name: 'Soğuk-Tek Servis A.Ş.', role: 'Yetkili servis · 6 teknisyen', rating: '4.7', jobs: 512, dist: '5,4 km', price: 'Teklif', eta: 'Yarın', verified: true },
  { id: 'p3', initials: 'HB', name: 'Hakan Bulut', role: 'Bağımsız teknisyen', rating: '4.4', jobs: 37, dist: '1,3 km', price: '₺600', eta: '2 saat içinde', verified: false },
];
export const PRO_QUERIES = ['Buzdolabım soğutmuyor', 'İSG uzmanı gerekiyor', 'HACCP kurulumu'];

export const VERIFICATIONS = [
  { label: 'Kimlik doğrulandı', ok: true },
  { label: 'Meslek belgesi', ok: true },
  { label: 'Yetkili servis sözleşmesi', ok: true },
  { label: 'Oda / birlik kaydı', ok: false },
];
export const PRO_STATS = [{ value: '4.9', label: 'PUAN · 96 DEĞ.' }, { value: '184', label: 'TAMAMLANAN İŞ' }, { value: '38 dk', label: 'YANIT SÜRESİ' }];
export const PRO_SERVICES = [
  { name: 'Acil arıza müdahalesi', scope: 'Yerinde · 2 saat içinde', price: '₺850' },
  { name: 'Soğutma bakım sözleşmesi', scope: 'Aylık periyodik · rapor dahil', price: '₺1.400' },
];

/** Score domains, outermost ring first. `r` is the ring radius in the 346×356 chart. */
export const SCORE_DOMAINS = [
  { key: 'docs', r: 150, label: 'BELGELER', value: '18/22', unit: '%82', pct: 0.82, tone: 'ok' as const },
  { key: 'personnel', r: 122, label: 'PERSONEL', value: '9/12', unit: '%75', pct: 0.75, tone: 'warn' as const },
  { key: 'form', r: 94, label: 'FORMLAR', value: '12/16', unit: '%75', pct: 0.75, tone: 'warn' as const },
  { key: 'roadmap', r: 66, label: 'İSG', value: '11/13', unit: '%85', pct: 0.85, tone: 'ok' as const },
  { key: 'equipment', r: 38, label: 'EKİPMAN', value: '6/14', unit: '%43', pct: 0.43, tone: 'crit' as const },
];

export const MORE_ITEMS = [
  { icon: '👥', label: 'Personel', sub: '4 kişi · 2 eksik eğitim', badge: '2', href: '/personnel' },
  { icon: '🧰', label: 'Ekipman & bakım', sub: '11 kayıt · 1 arıza', badge: '1', href: '/equipment' },
  { icon: '📋', label: 'Formlar', sub: 'Günlük hijyen kontrol formu · v4', badge: '1', href: '/form' },
  { icon: '⚠️', label: 'Uygunsuzluklar', sub: '1 açık · kritik', badge: '1', href: '/ncr' },
  { icon: '🎓', label: 'Eğitim', sub: 'Kayıtlı, canlı ve resmî sertifika yolları', href: '/training' },
  { icon: '🧭', label: 'Resmî süreç yol haritası', sub: '7 süreç · 3 tamam, 1 sürüyor', href: '/roadmap' },
  { icon: '💬', label: 'Teklifler', sub: '3 yanıt bekliyor', badge: '3', href: '/quotes' },
  { icon: '🧾', label: 'Servis geçmişi', sub: 'QR girişli ziyaretler ve kanıt zinciri', href: '/visit' },
  { icon: '🧑‍🔧', label: 'Uzman bul', sub: 'Doğrulanmış servis ve danışmanlar', href: '/experts' },
  { icon: '📰', label: 'Uzman içerikleri', sub: 'Doğrulanmış mevzuat yorumları', href: '/feed' },
  { icon: '📤', label: 'Rapor al', sub: 'PDF / Excel · denetim dosyası', action: 'report' as const },
  { icon: '⚙️', label: 'Ayarlar', sub: 'Bildirim matrisi, tek el modu, çevrimdışı', href: '/settings' },
] as const;

export const STAFF = [
  { initials: 'EK', name: 'Elif Kaya', role: 'Servis · tam zamanlı', tasks: '3 görev', chips: [{ label: 'HİJYEN EKSİK', tone: 'warn' }, { label: 'PORTÖR 21 GÜN', tone: 'warn' }] },
  { initials: 'BT', name: 'Burak Tan', role: 'Mutfak · tam zamanlı', tasks: '2 görev', chips: [{ label: 'HİJYEN EKSİK', tone: 'warn' }] },
  { initials: 'MS', name: 'Merve Sarı', role: 'Kasa · yarı zamanlı', tasks: '1 görev', chips: [{ label: 'BELGELER TAM', tone: 'ok' }] },
  { initials: 'AD', name: 'Ali Demir', role: 'Kurye · sözleşmeli', tasks: '—', chips: [{ label: 'İŞE ALIŞ %60', tone: 'info' }] },
] as const;

export const EQUIPMENT: { icon: string; name: string; serial: string; status: string; st: Status; next: string }[] = [
  { icon: '❄️', name: 'Buzdolabı · Mutfak arka', serial: 'GH-EQ-4471-KDK', status: 'ARIZA', st: 'crit', next: 'Bu ay 4. limit aşımı · servis öneriliyor' },
  { icon: '🧯', name: 'Yangın tüpü ×3 · Salon', serial: 'GH-EQ-2210-KDK', status: 'DOLUYOR', st: 'warn', next: 'Periyodik kontrol 3 gün içinde' },
  { icon: '🔥', name: 'LPG tüp bağlantısı', serial: 'GH-EQ-8842-KDK', status: 'GEÇERLİ', st: 'ok', next: 'Sonraki bakım 12.11.2026' },
];

export const QR_ACTIONS = [
  { icon: '📋', label: 'Bugünün kontrolleri (2)' },
  { icon: '🧰', label: 'Bakım geçmişi' },
  { icon: '⚠️', label: 'Arıza bildir' },
  { icon: '📄', label: 'Ekipman belgeleri' },
];

/** Deterministic 10×10 pattern with three finder squares, as drawn in the prototype. */
export const QR_CELLS: boolean[] = Array.from({ length: 100 }, (_, i) => {
  const r = Math.floor(i / 10), c = i % 10;
  const corner = (r < 3 && c < 3) || (r < 3 && c > 6) || (r > 6 && c < 3);
  return corner
    ? !((r === 1 && c !== 1 && c !== 8) || (c === 1 && r !== 1 && r !== 8) || (r === 8 && c < 3) || (c === 8 && r < 3))
    : (r * 7 + c * 3 + ((r * c) % 5)) % 3 !== 0;
});

export type OnbOption = { icon?: string; label: string; sub: string; v: string };
export const ONB_STEPS: { step: string; title: string; body: string; options: OnbOption[]; cta: string; skip: string; isResult?: boolean }[] = [
  { step: 'ADIM 1 / 5', title: 'İşletmeni nasıl tanımlayalım?', body: 'Sıfırdan doldurmak zorunda değilsin. Belgen varsa biz okuruz.',
    options: [{ icon: '📄', label: 'Belgemi yükle', sub: 'Vergi levhası, ruhsat, kayıt belgesi', v: 'doc' }, { icon: '✍️', label: 'Elle anlatayım', sub: 'Kendi cümlelerinle yaz', v: 'text' }, { icon: '⚡', label: 'Hızlı başlangıç', sub: '4 soru, sonra devam', v: 'quick' }],
    cta: 'Devam', skip: 'Şimdilik atla' },
  { step: 'ADIM 2 / 5', title: 'Belgeni okuduk. Doğrulayalım mı?', body: 'Kritik alanları senin onayın olmadan kaydetmiyoruz.',
    options: [{ icon: '🏢', label: 'Kahve Durağı Gıda Ltd. Şti.', sub: 'Ticari unvan · güven %98', v: 'a' }, { icon: '📍', label: 'Caferağa Mah. · Kadıköy / İstanbul', sub: 'Adres · güven %94 · haritada onayla', v: 'b' }, { icon: '🏷️', label: '56.10.13 — Kafe faaliyeti', sub: 'NACE · güven %91', v: 'c' }],
    cta: 'Bilgiler doğru', skip: 'Elle düzelt' },
  { step: 'ADIM 3 / 5', title: 'Kafe için 3 sorumuz var', body: 'Sadece işine uyanları soruyoruz. Yanıtına göre soru sayısı değişir.',
    options: [{ icon: '🔥', label: 'LPG / tüp gaz kullanıyor musun?', sub: 'Evet — gaz ve ekipman soruları eklenir', v: 'lpg' }, { icon: '🛵', label: 'Paket servis yapıyor musun?', sub: 'Evet — taşıma sıcaklık kuralları eklenir', v: 'deliv' }, { icon: '❄️', label: 'Soğuk depon var mı?', sub: 'Evet — soğuk zincir kayıtları eklenir', v: 'cold' }],
    cta: 'Yanıtları kaydet', skip: 'Bu bölümü atla' },
  { step: 'ADIM 4 / 5', title: 'Kaç kişi çalışıyor?', body: 'Personel sayısı bazı yükümlülükleri açıp kapatıyor.',
    options: [{ label: '1 – 4 kişi', sub: 'Temel İSG yükümlülükleri', v: '1' }, { label: '5 – 9 kişi', sub: 'İSG uzmanı desteği gerekir', v: '2' }, { label: '10+ kişi', sub: 'Genişletilmiş yükümlülük seti', v: '3' }],
    cta: 'Analizi başlat', skip: 'Sonra sorun' },
  { step: 'HAZIR', title: 'İşletmeni analiz ettik', body: 'Bugün yapman gerekenleri hazırladık. Kurulum %62 — çalışırken tamamlarız.',
    options: [], cta: 'Komuta merkezine git', skip: '', isResult: true },
];
export const ONB_RESULTS = [
  { n: '14', label: 'aktif yükümlülük', sub: 'Kafe · LPG · paket servis · Kadıköy' },
  { n: '3', label: 'bugünlük iş', sub: 'Hiçbiri 2 dakikadan uzun değil' },
  { n: '2', label: 'eksik belge', sub: 'Haşere raporu ve su analizi' },
  { n: '1', label: 'uzman ihtiyacı', sub: 'Yangın tüpü periyodik kontrolü' },
];

export const BRANCHES: { name: string; meta: string; score: string; tone: 'crit' | 'warn' | 'ok' | 'idle' }[] = [
  { name: 'Bostancı', meta: '2 kritik · 4 gecikmiş görev', score: '41', tone: 'crit' },
  { name: 'Kadıköy Moda', meta: '1 belge doluyor', score: '58', tone: 'warn' },
  { name: 'Acıbadem', meta: 'Tüm görevler zamanında', score: '79', tone: 'ok' },
  { name: 'Ataşehir', meta: 'Eğitim eksiği yok', score: '84', tone: 'ok' },
  { name: 'Üsküdar', meta: 'Yeni şube · kurulum %40', score: '—', tone: 'idle' },
];

export const PROVIDER_ROWS = [
  { label: 'Bu ayki kazanç', sub: 'Komisyon sonrası · %11', value: '₺18.400' },
  { label: 'Bekleyen teklif', sub: 'Ortalama yanıt 38 dk', value: '4' },
  { label: 'İşletme puanı', sub: '96 doğrulanmış değerlendirme', value: '4,9' },
];

export const FORM_QUESTIONS = [
  { no: '01', key: 'f1', label: 'Soğutucu sıcaklıkları kabul aralığında mı?', required: true, isCond: false },
  { no: '02', key: 'f2', label: 'Personel hijyen kıyafeti eksiksiz mi?', required: true, isCond: false },
  { no: '03', key: 'f3', label: 'Paket servis taşıma kabı sıcak/soğuk ayrımı yapıldı mı?', required: true, isCond: true },
  { no: '04', key: 'f4', label: 'Atık kovaları kapalı ve temiz mi?', required: false, isCond: false },
] as const;

export type StepState = 'done' | 'active' | 'todo';
export const CAPA: { label: string; meta: string; state: StepState }[] = [
  { label: 'Tespit', meta: '25.08 09:41 · form kaydı · Elif K.', state: 'done' },
  { label: 'Kontrol altına alma', meta: 'Ürün yedek üniteye taşındı · fotoğraf eklendi', state: 'done' },
  { label: 'Düzeltici faaliyet', meta: 'Teknik servis kontrolü · 24 saat içinde · açık', state: 'active' },
  { label: 'Yönetici doğrulaması', meta: 'Kanıt yüklendikten sonra istenecek', state: 'todo' },
  { label: 'Kapanış', meta: 'Doğrulama sonrası otomatik', state: 'todo' },
];

export const ROADMAP: { name: string; status: string; state: StepState; where: string; dur: string; items: { label: string; state: StepState }[] }[] = [
  { name: 'Vergi dairesi kaydı', status: 'TAMAM', state: 'done', where: 'Kadıköy Vergi D.', dur: '1 gün',
    items: [{ label: 'Kira sözleşmesi', state: 'done' }, { label: 'İmza beyannamesi', state: 'done' }, { label: 'Vergi levhası alındı', state: 'done' }] },
  { name: 'İşletme kayıt belgesi', status: 'SÜRÜYOR', state: 'active', where: 'Kadıköy Belediyesi', dur: '≈10 gün',
    items: [{ label: 'Başvuru formu verildi', state: 'done' }, { label: 'Ustalık belgesi bekleniyor', state: 'active' }, { label: 'Yerinde inceleme planlanmadı', state: 'todo' }] },
  { name: 'İtfaiye uygunluk raporu', status: 'BAŞLAMADI', state: 'todo', where: 'İtfaiye Daire Bşk.', dur: '≈15 gün',
    items: [{ label: 'Yangın tüpü ve tesisat kontrolü', state: 'todo' }, { label: 'Kaçış planı çizimi', state: 'todo' }] },
  { name: 'Gıda işletmesi kaydı', status: 'BAŞLAMADI', state: 'todo', where: 'Tarım ve Orman İl Md.', dur: '≈20 gün',
    items: [{ label: 'Kayıt belgesi ön koşul', state: 'todo' }, { label: 'Su analiz raporu', state: 'todo' }, { label: 'Personel portör muayenesi', state: 'todo' }] },
];
/** Seven official processes: 3 done, 1 running, 3 not started. */
export const ROADMAP_SEGMENTS: StepState[] = ['done', 'done', 'done', 'active', 'todo', 'todo', 'todo'];

export const COURSES = [
  { name: 'Hijyen eğitimi · temel', kind: 'GOVERHUB EĞİTİMİ', tone: 'lime' as const, dur: '45 dk · video + sınav',
    cert: 'Tamamlayana GoverHub katılım belgesi verilir. Resmî hijyen sertifikası değildir.', pct: 0.4, progress: '2/5 bölüm · Elif K.', cta: 'Devam et', primary: true,
    toast: ['Bölüm 3 açıldı', 'İlerleme çevrimdışı da kaydedilir'] },
  { name: 'Hijyen eğitimi · resmî sertifika', kind: 'CANLI · YETKİLİ KURUM', tone: 'info' as const, dur: '12 Eylül · 3 saat',
    cert: 'Yetkili kurum tarafından verilir; resmî sertifika yerine geçer. Eğitmen doğrulandı.', pct: 0, progress: '2 personel için uygun', cta: 'Yer ayır', primary: false,
    toast: ['Yer ayrıldı', '12 Eylül · 2 kişi · hatırlatma kuruldu'] },
  { name: 'Alerjen yönetimi', kind: 'UZMAN EĞİTİMİ', tone: 'idle' as const, dur: '25 dk · kayıtlı',
    cert: 'Doğrulanmış gıda mühendisi tarafından hazırlandı, GoverHub içerik onayından geçti.', pct: 1, progress: 'Tamamlandı · 3 personel', cta: 'Belgeyi gör', primary: false,
    toast: ['Katılım belgesi', 'PDF · kanıt zincirinde kayıtlı'] },
];

type QuoteRow = { k: string; v: string; tone?: 'warn' | 'crit' | 'muted' };
export const QUOTES: { initials: string; name: string; meta: string; price: string; featured: boolean; cta: string; rows: QuoteRow[]; toast: [string, string, ('ok' | 'warn')?] }[] = [
  { initials: 'MY', name: 'Murat Yıldız', meta: 'Doğrulanmış · 4,9 · 2,1 km', price: '₺850', featured: true, cta: 'Bu teklifi kabul et',
    rows: [{ k: 'Kapsam', v: 'Termostat kontrolü + gaz basıncı' }, { k: 'Süre', v: 'Bugün 11:30 · 1–2 saat' }, { k: 'Dahil', v: 'İşçilik, ölçüm raporu' }, { k: 'Dahil değil', v: 'Kompresör değişimi (₺2.400)', tone: 'warn' }, { k: 'Geçerlilik', v: '6 saat', tone: 'muted' }],
    toast: ['Teklif kabul edildi', 'Ödeme alındı · QR girişli servis kaydı açıldı'] },
  { initials: 'SC', name: 'Soğuk-Tek Servis A.Ş.', meta: 'Doğrulanmış şirket · 4,7', price: '₺1.150', featured: false, cta: 'Kabul et',
    rows: [{ k: 'Kapsam', v: 'Tam ünite bakımı + rapor' }, { k: 'Süre', v: 'Yarın 09:00 · 3 saat' }, { k: 'Dahil', v: 'İşçilik, gaz dolumu, 3 ay garanti' }, { k: 'Dahil değil', v: 'Yedek parça', tone: 'warn' }, { k: 'Geçerlilik', v: '2 gün', tone: 'muted' }],
    toast: ['Teklif kabul edildi', 'Yarın 09:00 · hatırlatma kuruldu'] },
  { initials: 'HB', name: 'Hakan Bulut', meta: 'Kimlik doğrulandı · oda kaydı yok', price: '₺600', featured: false, cta: 'Kabul et',
    rows: [{ k: 'Kapsam', v: 'Arıza tespiti' }, { k: 'Süre', v: '2 saat içinde · 1 saat' }, { k: 'Dahil', v: 'İşçilik' }, { k: 'Dahil değil', v: 'Rapor, parça, garanti', tone: 'crit' }, { k: 'Geçerlilik', v: '12 saat', tone: 'muted' }],
    toast: ['Teklif kabul edildi', 'Rapor dahil değil — kanıt için ek belge gerekebilir', 'warn'] },
];

export const EVIDENCE_CHAIN = [
  { time: '11:28', label: 'QR ile giriş · Murat Yıldız', hash: 'a17f…9c2e' },
  { time: '11:31', label: 'Arıza tespiti fotoğrafı eklendi', hash: 'b93d…4417' },
  { time: '12:14', label: 'Termostat değişimi tamamlandı', hash: 'c58a…7f30' },
  { time: '12:22', label: 'Ölçüm raporu teslim edildi', hash: 'd02c…11b8' },
  { time: '12:24', label: 'QR ile çıkış · işletme onayı', hash: 'e6b1…88af' },
];
export const RATING_DIMENSIONS = ['Uzmanlık', 'İletişim', 'Zamanında gelme', 'Rapor kalitesi'];

export const SETTINGS_TOGGLES = [
  { key: 'dark', label: 'Koyu tema', sub: 'Sistem ayarını izler · gündüz modu mevcut' },
  { key: 'onehand', label: 'Tek el modu', sub: 'Ana işlemler alt bölgeye toplanır' },
  { key: 'sms', label: 'Kritik uyarılarda SMS', sub: 'Yalnızca kritik seviye için · diğerleri uygulama içi' },
  { key: 'morning', label: 'Sabah özeti', sub: '07:30 · bugünün işleri ve süresi dolan belgeler' },
  { key: 'lang', label: 'Arayüz dili · Türkçe', sub: 'İkinci dil olarak İngilizce etiketler açık' },
] as const;
export const NOTIFICATION_MATRIX = [
  { cat: 'Kritik mevzuat', channels: 'PUSH · SMS · E-POSTA', on: true },
  { cat: 'Görev ve son tarih', channels: 'PUSH · E-POSTA', on: true },
  { cat: 'Belge süresi', channels: 'PUSH · E-POSTA', on: true },
  { cat: 'Pazar yeri ve içerik', channels: 'UYGULAMA İÇİ', on: false },
];

export const POSTS = [
  { initials: 'ZA', name: 'Dr. Zeynep Arslan', role: 'Gıda mühendisi · GoverHub Onaylı', verified: true, unverified: false, likes: 184, comments: 23,
    text: 'Alerjen tebliğinin yeni ekinde 14 alerjen için yazı boyu ve kontrast şartı da var. Menü kartını yeniden basmadan önce ölçüleri kontrol et — sadece liste eklemek yeterli değil.' },
  { initials: 'MK', name: 'Mehmet Korkmaz', role: 'İSG uzmanı · meslek belgesi doğrulandı', verified: false, unverified: true, likes: 62, comments: 9,
    text: '5 çalışanı geçen kafelerde risk değerlendirmesinin güncellenme sıklığı çoğu işletmede atlanıyor. Benim önerim yılda bir yerine her personel değişiminde gözden geçirmek.' },
  { initials: 'ST', name: 'Soğuk-Tek Servis A.Ş.', role: 'Yetkili servis · şirket profili', verified: false, unverified: false, likes: 41, comments: 4,
    text: 'Yaz aylarında en sık gördüğümüz arıza kondenser kirliliği. Ayda bir filtre temizliği, çağırdığınız servis sayısını yarıya indiriyor.' },
];
