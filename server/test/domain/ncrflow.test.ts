import { describe, expect, it } from 'vitest';
import { flow, roundPerformers, suggestions, verifierConflict, type FlowInput } from '../../src/domain/ncrflow';

const base: FlowInput = { flowVersion: 2, depth: 'correction', status: 'open', iteration: 1, ownerId: 'u1', dueAt: '2030-01-01T00:00:00Z',
  independentVerification: false, steps: [], causes: [], actions: [] };

describe('nonconformity flow', () => {
  it('stages go in order; the first missing one is active', () => {
    const f = flow(base);
    expect(f.stages.map(s => s.key)).toEqual(['containment', 'assignment', 'cause', 'actions', 'effectiveness', 'verification']);
    expect(f.stages[0]).toMatchObject({ state: 'active' });
    expect(f.readyForEffectiveness).toBe(false);
  });

  it('a correction-depth case is ready after first response, owner, a cause and one done action', () => {
    const f = flow({ ...base, steps: [{ step: 'containment', iteration: 1, doneBy: 'u1' }],
      causes: [{ stage: 'initial', iteration: 1, categories: ['knowledge'], migrated: false }],
      actions: [{ kind: 'correction', iteration: 1, status: 'done', doneBy: 'u1' }, { kind: 'follow_up', iteration: 1, status: 'open', doneBy: null }] });
    expect(f.readyForEffectiveness).toBe(true); // an open follow-up does not block
  });

  it('an open correction blocks; without an owner it is not ready', () => {
    const f = flow({ ...base, ownerId: null, steps: [{ step: 'containment', iteration: 1, doneBy: 'u1' }],
      causes: [{ stage: 'initial', iteration: 1, categories: ['process'], migrated: false }],
      actions: [{ kind: 'correction', iteration: 1, status: 'open', doneBy: null }] });
    expect(f.readyForEffectiveness).toBe(false);
    expect(f.blockers.join(' ')).toContain('Sorumlu');
  });

  it('full CAPA needs a verified root cause in this round; a new round needs a new action', () => {
    const capa: FlowInput = { ...base, depth: 'capa', iteration: 2, steps: [{ step: 'containment', iteration: 1, doneBy: 'u1' }],
      causes: [{ stage: 'initial', iteration: 1, categories: ['equipment'], migrated: false }, { stage: 'verified', iteration: 1, categories: ['equipment'], migrated: false }],
      actions: [{ kind: 'correction', iteration: 1, status: 'done', doneBy: 'u1' }, { kind: 'corrective_action', iteration: 1, status: 'done', doneBy: 'u1' }] };
    const f = flow(capa);
    expect(f.readyForEffectiveness).toBe(false);
    expect(f.blockers.join(' ')).toContain('yeni bir aksiyon');
    expect(f.blockers.join(' ')).toContain('Kök neden');
  });

  it('a case recorded before the new flow (v1) is not asked for owner or a first assessment', () => {
    const f = flow({ ...base, flowVersion: 1, depth: 'capa', ownerId: null, steps: [{ step: 'containment', iteration: 1, doneBy: 'u1' }],
      causes: [{ stage: 'verified', iteration: 1, categories: [], migrated: true }],
      actions: [{ kind: 'correction', iteration: 1, status: 'done', doneBy: 'u1' }, { kind: 'corrective_action', iteration: 1, status: 'done', doneBy: 'u1' }] });
    expect(f.readyForEffectiveness).toBe(true);
  });

  it('for high risk, whoever did this round\'s fix cannot verify', () => {
    const n = { independentVerification: true, iteration: 2, actions: [
      { kind: 'correction' as const, iteration: 1, status: 'done' as const, doneBy: 'a' },
      { kind: 'corrective_action' as const, iteration: 2, status: 'done' as const, doneBy: 'b' }] };
    expect(verifierConflict(n, 'b')).toBe(true);
    expect(verifierConflict(n, 'a')).toBe(false);
    expect(verifierConflict({ ...n, independentVerification: false }, 'b')).toBe(false);
  });

  it('a declared "done" counts only once verified; a rejected claim is open work again', () => {
    const ready = (verification: any, status: any = 'done') => flow({ ...base, steps: [{ step: 'containment', iteration: 1, doneBy: 'u1' }],
      causes: [{ stage: 'initial', iteration: 1, categories: ['process'], migrated: false }],
      actions: [{ kind: 'correction', iteration: 1, status, doneBy: status === 'done' ? 'u1' : null, verification }] });
    expect(ready('declared').readyForEffectiveness).toBe(false);
    expect(ready('declared').blockers.join(' ')).toContain('doğrulanmayı bekliyor');
    expect(ready('rejected', 'open').readyForEffectiveness).toBe(false);
    expect(ready('verified').readyForEffectiveness).toBe(true);
    expect(ready('legacy').readyForEffectiveness).toBe(true);
  });

  it('round performers are owners, doers and evidence givers of this round\'s fixes', () => {
    const n = { iteration: 1, independentVerification: true, actions: [
      { kind: 'corrective_action' as const, iteration: 1, status: 'done' as const, doneBy: 'b', ownerId: 'a', evidenceBy: ['c'] },
      { kind: 'follow_up' as const, iteration: 1, status: 'done' as const, doneBy: 'x', ownerId: 'x' }] };
    expect([...roundPerformers(n)].sort()).toEqual(['a', 'b', 'c']);
    for (const u of ['a', 'b', 'c']) expect(verifierConflict(n, u)).toBe(true);
    expect(verifierConflict(n, 'd')).toBe(false);
    expect(verifierConflict(n, 'x')).toBe(false); // a follow-up is not the fix
  });

  it('suggestions only point somewhere; training is shown as not available yet', () => {
    const s = suggestions(['knowledge', 'resource'], { hasEquipment: false, hasObligation: true, serviceCategory: null });
    expect(s.map(x => x.kind)).toEqual(['explanation', 'training', 'assign', 'team']);
    expect(s.find(x => x.kind === 'training')!.available).toBe(false);
  });
});
