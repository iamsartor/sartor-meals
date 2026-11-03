/* Sartor Meals: a small family meal planner. Data lives in Firebase Firestore (REST, no SDK). */
(() => {
  'use strict';

  // ---------- storage ----------
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
  };

  const state = {
    cfg: LS.get('sm.cfg', null),
    data: LS.get('sm.data', null),
    person: LS.get('sm.person', ''),
    weekOffset: 0,
    search: '',
    cravings: null,
    syncing: false,
    error: '',
  };

  // ---------- dates ----------
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const today = () => iso(new Date());
  // The plan week starts on the shopping/cooking day (setting prep_day, default Mittwoch) and runs 7 days.
  const WDAY = { Sonntag: 0, Montag: 1, Dienstag: 2, Mittwoch: 3, Donnerstag: 4, Freitag: 5, Samstag: 6 };
  const prepWd = () => { const v = state.data ? setting('prep_day', 'Mittwoch') : 'Mittwoch'; return v in WDAY ? WDAY[v] : 3; };
  const weekStart = (s) => { const d = parse(s); const wd = (d.getDay() - prepWd() + 7) % 7; d.setDate(d.getDate() - wd); return iso(d); };
  const DAY = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const DAYLONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const MON = ['Jan', 'Feb', 'März', 'Apr', 'Mai', 'Juni', 'Juli', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const fmt = (s) => { const d = parse(s); return `${d.getDate()}. ${MON[d.getMonth()]}`; };
  const dayShort = (s) => DAY[parse(s).getDay()];
  const dayLong = (s) => DAYLONG[parse(s).getDay()];
  const curWeek = () => addDays(weekStart(today()), state.weekOffset * 7);

  // ---------- helpers ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = (tab) => (state.data && state.data[tab]) || [];
  const recipe = (id) => T('Rezepte').find((r) => r.id === id);
  const yes = (v) => /^(ja|yes|true|1|x)$/i.test(String(v || '').trim());
  const tags = (r) => String((r && r.tags) || '').toLowerCase().split(',').map((t) => t.trim()).filter(Boolean);
  const setting = (k, d) => { const r = T('Einstellungen').find((x) => x.key === k); return r && r.value ? r.value : d; };
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; };

  const SECTIONS = ['Obst und Gemüse', 'Kühlregal', 'Fleisch und Fisch', 'Trockenes und Brot', 'Tiefkühl', 'Sonstiges'];
  const SECTION_BLOCK = { 'Obst und Gemüse': 'b-new', 'Kühlregal': 'b-prep', 'Fleisch und Fisch': 'b-warm', 'Trockenes und Brot': 'b-abendbrot', 'Tiefkühl': 'b-bites', 'Sonstiges': 'b-wish' };
  const CHIPS = ['Warm und deftig', 'Frisch', 'Nudeln', 'Suppe', 'Reis', 'Kartoffeln', 'Was Süßes'];

  function mealClass(row, r) {
    const t = tags(r);
    if ((row && row.slot === 'abendbrot') || (r && r.category === 'abendbrot')) return 'b-abendbrot';
    if (r && r.category === 'bite') return 'b-bites';
    if (t.includes('neu')) return 'b-new';
    if (t.includes('familienwunsch')) return 'b-wish';
    if (row && row.cook_on && row.cook_on !== row.date) return 'b-prep';
    if (!row && t.includes('vorkochen')) return 'b-prep';
    return 'b-warm';
  }
  function mealLabel(row, r) {
    if (row && row.note) return row.note;
    return { 'b-abendbrot': 'Abendbrot', 'b-bites': 'für den Kühlschrank', 'b-new': 'neu probieren', 'b-wish': 'Familienwunsch', 'b-prep': 'vorgekocht', 'b-warm': 'frisch gekocht' }[mealClass(row, r)];
  }

  // ---------- icons ----------
  const I = {
    week: '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
    choose: '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="3" y="6" width="8" height="12" rx="2"/><rect x="13" y="6" width="8" height="12" rx="2"/></svg>',
    cart: '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h2l2 10h10l2-7H7"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/></svg>',
    book: '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 4h10a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2z"/><path d="M6 18a2 2 0 0 1 2-2h10M10 8h5M10 11h5"/></svg>',
    next: '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    left: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    right: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    plus: '<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    gear: '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>',
  };

  // ---------- data sync ----------
  function applyLocal(op) { applyTo(state.data, op); }
  function applyTo(d, op) {
    const rows = d[op.tab] || (d[op.tab] = []);
    const m = (r) => Object.keys(op.match || {}).every((k) => String(r[k]) === String(op.match[k]));
    if (op.op === 'append') rows.push(...op.rows.map((r) => ({ ...r })));
    else if (op.op === 'delete') d[op.tab] = rows.filter((r) => !m(r));
    else if (op.op === 'replace') { d[op.tab] = rows.filter((r) => !m(r)); d[op.tab].push(...(op.rows || []).map((r) => ({ ...r }))); }
    else if (op.op === 'update') rows.forEach((r) => { if (m(r)) Object.assign(r, op.set); });
  }

  // Firestore REST: one document per tab at h/<household>/tabs/<Tab>, rows stored as a JSON string.
  // The household id is the secret; Firestore rules only open that one path.
  const FS = () => `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(state.cfg.p)}/databases/(default)/documents/h/${encodeURIComponent(state.cfg.h)}/tabs`;
  const tabName = (doc) => decodeURIComponent(doc.name.split('/').pop());
  const rowsOf = (doc) => { try { return JSON.parse((doc.fields && doc.fields.rows && doc.fields.rows.stringValue) || '[]'); } catch (e) { return []; } };

  async function fetchAll() {
    const out = {}; let token = '';
    do {
      const res = await fetch(`${FS()}?pageSize=100${token ? '&pageToken=' + encodeURIComponent(token) : ''}`);
      if (!res.ok) throw new Error('read ' + res.status);
      const j = await res.json();
      (j.documents || []).forEach((doc) => { out[tabName(doc)] = rowsOf(doc); });
      token = j.nextPageToken || '';
    } while (token);
    return out;
  }

  async function fetchTab(tab) {
    const res = await fetch(`${FS()}/${encodeURIComponent(tab)}`);
    if (res.status === 404) return { rows: [], time: null };
    if (!res.ok) throw new Error('read ' + res.status);
    const doc = await res.json();
    return { rows: rowsOf(doc), time: doc.updateTime };
  }

  // Write a whole tab, but only if nobody changed it since we read it (else the caller retries).
  async function putTab(tab, rows, time) {
    const pre = time ? `currentDocument.updateTime=${encodeURIComponent(time)}` : 'currentDocument.exists=false';
    const res = await fetch(`${FS()}/${encodeURIComponent(tab)}?${pre}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { rows: { stringValue: JSON.stringify(rows) } } }),
    });
    if (res.ok) return true;
    if ([400, 404, 409, 412].includes(res.status)) return false;
    throw new Error('write ' + res.status);
  }

  // Apply ops to the server copy of each tab: read, change, write with precondition, retry on conflict.
  async function pushOps(ops) {
    const tabs = [...new Set(ops.map((o) => o.tab))];
    for (const tab of tabs) {
      const mine = ops.filter((o) => o.tab === tab);
      for (let attempt = 0; ; attempt++) {
        const cur = await fetchTab(tab);
        const tmp = { [tab]: cur.rows };
        mine.forEach((o) => applyTo(tmp, o));
        if (await putTab(tab, tmp[tab], cur.time)) { state.data[tab] = tmp[tab]; break; }
        if (attempt >= 4) throw new Error('conflict');
      }
    }
  }

  let saving = Promise.resolve();
  function save(ops) {
    ops.forEach(applyLocal);
    LS.set('sm.data', state.data);
    render();
    if (!state.cfg) return;
    saving = saving.then(async () => {
      try {
        await pushOps(ops);
        LS.set('sm.data', state.data);
        state.error = '';
      } catch (e) {
        state.error = 'Speichern hat nicht geklappt. Bitte später neu laden.';
        toast(state.error);
      }
      render();
    });
  }

  async function load(quiet) {
    if (!state.cfg) {
      if (!state.data) { state.data = await seedData(); }
      render();
      return;
    }
    state.syncing = true;
    if (!quiet) render();
    try {
      await saving;
      let data = await fetchAll();
      if (!data.Rezepte) {
        const seed = await (await fetch('seed.json')).json();
        for (const t of seed) { if (!data[t.tab]) { await putTab(t.tab, t.rows, null); data[t.tab] = t.rows; } }
        toast('Daten eingerichtet');
      }
      state.data = data;
      LS.set('sm.data', data);
      state.error = '';
    } catch (e) {
      state.error = 'Keine Verbindung. Zeige den letzten Stand.';
      if (!state.data) state.data = await seedData();
    }
    state.syncing = false;
    render();
  }

  async function seedData() {
    try {
      const seed = await (await fetch('seed.json')).json();
      const d = {};
      seed.forEach((t) => { d[t.tab] = t.rows; });
      return d;
    } catch (e) { return {}; }
  }

  // ---------- shopping list generation ----------
  function roundQty(q, unit) {
    if (/^(g|ml)$/i.test(unit)) return Math.ceil(q / 50) * 50;
    if (/^kg$/i.test(unit)) return Math.ceil(q * 2) / 2;
    return Math.ceil(q - 0.01);
  }
  function generateList(ws) {
    const from = ws, to = addDays(ws, 6);
    const plan = T('Plan').filter((p) => p.date >= from && p.date <= to);
    const staple = (name) => T('Vorrat').find((v) => v.item.toLowerCase() === name.toLowerCase());
    const agg = new Map();
    plan.forEach((p) => {
      const r = recipe(p.recipe_id);
      if (!r) return;
      const f = num(p.servings || r.servings) / (num(r.servings) || 1);
      T('Zutaten').filter((z) => z.recipe_id === r.id).forEach((z) => {
        const s = staple(z.item);
        if (s && yes(s.always_have) && !yes(s.running_low)) return;
        const k = z.item.toLowerCase() + '|' + z.unit;
        const cur = agg.get(k) || { item: z.item, unit: z.unit, section: z.section || 'Sonstiges', qty: 0 };
        cur.qty += num(z.qty) * f;
        agg.set(k, cur);
      });
    });
    const rows = [...agg.values()].map((a, i) => ({ id: `p${ws.replace(/-/g, '')}${i}`, item: a.item, qty: String(roundQty(a.qty, a.unit)).replace('.', ','), unit: a.unit, section: a.section, source: 'plan', checked: 'nein', week: ws }));
    const low = T('Vorrat').filter((v) => yes(v.running_low) && !rows.some((r) => r.item.toLowerCase() === v.item.toLowerCase()))
      .map((v, i) => ({ id: `v${ws.replace(/-/g, '')}${i}`, item: v.item, qty: '', unit: '', section: v.section || 'Sonstiges', source: 'vorrat', checked: 'nein', week: ws }));
    return rows.concat(low);
  }

  // ---------- ui bits ----------
  const C = (cls) => 'c-' + String(cls).replace(/^b-/, '');
  const BAR = (cls) => 'bar-' + String(cls).replace(/^b-/, '');
  const SECTION_COLOR = { 'Obst und Gemüse': 'c-new', 'Kühlregal': 'c-prep', 'Fleisch und Fisch': 'c-warm', 'Trockenes und Brot': 'c-abendbrot', 'Tiefkühl': 'c-bites', 'Sonstiges': 'c-wish' };
  const CHECK = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>';
  const rise = (i) => ` rise" style="--i:${i}`;

  let toastTimer;
  function toast(msg) {
    let el = document.querySelector('.toast');
    if (el) el.remove();
    el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el);
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2600);
  }

  function nav(active) {
    const items = [['woche', 'Woche', I.week], ['lieber', 'Lieber?', I.choose], ['einkauf', 'Einkauf', I.cart], ['rezepte', 'Rezepte', I.book]];
    const idx = Math.max(0, items.findIndex(([k]) => k === active));
    return `<nav class="tabs" aria-label="Hauptnavigation"><span class="bubble" style="transform:translateX(${idx * 100}%)"></span>${items.map(([k, l, ic]) => `<a href="#/${k}"${active === k ? ' aria-current="page"' : ''}>${ic}${l}</a>`).join('')}</nav>`;
  }

  function weekSwitch() {
    const ws = curWeek();
    return `<div class="top-row"><button class="round" data-act="week" data-d="-1" aria-label="Vorherige Woche">${I.left}</button>
      <span class="eyebrow">${fmt(ws)} – ${fmt(addDays(ws, 6))}</span>
      <button class="round" data-act="week" data-d="1" aria-label="Nächste Woche">${I.right}</button></div>`;
  }

  function banner() {
    if (state.error) return `<p class="notice" style="background:var(--wish);color:var(--ink)">${esc(state.error)}</p>`;
    if (!state.cfg) return `<p class="notice">Vorschau mit Beispieldaten. Änderungen bleiben auf diesem Gerät, bis die App verbunden ist.</p>`;
    return '';
  }

  // ---------- week ----------
  function dayInfo(date) {
    const rows = T('Plan').filter((p) => p.date === date && p.slot !== 'bite');
    const main = rows.find((p) => p.slot === 'main');
    const eve = rows.find((p) => p.slot === 'abendbrot');
    const row = main || eve;
    const r = row && recipe(row.recipe_id);
    const cls = r ? mealClass(row, r) : 'b-empty';
    return { date, row, r, cls, eve: main && eve ? recipe(eve.recipe_id) : null, label: r ? mealLabel(row, r) : 'noch offen' };
  }

  function selDay() {
    const ws = curWeek();
    if (!state.sel || state.sel < ws || state.sel > addDays(ws, 6)) {
      const t = today();
      state.sel = t >= ws && t <= addDays(ws, 6) ? t : ws;
    }
    return state.sel;
  }

  function stageInner(d) {
    return `<div class="inner">
      <span class="eyebrow">${dayLong(d.date)}, ${fmt(d.date)} · ${esc(d.label)}</span>
      <span class="dish">${d.r ? esc(d.r.name) : 'Noch nichts geplant'}</span>
      ${d.eve ? `<span class="evening">Abends: ${esc(d.eve.name)}</span>` : ''}
      <div class="actions">${d.r ? `<a class="btn white" href="#/rezept/${d.r.id}">Rezept</a>` : ''}<a class="btn ${d.r ? 'ghost' : 'ink'}" href="#/tag/${d.date}">${d.r ? 'Ändern' : 'Planen'}</a></div>
    </div>`;
  }
  function blobStyle(i) { return [`transform:translateX(${-60 + i * 38}px) scale(${1 + (i % 3) * 0.12})`, `transform:translate(${300 - i * 34}px, ${24 + (i % 2) * 30}px)`]; }

  function vWoche() {
    const ws = curWeek();
    const sel = selDay();
    const idx = Math.round((parse(sel) - parse(ws)) / 864e5);
    const days = Array.from({ length: 7 }, (_, i) => dayInfo(addDays(ws, i)));
    const d = days[idx];
    const [b1, b2] = blobStyle(idx);
    const prep = ws;
    const prepRows = T('Plan').filter((p) => p.cook_on === prep || (p.slot === 'bite' && p.date === prep));
    const prepNames = [...new Set(prepRows.map((p) => recipe(p.recipe_id)).filter(Boolean).map((r) => r.name))];
    const fridge = T('Fertig').filter((f) => num(f.portions_left) > 0);
    return `${banner()}
      <header class="top">
        ${weekSwitch()}
        <h1 class="rise" style="--i:0">${state.weekOffset === 0 ? 'Diese<br>Woche' : state.weekOffset === 1 ? 'Nächste<br>Woche' : 'Woche<br>' + fmt(ws)}</h1>
      </header>
      <div class="days" role="group" aria-label="Tag wählen">${days.map((x, i) => `<button class="day${x.date === today() ? ' today' : ''}${rise(i + 1)}" data-act="sel" data-date="${x.date}" aria-pressed="${x.date === sel}"><span>${dayShort(x.date)}</span><b>${parse(x.date).getDate()}</b><i class="${BAR(x.cls)}"></i></button>`).join('')}</div>
      <section class="field stage ${C(d.cls)}" id="stage" aria-live="polite">
        <span class="blob" style="${b1}"></span><span class="blob2" style="${b2}"></span>
        ${stageInner(d)}
      </section>
      <a class="field prepband c-brand" href="${prepNames.length ? '#/vorkochen/' + prep : '#/woche'}"><span><b>${prepNames.length ? `${esc(setting('prep_day', 'Mittwoch'))}, ${fmt(prep)}: vorkochen` : 'Noch kein Vorkochen geplant'}</b><small>${prepNames.length ? esc(prepNames.join(' · ')) : 'Sag Claude „Plan die Woche“'}</small></span>${prepNames.length ? I.next : ''}</a>
      <div class="section-title"><h2>Die ganze Woche</h2><span class="small muted">${canSwap() ? 'wischen = tauschen' : 'antippen'}</span></div>
      <div class="rows">${days.map((x, i) => `<button class="rowi${x.date === sel ? ' sel' : ''}${rise(i)}" data-act="sel" data-date="${x.date}" data-scroll="1"${canSwap() ? ` data-swipe="1" data-slot="${x.row ? x.row.slot : 'main'}"` : ''}><span class="k">${dayShort(x.date)}</span><span class="mv"><span class="v"><b>${x.r ? esc(x.r.name) : 'Noch offen'}</b><small>${esc(x.label)}${x.eve ? ' · abends ' + esc(x.eve.name) : ''}</small></span><span class="bar ${BAR(x.cls)}"></span></span></button>`).join('')}</div>
      <a class="field c-bites" href="#/kuehlschrank" style="display:block;text-decoration:none;margin-top:24px;padding:22px 20px">
        <span class="eyebrow">Im Kühlschrank</span>
        <div style="display:flex;gap:22px;flex-wrap:wrap;margin-top:8px">${fridge.length ? fridge.slice(0, 4).map((f) => `<div><b class="disp" style="font-size:40px;line-height:40px;font-weight:800">${num(f.portions_left)}</b><div class="small" style="font-weight:700">${esc(f.item)}</div></div>`).join('') : '<b class="disp" style="font-size:28px">Gerade leer</b>'}</div>
      </a>
      <div style="text-align:center;padding-top:12px"><a class="link" href="#/einstellungen">${state.person ? esc(state.person) + ' · ' : ''}Einstellungen</a></div>
      ${nav('woche')}`;
  }

  function patchStage(date, dir) {
    const ws = curWeek();
    state.sel = date;
    const stage = document.getElementById('stage');
    if (!stage) { render(); return; }
    const i = Math.round((parse(date) - parse(ws)) / 864e5);
    const d = dayInfo(date);
    stage.className = `field stage ${C(d.cls)} ${dir < 0 ? 'slide-r' : 'slide-l'}`;
    stage.querySelector('.inner').outerHTML = stageInner(d);
    const [b1, b2] = blobStyle(i);
    stage.querySelector('.blob').setAttribute('style', b1);
    stage.querySelector('.blob2').setAttribute('style', b2);
    document.querySelectorAll('.day').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.date === date)));
    document.querySelectorAll('.rowi').forEach((b) => b.classList.toggle('sel', b.dataset.date === date));
  }

  function vVorkochen(prep) {
    const rows = T('Plan').filter((p) => p.cook_on === prep || (p.slot === 'bite' && p.date === prep));
    const ids = [...new Set(rows.map((p) => p.recipe_id))];
    const list = ids.map(recipe).filter(Boolean);
    const total = list.reduce((s, r) => s + num(r.active_min), 0);
    return `<section class="field c-brand rhero">
        <a class="back" href="#/woche">${I.left} Woche</a>
        <div><span class="eyebrow">${dayLong(prep)}, ${fmt(prep)}</span><h1>Vorkochen</h1></div>
        <div class="facts"><div><b>${list.length}</b><span>Gerichte</span></div><div><b>${total}</b><span>Min aktiv</span></div></div>
      </section>
      <div class="rows">${list.map((r, i) => { const row = rows.find((p) => p.recipe_id === r.id); return `<a class="rowi${rise(i)}" href="#/rezept/${r.id}"><span class="v"><b>${esc(r.name)}</b><small>${esc(r.prep_tips || mealLabel(row, r))}</small>${r.kid_task ? `<small>Lust zu helfen? ${esc(r.kid_task)}</small>` : ''}</span><span class="bar ${BAR(mealClass(row, r))}"></span></a>`; }).join('') || '<p class="empty-note">Nichts geplant.</p>'}</div>
      ${nav('woche')}`;
  }

  function vTag(date) {
    const slots = [['main', 'Hauptgericht'], ['abendbrot', 'Abendbrot']];
    return slots.map(([slot, label], k) => {
      const row = T('Plan').find((p) => p.date === date && p.slot === slot);
      const r = row && recipe(row.recipe_id);
      const head = k === 0 ? `<a class="back" href="#/woche">${I.left} Woche</a>` : '';
      if (!r) return `<section class="field c-empty rhero" style="min-height:${k ? 200 : 260}px">${head}<div><span class="eyebrow">${dayLong(date)}, ${fmt(date)} · ${label}</span><h2 style="font-size:34px;line-height:36px;margin-top:6px">Noch offen</h2></div><div><a class="btn ink" href="#/waehlen/${date}/${slot}">Rezept wählen</a></div></section>`;
      const cls = mealClass(row, r);
      return `<section class="field ${C(cls)} rhero" style="min-height:${k ? 200 : 300}px">${head}
        <div><span class="eyebrow">${dayLong(date)}, ${fmt(date)} · ${label}</span><h2 style="font-size:38px;line-height:38px;margin-top:6px">${esc(r.name)}</h2><p style="margin-top:6px;font-weight:600">${esc(mealLabel(row, r))}${row.cook_on && row.cook_on !== date ? ' am ' + fmt(row.cook_on) : ''}</p></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn white" href="#/rezept/${r.id}">Rezept</a><a class="btn ghost" href="#/waehlen/${date}/${slot}">Ändern</a><button class="link" data-act="unplan" data-date="${date}" data-slot="${slot}">Entfernen</button></div>
      </section>`;
    }).join('') + nav('woche');
  }

  function vWaehlen(date, slot) {
    const order = slot === 'abendbrot' ? ['abendbrot', 'main', 'bite'] : slot === 'bite' ? ['bite', 'main', 'abendbrot'] : ['main', 'abendbrot', 'bite'];
    let n = 0;
    const groups = order.map((c) => {
      const rs = T('Rezepte').filter((r) => (r.category || 'main') === c).sort((a, b) => a.name.localeCompare(b.name, 'de'));
      if (!rs.length) return '';
      return `<div class="section-title"><h2>${{ main: 'Hauptgerichte', abendbrot: 'Abendbrot', bite: 'Für den Kühlschrank' }[c]}</h2></div><div class="rows">
        ${rs.map((r) => `<button class="rowi${rise(n++)}" data-act="plan" data-date="${date}" data-slot="${slot}" data-id="${r.id}"><span class="v"><b>${esc(r.name)}</b><small>${esc(r.total_min)} Min · ${esc(mealLabel(null, r))}</small></span><span class="bar ${BAR(mealClass(null, r))}"></span></button>`).join('')}</div>`;
    }).join('');
    return `<header class="top"><a class="back" href="#/tag/${date}">${I.left} Zurück</a><span class="eyebrow">${dayLong(date)}, ${fmt(date)}</span><h1>${slot === 'abendbrot' ? 'Abendbrot' : 'Was gibt’s?'}</h1></header>${groups}${nav('woche')}`;
  }

  // ---------- lieber ----------
  function vWer() {
    const people = T('Familie').map((f) => f.person).filter(Boolean);
    const cols = ['c-prep', 'c-abendbrot', 'c-wish', 'c-new', 'c-bites', 'c-warm'];
    return `<header class="top"><h1>Wer<br>bist du?</h1><p class="muted">Einmal antippen, die App merkt es sich auf diesem Handy.</p></header>
      ${people.map((p, i) => `<button class="field ${cols[i % 6]} half${rise(i)}" style="width:100%;min-height:120px" data-act="person" data-p="${esc(p)}"><span class="t">${esc(p)}</span></button>`).join('')}
      <p class="small muted" style="padding:16px 20px">Namen ändern: einfach Claude im Chat fragen.</p>${nav('lieber')}`;
  }

  function lieberWeek() {
    const ws = weekStart(today());
    const weeks = [...new Set(T('Fragen').map((q) => q.week))].filter((w) => w >= ws).sort();
    return weeks[0] || addDays(ws, 7);
  }

  function vLieber() {
    if (!state.person) return vWer();
    const week = lieberWeek();
    const qs = T('Fragen').filter((q) => q.week === week);
    const answered = (q) => T('Antworten').some((a) => a.question_id === q.id && a.person === state.person);
    const open = qs.filter((q) => !answered(q));
    const q = open[0];
    const saved = T('Lust').find((l) => l.week === week && l.person === state.person);
    if (!state.cravings || state.cravings.week !== week || state.cravings.person !== state.person) {
      state.cravings = { week, person: state.person, chips: saved ? saved.chips.split(',').map((s) => s.trim()).filter(Boolean) : [], note: saved ? saved.note : '' };
    }
    const c = state.cravings;
    const progress = `<div class="progress" aria-label="${qs.length - open.length} von ${qs.length} beantwortet">${qs.map((x) => `<i class="${answered(x) ? 'on' : ''}"></i>`).join('')}</div>`;
    let main;
    if (q) {
      const a = recipe(q.option_a), b = recipe(q.option_b);
      const when = q.for_date === 'bites' ? 'für den Kühlschrank' : `für ${dayLong(q.for_date)}`;
      const meta = (r) => r ? `${esc(r.total_min)} Min${r.category === 'bite' ? ' · zum Mitnehmen' : ''}` : '';
      main = `<header class="top"><div class="top-row"><a class="link" href="#/wer">${esc(state.person)}</a><span class="eyebrow">${when}</span></div>${progress}<h1 class="rise" style="--i:0;margin-top:8px">Was hättest du lieber?</h1></header>
        <div class="split" id="split">
          <button class="field half c-warm" data-act="answer" data-q="${q.id}" data-c="a"><span class="t">${esc(a ? a.name : q.option_a)}</span><span class="m">${meta(a)}</span></button>
          <span class="or" aria-hidden="true">oder</span>
          <button class="field half c-new" data-act="answer" data-q="${q.id}" data-c="b"><span class="t">${esc(b ? b.name : q.option_b)}</span><span class="m">${meta(b)}</span></button>
        </div>`;
    } else {
      main = `<header class="top"><div class="top-row"><a class="link" href="#/wer">${esc(state.person)}</a></div>${progress}<h1 class="rise" style="--i:0;margin-top:8px">Danke!</h1><p class="muted">${qs.length ? 'Alles beantwortet. Claude plant damit die Woche.' : 'Gerade keine Fragen. Neue kommen, wenn die nächste Woche geplant wird.'}</p></header>`;
    }
    return `${banner()}${main}
      <section class="field c-wish" style="margin-top:22px;padding:22px 0 8px">
        <div class="pad"><h2>Worauf hast du Lust?</h2><p class="small" style="font-weight:600;margin:4px 0 12px">Woche ab ${fmt(week)} · wird sofort gespeichert</p></div>
        <div class="chips wrap">${CHIPS.map((ch) => `<button class="chip" aria-pressed="${c.chips.includes(ch)}" data-act="chip" data-ch="${esc(ch)}">${esc(ch)}</button>`).join('')}</div>
        <div class="pad" style="padding-bottom:16px"><input class="note" id="lustnote" placeholder="Sonst noch ein Wunsch?" value="${esc(c.note)}" aria-label="Sonst noch ein Wunsch?"></div>
      </section>
      ${nav('lieber')}`;
  }

  function saveLust() {
    const c = state.cravings; const n = document.getElementById('lustnote'); if (n) c.note = n.value;
    save([{ op: 'replace', tab: 'Lust', match: { week: c.week, person: c.person }, rows: [{ week: c.week, person: c.person, chips: c.chips.join(', '), note: c.note, at: new Date().toISOString() }] }], true);
  }

  // ---------- shopping ----------
  function vEinkauf() {
    const ws = curWeek();
    const items = T('Einkauf').filter((e) => e.week === ws);
    const hasPlan = items.some((e) => e.source === 'plan');
    const open = items.filter((i) => !yes(i.checked));
    const done = items.filter((i) => yes(i.checked));
    const secs = SECTIONS.concat([...new Set(open.map((i) => i.section))].filter((s) => !SECTIONS.includes(s)));
    const row = (i) => `<label class="item${yes(i.checked) ? ' done' : ''}"><input type="checkbox" data-act="tick" data-id="${esc(i.id)}"${yes(i.checked) ? ' checked' : ''}><span class="box">${CHECK}</span><span class="name">${esc(i.item)}</span><span class="q">${esc([i.qty, i.unit].filter(Boolean).join(' '))}</span></label>`;
    const groups = secs.map((sec) => {
      const its = open.filter((i) => (i.section || 'Sonstiges') === sec);
      if (!its.length) return '';
      return `<section><div class="field shead ${SECTION_COLOR[sec] || 'c-empty'}">${esc(sec)}<small>${its.length}</small></div>${its.map(row).join('')}</section>`;
    }).join('');
    const pct = items.length ? Math.round((done.length / items.length) * 100) : 0;
    return `${banner()}<header class="top">${weekSwitch()}<h1 class="rise" style="--i:0">Einkauf</h1><p class="muted">${items.length ? (open.length ? `noch ${open.length} von ${items.length}` : 'Alles im Korb!') : 'Noch keine Liste für diese Woche'}</p></header>
      ${items.length ? `<div class="meter" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>` : ''}
      ${hasPlan ? '' : `<section class="field c-brand rhero" style="min-height:200px;margin-top:14px"><div><h2 style="font-size:32px;line-height:34px">Liste aus dem Plan</h2><p style="margin-top:6px">Alles für die Woche und den Vorkochtag, ohne das, was im Vorrat ist.</p></div><div><button class="btn white" data-act="gen">Erstellen</button></div></section>`}
      <form class="addrow" data-act="add"><input class="input" id="additem" placeholder="Noch etwas dazu, z. B. Kaffee" autocomplete="off" aria-label="Artikel hinzufügen"><button class="round fill" type="submit" aria-label="Hinzufügen" style="background:var(--text);color:var(--ground)">${I.plus}</button></form>
      ${groups}
      ${done.length ? `<details style="margin-top:8px"><summary class="section-title" style="cursor:pointer;list-style:none"><h2>Im Korb</h2><span class="small muted">${done.length} · anzeigen</span></summary>${done.map(row).join('')}</details>` : ''}
      ${hasPlan ? `<div style="text-align:center;padding-top:12px"><button class="link" data-act="gen">Aus dem Plan neu erstellen</button></div>` : ''}
      <div class="section-title"><h2>Vorrat fast leer?</h2></div>
      <p class="small muted pad" style="margin-bottom:10px">Antippen, dann kommt es auf die nächste Liste.</p>
      <div class="chips plain wrap">${T('Vorrat').map((s) => `<button class="chip" aria-pressed="${yes(s.running_low)}" data-act="low" data-item="${esc(s.item)}">${esc(s.item)}</button>`).join('')}</div>
      ${open.length ? `<button class="btn brand fab" data-act="copy">Kopieren für WhatsApp</button>` : ''}
      ${nav('einkauf')}`;
  }

  // ---------- recipes ----------
  const FILTERS = [['', 'Alle'], ['main', 'Hauptgerichte'], ['abendbrot', 'Abendbrot'], ['bite', 'Kühlschrank'], ['vegetarisch', 'vegetarisch'], ['schnell', 'schnell'], ['vorkochen', 'vorkochen']];
  function recipeRows() {
    const q = state.search.toLowerCase();
    const f = state.filter || '';
    const rs = T('Rezepte').filter((r) => {
      if (f && !(r.category === f || tags(r).includes(f))) return false;
      return !q || r.name.toLowerCase().includes(q) || String(r.tags).toLowerCase().includes(q);
    }).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    return rs.map((r, i) => `<a class="rowi${rise(Math.min(i, 12))}" href="#/rezept/${r.id}"><span class="v"><b class="disp" style="font-size:22px;line-height:26px;font-weight:800">${esc(r.name)}</b><small>${esc(r.total_min)} Min · hält ${esc(r.keeps_days)} Tage${yes(r.freezable) ? ' · einfrierbar' : ''}</small></span><span class="bar ${BAR(mealClass(null, r))}"></span></a>`).join('') || '<p class="empty-note">Nichts gefunden.</p>';
  }
  function vRezepte() {
    return `${banner()}<header class="top"><h1 class="rise" style="--i:0">Rezepte</h1><p class="muted">${T('Rezepte').length} Rezepte · neue per Link an Claude, auch von NYT Cooking</p></header>
      <div class="addrow" style="padding-top:0"><input class="input" id="search" type="search" placeholder="Suchen, z. B. Linsen" value="${esc(state.search)}" aria-label="Rezepte suchen"></div>
      <div class="chips plain">${FILTERS.map(([k, l]) => `<button class="chip" aria-pressed="${(state.filter || '') === k}" data-act="filter" data-f="${k}">${l}</button>`).join('')}</div>
      <div class="rows" id="rlist">${recipeRows()}</div>
      ${nav('rezepte')}`;
  }

  function vRezept(id) {
    const r = recipe(id);
    if (!r) return `<header class="top"><h1>Nicht gefunden</h1></header>${nav('rezepte')}`;
    const ing = T('Zutaten').filter((z) => z.recipe_id === id);
    const steps = String(r.steps || '').split(/(?<=\.)\s+(?=[A-ZÄÖÜ])/).filter(Boolean);
    const isBite = r.category === 'bite';
    const cls = mealClass(null, r);
    return `<section class="field ${C(cls)} rhero">
        <a class="back" href="javascript:history.back()">${I.left} Zurück</a>
        <div><span class="eyebrow">${esc([mealLabel(null, r), r.source && r.source !== 'Claude' ? 'aus ' + r.source : ''].filter(Boolean).join(' · '))}</span><h1 class="rise" style="--i:0;margin-top:6px">${esc(r.name)}</h1></div>
        <div class="facts">
          <div><b>${esc(r.total_min || '?')}</b><span>Minuten</span></div>
          <div><b>${esc(r.servings || '?')}</b><span>${isBite ? 'Stück' : 'Portionen'}</span></div>
          <div><b>${esc(r.keeps_days || '?')}</b><span>Tage haltbar</span></div>
          <div><b>${yes(r.freezable) ? 'Ja' : 'Nein'}</b><span>einfrierbar</span></div>
        </div>
      </section>
      ${r.kid_task ? `<div style="display:flex"><div class="sticker field c-wish"><span class="eyebrow">Lust zu helfen?</span><p style="font-weight:600;margin-top:4px">${esc(r.kid_task)}</p></div></div>` : ''}
      <div class="prose"><h2 style="margin-top:14px">Zutaten</h2><ul>${ing.map((z) => `<li><b>${esc([z.qty, z.unit === 'Stück' ? '' : z.unit].filter(Boolean).join(' '))}</b><span>${esc(z.item)}</span></li>`).join('')}</ul>
        ${r.prep_tips ? `<p class="muted"><b>Vorkochen:</b> ${esc(r.prep_tips)}</p>` : ''}</div>
      ${steps.length ? `<div class="prose"><h2 style="margin-top:14px">So geht’s</h2><ol class="steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>` : ''}
      ${r.source_url ? `<p class="small" style="text-align:center"><a href="${esc(r.source_url)}" target="_blank" rel="noopener">Original ansehen</a></p>` : ''}
      ${isBite
        ? `<div class="fab" style="display:flex;gap:8px;box-shadow:none"><button class="btn ink" data-act="made" data-id="${r.id}" data-place="Gefrierfach">Gefrierfach</button><button class="btn brand" data-act="made" data-id="${r.id}" data-place="Kühlschrank">In den Kühlschrank</button></div>`
        : `<a class="btn brand fab" href="#/planen/${r.id}">Einplanen</a>`}
      ${nav('rezepte')}`;
  }

  function vPlanen(id) {
    const r = recipe(id);
    const start = today();
    const isAb = r && r.category === 'abendbrot';
    const days = Array.from({ length: 14 }, (_, i) => addDays(start, i));
    return `<header class="top"><a class="back" href="#/rezept/${id}">${I.left} Zurück</a><span class="eyebrow">${esc(r ? r.name : '')}</span><h1>Wann?</h1></header>
      <div class="days" style="flex-wrap:wrap">${days.map((d, i) => `<button class="day${rise(i)}" data-act="plan" data-date="${d}" data-slot="${isAb ? 'abendbrot' : 'main'}" data-id="${id}"><span>${dayShort(d)}</span><b>${parse(d).getDate()}</b><i class="${BAR(dayInfo(d).cls)}"></i></button>`).join('')}</div>
      <p class="small muted pad">Ein Tag antippen, dann ist ${esc(r ? r.name : 'es')} als ${isAb ? 'Abendbrot' : 'Hauptgericht'} geplant. Ein vorhandenes Gericht wird ersetzt.</p>
      ${nav('rezepte')}`;
  }

  // ---------- fridge ----------
  function vKuehlschrank() {
    const items = T('Fertig').filter((f) => num(f.portions_left) > 0).sort((a, b) => String(a.keeps_until).localeCompare(String(b.keeps_until)));
    const t = today();
    const bites = T('Rezepte').filter((r) => r.category === 'bite');
    return `<section class="field c-bites rhero" style="min-height:240px"><a class="back" href="#/woche">${I.left} Woche</a><div><span class="eyebrow">Schnelle Mittage</span><h1>Im Kühl&shy;schrank</h1></div></section>
      ${items.map((f, i) => { const old = f.keeps_until && f.keeps_until < t; return `<div class="stock${rise(i)}"><span class="n" id="n-${esc(f.id)}">${num(f.portions_left)}</span><div class="v"><b>${esc(f.item)}</b><span class="small muted">${esc(f.place || 'Kühlschrank')}${f.keeps_until ? ` · ${old ? 'Haltbarkeit vorbei seit' : 'gut bis'} ${fmt(f.keeps_until)}` : ''}</span><button class="link small" style="align-self:flex-start;padding:2px 0" data-act="empty" data-id="${esc(f.id)}">ist leer</button></div><button class="btn ink" data-act="take" data-id="${esc(f.id)}">−1</button></div>`; }).join('') || '<p class="empty-note">Gerade nichts vorrätig.</p>'}
      <div class="section-title"><h2>Frisch gemacht?</h2></div>
      <div class="rows">${bites.map((r) => `<a class="rowi" href="#/rezept/${r.id}"><span class="v"><b>${esc(r.name)}</b><small>Rezept öffnen und eintragen</small></span><span class="bar bar-bites"></span></a>`).join('')}</div>
      ${nav('woche')}`;
  }

  function vEinstellungen() {
    return `<header class="top"><a class="back" href="#/woche">${I.left} Woche</a><h1>Einstel&shy;lungen</h1></header>
      <div class="prose"><h2>Ich bin</h2><p>${state.person ? esc(state.person) : 'Noch nicht gewählt'}</p><div><a class="btn ghost" href="#/wer">Person wechseln</a></div></div>
      <div class="prose" style="margin-top:14px"><h2>Verbindung</h2><p>${state.cfg ? 'Verbunden. Alle Handys der Familie sehen dieselben Daten.' : 'Nicht verbunden: die App zeigt Beispieldaten. Öffne den Einrichtungslink, um sie zu verbinden.'}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${state.cfg ? '<button class="btn ghost" data-act="reload">Neu laden</button><button class="link" data-act="disconnect">Verbindung trennen</button>' : ''}</div></div>
      <p class="small muted pad" style="margin-top:24px">Sartor Meals · Farben aus Montage (Wanted Lab, MIT) · Schriften Bricolage Grotesque und Figtree</p>
      ${nav('woche')}`;
  }

  // ---------- router ----------
  function route() {
    const h = location.hash.replace(/^#\/?/, '');
    const [view, a, b] = h.split('/');
    switch (view) {
      case 'lieber': return vLieber();
      case 'wer': return vWer();
      case 'einkauf': return vEinkauf();
      case 'rezepte': return vRezepte();
      case 'rezept': return vRezept(a);
      case 'planen': return vPlanen(a);
      case 'tag': return vTag(a);
      case 'waehlen': return vWaehlen(a, b);
      case 'vorkochen': return vVorkochen(a);
      case 'kuehlschrank': return vKuehlschrank();
      case 'einstellungen': return vEinstellungen();
      default: return vWoche();
    }
  }

  const root = document.getElementById('app');
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let animTimer;
  function render(animate) {
    if (!state.data) { root.innerHTML = '<header class="top"><h1>Lädt…</h1></header>'; return; }
    const focusId = document.activeElement && document.activeElement.id;
    const caret = focusId && document.activeElement.selectionStart;
    if (animate) { root.classList.add('anim'); clearTimeout(animTimer); animTimer = setTimeout(() => root.classList.remove('anim'), 1200); }
    root.innerHTML = route();
    if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch (e) { /* not text */ } } }
  }
  function go() {
    const run = () => { render(true); window.scrollTo(0, 0); };
    if (document.startViewTransition && !reduced()) document.startViewTransition(run); else run();
  }

  // ---------- actions ----------
  const act = {
    week(el) { state.weekOffset += Number(el.dataset.d); state.sel = null; go(); },
    sel(el) {
      const cur = state.sel || selDay();
      const date = el.dataset.date;
      patchStage(date, date < cur ? -1 : 1);
      if (el.dataset.scroll) document.getElementById('stage').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
    },
    person(el) { state.person = el.dataset.p; LS.set('sm.person', state.person); state.cravings = null; if (location.hash === '#/lieber') go(); else location.hash = '#/lieber'; },
    answer(el) {
      const split = document.getElementById('split');
      const ops = [{ op: 'append', tab: 'Antworten', rows: [{ question_id: el.dataset.q, person: state.person, choice: el.dataset.c, at: new Date().toISOString() }] }];
      if (split && el.dataset.c !== 'egal' && !reduced()) {
        split.classList.add('done');
        split.querySelectorAll('.half').forEach((h) => h.classList.add(h === el ? 'won' : 'lost'));
        setTimeout(() => { save(ops, true); go(); }, 700);
      } else { save(ops, true); go(); }
    },
    chip(el) {
      const c = state.cravings; const ch = el.dataset.ch;
      c.chips = c.chips.includes(ch) ? c.chips.filter((x) => x !== ch) : c.chips.concat(ch);
      el.setAttribute('aria-pressed', String(c.chips.includes(ch)));
      clearTimeout(act._lt); act._lt = setTimeout(saveLust, 900);
    },
    gen() {
      const ws = curWeek(); const list = generateList(ws);
      save([{ op: 'replace', tab: 'Einkauf', match: { week: ws, source: 'plan' }, rows: list.filter((r) => r.source === 'plan') },
        { op: 'replace', tab: 'Einkauf', match: { week: ws, source: 'vorrat' }, rows: list.filter((r) => r.source === 'vorrat') }]);
      root.classList.add('anim'); setTimeout(() => root.classList.remove('anim'), 1200);
      toast('Liste erstellt');
    },
    tick(el) {
      const it = T('Einkauf').find((e) => e.id === el.dataset.id);
      const ops = [{ op: 'update', tab: 'Einkauf', match: { id: el.dataset.id }, set: { checked: el.checked ? 'ja' : 'nein' } }];
      const st = it && T('Vorrat').find((v) => v.item.toLowerCase() === it.item.toLowerCase() && yes(v.running_low));
      if (el.checked && st) ops.push({ op: 'update', tab: 'Vorrat', match: { item: st.item }, set: { running_low: 'nein' } });
      const lab = el.closest('.item'); if (lab) lab.classList.toggle('done', el.checked);
      setTimeout(() => save(ops), reduced() ? 0 : 450);
    },
    add(el, ev) {
      ev.preventDefault();
      const inp = document.getElementById('additem'); const v = inp.value.trim(); if (!v) return;
      inp.value = '';
      save([{ op: 'append', tab: 'Einkauf', rows: [{ id: uid('m'), item: v, qty: '', unit: '', section: 'Sonstiges', source: 'manual', checked: 'nein', week: curWeek() }] }]);
    },
    async copy() {
      const ws = curWeek();
      const items = T('Einkauf').filter((e) => e.week === ws && !yes(e.checked));
      const order = (s) => { const i = SECTIONS.indexOf(s); return i === -1 ? 99 : i; };
      const text = items.sort((a, b) => order(a.section) - order(b.section)).map((i) => [i.item, [i.qty, i.unit].filter(Boolean).join(' ')].filter(Boolean).join(' ')).join('\n');
      try { await navigator.clipboard.writeText(text); toast('Kopiert. Jetzt in WhatsApp oder Bring! einfügen.'); }
      catch (e) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Kopiert'); }
    },
    low(el) { const s = T('Vorrat').find((v) => v.item === el.dataset.item); save([{ op: 'update', tab: 'Vorrat', match: { item: el.dataset.item }, set: { running_low: yes(s && s.running_low) ? 'nein' : 'ja' } }]); },
    filter(el) { state.filter = el.dataset.f; document.querySelectorAll('[data-act=filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === el))); root.classList.add('anim'); document.getElementById('rlist').innerHTML = recipeRows(); setTimeout(() => root.classList.remove('anim'), 900); },
    plan(el) {
      const r = recipe(el.dataset.id); const slot = el.dataset.slot; const date = el.dataset.date;
      save([{ op: 'replace', tab: 'Plan', match: { date, slot }, rows: [{ date, slot, recipe_id: r.id, servings: slot === 'bite' ? r.servings : setting('household', r.servings), cook_on: slot === 'bite' ? date : '', note: '' }] }], true);
      toast(`${r.name}: ${dayLong(date)}, ${fmt(date)}`);
      state.sel = date; state.weekOffset = Math.round((parse(weekStart(date)) - parse(weekStart(today()))) / (7 * 864e5));
      location.hash = '#/woche';
    },
    unplan(el) { save([{ op: 'delete', tab: 'Plan', match: { date: el.dataset.date, slot: el.dataset.slot } }]); },
    made(el) {
      const r = recipe(el.dataset.id); const place = el.dataset.place;
      const keep = place === 'Gefrierfach' ? 90 : num(r.keeps_days) || 3;
      save([{ op: 'append', tab: 'Fertig', rows: [{ id: uid('f'), item: r.name, recipe_id: r.id, portions_left: r.servings, made_on: today(), keeps_until: addDays(today(), keep), place }] }], true);
      location.hash = '#/kuehlschrank'; toast('Eingetragen');
    },
    take(el) {
      const f = T('Fertig').find((x) => x.id === el.dataset.id);
      const n = document.getElementById('n-' + el.dataset.id);
      if (n) { n.textContent = Math.max(0, num(f.portions_left) - 1); n.classList.add('bump'); }
      setTimeout(() => save([{ op: 'update', tab: 'Fertig', match: { id: el.dataset.id }, set: { portions_left: Math.max(0, num(f.portions_left) - 1) } }]), reduced() ? 0 : 380);
    },
    empty(el) { save([{ op: 'update', tab: 'Fertig', match: { id: el.dataset.id }, set: { portions_left: 0 } }]); },
    reload() { load(); },
    disconnect() { LS.del('sm.cfg'); LS.del('sm.data'); state.cfg = null; state.data = null; load(); },
  };

  root.addEventListener('click', (ev) => {
    if (swallowClick) { swallowClick = false; ev.preventDefault(); return; }
    const el = ev.target.closest('[data-act]');
    if (!el || el.tagName === 'FORM' || el.type === 'checkbox') return;
    const fn = act[el.dataset.act]; if (fn) fn(el, ev);
  });
  root.addEventListener('change', (ev) => { const el = ev.target; if (el.dataset && el.dataset.act === 'tick') act.tick(el); });
  root.addEventListener('submit', (ev) => { const el = ev.target.closest('[data-act]'); if (el && act[el.dataset.act]) act[el.dataset.act](el, ev); });
  root.addEventListener('input', (ev) => {
    if (ev.target.id === 'search') { state.search = ev.target.value; document.getElementById('rlist').innerHTML = recipeRows(); }
  });
  root.addEventListener('focusout', (ev) => { if (ev.target.id === 'lustnote' && state.cravings && ev.target.value !== state.cravings.note) saveLust(); });

  // swipe on the week stage to change day
  let sx = null, sy = null;
  root.addEventListener('pointerdown', (ev) => { if (ev.target.closest('#stage')) { sx = ev.clientX; sy = ev.clientY; } });
  root.addEventListener('pointerup', (ev) => {
    if (sx === null) return;
    const dx = ev.clientX - sx, dy = ev.clientY - sy; sx = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
    const ws = curWeek(); const cur = state.sel || selDay();
    const next = addDays(cur, dx < 0 ? 1 : -1);
    if (next < ws || next > addDays(ws, 6)) return;
    patchStage(next, dx < 0 ? 1 : -1);
  });

  // ---------- swipe a day row to cycle through alternatives (Michael only) ----------
  const canSwap = () => state.person === 'Michael';
  const cyc = {};
  function alternatives(date, slot, orig) {
    const ws = curWeek(), we = addDays(ws, 6);
    const used = new Set(T('Plan').filter((p) => p.date >= ws && p.date <= we && p.date !== date).map((p) => p.recipe_id));
    const cat = slot === 'abendbrot' ? 'abendbrot' : 'main';
    const alts = T('Rezepte').filter((r) => r.category === cat && r.id !== orig && !used.has(r.id) && r.active !== 'nein')
      .sort((x, y) => (x.last_cooked || '').localeCompare(y.last_cooked || '') || num(y.rating) - num(x.rating)).map((r) => r.id);
    return [orig || null].concat(alts);
  }
  function showAlt(el, c) {
    const id = c.list[c.i], r = id && recipe(id);
    const n = c.list.length - 1;
    el.querySelector('.v b').textContent = r ? r.name : 'Noch offen';
    el.querySelector('.v small').textContent = c.i === 0 ? 'wie geplant' : `Vorschlag ${c.i} von ${n}`;
    el.querySelector('.bar').className = 'bar ' + BAR(r ? mealClass({ slot: c.slot }, r) : 'b-empty');
  }
  function stepRow(el, dir) {
    const date = el.dataset.date;
    const row = T('Plan').find((p) => p.date === date && p.slot === el.dataset.slot);
    const c = cyc[date] || (cyc[date] = { slot: el.dataset.slot, orig: row ? row.recipe_id : null, i: 0 });
    c.list = c.list || alternatives(date, c.slot, c.orig);
    if (c.list.length < 2) { toast('Keine Alternativen im Rezeptvorrat'); return; }
    c.i = (c.i + dir + c.list.length) % c.list.length;
    const mv = el.querySelector('.mv');
    const out = () => {
      showAlt(el, c);
      mv.style.transition = 'none'; mv.style.transform = `translateX(${dir * 60}%)`; mv.style.opacity = '0';
      void mv.offsetWidth;
      mv.style.transition = ''; mv.style.transform = ''; mv.style.opacity = '';
    };
    if (reduced()) out(); else { mv.style.transition = 'transform .16s ease-in, opacity .16s ease-in'; mv.style.transform = `translateX(${-dir * 60}%)`; mv.style.opacity = '0'; setTimeout(out, 160); }
    clearTimeout(c.t);
    c.t = setTimeout(() => commitRow(date), 1600);
  }
  function commitRow(date) {
    const c = cyc[date]; delete cyc[date];
    if (!c) return;
    const id = c.list[c.i];
    if (id === c.orig) { render(); return; }
    const r = id && recipe(id);
    if (!r) { save([{ op: 'delete', tab: 'Plan', match: { date, slot: c.slot } }]); return; }
    save([{ op: 'replace', tab: 'Plan', match: { date, slot: c.slot }, rows: [{ date, slot: c.slot, recipe_id: r.id, servings: setting('household', r.servings), cook_on: '', note: '' }] }]);
    toast(`${dayLong(date)}: ${r.name}`);
  }
  let rw = null, swallowClick = false;
  root.addEventListener('pointerdown', (ev) => { const el = ev.target.closest('[data-swipe]'); rw = el ? { el, x: ev.clientX, y: ev.clientY, drag: false } : null; });
  root.addEventListener('pointermove', (ev) => {
    if (!rw) return;
    const dx = ev.clientX - rw.x, dy = ev.clientY - rw.y;
    if (!rw.drag) { if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) rw.drag = true; else if (Math.abs(dy) > 10) { rw = null; return; } else return; }
    const mv = rw.el.querySelector('.mv'); mv.style.transition = 'none'; mv.style.transform = `translateX(${dx}px)`; mv.style.opacity = String(Math.max(0.3, 1 - Math.abs(dx) / 300));
  });
  const endSwipe = (ev) => {
    if (!rw) return;
    const { el, x, drag } = rw; rw = null;
    if (!drag) return;
    swallowClick = true; setTimeout(() => { swallowClick = false; }, 300);
    const dx = ev.clientX - x, mv = el.querySelector('.mv');
    if (Math.abs(dx) > 60 && ev.type === 'pointerup') stepRow(el, dx < 0 ? 1 : -1);
    else { mv.style.transition = ''; mv.style.transform = ''; mv.style.opacity = ''; }
  };
  root.addEventListener('pointerup', endSwipe);
  root.addEventListener('pointercancel', endSwipe);

  // ---------- setup link: #setup?p=<firebase project id>&h=<household secret> ----------
  function readSetup() {
    const m = location.hash.match(/^#setup\?(.*)$/);
    if (!m) return false;
    const q = new URLSearchParams(m[1]);
    const p = q.get('p'), h = q.get('h');
    if (p && h && /^[a-z0-9-]{4,40}$/.test(p) && /^[A-Za-z0-9]{16,64}$/.test(h)) {
      state.cfg = { p, h }; LS.set('sm.cfg', state.cfg); LS.del('sm.data'); state.data = null;
      setTimeout(() => toast('Verbunden'), 400);
    }
    history.replaceState(null, '', location.pathname + '#/woche');
    return true;
  }

  window.addEventListener('hashchange', () => { if (readSetup()) { load(); return; } go(); });
  readSetup();
  if (state.cfg && !state.cfg.p) { LS.del('sm.cfg'); state.cfg = null; }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.cfg) load(true); });
  root.classList.add('anim'); setTimeout(() => root.classList.remove('anim'), 1500);
  load();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
