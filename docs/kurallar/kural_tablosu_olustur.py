import sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import FormulaRule
from openpyxl.comments import Comment

OUT = sys.argv[1]
F = 'Arial'
wb = Workbook()

# ── Seçenekler ──
opt = wb.active; opt.title = 'Seçenekler'
lists = {
  'Onay durumu': ['Taslak — kaynak yok', 'Kaynak bulundu — doğrulanmadı', 'Kaynak doğrulandı', 'Alan uzmanı onayladı', 'Ürün sahibi onayladı', 'Reddedildi / kapsam dışı'],
  'Sıklık': ['Her vardiya', 'Günlük', 'Haftalık', 'Aylık', '3 aylık', '6 aylık', 'Yıllık', 'Olay olduğunda', 'Diğer (not sütununa yaz)'],
  'İnceleme alanı': ['food_safety — gıda güvenliği', 'occupational_safety — iş sağlığı ve güvenliği', 'gas_safety — gaz güvenliği', 'fire_safety — yangın güvenliği', 'environment — çevre / atık', 'consumer — tüketici bilgilendirme', 'good_practice — iyi uygulama (yasal zorunluluk değil)'],
  'Önem': ['Kritik', 'Önemli', 'İyileştirme'],
  'Kural türü': ['Yasal zorunluluk', 'İyi uygulama'],
}
for c, (name, vals) in enumerate(lists.items(), start=1):
    opt.cell(1, c, name).font = Font(name=F, bold=True)
    for r, v in enumerate(vals, start=2): opt.cell(r, c, v).font = Font(name=F)
    opt.column_dimensions[chr(64 + c)].width = 44
rng = {name: f"Seçenekler!${chr(64+c)}$2:${chr(64+c)}${len(vals)+1}" for c, (name, vals) in enumerate(lists.items(), start=1)}

# ── Kural taslakları ──
ws = wb.create_sheet('Kural taslakları', 0)
cols = [
  ('Kod', 12, False), ('Konu', 28, False), ('Kural türü', 16, True), ('İnceleme alanı', 26, True),
  ('Kaynak hüküm: belge adı ve sayısı', 30, True), ('Kaynak hüküm: madde / fıkra', 16, True), ('Kaynak hüküm: metin (aynen)', 44, True),
  ('Kaynak bağlantısı (resmî)', 28, True), ('Yürürlük tarihi', 14, True),
  ('Uygulanabilirlik koşulu', 36, True), ('Koşulda kullanılan işletme bilgileri', 30, True),
  ('Görev', 36, True), ('Sıklık', 16, True), ('Limit / kabul ölçütü', 26, True), ('Limitin dayanağı', 26, True),
  ('İyi uygulama önerisi (yasal zorunluluk değil)', 34, True),
  ('Kanıt', 30, True), ('Sapma aksiyonu (acil talimat)', 40, True), ('Önem', 12, True),
  ('Onay durumu', 26, True), ('Kaynağı doğrulayan (ad, tarih)', 24, True), ('Alan uzmanı onayı (ad, alan, tarih)', 26, True),
  ('Ürün sahibi onayı (ad, tarih)', 22, True), ('Not / belirsizlik', 36, True),
]
thin = Side(style='thin', color='BFBFBF')
border = Border(left=thin, right=thin, top=thin, bottom=thin)
head_fill = PatternFill('solid', start_color='1F2937')
fill_in = PatternFill('solid', start_color='FFF2CC')   # to be filled
example_fill = PatternFill('solid', start_color='E7E6E6')
for i, (name, width, _) in enumerate(cols, start=1):
    c = ws.cell(1, i, name)
    c.font = Font(name=F, bold=True, color='FFFFFF'); c.fill = head_fill
    c.alignment = Alignment(wrap_text=True, vertical='center'); c.border = border
    ws.column_dimensions[c.column_letter].width = width
ws.row_dimensions[1].height = 42
ws.freeze_panes = 'C2'

example = ['ÖRNEK-0', 'Soğuk muhafaza sıcaklık kaydı', 'Yasal zorunluluk', 'food_safety — gıda güvenliği',
  'ÖRNEK KAYNAK — gerçek mevzuat değildir (biçim gösterimi)', 'Örnek Madde 1', 'Bu metin örnektir ve hiçbir resmî düzenlemeyi temsil etmez.',
  'https://… (Resmî Gazete veya kurum sayfası)', '2024-01-01',
  'Gıda hazırlıyor VE soğuk depolama kullanıyor', 'activity.food_preparation = evet; storage.cold = evet',
  'Ünitenin iç sıcaklığını kalibreli termometreyle ölç, değeri gir', 'Günlük', '0 … 4 °C (ÖRNEK)', 'Örnek değer; ürün grubu ve HACCP planına göre belirlenmeli', '',
  'Ölçüm (°C) + fotoğraf (en az 1); limit dışıysa not', 'Ürünleri limit içindeki yedek üniteye taşı, yöneticine haber ver; kullanım/imha kararını yetkili kişi verir (ÖRNEK)',
  'Kritik', 'Taslak — kaynak yok', '', '', '', 'Bu satır yalnızca biçimi gösterir; uygulamaya aktarılmaz.']

# Candidate topics: subject, area, proposed condition and suggested task/evidence only.
# Source, frequency, limit and deviation action stay EMPTY: they come from verified sources and experts.
cand = [
  ('Soğutucu (buzdolabı) sıcaklık kontrolü', 'food_safety — gıda güvenliği', 'Gıda hazırlıyor VE soğuk depolama kullanıyor', 'activity.food_preparation; storage.cold', 'Ünite iç sıcaklığını ölç ve kaydet', 'Ölçüm (°C) + fotoğraf'),
  ('Dondurucu sıcaklık kontrolü', 'food_safety — gıda güvenliği', 'Gıda hazırlıyor VE dondurucu var', 'activity.food_preparation; equipment.types içinde freezer', 'Dondurucu iç sıcaklığını ölç ve kaydet', 'Ölçüm (°C) + fotoğraf'),
  ('Sıcak servis / sıcak tutma sıcaklığı', 'food_safety — gıda güvenliği', 'Gıda hazırlıyor VE sıcak servis yapıyor', 'activity.food_preparation; (yeni bilgi: sıcak servis — kataloğa eklenmeli)', 'Benmari / sıcak tutma ünitesinde ürün sıcaklığını ölç', 'Ölçüm (°C)'),
  ('Personel el hijyeni ve koruyucu ekipman', 'food_safety — gıda güvenliği', 'Gıda hazırlıyor', 'activity.food_preparation', 'Vardiya başında el hijyeni, bone/eldiven/önlük kontrolü', 'Kontrol listesi'),
  ('Temizlik ve dezenfeksiyon planı', 'food_safety — gıda güvenliği', 'Gıda hazırlıyor', 'activity.food_preparation', 'Plandaki alanların temizliğini işaretle', 'Kontrol listesi + fotoğraf (isteğe bağlı)'),
  ('Haşere (zararlı) kontrolü', 'food_safety — gıda güvenliği', 'Gıda hazırlıyor', 'activity.food_preparation', 'Yetkili firma ziyaret raporunu yükle; tuzak kontrolü', 'Belge (rapor) + kontrol listesi'),
  ('Alerjen bilgilendirmesi', 'consumer — tüketici bilgilendirme', 'Gıda hazırlıyor VE tüketiciye sunuyor', 'activity.food_preparation', 'Menüdeki alerjen bilgisinin güncel olduğunu kontrol et', 'Kontrol listesi + belge (menü)'),
  ('Son kullanma / etiket kontrolü', 'food_safety — gıda güvenliği', 'Gıda hazırlıyor VE soğuk depolama kullanıyor', 'activity.food_preparation; storage.cold', 'Depodaki ürünlerin tarih ve etiketlerini kontrol et', 'Kontrol listesi'),
  ('Termometre kalibrasyonu', 'food_safety — gıda güvenliği', 'Sıcaklık ölçümü gerektiren bir görev var', 'equipment.types içinde thermometer', 'Termometrenin kalibrasyon belgesini yükle / tarihini güncelle', 'Belge'),
  ('LPG / tüp gaz bağlantı kontrolü', 'gas_safety — gaz güvenliği', 'LPG veya tüp gaz kullanıyor', 'utility.lpg', 'Hortum, vana, havalandırma kontrolü', 'Kontrol listesi'),
  ('Yangın söndürücü kontrolü', 'fire_safety — yangın güvenliği', 'Tüm işyerleri (kaynakla doğrulanmalı)', '—', 'Söndürücü basınç göstergesi ve son kontrol tarihi', 'Kontrol listesi + fotoğraf'),
  ('İlk yardım malzemesi', 'occupational_safety — iş sağlığı ve güvenliği', 'Çalışanı var (eşik kaynakla belirlenmeli)', 'staff.count', 'İlk yardım dolabının içeriğini kontrol et', 'Kontrol listesi'),
  ('Çalışan hijyen / iş güvenliği eğitimi kaydı', 'occupational_safety — iş sağlığı ve güvenliği', 'Çalışanı var (eşik ve tehlike sınıfı kaynakla belirlenmeli)', 'staff.count; activity.nace_codes', 'Eğitim katılım belgesini yükle', 'Belge'),
  ('Atık kızartma yağı teslimi', 'environment — çevre / atık', 'Gıda hazırlıyor VE kızartma yapıyor', 'activity.food_preparation; (yeni bilgi: kızartma — kataloğa eklenmeli)', 'Lisanslı toplayıcıya teslim belgesini yükle', 'Belge'),
]

from openpyxl.utils import get_column_letter
COL = {name: i for i, (name, _, _) in enumerate(cols, start=1)}
L = lambda name: get_column_letter(COL[name])


NV = 'Kaynak bulundu — doğrulanmadı'
GHY = 'Türk Gıda Kodeksi Gıda Hijyeni Yönetmeliği — RG 17.12.2011, sayı 28145 (Mevzuat no 15592). 2011 sonrası değişiklikler kontrol edilemedi.'
RESEARCH = {
  1: {'Kural türü': 'Yasal zorunluluk', 'Kaynak hüküm: belge adı ve sayısı': GHY, 'Kaynak hüküm: madde / fıkra': 'Md. 5 (soğuk zincir ve kayıt); Md. 18/5; Md. 22 (HACCP)',
      'Kaynak hüküm: metin (aynen)': '"Soğuk zinciri korumak ve kayıt altına almak." · "…sağlık riski oluşturabilecek sıcaklıklarda tutulmaması ve soğuk zincirin kırılmaması gerekir." (ikincil kopyalardan; resmî konsolide metinle doğrulanmadı)',
      'Kaynak bağlantısı (resmî)': 'https://mevzuat.gov.tr/mevzuat?MevzuatNo=15592&MevzuatTur=7&MevzuatTertip=5', 'Yürürlük tarihi': '17.12.2011 (doğrulanmadı)',
      'Sıklık': None, 'Limit / kabul ölçütü': 'Mevzuatta sayısal sınır bulunamadı', 'Limitin dayanağı': 'İşletmenin HACCP planı (Md. 22)',
      'İyi uygulama önerisi (yasal zorunluluk değil)': 'Sayısal değer veren resmî rehber bulunamadı; varsayılan alan uzmanından gelmeli',
      'Onay durumu': NV, 'Not / belirsizlik': 'Bkz. KAYNAK_ARASTIRMASI_P01-P05.md §P-01'},
  2: {'Kural türü': 'Yasal zorunluluk', 'Kaynak hüküm: belge adı ve sayısı': GHY + ' · TGK Hızlı Dondurulmuş Gıdalar Tebliği 2014/47 — RG 18.10.2014, sayı 29149 · Sıcaklık izleme tebliği 2014/48',
      'Kaynak hüküm: madde / fıkra': 'GHY Md. 5; Tebliğ 2014/47 (madde no doğrulanmadı)', 'Kaynak hüküm: metin (aynen)': 'Hızlı dondurulmuş gıdanın sıcaklığı ürünün her noktasında −18 °C veya daha düşük olmalı (ikincil özet; aynen metin doğrulanmadı)',
      'Kaynak bağlantısı (resmî)': 'Resmî Gazete 18.10.2014 / 29149 (erişilemedi)', 'Limit / kabul ölçütü': '−18 °C veya daha düşük — yalnızca hızlı dondurulmuş ürünler için; toplu tüketim deposuna uzanımı belirsiz',
      'Limitin dayanağı': 'Tebliğ 2014/47 (kapsam uzmanca teyit edilmeli)', 'İyi uygulama önerisi (yasal zorunluluk değil)': 'Kapsam dışı kalsa da −18 °C referans; ölçüm sıklığı için kaynak bulunamadı',
      'Onay durumu': NV, 'Not / belirsizlik': 'Uygulamada dondurucu ekipman türü yok; eklenmeli. Bkz. §P-02'},
  3: {'Kural türü': 'İyi uygulama', 'Kaynak hüküm: belge adı ve sayısı': GHY + ' (genel hüküm) · Toplu Tüketim Yerleri İçin İyi Hijyen Uygulamaları Rehberi (Tarım ve Orman Bak. / TESK) — rehber, yönetmelik değil',
      'Kaynak hüküm: madde / fıkra': 'GHY Md. 18/5, Md. 22', 'Kaynak hüküm: metin (aynen)': 'Rehber: "Sıcak tutulacak gıdaların sıcaklığı 65°C seviyesinin altına düşmemelidir"; 3 saatten uzun tutulmamalı',
      'Kaynak bağlantısı (resmî)': 'https://isparta.tarimorman.gov.tr/BelgelerArsiv/G%C4%B1da%20ve%20Yem/Hijyen%20Uygulama%20Rehberleri/toplutuketimhijyen.pdf',
      'Limit / kabul ölçütü': 'Mevzuatta bağlayıcı sayısal sınır bulunamadı', 'Limitin dayanağı': '—',
      'İyi uygulama önerisi (yasal zorunluluk değil)': '≥ 65 °C, en fazla 3 saat (Bakanlık/TESK rehberi)', 'Onay durumu': NV,
      'Not / belirsizlik': 'Kaynaklarda 60/63/65/70 °C farklı değerler var. "Sıcak servis yapıyor" bilgisi katalogda yok. Bkz. §P-03'},
  4: {'Kural türü': 'Yasal zorunluluk', 'Kaynak hüküm: belge adı ve sayısı': GHY + ' · Hijyen Eğitimi Yönetmeliği — RG 05.07.2013, sayı 28698',
      'Kaynak hüküm: madde / fıkra': 'GHY Md. 17 (personel hijyeni); lavabo gereklilikleri (madde/ek no doğrulanmadı)',
      'Kaynak hüküm: metin (aynen)': '"Gıdanın muameleye tabi tutulduğu alanlarda çalışan bütün personelin, kişisel temizliğini sürdürmeye azami itina göstermesi, temiz ve gerekli durumlarda uygun koruyucu kıyafet giymesi gerekir." (ikincil kopya)',
      'Kaynak bağlantısı (resmî)': 'https://mevzuat.gov.tr/mevzuat?MevzuatNo=15592&MevzuatTur=7&MevzuatTertip=5', 'Limit / kabul ölçütü': 'Sonuç yükümlülüğü; kontrol sıklığı mevzuatta bulunamadı',
      'İyi uygulama önerisi (yasal zorunluluk değil)': 'Her vardiya başında kısa kontrol listesi (rehberler)', 'Onay durumu': NV,
      'Not / belirsizlik': 'Hijyen eğitimi belgesi P-13 ile birleşebilir. Bkz. §P-04'},
  5: {'Kural türü': 'Yasal zorunluluk', 'Kaynak hüküm: belge adı ve sayısı': GHY + ' (genel hijyen + HACCP) · Biyosidal Ürünler Yönetmeliği (Sağlık Bak.; künye bulunamadı)',
      'Kaynak hüküm: madde / fıkra': 'GHY Md. 5, Md. 22; temizlik-dezenfeksiyon madde/ek no doğrulanmadı', 'Kaynak hüküm: metin (aynen)': 'Doğrulanmış aynen metin yok',
      'Limit / kabul ölçütü': '—', 'İyi uygulama önerisi (yasal zorunluluk değil)': 'Yazılı plan: ne, nasıl, hangi kimyasal, ne zaman, kim; ruhsatlı dezenfektan (valilik genelgesi, rehberler)',
      'Onay durumu': NV, 'Not / belirsizlik': 'Dayanak madde uzmanca belirlenmeli. Bkz. §P-05'},
}

def style_row(r, fill=None, italic=False):
    for i, (_, _, editable) in enumerate(cols, start=1):
        c = ws.cell(r, i)
        c.font = Font(name=F, italic=italic, color='595959' if italic else '000000')
        c.alignment = Alignment(wrap_text=True, vertical='top'); c.border = border
        if fill: c.fill = fill
        elif editable and c.value in (None, ''): c.fill = fill_in

for i, v in enumerate(example, start=1): ws.cell(2, i, v)
style_row(2, example_fill, italic=True)
ws.cell(2, 1).comment = Comment('Biçim örneği. Uygulamadaki demo kuralından alınmıştır; gerçek mevzuat değildir.', 'GoverHub')

r = 3
for n, (topic, area, cond, facts, task, ev) in enumerate(cand, start=1):
    vals = {COL['Kod']: f'P-{n:02d}', COL['Konu']: topic, COL['İnceleme alanı']: area, COL['Uygulanabilirlik koşulu']: f'Öneri: {cond}',
            COL['Koşulda kullanılan işletme bilgileri']: facts, COL['Görev']: f'Öneri: {task}', COL['Kanıt']: f'Öneri: {ev}', COL['Onay durumu']: 'Taslak — kaynak yok'}
    for name, v in RESEARCH.get(n, {}).items(): vals[COL[name]] = v
    for k, v in vals.items(): ws.cell(r, k, v)
    style_row(r)
    r += 1
blank_until = r + 15
for rr in range(r, blank_until):
    ws.cell(rr, 1, f'P-{rr - 2:02d}')
    style_row(rr)
last = blank_until - 1

for name, col in [('Onay durumu', L('Onay durumu')), ('Sıklık', L('Sıklık')), ('İnceleme alanı', L('İnceleme alanı')), ('Önem', L('Önem')), ('Kural türü', L('Kural türü'))]:
    dv = DataValidation(type='list', formula1=f"={rng[name]}", allow_blank=True, showErrorMessage=True,
                        errorTitle='Listeden seç', error='Değeri açılır listeden seç (Seçenekler sayfası).')
    ws.add_data_validation(dv); dv.add(f'{col}3:{col}{last}')
status_colors = {'Ürün sahibi onayladı': 'C6EFCE', 'Alan uzmanı onayladı': 'DDEBF7', 'Kaynak doğrulandı': 'DDEBF7', 'Reddedildi / kapsam dışı': 'F4CCCC'}
for val, color in status_colors.items():
    sc = L('Onay durumu')
    ws.conditional_formatting.add(f'{sc}3:{sc}{last}', FormulaRule(formula=[f'${sc}3="{val}"'], fill=PatternFill('solid', start_color=color)))
ws.auto_filter.ref = f'A1:{get_column_letter(len(cols))}{last}'

# ── Özet ──
sm = wb.create_sheet('Özet', 1)
sm['A1'] = 'Onay durumuna göre satır sayısı (örnek satır hariç)'; sm['A1'].font = Font(name=F, bold=True)
for i, s in enumerate(lists['Onay durumu'], start=3):
    sm.cell(i, 1, s).font = Font(name=F)
    sm.cell(i, 2, f"=COUNTIF('Kural taslakları'!${L('Onay durumu')}$3:${L('Onay durumu')}${last},A{i})").font = Font(name=F)
end = 2 + len(lists['Onay durumu'])
sm.cell(end + 1, 1, 'Toplam (konusu yazılmış satır)').font = Font(name=F, bold=True)
sm.cell(end + 1, 2, f"=COUNTA('Kural taslakları'!$B$3:$B${last})").font = Font(name=F, bold=True)
sm.cell(end + 2, 1, 'Kaynak hükmü boş olan satır').font = Font(name=F)
sm.cell(end + 2, 2, f"=COUNTIFS('Kural taslakları'!$B$3:$B${last},\"<>\",'Kural taslakları'!$E$3:$E${last},\"\")").font = Font(name=F)
sm.cell(end + 3, 1, 'Yayına hazır (ürün sahibi onayı + kaynak dolu)').font = Font(name=F)
sm.cell(end + 3, 2, f"=COUNTIFS('Kural taslakları'!${L('Onay durumu')}$3:${L('Onay durumu')}${last},\"Ürün sahibi onayladı\",'Kural taslakları'!$E$3:$E${last},\"<>\")").font = Font(name=F)
sm.column_dimensions['A'].width = 48; sm.column_dimensions['B'].width = 12

# ── Nasıl doldurulur ──
hw = wb.create_sheet('Nasıl doldurulur', 0)
lines = [
  ('GoverHub — sınırlı kural kümesi taslak tablosu', True),
  ('Kapsam: tek şubeli, yemek hazırlayan kafe/restoran (pilot).', False),
  ('', False),
  ('BU TABLO HİÇBİR ŞEY YAYIMLAMAZ. Kurallar uygulamaya yalnızca kendi inceleme akışıyla girer: taslak → alan uzmanı incelemesi → ürün sahibi onayı → yayın.', True),
  ('', False),
  ('Doldurulacak hücreler', True),
  ('• Sarı hücreler doldurulacak alanlardır. Gri satır (ÖRNEK-0) yalnızca biçim örneğidir; gerçek kaynak değildir ve uygulamaya aktarılmaz.', False),
  ('• P-01 … P-14 satırları aday konulardır. Yalnızca konu, inceleme alanı, önerilen koşul, görev ve kanıt önerisi yazılıdır ("Öneri:" ile başlar).', False),
  ('• Kaynak hüküm, sıklık, limit, limitin dayanağı ve sapma aksiyonu bilerek BOŞ bırakıldı: bunlar doğrulanmış kaynaktan ve alan uzmanından gelmeli. Ben doldurmadım; tahmin yazmadım.', False),
  ('• P-01 … P-05 için kaynak araştırması yapıldı (docs/kurallar/KAYNAK_ARASTIRMASI_P01-P05.md): durumları "Kaynak bulundu — doğrulanmadı". Resmî konsolide metinle doğrulanmadılar. Yasal değerler ile iyi uygulama önerileri ayrı sütunlarda.', False),
  ('• Aday bir konu kapsam dışıysa Onay durumu = "Reddedildi / kapsam dışı" seç ve nedenini Not sütununa yaz.', False),
  ('• Boş P-15 … satırları yeni konular içindir.', False),
  ('', False),
  ('Sütunlar', True),
  ('Kaynak hüküm: belge adı ve sayısı, madde/fıkra, metnin aynısı, resmî bağlantı ve yürürlük tarihi. Metin özetlenmeden, kaynaktaki gibi yazılır.', False),
  ('Uygulanabilirlik koşulu: hangi işletmeye uygulandığı, düz Türkçe. Yanındaki sütun, koşulun hangi işletme bilgisine dayandığını gösterir (uygulamadaki soru kataloğu). Katalogda olmayan bir bilgi gerekiyorsa "(yeni bilgi: …)" yaz.', False),
  ('Görev / Sıklık / Limit / Kanıt: sahada yapılacak iş, ne sıklıkla, kabul ölçütü ve hangi kanıtla. Limitin dayanağı ayrıca yazılır (yasal sınır mı, HACCP planı mı, üretici talimatı mı).', False),
  ('Sapma aksiyonu: limit dışı ya da kontrol başarısız olunca personelin hemen yapacağı, onaylı acil talimat.', False),
  ('Onay durumu: Taslak — kaynak yok → Kaynak bulundu — doğrulanmadı → Kaynak doğrulandı → Alan uzmanı onayladı → Ürün sahibi onayladı. Her adımın kim tarafından ve ne zaman yapıldığı yandaki sütunlara yazılır.', False),
  ('', False),
  ('Sonra ne olur', True),
  ('"Ürün sahibi onayladı" durumundaki ve kaynağı dolu satırlar uygulamaya TASLAK kural olarak aktarılır, uygulamadaki alan uzmanı incelemesinden ve onaydan geçmeden yayımlanmaz. Örnek (demo) kurallar pilot ortamında zaten yayımlanamaz.', False),
]
for i, (t, bold) in enumerate(lines, start=1):
    c = hw.cell(i, 1, t); c.font = Font(name=F, bold=bold, size=13 if i == 1 else 11); c.alignment = Alignment(wrap_text=True, vertical='top')
hw.column_dimensions['A'].width = 120
legend = hw.cell(len(lines) + 2, 1, 'Renk: sarı = doldurulacak · gri = biçim örneği · yeşil = ürün sahibi onayladı · mavi = kaynak doğrulandı / uzman onayladı · kırmızı = reddedildi')
legend.font = Font(name=F, italic=True)
wb.active = 0
wb.save(OUT)
print('ok', last)
