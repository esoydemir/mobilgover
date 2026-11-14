import { describe, expect, it } from 'vitest';
import { assessEvidence, qLabel, type EvidenceRequirement } from '../../src/domain/evidence';

const base = { measurements: [], files: [], checklist: null, notes: 0, approvals: [] };

describe('user-facing evidence texts never show internal field names', () => {
  it('names the quantity and the approver in Turkish', () => {
    const reqs: EvidenceRequirement[] = [
      { kind: 'measurement', quantity: 'temperature', unit: '°C' },
      { kind: 'device_record', quantity: 'core_temperature' },
      { kind: 'approval', role: 'hq_manager' },
    ];
    const r = assessEvidence(reqs, base);
    expect(r.missing).toEqual(['Ölçüm: sıcaklık (°C)', 'Cihaz kaydı: çekirdek sıcaklık', 'Onay: merkez yöneticisi']);
    expect(r.missing.join(' ')).not.toMatch(/temperature|hq_manager|_/);
  });
  it('an unknown quantity code is shown as plain words, not as a snake_case key', () => {
    expect(qLabel('oven_door_gap')).toBe('oven door gap');
    expect(qLabel('temperature')).toBe('sıcaklık');
  });
});
