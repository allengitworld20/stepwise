import {
  SYMPTOMS, MAX_SCORE, RED_FLAGS, STAGES, DAY, symptomTotal, symptomCount, symptomTrend,
  personalZ, readiness, buildInsights, factorEffects, demoData, median, mean,
} from './ml.js';

// ---------- State (stored only in this browser) ----------
const KEY = 'stepwise:v1';
const fresh = () => ({ checkins: [], checks: [], stage: 1, stageSince: Date.now(), clearance: false, injuryDate: null });
let state = load();
function load() {
  try { return { ...fresh(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return fresh(); }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { toast('Could not save on this device'); }
}

// ---------- Helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const main = $('#main');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dayKey = (t) => new Date(t).toLocaleDateString('en-CA');
const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const todaysCheckin = () => state.checkins.find((c) => dayKey(c.date) === dayKey(Date.now()));
const sortedCheckins = () => [...state.checkins].sort((a, b) => a.date - b.date);
const checksOf = (type) => state.checks.filter((c) => c.type === type).sort((a, b) => a.date - b.date);
const stageOf = (id) => STAGES.find((s) => s.id === id) || STAGES[0];
const ICON = {
  ok: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="var(--good-soft)"/><path d="M6 10.5l2.5 2.5L14 7.5" fill="none" stroke="var(--good)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  no: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="var(--warn-soft)"/><path d="M10 5.5v5.5M10 14.2v.3" stroke="var(--warn)" stroke-width="2" stroke-linecap="round"/></svg>',
  up: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 11l5-5 5 5" fill="none" stroke="var(--warn)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 5l5 5 5-5" fill="none" stroke="var(--good)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  flat: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 8h10" fill="none" stroke="var(--muted)" stroke-width="2" stroke-linecap="round"/></svg>',
};

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- Theme ----------
const THEMES = ['auto', 'light', 'dark', 'dim'];
const THEME_NAMES = { auto: 'Match system', light: 'Light', dark: 'Dark', dim: 'Dim (for light sensitivity)' };
function applyTheme() {
  let t = 'auto';
  try { t = localStorage.getItem('stepwise:theme') || 'auto'; } catch {}
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
applyTheme();
$('#theme-btn').addEventListener('click', () => {
  let t = 'auto';
  try { t = localStorage.getItem('stepwise:theme') || 'auto'; } catch {}
  const next = THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];
  try { localStorage.setItem('stepwise:theme', next); } catch {}
  applyTheme();
  toast(`Display: ${THEME_NAMES[next]}`);
  if (current === 'insights') render();
});

// ---------- Urgent signs ----------
$('#urgent-list').innerHTML = RED_FLAGS.map((f) => `<li>${f}</li>`).join('');
$('#urgent-btn').addEventListener('click', () => $('#urgent').showModal());

// ---------- Screen-break reminder (every 20 visible minutes) ----------
let onScreen = 0;
setInterval(() => {
  if (document.visibilityState !== 'visible' || !$('#break').hidden || !state.injuryDate) return;
  onScreen += 30;
  if (onScreen >= 20 * 60) $('#break').hidden = false;
}, 30000);
$('#break-done').addEventListener('click', () => { onScreen = 0; $('#break').hidden = true; });

// ---------- Routing ----------
const TABS = ['today', 'check', 'plan', 'insights', 'summary'];
let current = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today';
// ?demo opens straight into sample data, handy for judges and screenshots.
if (new URLSearchParams(location.search).has('demo') && !state.injuryDate) { state = demoData(); save(); }
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab)));
function go(tab) {
  current = tab;
  history.replaceState(null, '', `#${tab}`);
  document.querySelectorAll('.tabs button').forEach((b) => b.dataset.tab === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  render();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
}
function render() {
  cleanupCheck();
  const onboarded = !!state.injuryDate;
  $('.tabs').hidden = !onboarded;
  const chip = $('#day-chip');
  if (onboarded) {
    const d = Math.max(1, Math.floor((Date.now() - state.injuryDate) / DAY) + 1);
    chip.textContent = `Day ${d} of recovery${state.demo ? ' · sample data' : ''}`;
    chip.hidden = false;
  } else chip.hidden = true;
  if (!onboarded) return renderWelcome();
  ({ today: renderToday, check: renderCheck, plan: renderPlan, insights: renderInsights, summary: renderSummary })[current]();
}

// ---------- Welcome ----------
function renderWelcome() {
  main.innerHTML = `
  <section class="card hero">
    <div class="eyebrow">Concussion recovery companion</div>
    <h1>Recover one step at a time.</h1>
    <p class="lead">Stepwise helps you track symptoms, check in on your thinking speed, and return to activity safely, with a calm screen that's easy on a sore head.</p>
    <ul class="feature-list">
      <li><b>Two-minute check-in</b>The 22-symptom scale clinicians use, one tap per symptom.</li>
      <li><b>Brain checks</b>Reaction time and memory games, compared with your own results.</li>
      <li><b>Return-to-activity plan</b>The 6-step consensus plan, with clear "ready to move on?" checks.</li>
      <li><b>Explainable insights</b>Your trends and triggers, each with the evidence behind it.</li>
    </ul>
    <form id="start" class="stack">
      <div class="field" style="max-width:320px">
        <label for="inj">When did the injury happen?</label>
        <input type="date" id="inj" required max="${dayKey(Date.now())}" value="${dayKey(Date.now())}">
      </div>
      <div class="row">
        <button class="btn" type="submit">Start tracking</button>
        <button class="btn-secondary" type="button" id="demo">Try with sample data</button>
      </div>
    </form>
  </section>
  <p class="callout" style="margin-top:16px"><strong>Stepwise supports your care team. It doesn't replace them.</strong> It can't diagnose a concussion or clear you to play. Everything you enter stays on this device.</p>`;
  $('#start').addEventListener('submit', (e) => {
    e.preventDefault();
    const d = new Date($('#inj').value + 'T12:00:00').getTime();
    state = { ...fresh(), injuryDate: Math.min(d, Date.now()), stageSince: Date.now() };
    save(); go('today');
  });
  $('#demo').addEventListener('click', () => { state = demoData(); save(); go('today'); toast('Loaded 16 days of sample data'); });
}

// ---------- Today ----------
const GROUPS = [
  { name: 'Physical', items: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
  { name: 'Thinking', items: [9, 10, 11, 12, 13, 15] },
  { name: 'Energy & sleep', items: [14, 16, 21] },
  { name: 'Mood', items: [17, 18, 19, 20] },
];
const TIPS = [
  'Break tasks into 20–30 minute blocks with rests in between.',
  'Light activity like a short walk usually helps more than total rest after the first day or two.',
  'Keep screen brightness low and text large. Take breaks before symptoms build.',
  'Aim for a regular sleep schedule. Avoid naps late in the day.',
  'A small rise in symptoms during activity is OK. If it rises by more than 2 out of 10, ease off.',
  'Avoid alcohol while you recover. It can worsen symptoms and slow healing.',
];

function renderToday() {
  const today = todaysCheckin();
  const all = sortedCheckins();
  const prev = [...all].reverse().find((c) => dayKey(c.date) !== dayKey(Date.now()));
  const scores = today ? [...today.scores] : SYMPTOMS.map(() => 0);
  const stage = stageOf(state.stage);
  const rts = checksOf('reaction');
  const lastRt = rts[rts.length - 1];
  const tip = TIPS[Math.floor(Date.now() / DAY) % TIPS.length];

  let delta = '';
  if (today && prev) {
    const d = symptomTotal(today.scores) - symptomTotal(prev.scores);
    delta = `<div class="sub">${d < 0 ? ICON.down : d > 0 ? ICON.up : ICON.flat} ${d === 0 ? 'Same as' : `${Math.abs(d)} ${d < 0 ? 'lower' : 'higher'} than`} last check-in</div>`;
  }

  main.innerHTML = `
  <div class="stack">
    <div class="grid three">
      <div class="card stat">
        <div class="eyebrow">Today's symptom score</div>
        ${today ? `<div class="value">${symptomTotal(today.scores)} <small>/ ${MAX_SCORE}</small></div>${delta || `<div class="sub">${symptomCount(today.scores)} of 22 symptoms present</div>`}`
          : `<div class="value" style="color:var(--muted)">–</div><div class="sub">Not logged yet today</div>`}
      </div>
      <div class="card stat">
        <div class="eyebrow">Activity stage</div>
        <div class="value">${stage.id} <small>of 6</small></div>
        <div class="sub">${stage.name}</div>
      </div>
      <div class="card stat">
        <div class="eyebrow">Last reaction time</div>
        ${lastRt ? `<div class="value">${Math.round(lastRt.value)} <small>ms</small></div><div class="sub">${fmtDate(lastRt.date)}</div>`
          : `<div class="value" style="color:var(--muted)">–</div><div class="sub"><button class="link-btn" data-go="check">Take a brain check</button></div>`}
      </div>
    </div>

    <div class="callout"><strong>Pacing tip:</strong> ${tip}</div>

    <form class="card" id="checkin">
      <div class="card-head">
        <div>
          <h2>${today ? "Update today's check-in" : 'How are you feeling today?'}</h2>
          <p class="muted" style="margin:0">Rate each symptom from 0 (none) to 6 (severe). Skip over anything you don't have; it stays at 0.</p>
        </div>
      </div>
      ${GROUPS.map((g) => `
        <div class="sym-group">
          <h3>${g.name}</h3>
          ${g.items.map((i) => `
            <div class="sym">
              <span id="sl${i}">${SYMPTOMS[i]}</span>
              <fieldset class="scale" aria-labelledby="sl${i}">
                ${[0, 1, 2, 3, 4, 5, 6].map((v) => `<input type="radio" name="s${i}" id="s${i}-${v}" value="${v}" ${scores[i] === v ? 'checked' : ''}><label for="s${i}-${v}" title="${['None', 'Mild', 'Mild', 'Moderate', 'Moderate', 'Severe', 'Severe'][v]}">${v}</label>`).join('')}
              </fieldset>
            </div>`).join('')}
        </div>`).join('')}
      <div class="sym-group">
        <h3>Your day</h3>
        <div class="fields">
          <div class="field"><label for="sleep">Sleep last night</label><span class="hint">Hours</span>
            <input type="number" id="sleep" min="0" max="16" step="0.5" inputmode="decimal" value="${today?.sleep ?? ''}" placeholder="e.g. 7.5"></div>
          <div class="field"><label for="screen">Screen time today</label><span class="hint">Hours, roughly</span>
            <input type="number" id="screen" min="0" max="20" step="0.5" inputmode="decimal" value="${today?.screen ?? ''}" placeholder="e.g. 3"></div>
          <div class="field"><label for="exertion">Symptom rise during activity</label><span class="hint">0 = none, 10 = much worse</span>
            <input type="number" id="exertion" min="0" max="10" step="1" inputmode="numeric" value="${today?.exertion ?? ''}" placeholder="0–10"></div>
        </div>
        <div class="field" style="margin-top:14px"><label for="note">Notes</label>
          <textarea id="note" placeholder="Anything that helped or made things worse?">${esc(today?.note)}</textarea></div>
      </div>
      <div class="callout warn" style="margin-top:16px">Are any symptoms severe or getting worse fast? <button type="button" class="link-btn" id="flags-inline">See urgent signs</button></div>
      <div class="sticky-save">
        <div class="total" aria-live="polite"></div>
        <button class="btn" type="submit">${today ? 'Update' : 'Save check-in'}</button>
      </div>
    </form>
  </div>`;

  const form = $('#checkin');
  const read = () => SYMPTOMS.map((_, i) => Number(form.querySelector(`input[name="s${i}"]:checked`)?.value || 0));
  const updateTotal = () => {
    const s = read();
    form.querySelector('.total').innerHTML = `Score <b>${symptomTotal(s)}</b> / ${MAX_SCORE} · ${symptomCount(s)} symptoms`;
  };
  updateTotal();
  form.addEventListener('change', updateTotal);
  $('#flags-inline').addEventListener('click', () => $('#urgent').showModal());
  main.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const num = (id, lo, hi) => { const v = $(id).value; return v === '' ? null : Math.min(hi, Math.max(lo, Number(v))); };
    const entry = { date: today?.date ?? Date.now(), scores: read(), sleep: num('#sleep', 0, 16), screen: num('#screen', 0, 20), exertion: num('#exertion', 0, 10), note: $('#note').value.trim() };
    state.checkins = state.checkins.filter((c) => c !== today).concat(entry);
    save();
    const ex = entry.exertion ?? 0;
    toast(ex > 2 ? 'Saved. Symptoms rose more than 2/10 with activity, so stay at this stage today.' : 'Check-in saved. Nice work.');
    renderToday();
  });
}

// ---------- Brain check ----------
let checkCleanup = [];
function cleanupCheck() { checkCleanup.forEach((f) => f()); checkCleanup = []; }

function compareLine(type, value, lowerIsBetter, unit) {
  const hist = checksOf(type).map((c) => c.value);
  const z = personalZ(value, hist.slice(-8), lowerIsBetter);
  if (z.status !== 'ok') return `<p class="muted">After ${z.need - z.n} more result(s), Stepwise will compare each one with your own typical.</p>`;
  const tone = z.flag === 'notably worse' ? 'warn' : z.flag === 'notably better' ? 'good' : '';
  return `<p class="callout ${tone}">${z.flag === 'typical' ? 'Within your usual range' : `<strong>${z.flag[0].toUpperCase() + z.flag.slice(1)}</strong> than usual`}: your typical is ${Math.round(z.typical * 10) / 10}${unit}. ${z.flag === 'notably worse' ? 'Tiredness, stress or time of day can do this. Consider a lighter day.' : ''}</p>`;
}

function renderCheck() {
  const rts = checksOf('reaction'), spans = checksOf('span');
  main.innerHTML = `
  <div class="stack">
    <p class="callout">These quick games track <strong>your own</strong> change over time. They aren't diagnostic tests. Take them at a similar time of day, on the same device, when you're not already tired.</p>
    <div class="grid two">
      <section class="card" aria-labelledby="rt-h">
        <div class="card-head"><h2 id="rt-h">Reaction time</h2><span class="muted">5 taps · ~30 sec</span></div>
        <p class="muted">When the box turns green, tap it (or press Space) as fast as you can.</p>
        <button class="pad" id="pad" type="button">Tap to start</button>
        <div id="rt-out" aria-live="polite" style="margin-top:12px"></div>
      </section>
      <section class="card" aria-labelledby="ds-h">
        <div class="card-head"><h2 id="ds-h">Number memory</h2><span class="muted">~1 min</span></div>
        <p class="muted">Watch the digits, then type them back in order. Each round adds one digit.</p>
        <div class="digits" id="digits" aria-live="assertive">–</div>
        <form id="ds-form" class="row" hidden>
          <label for="ds-in" class="sr-only" style="position:absolute;left:-999px">Digits you saw</label>
          <input id="ds-in" type="text" inputmode="numeric" autocomplete="off" pattern="[0-9]*" style="flex:1;min-width:140px;font-size:1.3rem;letter-spacing:.1em" placeholder="Type the digits">
          <button class="btn" type="submit">Check</button>
        </form>
        <button class="btn" id="ds-start" type="button">Start</button>
        <div id="ds-out" aria-live="polite" style="margin-top:12px"></div>
      </section>
    </div>
    <section class="card">
      <div class="card-head"><h2>Reaction time over time</h2><span class="muted">Lower is faster</span></div>
      <div id="rt-chart" class="chart"></div>
      <div class="legend-line"><span><i class="swatch"></i>Median of 5 taps (ms)</span></div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Recent results</h2></div>
      ${rts.length || spans.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Reaction (ms)</th><th>Digits remembered</th></tr></thead><tbody>
        ${[...new Set([...rts, ...spans].map((c) => dayKey(c.date)))].sort().reverse().slice(0, 10).map((k) => {
          const r = rts.filter((c) => dayKey(c.date) === k).pop(); const s = spans.filter((c) => dayKey(c.date) === k).pop();
          return `<tr><td>${fmtDate(new Date(k + 'T12:00:00'))}</td><td>${r ? Math.round(r.value) : '–'}</td><td>${s ? s.value : '–'}</td></tr>`;
        }).join('')}</tbody></table></div>` : '<p class="muted">No results yet.</p>'}
    </section>
  </div>`;
  lineChart($('#rt-chart'), { data: rts.map((c) => ({ date: c.date, y: c.value })), unit: ' ms', empty: 'Complete a reaction test to start your chart.', label: 'Reaction time' });
  setupReaction();
  setupSpan();
}

function setupReaction() {
  const pad = $('#pad'), out = $('#rt-out');
  let phase = 'idle', timer, t0 = 0, times = [];
  const TRIALS = 5;
  const arm = () => {
    phase = 'wait'; pad.className = 'pad wait'; pad.textContent = `Wait for green… (${times.length + 1}/${TRIALS})`;
    timer = setTimeout(() => { phase = 'go'; pad.className = 'pad go'; pad.textContent = 'Tap!'; t0 = performance.now(); }, 1500 + Math.random() * 2500);
  };
  const hit = (e) => {
    if (e.type === 'keydown' && e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (phase === 'idle' || phase === 'done') { times = []; out.innerHTML = ''; arm(); return; }
    if (phase === 'wait') { clearTimeout(timer); pad.className = 'pad'; pad.textContent = 'Too soon. Tap to retry this one.'; phase = 'retry'; return; }
    if (phase === 'retry') { arm(); return; }
    if (phase === 'go') {
      times.push(performance.now() - t0);
      if (times.length < TRIALS) { pad.className = 'pad'; phase = 'retry'; pad.textContent = `${Math.round(times.at(-1))} ms · tap for next`; return; }
      const value = median(times);
      phase = 'done'; pad.className = 'pad'; pad.textContent = 'Done · tap to go again';
      const cmp = compareLine('reaction', value, true, ' ms');
      state.checks.push({ date: Date.now(), type: 'reaction', value });
      save();
      out.innerHTML = `<p class="result">Median: <b>${Math.round(value)}</b> ms</p>${cmp}`;
      lineChart($('#rt-chart'), { data: checksOf('reaction').map((c) => ({ date: c.date, y: c.value })), unit: ' ms', label: 'Reaction time' });
    }
  };
  pad.addEventListener('pointerdown', hit);
  pad.addEventListener('keydown', hit);
  checkCleanup.push(() => clearTimeout(timer));
}

function setupSpan() {
  const box = $('#digits'), form = $('#ds-form'), input = $('#ds-in'), start = $('#ds-start'), out = $('#ds-out');
  let len = 3, misses = 0, best = 0, seq = '', timers = [];
  const clear = () => { timers.forEach(clearTimeout); timers = []; };
  checkCleanup.push(clear);
  const round = () => {
    seq = Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join('');
    form.hidden = true; start.hidden = true; box.textContent = '';
    [...seq].forEach((d, i) => {
      timers.push(setTimeout(() => { box.textContent = d; }, i * 1000 + 400));
      timers.push(setTimeout(() => { box.textContent = ''; }, i * 1000 + 1100));
    });
    timers.push(setTimeout(() => { box.textContent = '?'; form.hidden = false; input.value = ''; input.focus(); }, len * 1000 + 500));
  };
  const finish = () => {
    form.hidden = true; start.hidden = false; start.textContent = 'Play again';
    box.textContent = best || '–';
    const cmp = compareLine('span', best, false, ' digits');
    state.checks.push({ date: Date.now(), type: 'span', value: best });
    save();
    out.innerHTML = `<p class="result">You remembered <b>${best}</b> digits in order.</p>${cmp}`;
  };
  start.addEventListener('click', () => { len = 3; misses = 0; best = 0; out.innerHTML = ''; round(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (input.value.replace(/\D/g, '') === seq) {
      best = len; misses = 0; out.innerHTML = '<p class="muted">Correct.</p>';
      if (len >= 9) return finish();
      len++; round();
    } else {
      misses++;
      if (misses >= 2) return finish();
      out.innerHTML = `<p class="muted">Not quite. It was ${seq}. One more try at ${len} digits.</p>`;
      round();
    }
  });
}

// ---------- Plan ----------
function renderPlan() {
  const r = readiness({ stage: state.stage, stageSince: state.stageSince, checkins: state.checkins, clearance: state.clearance });
  main.innerHTML = `
  <div class="stack">
    <div class="grid two">
      <section class="card">
        <div class="eyebrow">You're at stage ${state.stage}</div>
        <h2>${stageOf(state.stage).name}</h2>
        <p class="muted">${stageOf(state.stage).examples}</p>
        <h3 style="margin-top:16px">${r.done ? 'Plan complete' : `Ready for stage ${r.next.id}?`}</h3>
        <ul class="reasons">${r.reasons.map((x) => `<li>${x.ok ? ICON.ok : ICON.no}<span>${x.text}</span></li>`).join('')}</ul>
        ${r.next?.needsClearance ? `<label class="check" style="margin-bottom:14px"><input type="checkbox" id="clear" ${state.clearance ? 'checked' : ''}><span>A healthcare professional has cleared me for contact activity</span></label>` : ''}
        <div class="row">
          ${r.done ? '' : `<button class="btn" id="advance" ${r.ok ? '' : 'disabled'}>Move to stage ${r.next.id}</button>`}
          ${state.stage > 1 ? '<button class="btn-secondary" id="back">Step back a stage</button>' : ''}
        </div>
        ${r.ok || r.done ? '' : '<p class="muted" style="margin-top:10px;font-size:.9rem">Symptoms flared during activity? That\'s normal. Rest for the day and try the same stage tomorrow.</p>'}
      </section>
      <section class="card">
        <h2>Return to school or work</h2>
        <ul class="reasons">
          <li>${ICON.ok}<span>Start with daily activities that don't make symptoms worse. Brief screen and reading time is fine.</span></li>
          <li>${ICON.ok}<span>Add schoolwork or work tasks at home, in 20–30 minute blocks.</span></li>
          <li>${ICON.ok}<span>Go back part-time with adjustments: breaks, a quiet space, fewer deadlines.</span></li>
          <li>${ICON.ok}<span>Build up to full days as you tolerate them. Getting back to learning comes before full-contact sport.</span></li>
        </ul>
        <p class="muted" style="font-size:.9rem">Share your check-in summary with teachers or your manager to ask for adjustments.</p>
        <button class="btn-secondary" data-go="summary">Open summary for my care team</button>
      </section>
    </div>
    <section class="card">
      <h2>The six steps</h2>
      <p class="muted">At least 24 hours per step. If symptoms rise by more than 2 out of 10 during activity, stop and try again the next day. Adapted from the 2023 Amsterdam international consensus on concussion in sport.</p>
      <ol class="ladder">${STAGES.map((s) => `
        <li class="${s.id < state.stage ? 'done' : s.id === state.stage ? 'current' : ''}" ${s.id === state.stage ? 'aria-current="step"' : ''}>
          <span class="num">${s.id < state.stage ? '✓' : s.id}</span>
          <div><div class="name">${s.name}${s.needsClearance ? '<span class="tag">Needs clearance</span>' : ''}</div>
          <div class="meta">${s.goal}. ${s.examples}</div></div>
        </li>`).join('')}
      </ol>
    </section>
  </div>`;
  $('#clear')?.addEventListener('change', (e) => { state.clearance = e.target.checked; save(); renderPlan(); });
  $('#advance')?.addEventListener('click', () => { state.stage++; state.stageSince = Date.now(); save(); toast(`Moved to stage ${state.stage}. Go gently.`); renderPlan(); });
  $('#back')?.addEventListener('click', () => { state.stage--; state.stageSince = Date.now(); save(); toast('Stepped back. That\'s part of recovery, not a setback.'); renderPlan(); });
  main.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
}

// ---------- Insights ----------
function renderInsights() {
  const all = sortedCheckins();
  const items = buildInsights(state);
  const trend = symptomTrend(state.checkins);
  let trendLine = null;
  if (trend.status === 'ok') {
    const t0 = all[all.length - trend.n].date;
    trendLine = { t0, slope: trend.slope, intercept: trend.intercept, x0: 0, x1: trend.points.at(-1).x };
  }
  const effects = factorEffects(state.checkins);
  main.innerHTML = `
  <div class="stack">
    <section class="card">
      <div class="card-head"><h2>What your data suggests</h2><span class="muted">${all.length} check-ins</span></div>
      ${items.length ? items.map((it) => `
        <div class="insight ${it.tone}">
          <h3>${it.title}</h3>
          <p>${it.body}</p>
          <details><summary>Why am I seeing this?</summary><p style="margin-top:6px">${it.evidence}</p></details>
        </div>`).join('') : `<p class="muted">Insights appear after about 4 check-ins. Patterns in sleep and screen time need at least 3 days on each side of the comparison. Keep logging; ${Math.max(0, 4 - all.length)} more to go.</p>`}
    </section>
    <section class="card">
      <div class="card-head"><h2>Symptom score</h2><span class="muted">0–${MAX_SCORE}, lower is better</span></div>
      <div id="sym-chart" class="chart"></div>
      <div class="legend-line"><span><i class="swatch"></i>Daily score</span>${trendLine ? '<span><i class="swatch dash"></i>Recent trend</span>' : ''}<span><i class="swatch band"></i>Low zone (5 or less)</span></div>
      <details style="margin-top:12px"><summary class="link-btn">Show as table</summary>
        <div class="table-wrap"><table><thead><tr><th>Date</th><th>Score</th><th>Symptoms</th><th>Sleep</th><th>Screens</th><th>Activity rise</th></tr></thead><tbody>
        ${[...all].reverse().map((c) => `<tr><td>${fmtDate(c.date)}</td><td>${symptomTotal(c.scores)}</td><td>${symptomCount(c.scores)}</td><td>${c.sleep ?? '–'}</td><td>${c.screen ?? '–'}</td><td>${c.exertion ?? '–'}</td></tr>`).join('')}
        </tbody></table></div></details>
    </section>
    <section class="card">
      <h2>What seems to affect you</h2>
      <p class="muted">Next-day symptoms, compared with your overall recovery trend. Positive numbers mean worse symptoms after the first kind of day.</p>
      <div class="table-wrap"><table><thead><tr><th>After days with…</th><th>vs.</th><th>Difference</th><th>Days compared</th><th>Strength</th></tr></thead><tbody>
        ${effects.map((f) => `<tr><td>${f.lowIs}</td><td>${f.highIs}</td><td>${f.enough ? (f.diff > 0 ? '+' : '') + f.diff.toFixed(1) : '–'}</td><td>${f.nLow} / ${f.nHigh}</td><td>${f.enough ? f.strength : 'not enough data'}</td></tr>`).join('')}
      </tbody></table></div>
    </section>
    <section class="card">
      <h2>How Stepwise's insights work</h2>
      <ul class="reasons">
        <li>${ICON.ok}<span><strong>On your device.</strong> Every calculation runs in your browser. No account, no server-side data, no third-party analytics.</span></li>
        <li>${ICON.ok}<span><strong>Robust, simple models.</strong> Trends use the Theil–Sen estimator, so one bad day doesn't skew the result. Patterns compare your own days using effect sizes (Cohen's d), adjusted for your overall recovery trend.</span></li>
        <li>${ICON.ok}<span><strong>Honest about uncertainty.</strong> Each insight shows how many days it's based on and how confident it is. Weak patterns are hidden, and nothing appears until there's enough data.</span></li>
        <li>${ICON.ok}<span><strong>You compared with you.</strong> Brain checks are compared with your own history, not a population norm that may not fit you.</span></li>
        <li>${ICON.no}<span><strong>Not medical advice.</strong> Stepwise never diagnoses, and it won't let you skip clearance for contact activity. Correlations aren't causes.</span></li>
      </ul>
    </section>
    <section class="card no-print">
      <h2>Your data</h2>
      <div class="row">
        <button class="btn-secondary" data-go="summary">Summary for my care team</button>
        <button class="btn-secondary" id="export">Download my data (JSON)</button>
        <button class="btn-secondary" id="wipe" style="color:var(--crit)">Delete everything</button>
      </div>
    </section>
  </div>`;
  lineChart($('#sym-chart'), { data: all.map((c) => ({ date: c.date, y: symptomTotal(c.scores) })), band: [0, 5], trend: trendLine, yMin: 0, unit: '', label: 'Score', empty: 'Your chart starts with your first check-in.' });
  main.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  $('#export').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
    a.download = `stepwise-${dayKey(Date.now())}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#wipe').addEventListener('click', () => {
    if (!confirm('Delete all Stepwise data on this device? This cannot be undone.')) return;
    state = fresh(); save(); current = 'today'; render(); toast('All data deleted');
  });
}

// ---------- Care-team summary (printable) ----------
function renderSummary() {
  const all = sortedCheckins();
  const recent = all.slice(-3);
  const avg = SYMPTOMS.map((name, i) => ({ name, v: mean(recent.map((c) => c.scores[i] || 0)) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 6);
  const trend = symptomTrend(state.checkins);
  const rts = checksOf('reaction');
  main.innerHTML = `
  <div class="stack">
    <div class="row no-print"><button class="btn-secondary" data-go="insights">← Back</button><button class="btn" id="print">Print or save as PDF</button></div>
    <section class="card">
      <div class="eyebrow">Stepwise recovery summary · ${new Date().toLocaleDateString()}</div>
      <h1>Concussion recovery log</h1>
      <p>Injury date: <b>${new Date(state.injuryDate).toLocaleDateString()}</b> · Current activity stage: <b>${state.stage}, ${stageOf(state.stage).name}</b> · Check-ins logged: <b>${all.length}</b></p>
      ${trend.status === 'ok' ? `<p>Symptom trend over last ${trend.n} check-ins: <b>${trend.direction}</b> (${(trend.slope * 7).toFixed(1)} points/week, robust estimate).</p>` : ''}
      ${avg.length ? `<p>Most prominent symptoms (last ${recent.length} check-ins, average 0–6): ${avg.map((a) => `${a.name} ${a.v.toFixed(1)}`).join(' · ')}</p>` : ''}
      ${rts.length ? `<p>Reaction time: first ${Math.round(rts[0].value)} ms → latest ${Math.round(rts.at(-1).value)} ms (${rts.length} tests).</p>` : ''}
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Score /${MAX_SCORE}</th><th>Symptoms /22</th><th>Sleep h</th><th>Screen h</th><th>Activity rise /10</th><th>Notes</th></tr></thead><tbody>
      ${[...all].reverse().slice(0, 21).map((c) => `<tr><td>${fmtDate(c.date)}</td><td>${symptomTotal(c.scores)}</td><td>${symptomCount(c.scores)}</td><td>${c.sleep ?? '–'}</td><td>${c.screen ?? '–'}</td><td>${c.exertion ?? '–'}</td><td>${esc(c.note)}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted" style="margin-top:12px;font-size:.85rem">Self-reported using the 22-item symptom scale (0–6 each). Brain-check results are informal, self-administered and not validated clinical measures.</p>
    </section>
  </div>`;
  $('#print').addEventListener('click', () => window.print());
  main.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
}

// ---------- Chart (single series, SVG, crosshair tooltip) ----------
function lineChart(el, { data, band, trend, yMin, unit = '', label = 'Value', empty = 'No data yet.' }) {
  if (!data.length) { el.innerHTML = `<p class="muted">${empty}</p>`; return; }
  const W = Math.max(280, el.clientWidth || 600), H = 220, m = { l: 40, r: 16, t: 12, b: 28 };
  const xs = data.map((d) => d.date), ys = data.map((d) => d.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x0 === x1) { x0 -= DAY; x1 += DAY; }
  const lo = yMin ?? Math.min(...ys) * 0.9, hiRaw = Math.max(...ys, band ? band[1] * 2 : 0);
  const step = niceStep((hiRaw - lo) / 4);
  const hi = Math.ceil(hiRaw / step) * step || step;
  const yLo = Math.floor(lo / step) * step;
  const X = (t) => m.l + ((t - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v) => H - m.b - ((v - yLo) / (hi - yLo)) * (H - m.t - m.b);
  const ticks = []; for (let v = yLo; v <= hi + 1e-9; v += step) ticks.push(v);
  const nX = Math.min(data.length, W < 500 ? 3 : 5);
  const xt = Array.from({ length: nX }, (_, i) => x0 + ((x1 - x0) * i) / Math.max(1, nX - 1));
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${X(d.date).toFixed(1)},${Y(d.y).toFixed(1)}`).join('');
  let trendSvg = '';
  if (trend) {
    const tA = trend.t0 + trend.x0 * DAY, tB = trend.t0 + trend.x1 * DAY;
    const yA = trend.intercept + trend.slope * trend.x0, yB = trend.intercept + trend.slope * trend.x1;
    trendSvg = `<path class="trend" d="M${X(tA)},${Y(Math.max(yLo, yA))}L${X(tB)},${Y(Math.max(yLo, yB))}"/>`;
  }
  el.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label} over time, ${data.length} points, latest ${Math.round(ys.at(-1))}${unit}">
      ${band ? `<rect class="band" x="${m.l}" y="${Y(band[1])}" width="${W - m.l - m.r}" height="${Y(band[0]) - Y(band[1])}" rx="4"/>` : ''}
      <g class="axis">${ticks.map((v) => `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`).join('')}
        ${xt.map((t, i) => `<text x="${X(t)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === nX - 1 ? 'end' : 'middle'}">${fmtDate(t)}</text>`).join('')}</g>
      ${trendSvg}
      <path class="series" d="${path}"/>
      ${data.length <= 40 ? data.map((d) => `<circle class="dot" cx="${X(d.date)}" cy="${Y(d.y)}" r="4"/>`).join('') : ''}
      <circle class="dot" cx="${X(xs.at(-1))}" cy="${Y(ys.at(-1))}" r="5"/>
      <text class="label" x="${Math.min(X(xs.at(-1)), W - m.r)}" y="${Y(ys.at(-1)) - 12}" text-anchor="end">${Math.round(ys.at(-1))}${unit}</text>
      <g class="hover" style="display:none"><line class="cross" y1="${m.t}" y2="${H - m.b}"/><circle class="dot" r="6"/></g>
      <rect x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent" class="hit"/>
    </svg><div class="tip" hidden></div>`;
  const svg = el.querySelector('svg'), hov = el.querySelector('.hover'), tip = el.querySelector('.tip');
  const move = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    data.forEach((d, i) => { if (Math.abs(X(d.date) - px) < Math.abs(X(data[best].date) - px)) best = i; });
    const d = data[best], cx = X(d.date), cy = Y(d.y);
    hov.style.display = '';
    hov.querySelector('line').setAttribute('x1', cx); hov.querySelector('line').setAttribute('x2', cx);
    hov.querySelector('circle').setAttribute('cx', cx); hov.querySelector('circle').setAttribute('cy', cy);
    tip.hidden = false;
    tip.innerHTML = `${fmtDate(d.date)}<br>${label}: <b>${Math.round(d.y)}${unit}</b>`;
    const sx = (cx / W) * r.width, sy = (cy / H) * r.height;
    tip.style.left = `${Math.min(Math.max(0, sx - tip.offsetWidth / 2), r.width - tip.offsetWidth)}px`;
    tip.style.top = `${Math.max(0, sy - tip.offsetHeight - 14)}px`;
  };
  const leave = () => { hov.style.display = 'none'; tip.hidden = true; };
  const hit = el.querySelector('.hit');
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', leave);
}
function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

// Redraw charts only when the width changes (mobile scrolling fires height-only
// resizes), and never re-render the brain check mid-test.
let resizeT, lastW = window.innerWidth;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    if (current === 'insights') render();
    else if (current === 'check') lineChart($('#rt-chart'), { data: checksOf('reaction').map((c) => ({ date: c.date, y: c.value })), unit: ' ms', label: 'Reaction time', empty: 'Complete a reaction test to start your chart.' });
  }, 200);
});

go(current);
