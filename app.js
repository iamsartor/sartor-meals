/* Sartor Meals: a small family meal planner. Data lives in a Google Sheet via an Apps Script connector. */
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
  const weekStart = (s) => { const d = parse(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return iso(d); };
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
  const CHIPS = ['Warm und deftig', 'Frisch', 'Nudeln', 'Suppe', 'Reis', 'Kartoffeln', 'Was Süßes', 'Wenig Hunger', 'Großer Hunger'];

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
  function applyLocal(op) {
    const d = state.data;
    const rows = d[op.tab] || (d[op.tab] = []);
    const m = (r) => Object.keys(op.match || {}).every((k) => String(r[k]) === String(op.match[k]));
    if (op.op === 'append') rows.push(...op.rows.map((r) => ({ ...r })));
    else if (op.op === 'delete') d[op.tab] = rows.filter((r) => !m(r));
    else if (op.op === 'replace') { d[op.tab] = rows.filter((r) => !m(r)); d[op.tab].push(...(op.rows || []).map((r) => ({ ...r }))); }
    else if (op.op === 'update') rows.forEach((r) => { if (m(r)) Object.assign(r, op.set); });
  }

  async function call(body) {
    const res = await fetch(state.cfg.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: state.cfg.key, ...body }) });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || 'Fehler');
    return j.data;
  }

  async function save(ops) {
    ops.forEach(applyLocal);
    LS.set('sm.data', state.data);
    render();
    if (!state.cfg) return;
    try {
      state.data = await call({ ops });
      LS.set('sm.data', state.data);
      state.error = '';
    } catch (e) {
      state.error = 'Speichern hat nicht geklappt. Bitte später neu laden.';
      toast(state.error);
    }
    render();
  }

  async function load() {
    if (!state.cfg) {
      if (!state.data) { state.data = await seedData(); }
      render();
      return;
    }
    state.syncing = true;
    render();
    try {
      let data = await call({ ops: [] });
      if (!data.Rezepte) {
        const seed = await (await fetch('seed.json')).json();
        data = await call({ ops: seed.map((t) => ({ op: 'ensure', tab: t.tab, headers: t.headers, rows: t.rows })).concat([{ op: 'dropDefault' }]) });
        toast('Tabelle eingerichtet');
      }
      state.data = data;
      LS.set('sm.data', data);
      state.error = '';
    } catch (e) {
      state.error = 'Keine Verbindung zur Tabelle. Zeige den letzten Stand.';
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
    const from = addDays(ws, -1), to = addDays(ws, 6);
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
  let toastTimer;
  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2600);
  }

  function nav(active) {
    const items = [['woche', 'Woche', I.week], ['lieber', 'Lieber?', I.choose], ['einkauf', 'Einkauf', I.cart], ['rezepte', 'Rezepte', I.book]];
    return `<nav class="tabs" aria-label="Hauptnavigation">${items.map(([k, l, ic]) => `<a href="#/${k}"${active === k ? ' aria-current="page"' : ''}><span>${ic}</span>${l}</a>`).join('')}</nav>`;
  }

  function weekSwitch() {
    const ws = curWeek();
    return `<div class="row"><button class="round sm ghost" data-act="week" data-d="-1" aria-label="Vorherige Woche">${I.left}</button>
      <span class="eyebrow">${fmt(ws)} bis ${fmt(addDays(ws, 6))}</span>
      <button class="round sm ghost" data-act="week" data-d="1" aria-label="Nächste Woche">${I.right}</button></div>`;
  }

  function banner() {
    if (state.error) return `<div class="block b-wish"><p style="margin:0">${esc(state.error)}</p></div>`;
    if (!state.cfg) return `<div class="block b-plain small"><p style="margin:0">Vorschau mit Beispieldaten. Änderungen bleiben nur auf diesem Gerät, bis die App mit der Tabelle verbunden ist.</p></div>`;
    return '';
  }

  // ---------- views ----------
  function vWoche() {
    const ws = curWeek();
    const prep = addDays(ws, -1);
    const prepRows = T('Plan').filter((p) => (p.cook_on === prep || (p.slot === 'bite' && p.date === prep)));
    const prepNames = [...new Set(prepRows.map((p) => recipe(p.recipe_id)).filter(Boolean).map((r) => r.name))];
    const prepMin = [...new Set(prepRows.map((p) => p.recipe_id))].map(recipe).filter(Boolean).reduce((s, r) => s + num(r.active_min), 0);
    const tiles = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(ws, i);
      const rows = T('Plan').filter((p) => p.date === date && p.slot !== 'bite');
      const row = rows.find((p) => p.slot === 'main') || rows[0];
      const r = row && recipe(row.recipe_id);
      const isToday = date === today() ? ' today' : '';
      const span = ['s4 wide-big', 's2', 's2', 's4 wide-big', 's6', 's4 wide-big', 's2'][i];
      const cls = r ? mealClass(row, r) : 'empty';
      const name = r ? esc(r.name) : 'Noch offen';
      const tag = r ? esc(mealLabel(row, r)) + (rows.length > 1 ? ' + Abendbrot' : '') : 'antippen zum Planen';
      const day = `${dayShort(date)} ${parse(date).getDate()}.`;
      tiles.push(span === 's6'
        ? `<a class="tile ${cls} s6${isToday}" href="#/tag/${date}"><span class="day">${day}</span><span class="body"><span class="meal">${name}</span><span class="tag">${tag}</span></span></a>`
        : `<a class="tile ${cls} ${span}${isToday}" href="#/tag/${date}"><span class="day">${day}</span><span class="meal">${name}</span><span class="tag">${tag}</span></a>`);
    }
    const fridge = T('Fertig').filter((f) => num(f.portions_left) > 0);
    const fridgeText = fridge.length ? fridge.slice(0, 3).map((f) => `${num(f.portions_left)} ${esc(f.item)}`).join(', ') : 'Gerade leer';
    tiles.push(`<a class="tile b-bites s6 fridge" href="#/kuehlschrank"><span class="day">Im Kühlschrank</span><span class="meal">${fridgeText}</span><span class="tag">für schnelle Mittage</span></a>`);
    return `${banner()}
      <section class="block big b-brand hero">
        <div class="row" style="justify-content:space-between">${weekSwitch().replace(/class="eyebrow"/, 'class="eyebrow" style="color:#fff"').replace(/round sm ghost/g, 'round sm')}</div>
        <h1 class="huge">${state.weekOffset === 0 ? 'Diese Woche' : state.weekOffset === 1 ? 'Nächste Woche' : 'Woche ' + fmt(ws)}</h1>
        <div class="hero-row">
          <p style="margin:0;font-size:15px;line-height:22px;font-weight:500">${prepNames.length ? `<b>${setting('prep_day', 'Sonntag')}, ${fmt(prep)} vorkochen</b><br>${esc(prepNames.join(', '))}${prepMin ? `<br><span class="small">ca. ${Math.round(prepMin / 15) * 15} Min aktiv</span>` : ''}` : 'Für diese Woche ist noch nichts zum Vorkochen geplant. Sag Claude im Chat „Plan die Woche“.'}</p>
          ${prepNames.length ? `<a class="round" href="#/vorkochen/${prep}" aria-label="Vorkoch-Plan ansehen">${I.next}</a>` : ''}
        </div>
      </section>
      <div class="grid6">${tiles.join('')}</div>
      <div class="row" style="justify-content:center"><a class="textbtn" href="#/einstellungen">${state.person ? esc(state.person) + ' · ' : ''}Einstellungen</a></div>
      ${nav('woche')}`;
  }

  function vVorkochen(prep) {
    const rows = T('Plan').filter((p) => (p.cook_on === prep || (p.slot === 'bite' && p.date === prep)));
    const ids = [...new Set(rows.map((p) => p.recipe_id))];
    const blocks = ids.map(recipe).filter(Boolean).map((r) => {
      const row = rows.find((p) => p.recipe_id === r.id);
      return `<a class="block ${mealClass(row, r)}" href="#/rezept/${r.id}" style="text-decoration:none">
        <h2>${esc(r.name)}</h2>
        <span class="soft small">${esc(r.active_min)} Min aktiv · hält ${esc(r.keeps_days)} Tage${yes(r.freezable) ? ' · einfrierbar' : ''}</span>
        ${r.prep_tips ? `<p style="margin:0">${esc(r.prep_tips)}</p>` : ''}
        ${r.kid_task ? `<p style="margin:0" class="soft">Lust zu helfen? ${esc(r.kid_task)}</p>` : ''}
      </a>`;
    }).join('');
    return `<div class="head"><a class="textbtn" href="#/woche" style="align-self:flex-start;padding:0">Zurück zur Woche</a>
      <h1>Vorkochen</h1><p class="eyebrow">${dayLong(prep)}, ${fmt(prep)}</p></div>
      ${blocks || '<p class="muted center">Nichts geplant.</p>'}
      ${nav('woche')}`;
  }

  function vTag(date) {
    const slots = [['main', 'Hauptgericht'], ['abendbrot', 'Abendbrot']];
    const blocks = slots.map(([slot, label]) => {
      const row = T('Plan').find((p) => p.date === date && p.slot === slot);
      const r = row && recipe(row.recipe_id);
      if (!r) return `<a class="block b-plain" href="#/waehlen/${date}/${slot}" style="text-decoration:none"><h2>+ ${label}</h2><span class="soft small">Rezept auswählen</span></a>`;
      return `<div class="block ${mealClass(row, r)}">
        <span class="soft small">${label}</span>
        <h2 style="font-size:22px;line-height:30px">${esc(r.name)}</h2>
        <span class="soft small">${esc(mealLabel(row, r))}${row.cook_on && row.cook_on !== date ? ' am ' + fmt(row.cook_on) : ''}</span>
        <div class="row wrap" style="margin-top:6px">
          <a class="btn white" href="#/rezept/${r.id}">Rezept</a>
          <a class="btn ink" href="#/waehlen/${date}/${slot}">Ändern</a>
          <button class="textbtn" style="color:var(--block-ink-soft)" data-act="unplan" data-date="${date}" data-slot="${slot}">Entfernen</button>
        </div></div>`;
    }).join('');
    return `<div class="head"><a class="textbtn" href="#/woche" style="align-self:flex-start;padding:0">Zurück zur Woche</a>
      <h1>${dayLong(date)}</h1><p class="eyebrow">${fmt(date)}</p></div>${blocks}${nav('woche')}`;
  }

  function vWaehlen(date, slot) {
    const order = slot === 'abendbrot' ? ['abendbrot', 'main', 'bite'] : slot === 'bite' ? ['bite', 'main', 'abendbrot'] : ['main', 'abendbrot', 'bite'];
    const groups = order.map((c) => {
      const rs = T('Rezepte').filter((r) => (r.category || 'main') === c).sort((a, b) => a.name.localeCompare(b.name, 'de'));
      if (!rs.length) return '';
      return `<div class="block b-plain"><h2>${{ main: 'Hauptgerichte', abendbrot: 'Abendbrot', bite: 'Für den Kühlschrank' }[c]}</h2>
        ${rs.map((r) => `<button class="list-item" style="background:none;border:none;border-bottom:1px solid var(--line);width:100%;text-align:left;cursor:pointer" data-act="plan" data-date="${date}" data-slot="${slot}" data-id="${r.id}"><span class="dot ${mealClass(null, r)}"></span><span class="grow">${esc(r.name)}</span><span class="small muted">${esc(r.total_min)} Min</span></button>`).join('')}</div>`;
    }).join('');
    return `<div class="head"><a class="textbtn" href="#/tag/${date}" style="align-self:flex-start;padding:0">Zurück</a>
      <h1>${slot === 'abendbrot' ? 'Abendbrot' : 'Was gibt es?'}</h1><p class="eyebrow">${dayLong(date)}, ${fmt(date)}</p></div>${groups}${nav('woche')}`;
  }

  function vWer() {
    const people = T('Familie').map((f) => f.person).filter(Boolean);
    return `<div class="head" style="--accent:var(--block-wish)"><h1>Wer bist du?</h1><p class="eyebrow">Einmal antippen, die App merkt es sich auf diesem Handy.</p></div>
      <div class="grid2">${people.map((p, i) => `<button class="tile ${['b-prep', 'b-abendbrot', 'b-wish', 'b-new', 'b-bites', 'b-warm'][i % 6]}" data-act="person" data-p="${esc(p)}"><span class="day">&nbsp;</span><span class="meal" style="font-size:22px">${esc(p)}</span><span class="tag">&nbsp;</span></button>`).join('')}</div>
      <p class="small muted center">Namen ändern: in der Tabelle im Tab „Familie“, oder Claude im Chat fragen.</p>${nav('lieber')}`;
  }

  function lieberWeek() {
    const qs = T('Fragen');
    const ws = weekStart(today());
    const weeks = [...new Set(qs.map((q) => q.week))].filter((w) => w >= ws).sort();
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
    if (state.cravings === null || state.cravings.week !== week || state.cravings.person !== state.person) {
      state.cravings = { week, person: state.person, chips: saved ? saved.chips.split(',').map((s) => s.trim()).filter(Boolean) : [], note: saved ? saved.note : '' };
    }
    const c = state.cravings;
    let main;
    if (q) {
      const a = recipe(q.option_a), b = recipe(q.option_b);
      const when = q.for_date === 'bites' ? 'Für den Kühlschrank' : `Für ${dayLong(q.for_date)}`;
      const meta = (r) => r ? `${esc(r.total_min)} Min${r.category === 'bite' ? ', zum Mitnehmen' : ''}` : '';
      main = `<div class="head" style="--accent:var(--block-abendbrot)"><div class="head-row"><a class="textbtn" href="#/wer" style="padding:0">${esc(state.person)}</a><span class="eyebrow">Frage ${qs.length - open.length + 1} von ${qs.length}</span></div>
        <h1>Was hättest du lieber?</h1><p class="eyebrow">${when}</p></div>
        <div class="choice">
          <button class="opt b-warm" data-act="answer" data-q="${q.id}" data-c="a"><span class="t">${esc(a ? a.name : q.option_a)}</span><span class="soft">${meta(a)}</span></button>
          <span class="or" aria-hidden="true">oder</span>
          <button class="opt b-new" data-act="answer" data-q="${q.id}" data-c="b"><span class="t">${esc(b ? b.name : q.option_b)}</span><span class="soft">${meta(b)}</span></button>
        </div>
        <div class="row" style="justify-content:center"><button class="textbtn" data-act="answer" data-q="${q.id}" data-c="egal">Egal, beides gut</button></div>`;
    } else {
      main = `<div class="head"><div class="head-row"><a class="textbtn" href="#/wer" style="padding:0">${esc(state.person)}</a></div>
        <h1>Danke!</h1><p class="eyebrow">${qs.length ? 'Alle Fragen für diese Woche beantwortet.' : 'Gerade gibt es keine Fragen. Claude stellt neue, wenn die nächste Woche geplant wird.'}</p></div>`;
    }
    return `${banner()}${main}
      <section class="block big b-wish">
        <h2>Worauf hast du Lust?</h2>
        <span class="soft small">Woche ab ${fmt(week)}</span>
        <div class="row wrap">${CHIPS.map((ch) => `<button class="chip" aria-pressed="${c.chips.includes(ch)}" data-act="chip" data-ch="${esc(ch)}">${esc(ch)}</button>`).join('')}</div>
        <input class="field" id="lustnote" placeholder="Sonst noch ein Wunsch?" value="${esc(c.note)}" style="margin-top:6px">
        <button class="btn ink" data-act="lust" style="margin-top:6px;align-self:flex-start">${saved ? 'Aktualisieren' : 'Speichern'}</button>
      </section>
      ${nav('lieber')}`;
  }

  function vEinkauf() {
    const ws = curWeek();
    const items = T('Einkauf').filter((e) => e.week === ws);
    const hasPlan = items.some((e) => e.source === 'plan');
    const groups = SECTIONS.concat([...new Set(items.map((i) => i.section))].filter((s) => !SECTIONS.includes(s))).map((sec) => {
      const its = items.filter((i) => (i.section || 'Sonstiges') === sec);
      if (!its.length) return '';
      return `<section class="block sec ${SECTION_BLOCK[sec] || 'b-plain'}"><h2 style="font-size:14px;line-height:20px">${esc(sec)}</h2>
        ${its.map((i) => `<label class="check${yes(i.checked) ? ' done' : ''}"><input type="checkbox" data-act="tick" data-id="${esc(i.id)}"${yes(i.checked) ? ' checked' : ''}><span class="grow name">${esc(i.item)}</span><span class="q">${esc([i.qty, i.unit].filter(Boolean).join(' '))}</span></label>`).join('')}
      </section>`;
    }).join('');
    const staples = T('Vorrat');
    const open = items.filter((i) => !yes(i.checked)).length;
    return `${banner()}<div class="head" style="--accent:var(--block-new)"><div class="head-row">${weekSwitch()}</div><h1>Einkauf</h1><p class="eyebrow">${items.length ? `${open} von ${items.length} offen` : 'Noch keine Liste für diese Woche'}</p></div>
      ${hasPlan ? '' : `<section class="block big b-brand"><h2>Liste aus dem Plan erstellen</h2><p style="margin:0">Alles für die geplanten Gerichte und den Vorkochtag, ohne das, was im Vorrat ist.</p><button class="btn white" data-act="gen" style="align-self:flex-start;margin-top:6px">Erstellen</button></section>`}
      ${groups}
      <form class="row" data-act="add"><input class="field grow" id="additem" placeholder="Noch etwas dazu, z. B. Kaffee" autocomplete="off"><button class="round ink" type="submit" aria-label="Hinzufügen">${I.plus}</button></form>
      ${items.length ? `<div class="sticky-bottom"><button class="btn primary grow" data-act="copy">Für WhatsApp kopieren</button></div>` : ''}
      ${hasPlan ? `<div class="row" style="justify-content:center"><button class="textbtn" data-act="gen">Aus dem Plan neu erstellen</button></div>` : ''}
      <section class="block b-plain"><h2>Vorrat fast leer?</h2><span class="soft small">Antippen, dann kommt es auf die nächste Liste.</span>
        <div class="row wrap">${staples.map((s) => `<button class="chip" style="border:1px solid var(--line)" aria-pressed="${yes(s.running_low)}" data-act="low" data-item="${esc(s.item)}">${esc(s.item)}</button>`).join('')}</div></section>
      ${nav('einkauf')}`;
  }

  function vRezepte() {
    const q = state.search.toLowerCase();
    const groups = [['main', 'Hauptgerichte'], ['abendbrot', 'Abendbrot'], ['bite', 'Für den Kühlschrank']].map(([c, label]) => {
      const rs = T('Rezepte').filter((r) => (r.category || 'main') === c && (!q || r.name.toLowerCase().includes(q) || String(r.tags).toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name, 'de'));
      if (!rs.length) return '';
      return `<section class="block b-plain"><h2>${label}</h2>${rs.map((r) => `<a class="list-item" href="#/rezept/${r.id}"><span class="dot ${mealClass(null, r)}"></span><span class="grow">${esc(r.name)}</span><span class="small muted">${esc(r.total_min)} Min</span></a>`).join('')}</section>`;
    }).join('');
    return `${banner()}<div class="head" style="--accent:var(--block-prep)"><h1>Rezepte</h1><p class="eyebrow">${T('Rezepte').length} Rezepte</p></div>
      <input class="field" id="search" type="search" placeholder="Suchen, z. B. Linsen oder schnell" value="${esc(state.search)}">
      <div id="rlist">${groups || '<p class="muted center">Nichts gefunden.</p>'}</div>
      <p class="small muted center" style="padding:0 12px">Neue Rezepte, auch von NYT Cooking: schick Claude im Chat den Link.</p>
      ${nav('rezepte')}`;
  }

  function vRezept(id) {
    const r = recipe(id);
    if (!r) return `<div class="head"><h1>Nicht gefunden</h1></div>${nav('rezepte')}`;
    const ing = T('Zutaten').filter((z) => z.recipe_id === id);
    const steps = String(r.steps || '').split(/(?<=\.)\s+(?=[A-ZÄÖÜ])/).filter(Boolean);
    const isBite = r.category === 'bite';
    return `<section class="block big hero-r ${mealClass(null, r)}">
        <a class="round sm" href="javascript:history.back()" aria-label="Zurück" style="margin-left:-8px">${I.left}</a>
        <span class="pill" style="margin-top:8px">${esc([mealLabel(null, r), r.source && r.source !== 'Claude' ? 'aus ' + r.source : ''].filter(Boolean).join(' · '))}</span>
        <h1 style="line-height:38px">${esc(r.name)}</h1>
        <div class="meta">
          <div><b>${esc(r.total_min || '?')}</b><span>Minuten</span></div>
          <div><b>${esc(r.servings || '?')}</b><span>${isBite ? 'Stück' : 'Portionen'}</span></div>
          <div><b>${esc(r.keeps_days || '?')} T.</b><span>haltbar</span></div>
          <div><b>${yes(r.freezable) ? 'Ja' : 'Nein'}</b><span>einfrierbar</span></div>
        </div>
      </section>
      ${r.kid_task ? `<section class="block b-wish"><h2 style="font-size:15px">Lust zu helfen?</h2><p style="margin:0">${esc(r.kid_task)}</p></section>` : ''}
      <section class="block b-plain"><h2>Zutaten</h2><ul class="ing">${ing.map((z) => `<li>${esc([z.qty, z.unit === 'Stück' ? '' : z.unit].filter(Boolean).join(' '))} ${esc(z.item)}</li>`).join('')}</ul>
        ${r.prep_tips ? `<p class="soft small" style="margin:4px 0 0">Vorkochen: ${esc(r.prep_tips)}</p>` : ''}</section>
      ${steps.length ? `<section class="block b-plain"><h2>So geht's</h2><ol class="steps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></section>` : ''}
      ${r.source_url ? `<p class="small center"><a href="${esc(r.source_url)}" target="_blank" rel="noopener">Original ansehen</a></p>` : ''}
      <div class="sticky-bottom">${isBite
        ? `<button class="btn primary grow" data-act="made" data-id="${r.id}" data-place="Kühlschrank">Gemacht: in den Kühlschrank</button><button class="btn ink" data-act="made" data-id="${r.id}" data-place="Gefrierfach">Gefrierfach</button>`
        : `<a class="btn primary grow" href="#/planen/${r.id}">Zum Plan hinzufügen</a>`}</div>
      ${nav('rezepte')}`;
  }

  function vPlanen(id) {
    const r = recipe(id);
    const start = today();
    const opts = Array.from({ length: 21 }, (_, i) => addDays(start, i)).map((d) => `<option value="${d}">${dayLong(d)}, ${fmt(d)}</option>`).join('');
    return `<div class="head"><a class="textbtn" href="#/rezept/${id}" style="align-self:flex-start;padding:0">Zurück</a><h1>Einplanen</h1><p class="eyebrow">${esc(r ? r.name : '')}</p></div>
      <section class="block big b-brand">
        <label class="lbl" for="pdate">Tag</label><select class="field" id="pdate" style="background:#fff;color:#171719">${opts}</select>
        <label class="lbl" for="pslot" style="margin-top:8px">Als</label><select class="field" id="pslot" style="background:#fff;color:#171719"><option value="${r && r.category === 'abendbrot' ? 'abendbrot' : 'main'}">${r && r.category === 'abendbrot' ? 'Abendbrot' : 'Hauptgericht'}</option><option value="${r && r.category === 'abendbrot' ? 'main' : 'abendbrot'}">${r && r.category === 'abendbrot' ? 'Hauptgericht' : 'Abendbrot'}</option><option value="bite">Vorkochen für den Kühlschrank</option></select>
        <button class="btn white" data-act="planpick" data-id="${id}" style="margin-top:10px;align-self:flex-start">Einplanen</button>
      </section>${nav('rezepte')}`;
  }

  function vKuehlschrank() {
    const items = T('Fertig').filter((f) => num(f.portions_left) > 0).sort((a, b) => String(a.keeps_until).localeCompare(String(b.keeps_until)));
    const t = today();
    const blocks = items.map((f) => {
      const old = f.keeps_until && f.keeps_until < t;
      return `<section class="block b-bites">
        <span class="soft small">${esc(f.place || 'Kühlschrank')}${f.keeps_until ? ` · ${old ? 'Haltbarkeit vorbei seit' : 'gut bis'} ${fmt(f.keeps_until)}` : ''}</span>
        <h2 style="font-size:22px;line-height:30px">${esc(f.item)}</h2>
        <span class="soft">noch ${num(f.portions_left)} ${num(f.portions_left) === 1 ? 'Stück' : 'Stück'}</span>
        <div class="row wrap" style="margin-top:6px"><button class="btn ink" data-act="take" data-id="${esc(f.id)}">Eins genommen</button><button class="textbtn" style="color:var(--block-ink-soft)" data-act="empty" data-id="${esc(f.id)}">Ist leer</button></div>
      </section>`;
    }).join('');
    const bites = T('Rezepte').filter((r) => r.category === 'bite');
    return `<div class="head"><a class="textbtn" href="#/woche" style="align-self:flex-start;padding:0">Zurück zur Woche</a><h1>Im Kühlschrank</h1><p class="eyebrow">Schnelle Mittage zum Mitnehmen</p></div>
      ${blocks || '<section class="block b-plain"><p style="margin:0">Gerade nichts vorrätig.</p></section>'}
      <section class="block b-plain"><h2>Frisch gemacht?</h2><span class="soft small">Rezept öffnen und „Gemacht“ antippen.</span>
        ${bites.map((r) => `<a class="list-item" href="#/rezept/${r.id}"><span class="dot b-bites"></span><span class="grow">${esc(r.name)}</span></a>`).join('')}</section>
      ${nav('woche')}`;
  }

  function vEinstellungen() {
    return `<div class="head"><a class="textbtn" href="#/woche" style="align-self:flex-start;padding:0">Zurück zur Woche</a><h1>Einstellungen</h1></div>
      <section class="block b-plain">
        <h2>Ich bin</h2><p style="margin:0">${state.person ? esc(state.person) : 'Noch nicht gewählt'}</p>
        <a class="btn line" href="#/wer" style="align-self:flex-start">Person wechseln</a>
      </section>
      <section class="block b-plain">
        <h2>Verbindung</h2>
        <p style="margin:0">${state.cfg ? 'Mit der Google-Tabelle verbunden.' : 'Nicht verbunden: die App zeigt Beispieldaten. Öffne den Einrichtungslink von Claude, um sie zu verbinden.'}</p>
        <div class="row wrap">${state.cfg ? '<button class="btn line" data-act="reload">Neu laden</button><button class="textbtn" data-act="disconnect">Verbindung trennen</button>' : ''}</div>
      </section>
      <p class="small muted center">Sartor Meals · Design auf Basis von Montage (Wanted Lab, MIT)</p>
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
  function render() {
    if (!state.data) { root.innerHTML = '<div class="head"><h1>Lädt…</h1></div>'; return; }
    const focusId = document.activeElement && document.activeElement.id;
    const caret = focusId && document.activeElement.selectionStart;
    root.innerHTML = route();
    if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus(); try { el.setSelectionRange(caret, caret); } catch (e) { /* not text */ } } }
  }

  // ---------- actions ----------
  const act = {
    week(el) { state.weekOffset += Number(el.dataset.d); render(); },
    person(el) { state.person = el.dataset.p; LS.set('sm.person', state.person); state.cravings = null; if (location.hash === '#/lieber') render(); else location.hash = '#/lieber'; },
    answer(el) { save([{ op: 'append', tab: 'Antworten', rows: [{ question_id: el.dataset.q, person: state.person, choice: el.dataset.c, at: new Date().toISOString() }] }]); window.scrollTo(0, 0); },
    chip(el) { const c = state.cravings; const ch = el.dataset.ch; c.chips = c.chips.includes(ch) ? c.chips.filter((x) => x !== ch) : c.chips.concat(ch); render(); },
    lust() {
      const c = state.cravings; const n = document.getElementById('lustnote'); c.note = n ? n.value : '';
      save([{ op: 'replace', tab: 'Lust', match: { week: c.week, person: c.person }, rows: [{ week: c.week, person: c.person, chips: c.chips.join(', '), note: c.note, at: new Date().toISOString() }] }]);
      toast('Gespeichert, danke!');
    },
    gen() {
      const ws = curWeek();
      save([{ op: 'replace', tab: 'Einkauf', match: { week: ws, source: 'plan' }, rows: generateList(ws).filter((r) => r.source === 'plan') },
        { op: 'replace', tab: 'Einkauf', match: { week: ws, source: 'vorrat' }, rows: generateList(ws).filter((r) => r.source === 'vorrat') }]);
      toast('Liste erstellt');
    },
    tick(el) {
      const it = T('Einkauf').find((e) => e.id === el.dataset.id);
      const ops = [{ op: 'update', tab: 'Einkauf', match: { id: el.dataset.id }, set: { checked: el.checked ? 'ja' : 'nein' } }];
      if (el.checked && it && T('Vorrat').some((v) => v.item.toLowerCase() === it.item.toLowerCase() && yes(v.running_low))) ops.push({ op: 'update', tab: 'Vorrat', match: { item: T('Vorrat').find((v) => v.item.toLowerCase() === it.item.toLowerCase()).item }, set: { running_low: 'nein' } });
      save(ops);
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
    plan(el) {
      const r = recipe(el.dataset.id); const slot = el.dataset.slot; const date = el.dataset.date;
      save([{ op: 'replace', tab: 'Plan', match: { date, slot }, rows: [{ date, slot, recipe_id: r.id, servings: slot === 'bite' ? r.servings : setting('household', r.servings), cook_on: slot === 'bite' ? date : '', note: '' }] }]);
      location.hash = slot === 'bite' ? '#/woche' : `#/tag/${date}`;
    },
    planpick(el) {
      const date = document.getElementById('pdate').value; const slot = document.getElementById('pslot').value;
      el.dataset.date = date; el.dataset.slot = slot; act.plan(el); toast(`Eingeplant für ${dayLong(date)}`);
    },
    unplan(el) { save([{ op: 'delete', tab: 'Plan', match: { date: el.dataset.date, slot: el.dataset.slot } }]); },
    made(el) {
      const r = recipe(el.dataset.id); const place = el.dataset.place;
      const keep = place === 'Gefrierfach' ? 90 : num(r.keeps_days) || 3;
      save([{ op: 'append', tab: 'Fertig', rows: [{ id: uid('f'), item: r.name, recipe_id: r.id, portions_left: r.servings, made_on: today(), keeps_until: addDays(today(), keep), place }] }]);
      location.hash = '#/kuehlschrank'; toast('Eingetragen');
    },
    take(el) { const f = T('Fertig').find((x) => x.id === el.dataset.id); save([{ op: 'update', tab: 'Fertig', match: { id: el.dataset.id }, set: { portions_left: Math.max(0, num(f.portions_left) - 1) } }]); },
    empty(el) { save([{ op: 'update', tab: 'Fertig', match: { id: el.dataset.id }, set: { portions_left: 0 } }]); },
    reload() { load(); },
    disconnect() { LS.del('sm.cfg'); LS.del('sm.data'); state.cfg = null; state.data = null; load(); },
  };

  root.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.tagName === 'FORM' || el.type === 'checkbox') return;
    const fn = act[el.dataset.act]; if (fn) fn(el, ev);
  });
  root.addEventListener('change', (ev) => { const el = ev.target; if (el.dataset && el.dataset.act === 'tick') act.tick(el); });
  root.addEventListener('submit', (ev) => { const el = ev.target.closest('[data-act]'); if (el && act[el.dataset.act]) act[el.dataset.act](el, ev); });
  root.addEventListener('input', (ev) => {
    if (ev.target.id === 'search') {
      state.search = ev.target.value;
      const tmp = document.createElement('div'); tmp.innerHTML = vRezepte();
      document.getElementById('rlist').innerHTML = tmp.querySelector('#rlist').innerHTML;
    }
  });

  // ---------- setup link: #setup?u=<script url>&k=<key> ----------
  function readSetup() {
    const m = location.hash.match(/^#setup\?(.*)$/);
    if (!m) return false;
    const p = new URLSearchParams(m[1]);
    const u = p.get('u'), k = p.get('k');
    if (u && k && /^https:\/\/script\.google\.com\//.test(u)) {
      state.cfg = { url: u, key: k }; LS.set('sm.cfg', state.cfg); LS.del('sm.data'); state.data = null;
      history.replaceState(null, '', location.pathname + '#/woche');
      setTimeout(() => toast('Verbunden mit der Tabelle'), 400);
    }
    return true;
  }

  window.addEventListener('hashchange', () => { if (readSetup()) { load(); return; } render(); window.scrollTo(0, 0); });
  readSetup();
  load();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
