/**
 * Masaüstü yönetim: tek stil sayfası. Renkler CSS değişkeni (açık/koyu tema), düzen CSS ızgarası.
 * Yönergeler: sakin, kırık beyaz yüzeyler; ince ayırıcılar; GoverHub yeşili yalnız birincil işlem ve seçim; risk rengi yanında her zaman metin.
 * Cam, büyük gölge ve süs yok. Odak, seçim ve üzerine gelme üç ayrı görünümdür.
 */
export const DESK_CSS = `
.gh{--bg:#F7F6F2;--surface:#FDFCFA;--sunk:#EFEDE6;--ink:#1A1D18;--ink2:#4F544A;--ink3:#686D61;--line:#E1DED4;--line2:#CFCBBF;
  --accent:#C6FF3D;--accent-ink:#101A00;--accent-line:#A5D61F;--green:#3B7608;--sel:rgba(198,255,61,.30);--sel-bar:#4E9A0B;--hover:rgba(26,29,24,.05);
  --crit:#AE2117;--crit-bg:#FBE9E7;--warn:#835000;--warn-bg:#FFF1D6;--info:#1B5C98;--info-bg:#E6F0FA;--ok:#2D6508;--ok-bg:#E8F3D9;--focus:#1B5C98;--shadow:0 1px 0 rgba(0,0,0,.03);
  color-scheme:light;}
.gh[data-theme=dark]{--bg:#0F100D;--surface:#151612;--sunk:#0B0C09;--ink:#ECEDE6;--ink2:#B0B5A6;--ink3:#8D9283;--line:#272923;--line2:#383B33;
  --accent:#C6FF3D;--accent-ink:#101A00;--accent-line:#C6FF3D;--green:#C6FF3D;--sel:rgba(198,255,61,.11);--sel-bar:#C6FF3D;--hover:rgba(236,237,230,.055);
  --crit:#FF9088;--crit-bg:rgba(255,144,136,.13);--warn:#FFC95E;--warn-bg:rgba(255,201,94,.13);--info:#8FC3F4;--info-bg:rgba(143,195,244,.13);--ok:#B7EA5C;--ok-bg:rgba(183,234,92,.13);--focus:#8FC3F4;--shadow:none;
  color-scheme:dark;}
.gh,.gh *{box-sizing:border-box}
.gh{position:fixed;inset:0;z-index:5;display:grid;grid-template-columns:236px minmax(0,1fr);background:var(--bg);color:var(--ink);
  font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-feature-settings:"tnum" 1;-webkit-font-smoothing:antialiased}
.gh button,.gh input,.gh textarea,.gh select{font:inherit;color:inherit}
.gh :focus{outline:none}
.gh :focus-visible{outline:2px solid var(--focus);outline-offset:2px;border-radius:6px}
.gh a{color:var(--info)}
.gh-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* kenar çubuğu */
.gh-side{display:flex;flex-direction:column;background:var(--sunk);border-right:1px solid var(--line);min-height:0}
.gh-brand{display:flex;align-items:center;gap:10px;padding:16px 16px 12px}
.gh-logo{width:30px;height:30px;border-radius:9px;background:var(--accent);color:var(--accent-ink);display:grid;place-items:center;font-weight:800;font-size:16px}
.gh-brand b{font-size:15px;letter-spacing:-.01em}.gh-brand small{display:block;color:var(--ink3);font-size:11.5px;margin-top:-2px}
.gh-nav{padding:6px 10px;display:flex;flex-direction:column;gap:2px;overflow:auto;flex:1}
.gh-nav a,.gh-nav button.gh-navi{display:flex;align-items:center;gap:10px;min-height:38px;padding:0 10px;border-radius:9px;color:var(--ink2);text-decoration:none;border:0;background:transparent;cursor:pointer;text-align:left;width:100%}
.gh-nav a:hover{background:var(--hover);color:var(--ink)}
.gh-nav a[aria-current=page]{background:var(--surface);color:var(--ink);font-weight:600;box-shadow:inset 3px 0 0 var(--sel-bar),0 0 0 1px var(--line)}
.gh-nav .gh-cnt{margin-left:auto;font-size:12px;font-variant-numeric:tabular-nums;color:var(--ink2);background:var(--hover);padding:1px 7px;border-radius:999px;min-width:22px;text-align:center}
.gh-nav a[aria-current=page] .gh-cnt{background:var(--sel);color:var(--ink)}
.gh-navlabel{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3);padding:12px 10px 4px}
.gh-side-foot{border-top:1px solid var(--line);padding:10px;display:flex;flex-direction:column;gap:6px}
.gh-user{font-size:12.5px;color:var(--ink2);padding:2px 8px}.gh-user b{display:block;color:var(--ink);font-size:13px}
.gh-roles{display:flex;flex-wrap:wrap;gap:4px;padding:2px 8px 0}
.gh-mini{display:flex;gap:6px;padding:0 2px}
.gh-mini button{flex:1;min-height:32px;border:1px solid var(--line2);background:var(--surface);border-radius:8px;cursor:pointer;font-size:12.5px;color:var(--ink2)}
.gh-mini button:hover{background:var(--hover);color:var(--ink)}

/* ana sütun */
.gh-col{display:flex;flex-direction:column;min-width:0;min-height:0;position:relative;background:var(--bg)}
.gh-head{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:14px 22px 12px;border-bottom:1px solid var(--line);background:var(--bg)}
.gh-head h1{margin:0;font-size:20px;letter-spacing:-.015em;line-height:1.2}
.gh-scope{color:var(--ink2);font-size:13px}
.gh-head .gh-grow{flex:1}
.gh-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 22px;border-bottom:1px solid var(--line);background:var(--bg)}
.gh-page{flex:1;display:flex;flex-direction:column;min-height:0;min-width:0;background:var(--bg)}
.gh-work{flex:1;min-height:0;display:flex;position:relative;background:var(--bg)}
.gh-cell .gh-badge{white-space:normal;border-radius:8px}
.gh-search input{width:190px}
.gh-select{max-width:150px;height:34px;padding:0 8px;border:1px solid var(--line2);border-radius:9px;background:var(--surface);font-size:13px}
.gh-now{border:1px solid var(--line2);border-radius:10px;padding:12px 14px;margin:12px 0;background:var(--bg)}
.gh-now h3{margin:0 0 4px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3)}
.gh-now p{margin:0 0 4px;font-size:14px;line-height:1.5}
.gh-now ul{margin:4px 0 0;padding-left:18px;font-size:14px;line-height:1.6}
.gh-listwrap{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}
.gh-list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;background:var(--bg)}
.gh-panel{width:clamp(430px,44%,660px);flex:none;border-left:1px solid var(--line);background:var(--surface);display:flex;flex-direction:column;min-height:0;min-width:0}
.gh-panel-scroll{flex:1;min-height:0;overflow:auto;padding:0 22px 18px}
.gh-panel-head{padding:16px 22px 12px;border-bottom:1px solid var(--line);display:flex;gap:12px;align-items:flex-start;background:var(--surface)}
.gh-panel-head h2{margin:0;font-size:17px;line-height:1.3;letter-spacing:-.01em;overflow-wrap:anywhere}
.gh-actbar{border-top:1px solid var(--line);background:var(--surface);padding:10px 22px 12px;display:flex;flex-direction:column;gap:7px;max-height:46%;overflow:auto;flex:none}
.gh-actbar .gh-field{margin:0}
.gh-actbar .gh-field textarea{min-height:52px}
.gh-tools .gh-seg button{padding:0 10px}
.gh-empty-panel{margin:auto;max-width:360px;padding:30px;text-align:center;color:var(--ink2)}
.gh-pre{padding:20px 22px}

/* satırlar */
.gh-rowhead{display:grid;gap:12px;padding:8px 22px;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--ink3);border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:2}
.gh-row{display:grid;gap:12px;align-items:start;padding:11px 22px;border-bottom:1px solid var(--line);cursor:pointer;position:relative;background:transparent;text-align:left;width:100%;border-left:0;border-right:0;border-top:0;color:inherit}
.gh-row:hover{background:var(--hover)}
.gh-row[aria-selected=true]{background:var(--sel);box-shadow:inset 3px 0 0 var(--sel-bar)}
.gh-row:focus-visible{outline:2px solid var(--focus);outline-offset:-2px;border-radius:0}
.gh-row .t{font-weight:600;line-height:1.35;overflow-wrap:anywhere}
.gh-row .s{color:var(--ink2);font-size:12.5px;margin-top:2px;overflow-wrap:anywhere}
.gh-cell{font-size:13px;min-width:0;overflow-wrap:anywhere}
.gh-cell.dim{color:var(--ink2)}
.gh-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}

/* parçalar */
.gh-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:36px;padding:0 14px;border-radius:9px;border:1px solid var(--line2);background:var(--surface);color:var(--ink);cursor:pointer;font-weight:550;white-space:nowrap}
.gh-btn:hover:not(:disabled){background:var(--hover)}
.gh-btn.pri{background:var(--accent);border-color:var(--accent-line);color:var(--accent-ink);font-weight:650}
.gh-btn.pri:hover:not(:disabled){filter:brightness(.96);background:var(--accent)}
.gh-btn.dng{color:var(--crit);border-color:color-mix(in srgb,var(--crit) 40%,transparent)}
.gh-btn.sm{min-height:30px;padding:0 10px;font-size:13px;border-radius:8px}
.gh-btn.ghost{border-color:transparent;background:transparent;color:var(--ink2)}
.gh-btn:disabled{opacity:.5;cursor:not-allowed}
.gh-iconbtn{width:34px;height:34px;padding:0;flex:none}
.gh-seg{display:inline-flex;border:1px solid var(--line2);border-radius:9px;overflow:hidden;background:var(--surface)}
.gh-seg button{border:0;background:transparent;min-height:32px;padding:0 12px;cursor:pointer;color:var(--ink2);border-right:1px solid var(--line);font-size:13px;display:inline-flex;gap:6px;align-items:center}
.gh-seg button:last-child{border-right:0}
.gh-seg button:hover{background:var(--hover);color:var(--ink)}
.gh-seg button[aria-pressed=true]{background:var(--sel);color:var(--ink);font-weight:650;box-shadow:inset 0 -2px 0 var(--sel-bar)}
.gh-seg .n{font-variant-numeric:tabular-nums;color:var(--ink3);font-size:12px}
.gh-seg button[aria-pressed=true] .n{color:var(--ink)}
.gh-search{position:relative;display:flex;align-items:center}
.gh-search svg{position:absolute;left:9px;color:var(--ink3);pointer-events:none}
.gh-search input{height:34px;width:min(280px,100%);padding:0 10px 0 32px;border:1px solid var(--line2);border-radius:9px;background:var(--surface)}
.gh-search input::placeholder{color:var(--ink3)}
.gh-field{display:flex;flex-direction:column;gap:5px;margin:10px 0}
.gh-field label{font-size:12.5px;font-weight:600;color:var(--ink)}
.gh-field .hint{font-size:12px;color:var(--ink2)}
.gh-field input,.gh-field textarea,.gh-field select{border:1px solid var(--line2);border-radius:9px;background:var(--bg);padding:8px 10px;min-height:36px;width:100%}
.gh-field textarea{min-height:76px;resize:vertical;line-height:1.45}
.gh-field input:focus-visible,.gh-field textarea:focus-visible,.gh-field select:focus-visible{outline-offset:0;border-radius:9px}
.gh-badge{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;background:var(--hover);color:var(--ink2);white-space:nowrap;line-height:1.5}
.gh-badge.crit{background:var(--crit-bg);color:var(--crit)}.gh-badge.warn{background:var(--warn-bg);color:var(--warn)}
.gh-badge.info{background:var(--info-bg);color:var(--info)}.gh-badge.ok{background:var(--ok-bg);color:var(--ok)}
.gh-badge.ex{background:transparent;border:1px dashed var(--warn);color:var(--warn)}
.gh-sec{padding:16px 0 4px;border-top:1px solid var(--line)}
.gh-sec:first-of-type{border-top:0}
.gh-sec h3{margin:0 0 8px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3);display:flex;gap:8px;align-items:center}
.gh-sec h3 .no{display:grid;place-items:center;width:18px;height:18px;border-radius:999px;background:var(--hover);color:var(--ink2);font-size:11px;letter-spacing:0}
.gh-kv{display:grid;grid-template-columns:minmax(110px,150px) minmax(0,1fr);gap:6px 14px;margin:0}
.gh-kv dt{color:var(--ink2);font-size:13px}.gh-kv dd{margin:0;overflow-wrap:anywhere}
.gh-note{font-size:13px;color:var(--ink2);line-height:1.5}
.gh-callout{border:1px solid var(--line2);border-left-width:3px;border-radius:8px;padding:9px 12px;font-size:13px;line-height:1.5;background:var(--bg);margin:8px 0}
.gh-callout.warn{border-left-color:var(--warn);background:var(--warn-bg)}.gh-callout.crit{border-left-color:var(--crit);background:var(--crit-bg)}
.gh-callout.info{border-left-color:var(--info);background:var(--info-bg)}.gh-callout.ok{border-left-color:var(--sel-bar);background:var(--ok-bg)}
.gh-why{font-size:12.5px;color:var(--warn);margin-top:3px}
.gh-diff{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.gh-diff>div{border:1px solid var(--line);border-radius:9px;padding:10px 12px;background:var(--bg);font-size:13px;line-height:1.55;overflow-wrap:anywhere}
.gh-diff>div.new{border-color:var(--accent-line)}
.gh-diff h4{margin:0 0 4px;font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--ink3)}
.gh-site{border:1px solid var(--line);border-radius:9px;padding:9px 12px;margin:6px 0;background:var(--bg)}
.gh-site b{font-weight:600}
.gh-from{display:inline-block;font-size:11.5px;padding:1px 7px;border-radius:5px;font-weight:600;margin-right:6px}
.gh-from.official{background:var(--ok-bg);color:var(--ok)}.gh-from.plan{background:var(--info-bg);color:var(--info)}.gh-from.example{background:var(--warn-bg);color:var(--warn)}
.gh-hist{list-style:none;margin:0;padding:0}
.gh-hist li{display:grid;grid-template-columns:132px minmax(0,1fr);gap:12px;padding:7px 0;border-bottom:1px solid var(--line);font-size:13px}
.gh-hist li:last-child{border-bottom:0}.gh-hist .w{color:var(--ink2)}
.gh-state{padding:34px 22px;max-width:560px}
.gh-state h2{margin:0 0 6px;font-size:16px}.gh-state p{margin:0 0 12px;color:var(--ink2)}
.gh-state.err h2{color:var(--crit)}.gh-state.lock h2{color:var(--ink)}
.gh-spin{display:inline-block;width:16px;height:16px;border:2px solid var(--line2);border-top-color:var(--sel-bar);border-radius:50%;animation:ghs .8s linear infinite;vertical-align:-3px;margin-right:8px}
@keyframes ghs{to{transform:rotate(360deg)}}
.gh-skel{height:14px;border-radius:6px;background:linear-gradient(90deg,var(--hover),var(--line),var(--hover));background-size:200% 100%;animation:ghk 1.2s ease-in-out infinite;margin:10px 22px}
@keyframes ghk{0%{background-position:200% 0}100%{background-position:-200% 0}}
.gh-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:10px;font-size:13.5px;z-index:20;max-width:min(560px,92vw)}
.gh-prio{margin:16px 22px 0;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
.gh-prio h2{margin:0;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3);padding:12px 16px 4px}
.gh-prio .rule{padding:0 16px 8px;color:var(--ink2);font-size:12.5px}
.gh-prio-item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;align-items:center;padding:11px 16px;border-top:1px solid var(--line)}
.gh-prio-item:first-of-type{border-top:1px solid var(--line)}
.gh-prio-item.first{background:var(--sel)}
.gh-prio-item .why{font-size:12.5px;color:var(--ink2);margin-top:2px}
.gh-areas{display:flex;flex-direction:column;gap:6px;padding:14px 22px 0}
.gh-arearow{display:grid;grid-template-columns:250px minmax(0,1fr);gap:6px;align-items:start}
.gh-chips{display:flex;gap:6px;flex-wrap:wrap;align-items:center;min-height:38px}
.gh-arearow .gh-area{color:inherit;text-decoration:none}
.gh-counter{text-decoration:none;color:inherit}
.gh-counter b{font-variant-numeric:tabular-nums}
.gh-counter.zero{color:var(--ink3)}
.gh-area{display:flex;gap:8px;align-items:baseline;border:1px solid var(--line);border-radius:10px;padding:7px 12px;background:var(--surface);font-size:13px}
.gh-area b{font-size:16px;font-variant-numeric:tabular-nums}
.gh-area.bad{border-color:var(--crit)}.gh-area.lock{color:var(--ink3);background:transparent}
.gh-grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.gh-back{display:none}
.gh-kbd{font-size:11.5px;color:var(--ink3);padding:6px 22px;border-top:1px solid var(--line)}
.gh-kbd kbd{font:inherit;border:1px solid var(--line2);border-radius:4px;padding:0 4px;background:var(--surface)}
.gh-tbl{width:100%;border-collapse:collapse;font-size:13px}
.gh-tbl th{font-size:11.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--ink3);text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}
.gh-tbl td{padding:8px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:anywhere}

/* ayrıntı paneli açıkken liste dar kalır: ikincil sütunlar gizlenir, kritik sütunlar (başlık, durum, bekleme) kalır */
@media (min-width:1181px){.gh-work[data-panel=open] .gh-row,.gh-work[data-panel=open] .gh-rowhead{grid-template-columns:var(--colsc)!important}.gh-work[data-panel=open] [data-opt]{display:none}}
/* geniş masaüstü: satırlar gereksiz uzamasın */
@media (min-width:1800px){.gh-panel{width:clamp(520px,36%,760px)}.gh-listwrap .gh-list>*{max-width:1280px}}
/* dar pencere: kenar çubuğu simge şeridi, ayrıntı tam sayfa */
@media (max-width:1180px){.gh{grid-template-columns:64px minmax(0,1fr)}.gh-brand b,.gh-brand small,.gh-nav a span.l,.gh-navlabel,.gh-user,.gh-roles,.gh-nav .gh-cnt{display:none}
  .gh-nav a{justify-content:center;padding:0}.gh-brand{justify-content:center;padding:14px 0}.gh-mini{flex-direction:column}.gh-mini button span{display:none}
  .gh-panel{position:absolute;inset:0;width:auto;z-index:4;border-left:0}.gh-back{display:inline-flex}}
@media (max-width:760px){.gh{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr)}.gh-side{flex-direction:row;border-right:0;border-bottom:1px solid var(--line);overflow-x:auto}
  .gh-brand{padding:6px 10px}.gh-nav{flex-direction:row;padding:4px 6px;overflow:visible;flex:1}.gh-nav a{min-width:44px}.gh-side-foot{border-top:0;flex-direction:row;padding:4px 8px}
  .gh-head,.gh-tools{padding-left:14px;padding-right:14px}.gh-row,.gh-rowhead{padding-left:14px;padding-right:14px}.gh-rowhead{display:none!important}.gh-diff{grid-template-columns:1fr}.gh-kv{grid-template-columns:1fr}
  .gh-row{grid-template-columns:1fr!important}.gh-grid2{grid-template-columns:1fr}.gh-panel-scroll,.gh-panel-head,.gh-actbar{padding-left:14px;padding-right:14px}.gh-hist li{grid-template-columns:1fr;gap:2px}}
@media (prefers-reduced-motion:reduce){.gh-spin,.gh-skel{animation:none}}
`;
