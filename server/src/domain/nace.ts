/**
 * NACE (Rev.2, Türkiye faaliyet sınıflaması) catalogue used at registration.
 *
 * Source: TÜİK "Faaliyet Sınıflaması (NACE Rev.2)", 4-digit class level. This is a STARTER SUBSET
 * of the classes the first businesses need, not the full classification: a code that is not listed
 * is never guessed at — it is sent to review and leaves every dependent obligation at "needs info".
 * `foodPreparation` is the only activity statement derived from a class today; add one here only
 * together with the rule that reads it.
 */
export const NACE_VERSION = 'nace-rev2-tr/starter-1';
export const NACE_SOURCE = 'TÜİK Faaliyet Sınıflaması (NACE Rev.2)';

export type NaceEntry = { code: string; title: string; foodPreparation: boolean };

export const NACE: readonly NaceEntry[] = [
  { code: '10.71', title: 'Ekmek, taze pastane ürünleri ve tatlı imalatı', foodPreparation: true },
  { code: '47.11', title: 'Gıda, içecek ve tütün ağırlıklı perakende satış (bakkal, market)', foodPreparation: false },
  { code: '56.10', title: 'Lokanta ve seyyar yiyecek hizmeti faaliyetleri (restoran, kafe)', foodPreparation: true },
  { code: '56.21', title: 'Dış yemek hizmetleri (catering)', foodPreparation: true },
  { code: '56.30', title: 'İçecek sunum hizmetleri (kafe, bar)', foodPreparation: true },
  { code: '62.01', title: 'Bilgisayar programlama faaliyetleri', foodPreparation: false },
  { code: '68.20', title: 'Kendi mülkü veya kiralanan gayrimenkulün kiralanması ve işletilmesi', foodPreparation: false },
  { code: '68.31', title: 'Emlak acenteleri (emlak ofisi)', foodPreparation: false },
  { code: '69.20', title: 'Muhasebe, defter tutma ve denetim faaliyetleri', foodPreparation: false },
  { code: '96.02', title: 'Kuaförlük ve güzellik bakım hizmetleri', foodPreparation: false },
];

/** "5610", "56.10" and the 6-digit "56.10.01" all mean class 56.10; anything else is not a code. */
export function normalizeNace(raw: string): string | null {
  const digits = raw.trim().replace(/[.\s]/g, '');
  if (!/^\d{4}(\d{2})?$/.test(digits)) return null;
  return `${digits.slice(0, 2)}.${digits.slice(2, 4)}`;
}

export const lookupNace = (code: string) => NACE.find(n => n.code === code) ?? null;

const fold = (s: string) => s.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');

/** Search by code ("56", "56.10") or by words of the activity name ("kafe", "emlak"). */
export function searchNace(q: string): NaceEntry[] {
  const query = fold(q.trim());
  if (!query) return [...NACE];
  const code = query.replace(/\s/g, '');
  return NACE.filter(n => n.code.replace('.', '').startsWith(code.replace('.', '')) || fold(n.title).includes(query));
}
