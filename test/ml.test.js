import { test } from 'node:test';
import assert from 'node:assert/strict';
import { theilSen, symptomTrend, factorEffects, personalZ, readiness, buildInsights, demoData, DAY, SYMPTOMS } from '../public/ml.js';

const day = (i, total, extra = {}) => ({ date: i * DAY, scores: SYMPTOMS.map((_, k) => (k < total ? 1 : 0)), ...extra });

test('Theil–Sen ignores a single outlier', () => {
  const pts = [0, 1, 2, 3, 4, 5, 6].map((x) => ({ x, y: 20 - 2 * x }));
  pts[3].y = 80;
  const fit = theilSen(pts);
  assert.ok(Math.abs(fit.slope + 2) < 0.01, `slope ${fit.slope}`);
});

test('trend needs 4 check-ins and detects improvement', () => {
  assert.equal(symptomTrend([day(0, 10), day(1, 9)]).status, 'insufficient');
  const t = symptomTrend([day(0, 20), day(1, 18), day(2, 15), day(3, 13), day(4, 10)]);
  assert.equal(t.direction, 'improving');
  assert.ok(t.daysToLow > 0);
});

test('factor effect is adjusted for the recovery trend', () => {
  // Symptoms fall steadily while sleep rises steadily: no real sleep effect.
  const cs = Array.from({ length: 12 }, (_, i) => day(i, 20 - i, { sleep: 5 + i * 0.4 }));
  const sleep = factorEffects(cs).find((f) => f.key === 'sleep');
  assert.ok(sleep.strength === 'none' || Math.abs(sleep.diff) < 1, JSON.stringify(sleep));
});

test('real sleep effect is found', () => {
  const cs = Array.from({ length: 14 }, (_, i) => {
    const prevShort = i > 0 && (i - 1) % 2 === 0;
    return day(i, 10 + (prevShort ? 6 : 0), { sleep: i % 2 === 0 ? 5 : 8 });
  });
  const sleep = factorEffects(cs).find((f) => f.key === 'sleep');
  assert.ok(sleep.diff > 4 && sleep.strength === 'strong', JSON.stringify(sleep));
});

test('personal z-score flags slow reaction time', () => {
  const z = personalZ(500, [300, 310, 290, 305, 295], true);
  assert.equal(z.flag, 'notably worse');
  assert.equal(personalZ(300, [300], true).status, 'insufficient');
});

test('readiness blocks on flare-up, time and clearance', () => {
  const now = 10 * DAY;
  const base = { stageSince: now - 2 * DAY, clearance: false, now };
  assert.equal(readiness({ ...base, stage: 2, checkins: [day(9, 3, { exertion: 1 })] }).ok, true);
  assert.equal(readiness({ ...base, stage: 2, checkins: [day(9, 3, { exertion: 5 })] }).ok, false);
  assert.equal(readiness({ ...base, stageSince: now - 3600000, stage: 2, checkins: [day(9.99, 3, { exertion: 0 })] }).ok, false);
  assert.equal(readiness({ ...base, stage: 4, checkins: [day(9, 3, { exertion: 0 })] }).ok, false);
  assert.equal(readiness({ ...base, clearance: true, stage: 4, checkins: [day(9, 3, { exertion: 0 })] }).ok, true);
});

test('demo data produces insights', () => {
  const items = buildInsights(demoData());
  assert.ok(items.length >= 2, JSON.stringify(items, null, 1));
});
