const fs = require('fs'); const { q } = require('./leg-lib.cjs'); const T = 'C:/Users/gkhno/AppData/Local/Temp/'; const DAY = new Date().toISOString().slice(0, 10).replaceAll('-', '');
const sleep = ms => new Promise(r => setTimeout(r, ms)); const setClock = iso => fs.writeFileSync(T + 'synth-clock.json', JSON.stringify({ offsetMs: Date.parse(iso) - Date.now() }));
const runs = () => q(`SELECT count(*) FROM legislation_scan_runs WHERE trigger='schedule' AND run_date='2027-04-21'`); const items = () => q(`SELECT count(*) FROM legislation_changes`);
(async () => {
  const cur = JSON.parse(fs.readFileSync(T + 'synth-publish.json', 'utf8')); if (!cur.find(x => x.id === `${DAY}-87`)) { cur.push({ id: `${DAY}-87`, title: 'Sentetik Taşınmaz Aracılık Güvence Esasları Yönetmeliği', sayi: 99087, articles: ['Metin okunamayacak.'], unreadable: true, dayOffset: 149 }); cur.push({ id: `${DAY}-88`, title: 'Sentetik Taşınmaz Ticareti Kayıt Esasları Yönetmeliği', sayi: 99088, articles: ['Taşınmaz ticareti kayıtları saklanır.', 'Bu Yönetmelik yayımı tarihinde yürürlüğe girer.'], dayOffset: 149 }); fs.writeFileSync(T + 'synth-publish.json', JSON.stringify(cur)); }
  await sleep(6000); console.log('kuyruk onceki', items());
  for (const [iso, wait] of [['2027-04-21T23:00:30+03:00', 30], ['2027-04-21T23:20:00+03:00', 25], ['2027-04-21T23:32:00+03:00', 30], ['2027-04-21T23:59:00+03:00', 25]]) { setClock(iso); await sleep(wait * 1000); console.log(iso.slice(11, 16), '| o gunku zamanlanmis tarama sayisi:', runs(), '| kuyruktaki kayit:', items()); }
  console.log(q(`SELECT string_agg(to_char(started_at AT TIME ZONE 'Europe/Istanbul','HH24:MI:SS')||' '||status, ' // ' ORDER BY started_at) FROM legislation_scan_runs WHERE trigger='schedule' AND run_date='2027-04-21'`));
})();
