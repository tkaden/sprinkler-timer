// Decides whether, when, and how long to water today.
//
// Model: a simple root-zone "bucket". Each day the lawn loses ET0 × Kc inches
// (evapotranspiration) and gains effective rain + whatever we told you to
// water. When the bucket's depletion crosses a trigger, we water it back to
// full — unless real rain is on the way. Brand-new seed is different: it just
// needs the top ¼" of soil kept damp every day, so it gets short daily cycles.
//
// All pure functions — no I/O — so it's easy to test.

/** Turf crop coefficient for cool-season grass (tall fescue / bluegrass). */
export const KC = 0.8;
/** Rain below this barely wets the soil before evaporating. */
export const MIN_EFFECTIVE_RAIN_IN = 0.1;
export const RAIN_EFFICIENCY = 0.8;
/** Olathe soils are silty clay loam: they take water slowly, so cap each cycle. */
export const MAX_CYCLE_IN = 0.3;

export const STAGES = {
  // Days 0–20: keep seed surface moist. Short, daily, possibly multiple cycles.
  germination: { label: 'new seed', maxDays: 21 },
  // Days 21–41: roots are a couple inches deep. Smaller bucket, water more often.
  young: { label: 'young grass', maxDays: 42, triggerIn: 0.2, maxIn: 0.4, capacityIn: 0.4 },
  // Deep, infrequent watering trains deep roots.
  established: { label: 'established lawn', triggerIn: 0.5, maxIn: 1.0, capacityIn: 1.0 },
};

const DAY_MS = 86_400_000;
export const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

export function lawnStage(today, seedDate) {
  if (!seedDate) return { stage: 'established' };
  const age = daysBetween(seedDate, today);
  if (Number.isNaN(age) || age < 0) return { stage: 'established' };
  if (age < STAGES.germination.maxDays) return { stage: 'germination', age };
  if (age < STAGES.young.maxDays) return { stage: 'young', age };
  return { stage: 'established', age };
}

export const effectiveRain = (inches) => (inches >= MIN_EFFECTIVE_RAIN_IN ? inches * RAIN_EFFICIENCY : 0);

/** Rain we can actually count on: amount weighted by probability, ignoring long shots. */
export const expectedRain = (day) => (day && day.popPct >= 50 ? day.rainIn * (day.popPct / 100) : 0);

/**
 * Run the bucket forward over the past days (everything before `todayIdx`),
 * starting full. Returns depletion in inches at the start of today.
 */
export function depletionAtStartOf(days, todayIdx, history, capacityIn) {
  let dep = 0;
  for (let i = 0; i < todayIdx; i++) {
    const d = days[i];
    const irrigated = history[d.date] ?? 0;
    dep += d.et0In * KC - effectiveRain(d.rainIn) - irrigated;
    dep = Math.min(Math.max(dep, 0), capacityIn);
  }
  return dep;
}

const roundTo = (x, step) => Math.round(x / step) * step;

export function minutesFor(inches, rateInPerHr) {
  return Math.max(3, Math.ceil((inches / rateInPerHr) * 60));
}

/** Pick start times, nudging later in the morning when it froze overnight. */
function startTimes(n, today) {
  const frosty = today.loF !== null && today.loF <= 34;
  if (n === 1) return [frosty ? '~11am' : '~9am'];
  if (n === 2) return frosty ? ['~11am', '~2pm'] : ['~7am', '~1pm'];
  return frosty ? ['~10am', '~12pm', '~2pm'] : ['~7am', '~11am', '~3pm'];
}

function cycleSessions(inches, rate, today) {
  const n = Math.max(1, Math.ceil(inches / MAX_CYCLE_IN - 1e-9));
  const per = inches / n;
  const minutes = minutesFor(per, rate);
  const frosty = today.loF !== null && today.loF <= 34;
  // Back-to-back cycle-and-soak: 45 min apart so clay soil can absorb.
  const first = frosty ? 10 : 5;
  return Array.from({ length: n }, (_, i) => ({
    minutes,
    when: formatClock(first * 60 + i * (minutes + 45)),
  }));
}

function formatClock(totalMin) {
  totalMin = Math.round(totalMin / 15) * 15;
  const h24 = Math.floor(totalMin / 60) % 24;
  const m = totalMin % 60;
  const h = ((h24 + 11) % 12) + 1;
  const ap = h24 < 12 ? 'am' : 'pm';
  return m === 0 ? `~${h}${ap}` : `~${h}:${String(m).padStart(2, '0')}${ap}`;
}

/**
 * @param {object} p
 * @param {Array} p.days        normalized weather days (past + forecast)
 * @param {string} p.today      YYYY-MM-DD local date
 * @param {object} p.history    { 'YYYY-MM-DD': inchesWatered }
 * @param {object} p.config     from loadConfig()
 */
export function recommend({ days, today, history = {}, config }) {
  const rec = lawnPlan({ days, today, history, config });
  const patch = lawnStage(today, config.patchDate);
  // Patches only matter while their seed is germinating, and only if the
  // whole lawn isn't already on the germination schedule.
  if (config.patchDate && patch.stage === 'germination' && rec.stage !== 'germination') {
    const idx = days.findIndex((d) => d.date === today);
    const t = days[idx];
    const plan = t.hiF !== null && t.hiF < 40
      ? { skip: 'too cold' }
      : seedPlan(t, days[idx - 1], config.sprinklerRateInPerHr);
    rec.patch = { age: patch.age, ...plan };
  }
  return rec;
}

/** Light, frequent watering that keeps a fresh seedbed's top 1/4" damp. */
export function seedPlan(t, yesterday, rate) {
  if (yesterday.rainIn >= 0.25) return { skip: `${fmtIn(yesterday.rainIn)} rain yesterday kept the seedbed wet` };
  const need = Math.min(Math.max(t.et0In, 0.1), 0.3);
  if (expectedRain(t) >= need && t.popPct >= 70) {
    return { skip: `${t.popPct}% chance of ${fmtIn(t.rainIn)} rain today - check soil this afternoon; mist if surface dries` };
  }
  const n = t.hiF >= 85 ? 3 : t.hiF >= 60 ? 2 : 1;
  const per = roundTo(need / n, 0.01);
  const minutes = minutesFor(per, rate);
  const sessions = startTimes(n, t).map((when) => ({ minutes, when }));
  return { inches: per * n, sessions, reason: 'keep the top 1/4" damp so seed can germinate' };
}

function lawnPlan({ days, today, history, config }) {
  const idx = days.findIndex((d) => d.date === today);
  if (idx < 1) throw new Error(`Weather data doesn't include ${today} with history before it`);
  const t = days[idx];
  const yesterday = days[idx - 1];
  const tomorrow = days[idx + 1];
  const rate = config.sprinklerRateInPerHr;
  const { stage, age } = lawnStage(today, config.seedDate);

  const base = { date: today, stage, age, weather: { today: t, yesterday }, rate };
  const skip = (reason) => ({ ...base, action: 'skip', inches: 0, sessions: [], reason });

  // Too cold: water won't soak in, grass isn't using it, and ice can damage turf.
  if (t.hiF !== null && t.hiF < 40) return skip(`too cold today (high ${Math.round(t.hiF)}F)`);

  const notes = [];
  if (t.windMph >= 20) notes.push(`windy (${Math.round(t.windMph)} mph) - water early before it picks up`);

  if (stage === 'germination') {
    const plan = seedPlan(t, yesterday, rate);
    if (plan.skip) return skip(plan.skip);
    return { ...base, action: 'water', ...plan, notes };
  }

  const p = STAGES[stage];
  const startDep = depletionAtStartOf(days, idx, history, p.capacityIn);
  const dep = startDep + t.et0In * KC; // where we'll be by end of today without water
  base.depletionIn = dep;

  if (dep < p.triggerIn) {
    return skip(`soil still has moisture (${fmtIn(dep)} used of ${fmtIn(p.triggerIn)} before watering)`);
  }

  const comingRain = expectedRain(t) + expectedRain(tomorrow);
  if (comingRain >= dep * 0.5) {
    return skip(`rain likely: ~${fmtIn(t.rainIn)} today (${t.popPct}%), ~${fmtIn(tomorrow?.rainIn ?? 0)} tomorrow (${tomorrow?.popPct ?? 0}%)`);
  }

  const inches = Math.max(0.1, roundTo(Math.min(dep, p.maxIn), 0.05));
  const sessions = cycleSessions(inches, rate, t);
  if (sessions.length > 1) notes.push('split into cycles so clay soil can soak it in');
  return { ...base, action: 'water', inches, sessions, notes,
    reason: `lawn has used ~${fmtIn(dep)} since it was last full` };
}

export const fmtIn = (x) => `${x.toFixed(2).replace(/^0/, '')}"`;

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Short, plain-ASCII SMS (emoji would force UCS-2 and triple the segment count). */
const sessionText = (s) => {
  const allSame = s.every((x) => x.minutes === s[0].minutes);
  return s.length === 1
    ? `${s[0].minutes} min at ${s[0].when}`
    : allSame
      ? `${s.length}x ${s[0].minutes} min (${s.map((x) => x.when).join(', ')})`
      : s.map((x) => `${x.minutes} min ${x.when}`).join(', ');
};

export function formatMessage(rec) {
  const [y, m, d] = rec.date.split('-').map(Number);
  const dow = DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const t = rec.weather.today;
  const wx = `Hi ${Math.round(t.hiF)}/Lo ${Math.round(t.loF)}F, ${t.popPct}% rain chance. ` +
    `Rain past 24h: ${fmtIn(rec.weather.yesterday.rainIn)}.`;
  const head = `Lawn ${dow} ${m}/${d}:`;
  const stage = rec.stage === 'established' ? '' : ` (${STAGES[rec.stage].label}, day ${rec.age})`;
  const notes = rec.notes?.length ? ` Note: ${rec.notes.join('; ')}.` : '';

  const main = rec.action === 'skip'
    ? `NO WATER today - ${rec.reason}.`
    : `WATER ${sessionText(rec.sessions)} = ${fmtIn(rec.inches)} total. Why: ${rec.reason}.`;

  if (!rec.patch) {
    return rec.action === 'skip'
      ? `${head} ${main} ${wx}`
      : `${head} ${main.replace(' total.', ` total${stage}.`)} ${wx}${notes}`;
  }

  const p = rec.patch;
  const patch = p.skip
    ? `skip - ${p.skip}.`
    : `${sessionText(p.sessions)} = ${fmtIn(p.inches)} (hose/mist just the patches).`;
  return `${head} Main lawn${stage}: ${main} New-seed patches (day ${p.age}): ${patch} ${wx}${notes}`;
}
