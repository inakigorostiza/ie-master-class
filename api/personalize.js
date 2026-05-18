import { randomUUID } from "node:crypto";
import { getPostHog } from "../lib/posthog.js";
import { getSql } from "../lib/db.js";

export const config = {
  maxDuration: 15,
};

const REQUIRED = ["full_name", "email", "country", "gdpr_consent"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return null;
    }
  }
  return await new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

function nullable(v) {
  return v === undefined || v === null || v === "" ? null : v;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = (await readJsonBody(req)) ?? {};

  const missing = REQUIRED.filter((k) => {
    const v = body[k];
    if (k === "gdpr_consent") return v !== true;
    return typeof v !== "string" || !v.trim();
  });
  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(", ")}` });
  }
  if (!EMAIL_RE.test(body.email)) {
    return res.status(400).json({ error: "Invalid email address" });
  }

  const distinctId = body.email.trim().toLowerCase();
  const eventId = randomUUID();

  // Build the props object — every non-empty form field becomes both a person
  // property in PostHog and a column in Postgres.
  const props = { source: "landing_form_v1" };
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || v === null || v === "") continue;
    props[k] = v;
  }

  // 1) Postgres UPSERT — source of truth. Must succeed for the request to return 200.
  let dbId = null;
  const sql = getSql();
  if (sql) {
    try {
      const threeWords = Array.isArray(body.three_words) ? body.three_words : null;
      const yearsExperience =
        body.years_experience != null && body.years_experience !== ""
          ? Number(body.years_experience)
          : null;
      const rawPayload = JSON.stringify(body);

      const rows = await sql`
        INSERT INTO students (
          email, phone_number, full_name, country, city, date_of_birth, preferred_language, profile_picture_url,
          job_role, current_company, years_experience, undergrad_field, top_program_interest,
          career_goal_one_line, dream_company_or_industry, visual_vibe, tone_preference,
          three_words, linkedin_url, instagram_handle,
          referral_source, contact_channel_preference, gdpr_consent,
          raw_payload, updated_at
        ) VALUES (
          ${distinctId}, ${nullable(body.phone_number)}, ${body.full_name}, ${body.country},
          ${nullable(body.city)},
          ${nullable(body.date_of_birth)}, ${nullable(body.preferred_language)},
          ${nullable(body.profile_picture_url)},
          ${nullable(body.current_role)}, ${nullable(body.current_company)},
          ${yearsExperience}, ${nullable(body.undergrad_field)}, ${nullable(body.top_program_interest)},
          ${nullable(body.career_goal_one_line)}, ${nullable(body.dream_company_or_industry)},
          ${nullable(body.visual_vibe)}, ${nullable(body.tone_preference)},
          ${threeWords}, ${nullable(body.linkedin_url)}, ${nullable(body.instagram_handle)},
          ${nullable(body.referral_source)}, ${nullable(body.contact_channel_preference)},
          ${body.gdpr_consent === true},
          ${rawPayload}::jsonb, NOW()
        )
        ON CONFLICT (email) DO UPDATE SET
          phone_number = COALESCE(EXCLUDED.phone_number, students.phone_number),
          full_name = EXCLUDED.full_name,
          country = EXCLUDED.country,
          city = EXCLUDED.city,
          date_of_birth = EXCLUDED.date_of_birth,
          preferred_language = EXCLUDED.preferred_language,
          profile_picture_url = COALESCE(EXCLUDED.profile_picture_url, students.profile_picture_url),
          job_role = EXCLUDED.job_role,
          current_company = EXCLUDED.current_company,
          years_experience = EXCLUDED.years_experience,
          undergrad_field = EXCLUDED.undergrad_field,
          top_program_interest = EXCLUDED.top_program_interest,
          career_goal_one_line = EXCLUDED.career_goal_one_line,
          dream_company_or_industry = EXCLUDED.dream_company_or_industry,
          visual_vibe = EXCLUDED.visual_vibe,
          tone_preference = EXCLUDED.tone_preference,
          three_words = EXCLUDED.three_words,
          linkedin_url = EXCLUDED.linkedin_url,
          instagram_handle = EXCLUDED.instagram_handle,
          referral_source = EXCLUDED.referral_source,
          contact_channel_preference = EXCLUDED.contact_channel_preference,
          gdpr_consent = EXCLUDED.gdpr_consent,
          raw_payload = EXCLUDED.raw_payload,
          updated_at = NOW()
        RETURNING id, created_at, updated_at
      `;
      dbId = rows[0]?.id ?? null;
    } catch (err) {
      console.error("[personalize] Postgres error:", err);
      return res.status(502).json({ error: "Failed to save student record" });
    }
  } else {
    console.warn("[personalize] DATABASE_URL not set — skipping Postgres write");
  }

  // 2) PostHog — best-effort observability. All form fields land as person properties.
  const posthog = getPostHog();
  if (posthog) {
    try {
      const { source: _source, ...peopleProps } = props;
      posthog.identify({ distinctId, properties: peopleProps });
      posthog.capture({
        distinctId,
        event: "ie_personalization_submitted",
        properties: { ...props, $insert_id: eventId },
      });
      await posthog.shutdown();
    } catch (err) {
      console.error("[personalize] PostHog error (non-fatal):", err);
    }
  } else {
    console.warn("[personalize] POSTHOG_API_KEY not set — skipping event capture");
  }

  return res.status(200).json({ ok: true, db_id: dbId, event_id: eventId });
}
