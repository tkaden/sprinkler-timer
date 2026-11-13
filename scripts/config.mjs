// Runtime configuration, read from environment variables with sensible
// defaults for Olathe, Kansas. Every value can be overridden in the GitHub
// Actions workflow (repo Settings → Secrets and variables → Actions).

const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export function loadConfig(env = process.env) {
  return {
    latitude: num(env.LAT, 38.8814),
    longitude: num(env.LON, -94.8191),
    timezone: env.TZ_NAME || 'America/Chicago',
    placeName: env.PLACE_NAME || 'Olathe, KS',

    // How fast your sprinkler puts down water, in inches per hour.
    // Measure it: set out a few straight-sided cans, run 15 min, measure
    // depth in inches, multiply by 4.
    sprinklerRateInPerHr: num(env.SPRINKLER_RATE_IN_PER_HR, 0.5),

    // Date the seed went down (YYYY-MM-DD). Leave blank for an established lawn.
    // Seedling rules apply for the first 6 weeks, then it switches automatically.
    seedDate: env.SEED_DATE || '',
    // Date you last re-seeded bare patches. While that seed is germinating
    // (3 weeks), the text adds a light misting plan for just those spots.
    patchDate: env.PATCH_DATE || '',

    twilio: {
      accountSid: env.TWILIO_ACCOUNT_SID || '',
      authToken: env.TWILIO_AUTH_TOKEN || '',
      from: env.TWILIO_FROM || '',
      to: env.SMS_TO || '',
    },
    ntfyTopic: env.NTFY_TOPIC || '',
  };
}
