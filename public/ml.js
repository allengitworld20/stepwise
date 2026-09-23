// Stepwise recovery model.
// Small, explainable, on-device statistics. Every output carries the evidence
// behind it (n, effect size, confidence) so a person can judge it themselves.
// Nothing here diagnoses; it summarises what the user logged.

export const SYMPTOMS = [
  'Headache', 'Pressure in head', 'Neck pain', 'Nausea or vomiting', 'Dizziness',
  'Blurred vision', 'Balance problems', 'Sensitivity to light', 'Sensitivity to noise',
  'Feeling slowed down', 'Feeling like "in a fog"', "Don't feel right",
  'Difficulty concentrating', 'Difficulty remembering', 'Fatigue or low energy',
  'Confusion', 'Drowsiness', 'More emotional', 'Irritability', 'Sadness',
  'Nervous or anxious', 'Trouble falling asleep',
];
export const MAX_SCORE = SYMPTOMS.length * 6; // 132

// Signs that need urgent medical care, not an app.
export const RED_FLAGS = [
  'Headache that is severe or getting worse',
  'Repeated vomiting',
  'Seizure or convulsion',
  'Loss of consciousness',
  'Increasing confusion, agitation or unusual behaviour',
  'Weakness, numbness or tingling in arms or legs',
  'Slurred speech',
  'Double vision',
  'Cannot be woken up or is very drowsy',
  'Neck pain or tenderness that is severe',
];

// Graduated return-to-activity strategy, adapted from the 2023 Amsterdam
// international consensus on concussion in sport.
export const STAGES = [
  { id: 1, name: 'Symptom-limited activity', goal: 'Gradual reintroduction of work, school and daily life',
    examples: 'Short walks, reading in brief blocks, light chores. Screen time in short sessions.' },
  { id: 2, name: 'Light to moderate aerobic', goal: 'Raise heart rate',
    examples: 'Walking or stationary cycling at slow to medium pace. Start light, then build.' },
  { id: 3, name: 'Individual sport-specific exercise', goal: 'Add movement',
    examples: 'Running or skating drills away from the team. No head impact activities.' },
  { id: 4, name: 'Non-contact training drills', goal: 'Exercise, coordination and thinking',
    examples: 'Harder training drills, passing drills. May add progressive resistance training.' },
  { id: 5, name: 'Full contact practice', goal: 'Restore confidence, let coaches assess skills',
    examples: 'Normal training activities. Only after clearance from a healthcare professional.',
    needsClearance: true },
  { id: 6, name: 'Return to sport', goal: 'Normal game play', examples: 'Back to full competition.', needsClearance: true },
];

export const DAY = 86400000;

export function symptomTotal(scores) {
  return (scores || []).reduce((a, b) => a + (Number(b) || 0), 0);
}
export function symptomCount(scores) {
  return (scores || []).filter((s) => Number(s) > 0).length;
}

export function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN; }
export function median(xs) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function stdev(xs) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

// Theil–Sen estimator: median of pairwise slopes. Robust to the odd bad day,
// which a plain least-squares fit would chase.
export function theilSen(points) {
  if (points.length < 2) return null;
  const slopes = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j].x - points[i].x;
      if (dx !== 0) slopes.push((points[j].y - points[i].y) / dx);
    }
  }
  if (!slopes.length) return null;
  const slope = median(slopes);
  const intercept = median(points.map((p) => p.y - slope * p.x));
  // Bootstrap-free confidence proxy: share of pairwise slopes agreeing in sign.
  const agree = slopes.filter((s) => Math.sign(s) === Math.sign(slope)).length / slopes.length;
  return { slope, intercept, agreement: agree, n: points.length };
}

// Pearson correlation.
export function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : NaN;
}

const byDate = (a, b) => a.date - b.date;
const dayIndex = (t, t0) => Math.round((t - t0) / DAY);

// Symptom trend over the most recent `window` check-ins.
export function symptomTrend(checkins, window = 10) {
  const recent = [...checkins].sort(byDate).slice(-window);
  if (recent.length < 4) return { status: 'insufficient', n: recent.length, need: 4 };
  const t0 = recent[0].date;
  const pts = recent.map((c) => ({ x: dayIndex(c.date, t0), y: symptomTotal(c.scores) }));
  const fit = theilSen(pts);
  const last = pts[pts.length - 1];
  const current = fit.intercept + fit.slope * last.x;
  let direction = 'steady';
  if (fit.slope <= -0.5) direction = 'improving';
  else if (fit.slope >= 0.5) direction = 'worsening';
  let daysToLow = null;
  const LOW = 5; // near-baseline symptom burden
  if (fit.slope < -0.25 && current > LOW) daysToLow = Math.ceil((current - LOW) / -fit.slope);
  const confidence = fit.n >= 8 && fit.agreement >= 0.75 ? 'moderate' : 'low';
  return { status: 'ok', ...fit, direction, current, daysToLow, confidence, points: pts };
}

// Which logged daily factors move with symptoms? Compares next-day symptom
// totals on days split at a sensible threshold, and reports the difference,
// the correlation and the sample sizes.
export const FACTORS = [
  { key: 'sleep', label: 'sleep', unit: 'h', split: 7, lowIs: 'under 7 hours of sleep', highIs: '7+ hours of sleep' },
  { key: 'screen', label: 'screen time', unit: 'h', split: 4, lowIs: 'under 4 hours of screens', highIs: '4+ hours of screens' },
  { key: 'exertion', label: 'symptom increase during activity', unit: '/10', split: 3, lowIs: 'mild or no flare-ups', highIs: 'a flare-up of 3+ points' },
];

export function factorEffects(checkins) {
  const sorted = [...checkins].sort(byDate);
  // Symptoms fall over time regardless, so compare each day against the
  // overall recovery trend instead of its raw score. Otherwise anything that
  // drifts with time (more sleep as you heal) looks like a cause.
  let expected = () => 0;
  if (sorted.length >= 4) {
    const t0 = sorted[0].date;
    const fit = theilSen(sorted.map((c) => ({ x: dayIndex(c.date, t0), y: symptomTotal(c.scores) })));
    if (fit) expected = (c) => fit.intercept + fit.slope * dayIndex(c.date, t0);
  }
  const out = [];
  for (const f of FACTORS) {
    // Pair factor on day d with symptoms on the next logged day (within 36h).
    const pairs = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const v = sorted[i][f.key];
      if (v == null || v === '') continue;
      const next = sorted[i + 1];
      if (next.date - sorted[i].date > 1.5 * DAY) continue;
      pairs.push({ x: Number(v), y: symptomTotal(next.scores) - expected(next) });
    }
    const low = pairs.filter((p) => p.x < f.split).map((p) => p.y);
    const high = pairs.filter((p) => p.x >= f.split).map((p) => p.y);
    const r = pearson(pairs.map((p) => p.x), pairs.map((p) => p.y));
    const enough = low.length >= 3 && high.length >= 3;
    const diff = enough ? mean(low) - mean(high) : NaN;
    // Pooled standard deviation -> Cohen's d, for a sense of size.
    let d = NaN;
    if (enough) {
      const sp = Math.sqrt(((low.length - 1) * stdev(low) ** 2 + (high.length - 1) * stdev(high) ** 2) / (low.length + high.length - 2));
      // Scores are whole numbers, so floor the spread at half a point.
      d = diff / Math.max(sp, 0.5);
    }
    out.push({ ...f, n: pairs.length, nLow: low.length, nHigh: high.length, meanLow: mean(low), meanHigh: mean(high), diff, r, d, enough,
      strength: !enough || !isFinite(d) ? 'none' : Math.abs(d) >= 0.8 ? 'strong' : Math.abs(d) >= 0.5 ? 'moderate' : Math.abs(d) >= 0.2 ? 'weak' : 'none' });
  }
  return out;
}

// Compare today's brain-check result with the person's own recent results.
// Lower is better for reaction time; higher is better for digit span.
export function personalZ(value, history, lowerIsBetter) {
  if (history.length < 3) return { status: 'insufficient', n: history.length, need: 3 };
  const m = median(history);
  const s = stdev(history) || 1;
  const z = (value - m) / s;
  const better = lowerIsBetter ? z < 0 : z > 0;
  const flag = Math.abs(z) >= 1.5 ? (better ? 'notably better' : 'notably worse') : 'typical';
  return { status: 'ok', z, typical: m, flag, n: history.length };
}

// Should the person consider moving to the next stage? Rules follow the
// consensus: at least 24h at the current stage, no more than a mild (≤2/10)
// symptom increase during activity, and clearance before contact.
export function readiness({ stage, stageSince, checkins, clearance, now = Date.now() }) {
  const reasons = [];
  let ok = true;
  const s = STAGES.find((x) => x.id === stage) || STAGES[0];
  const next = STAGES.find((x) => x.id === stage + 1);
  if (!next) return { ok: false, done: true, reasons: [{ ok: true, text: 'You have completed the return-to-activity steps.' }] };

  const hours = (now - stageSince) / 3600000;
  const timeOk = hours >= 24;
  reasons.push({ ok: timeOk, text: timeOk ? `${Math.floor(hours / 24)} day(s) at "${s.name}" (need at least 1)` : `${Math.floor(hours)}h at this stage; wait at least 24h before moving on` });
  ok = ok && timeOk;

  const sinceStage = checkins.filter((c) => c.date >= stageSince - DAY / 2).sort(byDate);
  const latest = sinceStage[sinceStage.length - 1];
  if (!latest) {
    reasons.push({ ok: false, text: 'Log a check-in at this stage first' });
    ok = false;
  } else {
    const ex = Number(latest.exertion ?? 0);
    const exOk = ex <= 2;
    reasons.push({ ok: exOk, text: exOk ? `Symptoms rose by ${ex}/10 or less during activity (mild is OK)` : `Symptoms rose by ${ex}/10 during activity. Stay at this stage and try again tomorrow` });
    ok = ok && exOk;
  }

  const trend = symptomTrend(checkins, 7);
  if (trend.status === 'ok') {
    const tOk = trend.direction !== 'worsening';
    reasons.push({ ok: tOk, text: tOk ? `Recent symptom trend is ${trend.direction}` : 'Symptoms are trending up this week. Hold here and talk to your clinician' });
    ok = ok && tOk;
  }

  if (next.needsClearance) {
    reasons.push({ ok: !!clearance, text: clearance ? 'Cleared by a healthcare professional' : `"${next.name}" needs clearance from a healthcare professional` });
    ok = ok && !!clearance;
  }
  return { ok, next, reasons };
}

// Plain-language insights, each with its evidence attached.
export function buildInsights(state) {
  const items = [];
  const t = symptomTrend(state.checkins);
  if (t.status === 'ok') {
    const perWeek = Math.abs(t.slope * 7).toFixed(1);
    if (t.direction === 'improving') {
      items.push({ tone: 'good', title: 'Symptoms are easing',
        body: `Your symptom score is falling by about ${perWeek} points a week.` + (t.daysToLow ? ` If this pace holds, you could be near a low score (≤5) in about ${t.daysToLow} days. Recovery is rarely a straight line, so treat this as a rough guide.` : ''),
        evidence: `Robust trend (Theil–Sen) over ${t.n} check-ins · ${(t.agreement * 100).toFixed(0)}% of day-pairs agree · confidence ${t.confidence}` });
    } else if (t.direction === 'worsening') {
      items.push({ tone: 'warn', title: 'Symptoms are creeping up',
        body: `Your score is rising by about ${perWeek} points a week. Consider stepping back a stage, and tell your clinician if it continues.`,
        evidence: `Robust trend (Theil–Sen) over ${t.n} check-ins · confidence ${t.confidence}` });
    } else {
      items.push({ tone: 'neutral', title: 'Symptoms are holding steady',
        body: 'No clear upward or downward trend right now. Plateaus are common. Keep logging.',
        evidence: `Robust trend over ${t.n} check-ins, slope ${t.slope.toFixed(2)}/day` });
    }
  }
  for (const f of factorEffects(state.checkins)) {
    if (f.strength === 'none' || f.strength === 'weak') continue;
    const worseOnLow = f.diff > 0;
    const worse = worseOnLow ? f.lowIs : f.highIs;
    const better = worseOnLow ? f.highIs : f.lowIs;
    items.push({ tone: 'neutral', title: `Pattern: ${f.label}`,
      body: `The day after ${worse}, your symptom score was ${Math.abs(f.diff).toFixed(1)} points higher than after ${better}, after allowing for your overall recovery trend.`,
      evidence: `${f.strength} association (Cohen's d ${Math.abs(f.d).toFixed(2)}, r ${f.r.toFixed(2)}) · ${f.nLow} vs ${f.nHigh} days. Correlation, not proof of cause.` });
  }
  const rts = state.checks.filter((c) => c.type === 'reaction').sort(byDate);
  if (rts.length >= 4) {
    const last = rts[rts.length - 1];
    const z = personalZ(last.value, rts.slice(-8, -1).map((c) => c.value), true);
    if (z.status === 'ok' && z.flag !== 'typical') {
      items.push({ tone: z.flag === 'notably worse' ? 'warn' : 'good', title: `Reaction time ${z.flag}`,
        body: `Your latest reaction time (${Math.round(last.value)} ms) is ${z.flag} than your recent typical (${Math.round(z.typical)} ms).` + (z.flag === 'notably worse' ? ' Tiredness can cause this too. A lighter day may help.' : ''),
        evidence: `Compared with your own last ${z.n} results · z = ${z.z.toFixed(1)}` });
    }
  }
  return items;
}

// Two weeks of plausible recovery data, for demos.
export function demoData(now = Date.now()) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const checkins = [], checks = [];
  const days = 16;
  for (let i = days; i >= 1; i--) {
    const date = now - i * DAY;
    const progress = (days - i) / days;
    const sleep = Math.round((5.5 + rnd() * 3) * 2) / 2;
    const screen = Math.round((2 + rnd() * 5) * 2) / 2;
    const prev = checkins[checkins.length - 1];
    const penalty = prev ? (prev.sleep < 7 ? 5 : 0) + (prev.screen >= 4 ? 4 : 0) : 0;
    const base = 48 * (1 - progress) ** 1.4 + 3 + penalty;
    const scores = SYMPTOMS.map((_, k) => {
      const w = [1.4, 1.2, .5, .6, 1, .4, .6, 1.3, 1.1, 1, 1, .9, 1.2, .9, 1.3, .3, .8, .5, .7, .4, .6, .7][k];
      const v = (base / 20) * w + (rnd() - 0.5) * 1.2;
      return Math.max(0, Math.min(6, Math.round(v)));
    });
    const exertion = progress > 0.3 ? Math.round(rnd() * 3) : 0;
    checkins.push({ date, scores, sleep, screen, exertion, note: '' });
    if (i % 2 === 0 || i < 5) {
      checks.push({ date, type: 'reaction', value: 420 - 110 * progress + (rnd() - 0.5) * 40 });
      checks.push({ date, type: 'span', value: Math.min(9, Math.round(4 + 2.5 * progress + (rnd() - 0.5))) });
    }
  }
  return { checkins, checks, stage: 3, stageSince: now - 2 * DAY, clearance: false, injuryDate: now - (days + 2) * DAY, demo: true };
}
