import { C } from '../theme';

export const STATUS_TR: Record<string, [string, string]> = {
  pending: ['İNCELEME BEKLİYOR', C.warn], drafted: ['TASLAK HAZIR · ONAY BEKLİYOR', C.info], scheduled: ['ONAYLANDI · YÜRÜRLÜK GÜNÜ BEKLİYOR', C.lime],
  applied: ['UYGULANDI', C.lime], rejected: ['REDDEDİLDİ', C.t3],
};
export const dayTr = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('.') : '—');
