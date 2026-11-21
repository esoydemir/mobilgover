/** B-16: kullanıcıya teknik alan anahtarı değil, sorunun Türkçe adı gösterilir. Sunucudaki FACTS kataloğuyla aynı etiketler. */
const LABELS: Record<string, string> = {
  'activity.food_preparation': 'Yemek / içecek hazırlama',
  'activity.nace_codes': 'Faaliyet (NACE) kodları',
  'activity.onsite_installation': 'Müşteri yerinde montaj / kurulum işi',
  'site.province': 'İl',
  'site.district': 'İlçe',
  'utility.lpg': 'LPG / tüp gaz kullanımı',
  'service.delivery': 'Paket servis',
  'storage.cold': 'Soğuk depolama',
  'staff.count': 'Çalışan sayısı',
  'equipment.types': 'Kayıtlı ekipman türleri',
};
export const factLabel = (key: string) => LABELS[key] ?? key;
export const factLabels = (keys: string[]) => keys.map(factLabel).join(', ');
