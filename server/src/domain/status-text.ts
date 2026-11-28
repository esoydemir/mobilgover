/** Stored status codes as people read them in error messages. */
const TR: Record<string, string> = {
  pending: 'karar bekliyor', drafted: 'taslak hazır', scheduled: 'onaylı, yürürlük bekliyor', applied: 'uygulandı', rejected: 'reddedildi',
  superseded: 'yerini yenisi aldı', draft: 'taslak', in_review: 'incelemede', approved: 'onaylı', published: 'yayımlandı', withdrawn: 'geri çekildi',
};
export const statusText = (code: string) => TR[code] ?? code;
