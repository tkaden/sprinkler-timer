import { describe, it, expect } from 'vitest';
import {
  recommend, formatMessage, lawnStage, depletionAtStartOf, minutesFor, effectiveRain, KC,
} from '../scripts/recommend.mjs';
import { normalize, buildUrl } from '../scripts/weather.mjs';
import { deliver } from '../scripts/send.mjs';
import { loadConfig } from '../scripts/config.mjs';
import { localDate, pruneHistory } from '../scripts/notify.mjs';

const TODAY = '2026-07-15';

/** 14 past days + today + 2 forecast days, with overrides by offset from today. */
function makeDays(overrides = {}, defaults = {}) {
  const base = { rainIn: 0, et0In: 0.2, hiF: 88, loF: 68, popPct: 10, windMph: 8, ...defaults };
  return Array.from({ length: 17 }, (_, i) => {
    const offset = i - 14;
    const date = new Date(Date.parse(TODAY) + offset * 86_400_000).toISOString().slice(0, 10);
    return { date, ...base, ...(overrides[offset] || {}) };
  });
}

const config = (extra = {}) => ({ ...loadConfig({}), ...extra });

describe('lawnStage', () => {
  it('is established without a seed date', () => {
    expect(lawnStage(TODAY, '').stage).toBe('established');
  });
  it('walks through germination → young → established', () => {
    expect(lawnStage('2026-09-10', '2026-09-01')).toEqual({ stage: 'germination', age: 9 });
    expect(lawnStage('2026-09-25', '2026-09-01')).toEqual({ stage: 'young', age: 24 });
    expect(lawnStage('2026-10-20', '2026-09-01').stage).toBe('established');
  });
  it('treats a future seed date as established', () => {
    expect(lawnStage('2026-09-01', '2026-09-10').stage).toBe('established');
  });
});

describe('bucket model', () => {
  it('accumulates ET and is refilled by rain and irrigation', () => {
    const days = makeDays({ [-3]: { rainIn: 3 } });
    // Rain 3 days ago refills; then 2 more dry days of ET.
    expect(depletionAtStartOf(days, 14, {}, 1.5)).toBeCloseTo(2 * 0.2 * KC);
    const watered = { [days[13].date]: 1 };
    expect(depletionAtStartOf(days, 14, watered, 1.5)).toBe(0);
  });
  it('ignores trace rain', () => {
    expect(effectiveRain(0.05)).toBe(0);
    expect(effectiveRain(0.5)).toBeCloseTo(0.4);
  });
  it('rounds minutes up with a 3-minute floor', () => {
    expect(minutesFor(0.5, 0.5)).toBe(60);
    expect(minutesFor(0.01, 0.5)).toBe(3);
  });
});

describe('recommend: established lawn', () => {
  it('waters deeply in cycles after a dry hot stretch', () => {
    const rec = recommend({ days: makeDays(), today: TODAY, config: config() });
    expect(rec.action).toBe('water');
    expect(rec.inches).toBe(1); // capped
    expect(rec.sessions).toHaveLength(4); // 1" / 0.3" per cycle
    expect(rec.sessions[0]).toEqual({ minutes: 30, when: '~5am' });
    expect(formatMessage(rec)).toMatch(/^Lawn Wed 7\/15: WATER 4x 30 min .* = 1.00" total\. Why:/);
  });

  it('skips when soil is still moist', () => {
    const days = makeDays({ [-1]: { rainIn: 1.5 } });
    const rec = recommend({ days, today: TODAY, config: config() });
    expect(rec.action).toBe('skip');
    expect(formatMessage(rec)).toContain('NO WATER today - soil still has moisture');
    expect(formatMessage(rec)).toContain('Rain past 24h: 1.50"');
  });

  it('skips when we already watered recently', () => {
    const days = makeDays();
    const rec = recommend({ days, today: TODAY, history: { [days[12].date]: 1 }, config: config() });
    expect(rec.action).toBe('skip');
  });

  it('holds off when real rain is forecast', () => {
    const days = makeDays({ 0: { rainIn: 0.3, popPct: 80 }, 1: { rainIn: 0.5, popPct: 70 } });
    const rec = recommend({ days, today: TODAY, config: config() });
    expect(rec.action).toBe('skip');
    expect(rec.reason).toMatch(/rain likely/);
  });

  it('ignores a low-probability shower', () => {
    const days = makeDays({ 0: { rainIn: 1, popPct: 30 } });
    expect(recommend({ days, today: TODAY, config: config() }).action).toBe('water');
  });

  it('never waters on a freezing day', () => {
    const days = makeDays({ 0: { hiF: 35, loF: 20 } });
    const rec = recommend({ days, today: TODAY, config: config() });
    expect(rec.action).toBe('skip');
    expect(rec.reason).toMatch(/too cold/);
  });

  it('does not water a cool, low-ET November lawn', () => {
    const days = makeDays({}, { et0In: 0.03, hiF: 55, loF: 33 });
    expect(recommend({ days, today: TODAY, config: config() }).action).toBe('skip');
  });

  it('uses sprinkler rate for minutes', () => {
    const days = makeDays();
    const fast = recommend({ days, today: TODAY, config: config({ sprinklerRateInPerHr: 1 }) });
    expect(fast.sessions[0].minutes).toBe(15);
  });
});

describe('recommend: new seed', () => {
  const seed = (daysAgo) => new Date(Date.parse(TODAY) - daysAgo * 86_400_000).toISOString().slice(0, 10);

  it('waters lightly several times on a hot day', () => {
    const rec = recommend({ days: makeDays(), today: TODAY, config: config({ seedDate: seed(5) }) });
    expect(rec.action).toBe('water');
    expect(rec.sessions).toHaveLength(3);
    expect(rec.sessions.map((s) => s.when)).toEqual(['~7am', '~11am', '~3pm']);
    expect(formatMessage(rec)).toContain('(new seed, day 5)');
  });

  it('once, later in the morning, on a frosty fall day', () => {
    const days = makeDays({}, { et0In: 0.05, hiF: 52, loF: 31 });
    const rec = recommend({ days, today: TODAY, config: config({ seedDate: seed(10) }) });
    expect(rec.sessions).toEqual([{ minutes: 12, when: '~11am' }]);
    expect(rec.inches).toBeCloseTo(0.1);
  });

  it('skips after a soaking rain', () => {
    const days = makeDays({ [-1]: { rainIn: 0.4 } });
    expect(recommend({ days, today: TODAY, config: config({ seedDate: seed(5) }) }).action).toBe('skip');
  });

  it('uses the young-grass bucket after 3 weeks', () => {
    const rec = recommend({ days: makeDays(), today: TODAY, config: config({ seedDate: seed(30) }) });
    expect(rec.stage).toBe('young');
    expect(rec.inches).toBe(0.4);
    expect(rec.sessions).toHaveLength(2);
  });
});

describe('weather', () => {
  it('normalizes Open-Meteo mm into inches', () => {
    const days = normalize({ daily: {
      time: ['2026-11-13'], precipitation_sum: [25.4], et0_fao_evapotranspiration: [2.54],
      temperature_2m_max: [60], temperature_2m_min: [40], precipitation_probability_max: [20], wind_speed_10m_max: [12],
    } });
    expect(days[0]).toEqual({ date: '2026-11-13', rainIn: 1, et0In: 0.1, hiF: 60, loF: 40, popPct: 20, windMph: 12 });
  });
  it('builds a URL for Olathe by default', () => {
    const url = buildUrl(loadConfig({}));
    expect(url).toContain('latitude=38.8814');
    expect(url).toContain('timezone=America%2FChicago');
  });
});

describe('delivery', () => {
  it('posts to Twilio and ntfy when configured', async () => {
    const calls = [];
    const fake = async (url, init) => { calls.push({ url, init }); return { ok: true }; };
    const cfg = loadConfig({
      TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+15550001111', SMS_TO: '+15552223333',
      NTFY_TOPIC: 'my-lawn',
    });
    expect(await deliver(cfg, 'hi', fake)).toEqual(['sms', 'ntfy']);
    expect(calls[0].url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json');
    expect(String(calls[0].init.body)).toBe('To=%2B15552223333&From=%2B15550001111&Body=hi');
    expect(calls[1].url).toBe('https://ntfy.sh/my-lawn');
  });
  it('sends nothing when unconfigured', async () => {
    expect(await deliver(loadConfig({}), 'hi', async () => { throw new Error('no'); })).toEqual([]);
  });
});

describe('notify helpers', () => {
  it('computes local date in Central time', () => {
    expect(localDate('America/Chicago', new Date('2026-11-14T03:00:00Z'))).toBe('2026-11-13');
  });
  it('prunes history older than 30 days', () => {
    expect(pruneHistory({ '2026-01-01': 1, '2026-07-10': 0.5 }, TODAY)).toEqual({ '2026-07-10': 0.5 });
  });
});

describe('recommend: re-seeded patches', () => {
  const ago = (n) => new Date(Date.parse(TODAY) - n * 86_400_000).toISOString().slice(0, 10);
  const cool = { et0In: 0.05, hiF: 55, loF: 33 };

  it('adds a misting plan for fresh patches on top of the young-lawn plan', () => {
    const rec = recommend({ days: makeDays({}, cool), today: TODAY,
      config: config({ seedDate: ago(26), patchDate: ago(4) }) });
    expect(rec.stage).toBe('young');
    expect(rec.patch).toMatchObject({ age: 4, inches: 0.1, sessions: [{ minutes: 12, when: '~11am' }] });
    const msg = formatMessage(rec);
    expect(msg).toContain('Main lawn (young grass, day 26):');
    expect(msg).toContain('New-seed patches (day 4): 12 min at ~11am = .10" (hose/mist just the patches).');
  });

  it('drops the patch plan once patch seed is 3 weeks old', () => {
    const rec = recommend({ days: makeDays({}, cool), today: TODAY,
      config: config({ seedDate: ago(26), patchDate: ago(21) }) });
    expect(rec.patch).toBeUndefined();
  });

  it('skips patches after soaking rain too', () => {
    const rec = recommend({ days: makeDays({ [-1]: { rainIn: 0.5 } }, cool), today: TODAY,
      config: config({ seedDate: ago(26), patchDate: ago(4) }) });
    expect(formatMessage(rec)).toContain('New-seed patches (day 4): skip - .50" rain yesterday');
  });

  it('ignores the patch date while the whole lawn is still germinating', () => {
    const rec = recommend({ days: makeDays(), today: TODAY, config: config({ seedDate: ago(5), patchDate: ago(2) }) });
    expect(rec.patch).toBeUndefined();
  });
});
