import { useState } from 'react';
import { Text, View } from 'react-native';
import { errorText } from '../api/client';
import { useSession } from '../api/session';
import type { Indicators } from '../api/types';
import { useApi } from '../api/useApi';
import { ScoreRings, type RingDomain } from '../components/ScoreRings';
import { Screen } from '../components/Screen';
import { ErrorBox, Loading, StaleNote } from '../components/states';
import { Card, Eyebrow, FilterChip, PrimaryButton } from '../components/ui';
import { addDays, fmtDateTime, startOfDay } from '../features/dates';
import { C, tint, type } from '../theme';

type Export = {
  scope: { company: string; isDemo: boolean }; period: { from: string; to: string }; generatedAt: string; disclaimer: string;
  exampleContentWarning: string | null;
  ruleVersions: { code: string; version: number; is_example: boolean; kind: string }[];
  summary: { tasks: number; done: number; nonconforming: number; overdue: number; openNonconformities: number };
  gaps: { type: string; title?: string; rule?: string; facts?: string[]; flag?: string; status?: string }[];
  nonconformities: { id: string; title: string; risk_level: string; status: string }[];
  integrity: { auditChain: { ok: boolean; count: number; brokenAtSeq?: number; reason?: string }; files: { evidenceId: string; status: string }[] };
};

const PERIODS: [number, string][] = [[7, '7 gün'], [30, '30 gün'], [90, '90 gün']];
const GAP_TEXT: Record<string, string> = {
  missing_profile_info: 'Profil bilgisi eksik', needs_expert_review: 'Uzman incelemesi bekliyor', overdue_check: 'Gecikmiş kontrol',
  needs_review: 'Kural değişti, inceleme gerekli', evidence_integrity: 'Kanıt dosyası bütünlük sorunu',
};
const pct = (v: number | null) => (v === null ? '—' : `%${Math.round(v * 100)}`);
const tone = (v: number | null): RingDomain['tone'] => (v === null ? 'idle' : v >= 0.9 ? 'ok' : v >= 0.7 ? 'warn' : 'crit');

/** Indicators with their components, and the audit file with its gaps. */
export default function ReportRoute() {
  const { company, siteId, call } = useSession();
  const [days, setDays] = useState(30);
  const [width, setWidth] = useState(346);
  const [file, setFile] = useState<Export | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const to = addDays(startOfDay(), 1).toISOString();
  const from = addDays(startOfDay(), -days).toISOString();
  const query = `siteId=${siteId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const ind = useApi<Indicators>(company && siteId ? `/companies/${company.id}/indicators?${query}` : null);
  const d = ind.data;

  const rings: RingDomain[] = d ? [
    { key: 'onTime', label: 'ZAMAN', value: `${d.components.onTime.numerator}/${d.components.onTime.denominator}`, unit: pct(d.components.onTime.value), pct: d.components.onTime.value ?? 0, tone: tone(d.components.onTime.value) },
    { key: 'conforming', label: 'SONUÇ', value: `${d.components.conforming.numerator}/${d.components.conforming.denominator}`, unit: pct(d.components.conforming.value), pct: d.components.conforming.value ?? 0, tone: tone(d.components.conforming.value) },
    { key: 'evidence', label: 'KANIT', value: `${d.components.evidenceCoverage.numerator}/${d.components.evidenceCoverage.denominator}`, unit: pct(d.components.evidenceCoverage.value), pct: d.components.evidenceCoverage.value ?? 0, tone: tone(d.components.evidenceCoverage.value) },
  ] : [];

  const exportFile = async () => {
    setBusy(true); setError(null);
    try { setFile(await call<Export>('GET', `/companies/${company!.id}/audit-export?${query}`)); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <Screen title="Uyum raporu" titleEn="Compliance report" onRefresh={ind.reload} refreshing={ind.loading}>
      <View onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', gap: 7 }}>
        {PERIODS.map(([n, label]) => <FilterChip key={n} label={label} active={days === n} onPress={() => { setDays(n); setFile(null); }} />)}
      </View>
      {ind.stale ? <StaleNote /> : null}
      {ind.error ? <ErrorBox message={ind.error} onRetry={ind.reload} /> : null}
      {!d ? <Loading /> : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={type(10.5, 700, { ls: 0.13, color: d.status === 'on_track' ? C.lime : d.status === 'critical_risk' ? C.crit : C.warn })}>
                {d.status === 'critical_risk' ? 'KRİTİK RİSK AÇIK' : d.status === 'insufficient_data' ? 'VERİ YETERSİZ' : d.status === 'attention' ? 'İZLEME GEREKTİRİYOR' : 'YOLUNDA'}
              </Text>
              <Text style={[type(24, 600, { family: 'outfit', ls: -0.035, lh: 1.12 }), { marginTop: 7 }]}>Son {days} gün</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
              <Text testID="report-score" style={type(46, 600, { family: 'outfit', ls: -0.045 })}>{d.score ?? '—'}</Text>
              <Text style={type(17, 600, { color: C.t3 })}>/100</Text>
            </View>
          </View>
          {d.scoreCappedBy ? <Text style={type(12, 600, { color: C.crit })}>Puan sınırlandı: {d.scoreCappedBy}. Kritik risk ortalamanın içinde gizlenmez.</Text> : null}
          <ScoreRings width={width} domains={rings} />
          <Text style={type(11.5, 400, { color: C.t3, lh: 1.5 })}>Dıştan içe: ZAMAN = son tarihinden önce yapılan kontroller · SONUÇ = uygun çıkan sonuçlar · KANIT = kanıtı eksiksiz saklanan kontroller.</Text>
          <Card>
            <Eyebrow>DİĞER GÖSTERGELER</Eyebrow>
            {[['Gecikmiş kontrol', d.components.overdueTasks], ['Açık kritik / yüksek risk', d.components.openCriticalRisks], ['Tekrarlayan uygunsuzluk', d.components.recurringNonconformities],
              ['Bilgi eksik yükümlülük', d.components.unknowns.needsInfo], ['Uzman incelemesi bekleyen', d.components.unknowns.needsReview]].map(([k, v]) => (
              <View key={k as string} style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
                <Text style={type(13, 500)}>{k}</Text>
                <Text style={type(13, 700, { family: 'mono', color: (v as number) > 0 ? C.warn : C.t2 })}>{v}</Text>
              </View>
            ))}
            <Text style={[type(11, 400, { color: C.t3, lh: 1.45 }), { marginTop: 12 }]}>{d.disclaimer} Formül: {d.formulaVersion}.</Text>
          </Card>
        </>
      )}

      <PrimaryButton testID="report-export" label={busy ? 'Hazırlanıyor…' : 'Denetim dosyası oluştur'} disabled={busy} onPress={exportFile} />
      {error ? <ErrorBox message={error} /> : null}
      {file ? (
        <Card border={file.integrity.auditChain.ok ? tint.lime(0.3) : tint.crit(0.4)}>
          <Eyebrow>DENETİM DOSYASI · {fmtDateTime(file.generatedAt)}</Eyebrow>
          <Text style={[type(13, 600), { marginTop: 10 }]}>{file.scope.company}{file.scope.isDemo ? ' (DEMO)' : ''}</Text>
          {file.exampleContentWarning ? <Text style={[type(12, 600, { color: C.warn, lh: 1.45 }), { marginTop: 8 }]}>{file.exampleContentWarning}</Text> : null}
          <Text style={[type(12.5, 400, { color: C.t2, lh: 1.6 }), { marginTop: 8 }]}>
            {file.summary.tasks} görev · {file.summary.done} yapıldı · {file.summary.nonconforming} uygunsuz sonuç · {file.summary.overdue} gecikmiş · {file.summary.openNonconformities} açık uygunsuzluk
          </Text>
          <Text testID="report-chain" style={[type(12.5, 600, { color: file.integrity.auditChain.ok ? C.lime : C.crit }), { marginTop: 8 }]}>
            Denetim izi: {file.integrity.auditChain.ok ? `${file.integrity.auditChain.count} olay, zincir sağlam` : `zincir bozuk (#${file.integrity.auditChain.brokenAtSeq}: ${file.integrity.auditChain.reason})`}
          </Text>
          <Text style={type(12.5, 600, { color: file.integrity.files.every(f => f.status === 'intact') ? C.lime : C.crit })}>
            Kanıt dosyaları: {file.integrity.files.filter(f => f.status === 'intact').length}/{file.integrity.files.length} sağlam
          </Text>
          <Text style={[type(10.5, 600, { ls: 0.1, color: C.t3 }), { marginTop: 12 }]}>EKSİKLER ({file.gaps.length})</Text>
          {file.gaps.length === 0 ? <Text style={type(12, 400, { color: C.t2 })}>Eksik bulunmadı.</Text> : null}
          {file.gaps.slice(0, 12).map((g, i) => (
            <Text key={i} style={[type(12, 400, { color: C.t2 }), { marginTop: 4 }]}>• {GAP_TEXT[g.type] ?? g.type}{g.title ? `: ${g.title}` : g.rule ? `: ${g.rule}` : ''}{g.facts?.length ? ` (${g.facts.join(', ')})` : ''}</Text>
          ))}
          <Text style={[type(10.5, 600, { ls: 0.1, color: C.t3 }), { marginTop: 12 }]}>KURAL SÜRÜMLERİ</Text>
          {file.ruleVersions.map(r => <Text key={r.code + r.version} style={[type(12, 400, { color: C.t2 }), { marginTop: 4 }]}>• {r.code} v{r.version}{r.is_example ? ' · ÖRNEK' : ''}</Text>)}
          <Text style={[type(11, 400, { color: C.t3, lh: 1.45 }), { marginTop: 12 }]}>{file.disclaimer}</Text>
        </Card>
      ) : null}
    </Screen>
  );
}
