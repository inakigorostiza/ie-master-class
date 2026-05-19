// Tiny adapters for transactional sends — Resend (email) + Twilio (SMS, WhatsApp).
// Implemented with raw fetch() so we don't add SDK dependencies.

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

// Normalize a free-text phone number to E.164. Throws if it can't be coerced
// (no leading +, or fewer than 8 digits).
export function toE164(raw) {
  if (!raw) throw new Error("phone number is empty");
  const trimmed = String(raw).trim();
  if (!trimmed.startsWith("+")) {
    throw new Error(`phone number must be E.164 (start with +): "${trimmed}"`);
  }
  const digits = trimmed.slice(1).replace(/\D/g, "");
  if (digits.length < 8) throw new Error(`phone number too short: "${trimmed}"`);
  return `+${digits}`;
}

// ─── Resend email ──────────────────────────────────────────────────────────

export async function sendEmail({ to, subject, body }) {
  const apiKey = requireEnv("RESEND_API_KEY");
  const from = requireEnv("RESEND_FROM_EMAIL");
  if (!to) throw new Error("sendEmail: missing 'to'");
  if (!subject) throw new Error("sendEmail: missing 'subject'");
  if (!body) throw new Error("sendEmail: missing 'body'");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      text: body,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.message || json?.error || `Resend HTTP ${res.status}`;
    throw new Error(`Resend: ${msg}`);
  }
  return { id: json.id };
}

// ─── Twilio SMS + WhatsApp ────────────────────────────────────────────────

async function twilioCreateMessage({ to, from, body }) {
  const sid = requireEnv("TWILIO_ACCOUNT_SID");
  const token = requireEnv("TWILIO_AUTH_TOKEN");
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");

  const form = new URLSearchParams();
  form.set("To", to);
  form.set("From", from);
  form.set("Body", body);

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.message || `Twilio HTTP ${res.status}`;
    throw new Error(`Twilio: ${msg}`);
  }
  return { sid: json.sid };
}

export async function sendSms({ to, body }) {
  const from = requireEnv("TWILIO_FROM_SMS");
  if (!body) throw new Error("sendSms: missing 'body'");
  const normalized = toE164(to);
  return await twilioCreateMessage({
    to: normalized,
    from,
    body,
  });
}

export async function sendWhatsapp({ to, body }) {
  const fromRaw = requireEnv("TWILIO_FROM_WHATSAPP");
  if (!body) throw new Error("sendWhatsapp: missing 'body'");
  const normalized = toE164(to);
  const from = fromRaw.startsWith("whatsapp:") ? fromRaw : `whatsapp:${fromRaw}`;
  return await twilioCreateMessage({
    to: `whatsapp:${normalized}`,
    from,
    body,
  });
}
