import { describe, expect, it } from 'vitest';
import { moduleStatus, modelModule, ocrModule, pdfModule } from '../src/services/modules';

describe('module status names the missing function', () => {
  it('reports OCR and PDF as present when installed', () => {
    expect(ocrModule()).toMatchObject({ id: 'ocr', available: true, missing: null });
    expect(pdfModule()).toMatchObject({ id: 'pdf', available: true, missing: null });
  });

  it('model not configured: says what is missing and what the user loses', async () => {
    const m = await modelModule(null);
    expect(m.available).toBe(false);
    expect(m.missing).toMatch(/LLM_BASE_URL/);
    expect(m.effect).toMatch(/kaynakları listeler/);
  });

  it('model unreachable vs reachable vs error status are told apart', async () => {
    const cfg = { baseUrl: 'http://model.test/v1', model: 'm', apiKey: null, timeoutMs: 5000 };
    const down = await modelModule(cfg, (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch);
    expect(down).toMatchObject({ available: false, missing: 'Model sunucusuna ulaşılamadı' });
    const bad = await modelModule(cfg, (async () => new Response('x', { status: 503 })) as unknown as typeof fetch);
    expect(bad.missing).toMatch(/503/);
    const up = await modelModule(cfg, (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch);
    expect(up).toMatchObject({ available: true, missing: null });
  });

  it('moduleStatus aggregates', async () => {
    const s = await moduleStatus(null);
    expect(s.items.map(i => i.id)).toEqual(['ocr', 'pdf', 'model']);
    expect(s.allAvailable).toBe(false);
  });
});
