/** Tek aile simge seti: 24px ızgara, 1.7 çizgi, yuvarlak uçlar. Yalnız masaüstü yönetim için (web). */
const P: Record<string, string> = {
  home: 'M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10',
  scale: 'M12 3v18M6 21h12M5 7h14M5 7l-3 7a3.5 3.5 0 0 0 6 0L5 7Zm14 0-3 7a3.5 3.5 0 0 0 6 0l-3-7Z',
  store: 'M4 9l1.5-5h13L20 9M4 9v10.5h16V9M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9M9.5 19.5V14h5v5.5',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  users: 'M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 20v-1.5a4 4 0 0 0-3-3.9M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  history: 'M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5M3.5 4v4.5H8M12 7.5V12l3 2',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20.5 20.5 16 16',
  x: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5 10 17.5 19 7',
  chevron: 'M9 5l7 7-7 7',
  back: 'M15 5l-7 7 7 7',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v5H5V6h5',
  alert: 'M12 3.5 2.5 20h19L12 3.5ZM12 10v4.5M12 17.2v.1',
  sun: 'M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
  lock: 'M6 11V8a6 6 0 0 1 12 0v3M5 11h14v9.5H5V11Z',
  out: 'M10 4H5v16h5M14 8l4 4-4 4M18 12H9',
  doc: 'M7 3h7l4 4v14H7V3ZM14 3v4h4M10 12h5M10 16h5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20.5a7.5 7.5 0 0 1 15 0',
};
export type IconName = keyof typeof P;
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flex: 'none' }}>
      <path d={P[name]} />
    </svg>
  );
}
