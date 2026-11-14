import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LocalStore } from '../../src/storage/local';

// Windows LocalStore bug: the root check compared against `root + '/'`, but resolved Windows paths use backslashes,
// so every put/get failed there. These run on whatever platform runs the suite (Windows locally, Linux in CI).
describe('LocalStore path handling', () => {
  let dir = '';
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it('stores and reads a nested key', async () => {
    dir = await mkdtemp(join(tmpdir(), 'gh-store-'));
    const s = new LocalStore(dir);
    await s.put('company/doc/v1.pdf', Buffer.from('%PDF-1.4 x'));
    expect((await s.get('company/doc/v1.pdf'))?.toString()).toBe('%PDF-1.4 x');
  });
  it('refuses to overwrite a stored file', async () => {
    const s = new LocalStore(dir);
    await expect(s.put('company/doc/v1.pdf', Buffer.from('y'))).rejects.toThrow();
  });
  it('refuses keys that escape the root', async () => {
    const s = new LocalStore(dir);
    await expect(s.put('../escape.txt', Buffer.from('x'))).rejects.toThrow('invalid storage key');
    await expect(s.put('a/../../escape.txt', Buffer.from('x'))).rejects.toThrow('invalid storage key');
    expect(await s.get('../escape.txt')).toBeNull();
  });
  it('returns null for a missing key', async () => {
    expect(await new LocalStore(dir).get('nope/none.pdf')).toBeNull();
  });
});
