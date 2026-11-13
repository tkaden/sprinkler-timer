// Delivery channels. Twilio sends a real SMS; ntfy.sh is a free push
// notification alternative (install the ntfy app, subscribe to your topic).

export async function sendTwilio({ accountSid, authToken, from, to }, body, fetchImpl = fetch) {
  const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(
      from.startsWith('MG') ? { To: to, MessagingServiceSid: from, Body: body } : { To: to, From: from, Body: body },
    ),
  });
  if (!res.ok) throw new Error(`Twilio HTTP ${res.status}: ${await res.text()}`);
}

export async function sendNtfy(topic, body, fetchImpl = fetch) {
  const res = await fetchImpl(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: 'POST',
    headers: { Title: 'Lawn watering' },
    body,
  });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}: ${await res.text()}`);
}

/** Send via every configured channel. Returns the list of channels used. */
export async function deliver(config, body, fetchImpl = fetch) {
  const sent = [];
  const t = config.twilio;
  if (t.accountSid && t.authToken && t.from && t.to) {
    await sendTwilio(t, body, fetchImpl);
    sent.push('sms');
  }
  if (config.ntfyTopic) {
    await sendNtfy(config.ntfyTopic, body, fetchImpl);
    sent.push('ntfy');
  }
  return sent;
}
