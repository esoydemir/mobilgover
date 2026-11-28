/** B-16: kullanıcıya teknik alan anahtarı değil, sorunun Türkçe adı gösterilir. Sunucudaki FACTS kataloğuyla aynı etiketler. */
const LABELS: Record<string, string> = {
  'activity.food_preparation': 'Yemek / içecek hazırlama',
  'activity.food_business': 'Gıda ürünü hazırlayan / satan faaliyet',
  'activity.nace_codes': 'Faaliyet (NACE) kodları',
  'site.province': 'İl',
  'site.district': 'İlçe',
  'utility.lpg': 'LPG / tüp gaz kullanımı',
  'service.delivery': 'Paket servis',
  'activity.onsite_installation': 'Müşteri yerinde montaj / kurulum işi',
  'activity.installation_business': 'Montaj / kurulum işi yapılan faaliyet',
  'activity.brokerage': 'Emlak / aracılık faaliyeti',
  'activity.client_contracts': 'Müşteri adına sözleşme / yetki belgesi dosyası tutma',
  'storage.cold': 'Soğuk depolama',
  'staff.count': 'Çalışan sayısı',
  'equipment.types': 'Kayıtlı ekipman türleri',
};
export const factLabel = (key: string) => LABELS[key] ?? 'Tanımsız profil sorusu';
export const factLabels = (keys: string[]) => keys.map(factLabel).join(', ');
