/**
 * Plain-language problem → service category SUGGESTION ("dolabım soğutmuyor" → soğutma teknik
 * servisi). Word lists, not a diagnosis: the user confirms or picks another category, and the
 * matched words are shown so the suggestion can be judged. Example lists for the example categories.
 */
const CUES: Record<string, string[]> = {
  refrigeration_service: ['soğut', 'buzdolab', 'dolap', 'dolab', 'dondurucu', 'derin', 'kompresör', 'termostat', 'buzlan', 'conta', 'teşhir', 'reyon', 'sıcaklık', 'derece', '°c', 'ısınıyor', 'erimiş', 'chiller', 'klima'],
  gas_installation_check: ['gaz', 'lpg', 'tüp', 'doğalgaz', 'kaçak', 'koku', 'ocak', 'brülör', 'regülatör', 'hortum', 'vana', 'alev'],
  food_safety_consulting: ['haccp', 'hijyen', 'gıda güvenliği', 'denetim', 'etiket', 'son kullanma', 'bakteri', 'zehirlen', 'alerjen', 'izlenebilir', 'kayıt', 'plan', 'eğitim'],
};

const fold = (s: string) => s.toLocaleLowerCase('tr').normalize('NFC');

export function suggestCategories(text: string, names: Record<string, string>): { code: string; name: string; matched: string[]; why: string }[] {
  const t = fold(text);
  if (t.trim().length < 3) return [];
  const out = [];
  for (const [code, cues] of Object.entries(CUES)) {
    if (!names[code]) continue;
    const matched = cues.filter(c => t.includes(fold(c)));
    if (matched.length) out.push({ code, name: names[code]!, matched, why: `"${matched.slice(0, 3).join('", "')}" ifadesi bu hizmet türüne işaret ediyor (öneri; teşhis değildir).` });
  }
  return out.sort((a, b) => b.matched.length - a.matched.length);
}
