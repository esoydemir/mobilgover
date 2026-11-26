/** Denetim olaylarının ve rollerin Türkçe adları. Bilinmeyen tür ham kodla gösterilir; uydurma ad verilmez. */
export const EVENT_TR: Record<string, string> = {
  'legislation.detected': 'Taramada bulundu', 'legislation.date_resolved': 'Yürürlük tarihi belirlendi', 'legislation.proposal_saved': 'Öneri yazıldı ya da güncellendi', 'legislation.drafted': 'Kural taslağı hazırlandı',
  'legislation.approved': 'Onaylandı', 'legislation.assigned': 'Dosya atandı', 'legislation.unassigned': 'Atama kaldırıldı', 'legislation.returned': 'Gerekçeyle iade edildi', 'legislation.rejected': 'Reddedildi',
  'legislation.applied': 'Yürürlük gününde uygulandı', 'platform.area_granted': 'İnceleme alanı yetkisi verildi', 'platform.area_revoked': 'İnceleme alanı yetkisi alındı',
  'platform.role_granted': 'Platform rolü verildi', 'platform.role_revoked': 'Platform rolü kaldırıldı', 'rule.approved': 'Kural onaylandı', 'rule.published': 'Kural yayınlandı', 'rule.area_reviewed': 'Alan incelemesi yapıldı',
  'rule.submitted': 'Kural incelemeye gönderildi', 'rule.drafted': 'Kural taslağı yazıldı', 'rule.returned': 'Kural yazara iade edildi', 'rule.rejected': 'Kural reddedildi', 'rule.withdrawn': 'Yayımlanmış kural geri çekildi',
  'pro.verification_decided': 'Uzman belgesi karara bağlandı', 'pro.authorization_decided': 'Uzman kategori başvurusu karara bağlandı', 'network.moderation_decision': 'Şikâyet karara bağlandı', 'network.appeal_filed': 'Karara itiraz edildi', 'network.profile_saved': 'Ağ profili kaydedildi', 'pro.profile_saved': 'Uzman profili kaydedildi', 'pro.verification_submitted': 'Uzman belgesi sunuldu',
  'legislation.applied_to_company': 'İşletmeye uygulandı', 'legislation.scanned': 'Kaynaklar tarandı', 'rule.draft_edited': 'Kural taslağı düzenlendi', 'rule.effective_confirmed': 'Yürürlük teyit edildi', 'service.complaint_opened': 'Hizmet şikâyeti açıldı', 'service.complaint_responded': 'Hizmet şikâyetine yanıt', 'service.requested': 'Hizmet talebi', 'network.appeal_decided': 'İtiraz karara bağlandı',
  'network.post_published': 'Paylaşım yayımlandı', 'network.post_hidden': 'Paylaşım gizlendi', 'service.complaint_resolved': 'Hizmet şikâyeti karara bağlandı',
};
export const eventTr = (t: string) => EVENT_TR[t] ?? `Kayıt türü: ${t}`;
export const DECISION_TR: Record<string, string> = { hide: 'İçeriği gizle', dismiss: 'Şikâyeti reddet', suspend_profile: 'Profili askıya al', verified: 'Doğrulandı', rejected: 'Reddedildi', approved: 'Onaylandı', suspended: 'Askıya alındı' };
export const REASON_TR: Record<string, string> = { misleading: 'Yanıltıcı bilgi', personal_data: 'Kişisel veri', commercial_data: 'Ticari veri', harassment: 'Taciz ya da hakaret', spam: 'Reklam ya da istenmeyen içerik', other: 'Diğer' };
export const TARGET_TR: Record<string, string> = { post: 'Paylaşım', comment: 'Yorum', profile: 'Profil' };
export const AREA_TR: Record<string, string> = { food_safety: 'Gıda güvenliği', occupational_safety: 'İş sağlığı ve güvenliği', gas_safety: 'Gaz güvenliği', fire_safety: 'Yangın güvenliği', environment: 'Çevre', consumer: 'Tüketici', good_practice: 'İyi uygulama' };
/** Sunucu cümlelerinde geçen alan kodlarını Türkçe adlarıyla değiştirir; "Sıra:" ön ekini atar. */
export const trText = (s: string | null | undefined) => (s ?? '').replace(/^Sıra:\s*/, '').replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, '$3.$2.$1').replace(/^sistemde — /, '').replace(/"?\b(food_safety|occupational_safety|gas_safety|fire_safety|environment|consumer|good_practice)\b"?/g, (_m, k: string) => AREA_TR[k] ?? k).replace(/^./, c => c.toLocaleUpperCase('tr-TR'));
export const SECTOR_TR: Record<string, string> = { food: 'Gıda', electrical: 'Elektrik', estate: 'Emlak' };
export const SOURCE_TR: Record<string, string> = { resmi_gazete: 'Resmî Gazete', mevzuat: 'Mevzuat Bilgi Sistemi' };
export const STATUS_LEG: Record<string, [string, 'warn' | 'info' | 'ok' | undefined]> = {
  pending: ['İnceleme bekliyor', 'warn'], drafted: ['Taslak hazır, onay bekliyor', 'info'], scheduled: ['Onaylandı, yürürlük günü bekliyor', 'ok'], applied: ['Uygulandı', 'ok'], rejected: ['Reddedildi', undefined],
};
export const CRED_TR: Record<string, string> = { ustalik_belgesi: 'Ustalık belgesi', mesleki_yeterlilik: 'Mesleki yeterlilik belgesi', sigorta: 'Sigorta poliçesi', vergi_levhasi: 'Vergi levhası' };
export const credTr = (t: string | null | undefined) => (t ? CRED_TR[t] ?? t.replace(/_/g, ' ') : 'Belge');
