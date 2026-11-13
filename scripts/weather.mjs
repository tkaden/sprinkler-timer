// Fetches daily weather from Open-Meteo (free, no API key) and normalizes it
// into imperial units. ET0 is requested in mm and converted here so we never
// depend on how the API scales evapotranspiration with unit flags.

export const PAST_DAYS = 14;
export const FORECAST_DAYS = 3;

const MM_PER_IN = 25.4;

export function buildUrl({ latitude, longitude, timezone }) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    timezone,
    past_days: String(PAST_DAYS),
    forecast_days: String(FORECAST_DAYS),
    daily: [
      'precipitation_sum',
      'precipitation_probability_max',
      'et0_fao_evapotranspiration',
      'temperature_2m_max',
      'temperature_2m_min',
      'wind_speed_10m_max',
    ].join(','),
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'mm',
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

/** Turn the raw Open-Meteo response into [{date, rainIn, et0In, hiF, loF, popPct, windMph}]. */
export function normalize(json) {
  const d = json?.daily;
  if (!d || !Array.isArray(d.time)) throw new Error('Unexpected Open-Meteo response: no daily data');
  return d.time.map((date, i) => ({
    date,
    rainIn: (d.precipitation_sum?.[i] ?? 0) / MM_PER_IN,
    et0In: (d.et0_fao_evapotranspiration?.[i] ?? 0) / MM_PER_IN,
    hiF: d.temperature_2m_max?.[i] ?? null,
    loF: d.temperature_2m_min?.[i] ?? null,
    popPct: d.precipitation_probability_max?.[i] ?? 0,
    windMph: d.wind_speed_10m_max?.[i] ?? 0,
  }));
}

export async function fetchWeather(config, fetchImpl = fetch) {
  const url = buildUrl(config);
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
      return normalize(await res.json());
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr;
}
