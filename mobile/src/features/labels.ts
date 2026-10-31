/** Turkish labels for codes that come from the API. */
export const ROLE_LABEL: Record<string, string> = { owner: 'İşletme sahibi', hq_manager: 'Merkez yöneticisi', site_manager: 'Şube yöneticisi', staff: 'Personel' };
export const SEVERITY_LABEL: Record<string, string> = { minor: 'düşük', major: 'önemli', critical: 'kritik' };
export const RISK_LABEL: Record<string, string> = { low: 'düşük', medium: 'orta', high: 'yüksek', critical: 'kritik' };
export const QUOTE_STATUS: Record<string, string> = { submitted: 'gönderildi, yanıt bekleniyor', accepted: 'kabul edildi', rejected: 'başka teklif seçildi', withdrawn: 'geri çekildi' };
// EXAMPLE credential names used by the example service categories.
export const CREDENTIAL_LABEL: Record<string, string> = {
  refrigeration_technician: 'Soğutma teknisyeni belgesi (örnek)', gas_installer: 'Gaz tesisatçısı belgesi (örnek)', food_engineer: 'Gıda mühendisliği diploması (örnek)',
};
export const credentialLabel = (c: string) => CREDENTIAL_LABEL[c] ?? c;
