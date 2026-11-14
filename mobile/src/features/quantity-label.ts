/** Turkish names for measured quantities. Internal field names (e.g. "temperature") are never shown to users. */
const LABEL: Record<string, string> = {
  temperature: 'sıcaklık', humidity: 'nem', pressure: 'basınç', ph: 'pH', chlorine: 'klor', oil_polar: 'yağ polar madde oranı',
  core_temperature: 'çekirdek sıcaklık', hot_holding_temperature: 'sıcak tutma sıcaklığı', cold_holding_temperature: 'soğuk tutma sıcaklığı',
};
export const quantityLabel = (q: string): string => LABEL[q] ?? q.replace(/_/g, ' ');
const cap = (s: string) => s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1);
export const quantityTitle = (q: string): string => cap(quantityLabel(q));
