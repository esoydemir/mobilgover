/** Quick check of a real model with llm.ts: LLM_BASE_URL=... LLM_MODEL=... npx tsx scripts/try-model.ts */
import { askModel, llmConfigFromEnv, type PromptSource } from '../src/services/llm';

const cfg = llmConfigFromEnv();
if (!cfg) { console.error('LLM_BASE_URL ve LLM_MODEL gerekli'); process.exit(2); }
const S = (n: number, title: string, text: string, locator = 'Belge · sürüm 1 · bölüm 1'): PromptSource => ({ n, title, locator, text, isExample: false });
const cases: [string, string, PromptSource[]][] = [
  ['kaynaklı', 'Soğuk oda sıcaklığı en fazla kaç derece olmalı?', [S(1, 'Soğuk oda talimatı', 'Soğuk oda sıcaklığı en fazla 4 °C olmalıdır. Sıcaklık günde iki kez kaydedilir.'), S(2, 'Temizlik planı', 'Yüzeyler her vardiya sonunda dezenfekte edilir.')]],
  ['yetersiz', 'Yangın tüpleri ne sıklıkla kontrol edilmeli?', [S(1, 'Soğuk oda talimatı', 'Soğuk oda sıcaklığı en fazla 4 °C olmalıdır.'), S(2, 'Temizlik planı', 'Yüzeyler her vardiya sonunda dezenfekte edilir.')]],
  ['çelişen', 'Soğuk oda sıcaklığı en fazla kaç derece olabilir?', [S(1, 'Soğuk oda talimatı A', 'Soğuk oda sıcaklığı en fazla 4 °C olmalıdır.'), S(2, 'Soğuk oda talimatı B', 'Soğuk oda sıcaklığı 8 °C’ye kadar çıkabilir.')]],
];
for (const [name, q, src] of cases) {
  const t0 = Date.now(); const r = await askModel(cfg, q, src);
  console.log(`\n## ${name} (${Date.now() - t0} ms)\n`, JSON.stringify(r, null, 1));
}
