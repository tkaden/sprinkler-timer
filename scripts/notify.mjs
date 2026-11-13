#!/usr/bin/env node
// Daily entry point: fetch weather → decide → text it → remember what we said.
//
//   npm run notify               # fetch, decide, send, record
//   npm run notify -- --dry-run  # print the message only; send/record nothing

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { fetchWeather } from './weather.mjs';
import { recommend, formatMessage } from './recommend.mjs';
import { deliver } from './send.mjs';

const HISTORY_PATH = fileURLToPath(new URL('../state/history.json', import.meta.url));
const KEEP_DAYS = 30;

export function localDate(timezone, now = new Date()) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
}

async function loadHistory() {
  try {
    return JSON.parse(await readFile(HISTORY_PATH, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

export function pruneHistory(history, today) {
  const cutoff = Date.parse(today) - KEEP_DAYS * 86_400_000;
  return Object.fromEntries(Object.entries(history).filter(([d]) => Date.parse(d) >= cutoff).sort());
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const config = loadConfig();
  const today = localDate(config.timezone);

  const days = await fetchWeather(config);
  const history = await loadHistory();
  const rec = recommend({ days, today, history, config });
  const message = formatMessage(rec);
  console.log(message);

  if (dryRun) return;

  const channels = await deliver(config, message);
  if (channels.length === 0) {
    console.warn('No delivery channel configured (set Twilio vars or NTFY_TOPIC). Message printed only.');
  } else {
    console.log(`Sent via ${channels.join(', ')}`);
  }

  // Assume the advice is followed; the bucket model uses this tomorrow.
  const next = pruneHistory({ ...history, [today]: Number(rec.inches.toFixed(2)) }, today);
  await mkdir(dirname(HISTORY_PATH), { recursive: true });
  await writeFile(HISTORY_PATH, JSON.stringify(next, null, 2) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
