import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { seedDemoCompany, seedPlatform } from '../../src/seed/demo';
import { CAMERA_PROBLEM_TEXT, classifyCameraError, decodeFrame, onceWithin, tokenFromText } from '../../../mobile/src/features/qr-scan';
import { client, freshEnv, type Env } from '../support/env';

/** AM-1: the camera screen's decoding and resolving, against the real server. The live camera stream is exercised separately in the browser. */
let env: Env;
let demo: Awaited<ReturnType<typeof seedDemoCompany>>;
const C = () => `/companies/${demo.companyId}`;
const owner = () => client(env, demo.users.owner.token);

/** What a camera frame looks like to the decoder: the PNG data URL the server prints, as RGBA pixels. */
const frameOf = (dataUrl: string) => {
  const png = PNG.sync.read(Buffer.from(dataUrl.split(',')[1]!, 'base64'));
  return { rgba: new Uint8ClampedArray(png.data), w: png.width, h: png.height };
};

beforeAll(async () => { env = await freshEnv(); await seedPlatform(env.db); demo = await seedDemoCompany(env.db, { isDemo: true }); });
afterAll(async () => { await env?.close(); });

describe('QR printed by the server is read back and resolved', () => {
  it('equipment code: image → text → token → the equipment record', async () => {
    const q = (await owner().post(`${C()}/qr`, { kind: 'equipment', refId: demo.fridgeId })).body;
    const img = (await owner().get(`${C()}/qr/${q.id}/image?base=${encodeURIComponent('https://app.example.test')}`)).body;
    const f = frameOf(img.dataUrl);
    const text = decodeFrame(f.rgba, f.w, f.h);
    expect(text).toBe(img.url);
    const token = tokenFromText(text!);
    expect(token).toBe(q.token);
    const r = await owner().get(`/qr/resolve?token=${token}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: 'equipment', route: `/equipment/${demo.fridgeId}` });
  });

  it('a link, a bare code and surrounding spaces all give the same token; junk gives none', () => {
    const t = 'Tzho-U8bEGIt1_djf0o9V6lu';
    expect(tokenFromText(`https://x.test/q/${t}`)).toBe(t);
    expect(tokenFromText(`  ${t}  `)).toBe(t);
    expect(tokenFromText(`https://x.test/q/${t}/`)).toBe(t);
    expect(tokenFromText('kısa')).toBeNull();
    expect(tokenFromText('')).toBeNull();
  });

  it('a frame without a code decodes to nothing', () => {
    const blank = new Uint8ClampedArray(64 * 64 * 4).fill(255);
    expect(decodeFrame(blank, 64, 64)).toBeNull();
  });

  it('inactive and unknown codes read fine but resolve to the same refusal; access stays with the server', async () => {
    const q = (await owner().post(`${C()}/qr`, { kind: 'document', refId: (await owner().post(`${C()}/documents`, { docType: 'other', title: 'QR belge', siteId: demo.siteId })).body.id })).body;
    const img = (await owner().get(`${C()}/qr/${q.id}/image?base=${encodeURIComponent('https://app.example.test')}`)).body;
    const f = frameOf(img.dataUrl);
    const token = tokenFromText(decodeFrame(f.rgba, f.w, f.h)!)!;
    expect((await owner().get(`/qr/resolve?token=${token}`)).status).toBe(200);
    expect((await client(env, demo.users.staff.token).get(`/qr/resolve?token=${token}`)).status).toBe(404); // staff: no document right
    await owner().post(`${C()}/qr/${q.id}/active`, { active: false, reason: 'Etiket değişti.' });
    expect((await owner().get(`/qr/resolve?token=${token}`)).status).toBe(404);
    expect((await owner().get(`/qr/resolve?token=${'z'.repeat(30)}`)).status).toBe(404);
  });
});

describe('camera helpers', () => {
  it('the same code seen again inside the window is dropped; another code or a later time passes', () => {
    let now = 1000;
    const once = onceWithin(4000, () => now);
    expect(once('a')).toBe(true);
    now += 250; expect(once('a')).toBe(false);
    now += 250; expect(once('a')).toBe(false);
    expect(once('b')).toBe(true);
    now += 5000; expect(once('b')).toBe(true);
  });

  it('every camera failure maps to a message that points to the code entry', () => {
    const cases: [string, keyof typeof CAMERA_PROBLEM_TEXT][] = [['NotAllowedError', 'denied'], ['NotFoundError', 'none'], ['NotReadableError', 'busy'], ['AbortError', 'other']];
    for (const [name, want] of cases) expect(classifyCameraError({ name })).toBe(want);
    expect(classifyCameraError(null)).toBe('other');
    for (const t of Object.values(CAMERA_PROBLEM_TEXT)) expect(t).toMatch(/yapıştır/);
  });
});
