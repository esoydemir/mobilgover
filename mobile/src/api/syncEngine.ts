import { ApiError, NetworkError } from './errors';

/**
 * Offline queue engine, free of React and device APIs so the same code runs
 * in the app and in integration tests against a real server.
 *
 * Every write made in the field is stored on the device first and sent in
 * order with a unique operation key; the server answers a resend with the
 * first result, so nothing is duplicated. Nothing is dropped silently:
 * rejected and conflicting operations stay until the user decides.
 */
export type OpStatus = 'pending' | 'syncing' | 'failed' | 'conflict';

export type Op = {
  id: string;
  /** The user who made the record. Only that user's session ever sends it. */
  userId: string;
  companyId: string;
  taskId?: string;
  label: string;
  createdAt: string;
  method: 'POST';
  path: string;
  body: unknown;
  /** Photo/document: registered first, then its bytes are uploaded. */
  file?: { base64: string; mime: string; sha256: string; size: number };
  /** Key used to register the file. Renewed when the server rejected an upload, so a retry opens a fresh record. */
  regKey?: string;
  /** Set once the evidence record exists on the server, so a retry only re-sends the bytes. */
  evidenceId?: string;
  status: OpStatus;
  /** Why it is waiting or was refused, in words the user understands. */
  error?: string;
  attempts: number;
};

export type DoneOp = { id: string; label: string; doneAt: string; result?: any };
export type Saved = { ops: Op[]; recent: DoneOp[] };
export type Auth = { token: string; userId: string } | null;
export type Transport = <T = any>(method: 'GET' | 'POST' | 'PUT', path: string, o?: { token?: string | null; body?: unknown; idempotencyKey?: string; bytes?: { data: Uint8Array; mime: string } }) => Promise<T>;
export type Persist = { load: () => Promise<Saved | null>; save: (s: Saved) => Promise<unknown> };

export type SyncResult = { sent: number; offline: boolean; authRequired: boolean };

export const MSG = {
  offline: 'Bağlantı yok; tekrar denenecek.',
  login: 'Oturum sona erdi; yeniden giriş yapınca gönderilecek.',
  otherUser: 'Bu kaydı başka bir kullanıcı oluşturdu; yalnızca o kişi giriş yapınca gönderilir.',
  unknownAuthor: 'Bu kayıt uygulamanın eski sürümünde oluşturuldu ve kimin girdiği kayıtlı değil. Senin girdiğin bir kayıtsa "Tekrar dene" ile gönder; değilse sil.',
};

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class SyncEngine {
  ops: Op[] = [];
  recent: DoneOp[] = [];
  online: boolean | null = null;
  authRequired = false;
  private running: Promise<SyncResult> | null = null;
  private saving: Promise<unknown> = Promise.resolve();

  constructor(private deps: { transport: Transport; persist: Persist; auth: () => Auth; newKey: () => string; onChange?: () => void }) {}

  /** Restores the queue after the app was closed. An operation cut off mid-send goes back to pending; its key makes the resend safe. */
  async load() {
    const s = (await this.deps.persist.load()) ?? { ops: [], recent: [] };
    this.ops = s.ops.map(o => {
      // Saved by an app version that did not record the author: never sent on a guess; the user confirms with "Tekrar dene".
      if (!o.userId) return { ...o, userId: '', status: 'failed' as const, error: MSG.unknownAuthor };
      return o.status === 'syncing' ? { ...o, status: 'pending' as const } : o;
    });
    this.recent = s.recent;
    this.changed();
  }

  /** Waits until the latest state is on the device. */
  flushed() { return this.saving; }

  enqueue(o: Omit<Op, 'id' | 'userId' | 'createdAt' | 'status' | 'attempts' | 'method'>): string {
    const auth = this.deps.auth();
    if (!auth) throw new Error('Kayıt için giriş gerekli.');
    const id = this.deps.newKey();
    this.ops = [...this.ops, { ...o, id, userId: auth.userId, method: 'POST', createdAt: new Date().toISOString(), status: 'pending', attempts: 0 }];
    this.changed();
    return id;
  }

  /** The user asks to send it again. A record without a known author is claimed by whoever confirms it. */
  retry(id: string) {
    const o = this.ops.find(x => x.id === id);
    const me = this.deps.auth()?.userId;
    this.patch(id, { status: 'pending', error: undefined, ...(o && !o.userId && me ? { userId: me } : {}) });
  }
  discard(id: string) { this.ops = this.ops.filter(o => o.id !== id); this.changed(); }
  resultOf(id: string) { return this.recent.find(r => r.id === id); }

  /** Sends pending operations in order. Only one run at a time; a second call joins the first. */
  syncNow(): Promise<SyncResult> {
    if (!this.running) this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }

  private async run(): Promise<SyncResult> {
    const auth = this.deps.auth();
    const out: SyncResult = { sent: 0, offline: false, authRequired: false };
    if (!auth) { this.authRequired = this.ops.some(o => o.status === 'pending'); out.authRequired = this.authRequired; this.changed(); return out; }
    this.authRequired = false;
    for (const snapshot of [...this.ops]) {
      const op = this.ops.find(o => o.id === snapshot.id);
      if (!op || op.status !== 'pending') continue;
      if (op.userId !== auth.userId) { this.patch(op.id, { error: MSG.otherUser }); continue; }
      this.patch(op.id, { status: 'syncing', attempts: op.attempts + 1, error: undefined });
      try {
        const result = await this.send(this.ops.find(o => o.id === op.id)!, auth.token);
        this.finish(op, result);
        this.online = true;
        out.sent++;
      } catch (e) {
        if (e instanceof NetworkError) {
          this.patch(op.id, { status: 'pending', error: MSG.offline });
          this.online = false;
          out.offline = true;
          break;
        }
        const err = e as ApiError;
        this.online = true;
        if (err.status === 401) {
          // The session ended mid-sync: keep everything, resume after sign-in.
          this.ops = this.ops.map(o => (o.id === op.id || (o.status === 'pending' && o.userId === auth.userId) ? { ...o, status: 'pending' as const, error: MSG.login } : o));
          this.authRequired = true;
          out.authRequired = true;
          break;
        }
        if (err.code === 'UPLOAD_REJECTED' || err.code === 'EVIDENCE_REJECTED') {
          // The server kept the rejected record. The file is still on the device; a retry registers a fresh record.
          this.patch(op.id, { status: 'failed', error: `${err.message} Dosya cihazda duruyor; "Tekrar dene" yeni bir kayıtla yükler.`, evidenceId: undefined, regKey: this.deps.newKey() });
          continue;
        }
        this.patch(op.id, { status: err.status === 409 ? 'conflict' : 'failed', error: err.message });
      }
    }
    this.changed();
    return out;
  }

  private async send(op: Op, token: string) {
    const t = this.deps.transport;
    if (!op.file) return t('POST', op.path, { token, body: op.body, idempotencyKey: op.id });
    let evidenceId = op.evidenceId;
    if (!evidenceId) {
      const r = await t<{ id: string }>('POST', op.path, { token, body: op.body, idempotencyKey: op.regKey ?? op.id });
      evidenceId = r.id;
      this.patch(op.id, { evidenceId });
    }
    try {
      return await t('PUT', `/companies/${op.companyId}/evidence/${evidenceId}/content`, { token, bytes: { data: b64ToBytes(op.file.base64), mime: op.file.mime } });
    } catch (e) {
      // An earlier attempt reached the server but its answer was lost. Trust the server's state, not the guess.
      if (e instanceof ApiError && e.code === 'EVIDENCE_NOT_PENDING') {
        if (e.details?.status === 'stored') return { id: evidenceId, status: 'stored', sha256: e.details.sha256 };
        throw new ApiError(422, 'EVIDENCE_REJECTED', e.details?.reason ?? 'Sunucu bu dosyayı reddetti.', e.details);
      }
      throw e;
    }
  }

  private finish(op: Op, result?: any) {
    this.recent = [{ id: op.id, label: op.label, doneAt: new Date().toISOString(), result }, ...this.recent].slice(0, 30);
    this.ops = this.ops.filter(o => o.id !== op.id);
    this.changed();
  }

  private patch(id: string, p: Partial<Op>) {
    this.ops = this.ops.map(o => (o.id === id ? { ...o, ...p } : o));
    this.changed();
  }

  private changed() {
    const snapshot: Saved = { ops: this.ops, recent: this.recent };
    this.saving = this.saving.then(() => this.deps.persist.save(snapshot)).catch(() => undefined);
    this.deps.onChange?.();
  }
}
