CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS students (
  id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email                       TEXT         UNIQUE NOT NULL,
  phone_number                TEXT,
  full_name                   TEXT         NOT NULL,
  country                     TEXT         NOT NULL,
  city                        TEXT,
  date_of_birth               DATE,
  preferred_language          TEXT,
  profile_picture_url         TEXT,

  job_role                    TEXT,
  current_company             TEXT,
  years_experience            INTEGER,
  undergrad_field             TEXT,
  top_program_interest        TEXT,

  career_goal_one_line        TEXT,
  dream_company_or_industry   TEXT,
  visual_vibe                 TEXT,
  tone_preference             TEXT,
  three_words                 TEXT[],
  linkedin_url                TEXT,
  instagram_handle            TEXT,

  referral_source             TEXT,
  contact_channel_preference  TEXT,
  gdpr_consent                BOOLEAN      NOT NULL DEFAULT FALSE,

  raw_payload                 JSONB,
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE students ADD COLUMN IF NOT EXISTS phone_number TEXT;

CREATE INDEX IF NOT EXISTS idx_students_program     ON students(top_program_interest);
CREATE INDEX IF NOT EXISTS idx_students_country     ON students(country);
CREATE INDEX IF NOT EXISTS idx_students_created_at  ON students(created_at DESC);

CREATE TABLE IF NOT EXISTS student_creatives (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID         NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  format        TEXT         NOT NULL,
  url           TEXT         NOT NULL,
  mime_type     TEXT,
  width         INTEGER,
  height        INTEGER,
  prompt        TEXT,
  model         TEXT,
  latency_ms    INTEGER,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creatives_student ON student_creatives(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creatives_format  ON student_creatives(format);

ALTER TABLE student_creatives ADD COLUMN IF NOT EXISTS status        TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE student_creatives ADD COLUMN IF NOT EXISTS operation_id  TEXT;
ALTER TABLE student_creatives ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE student_creatives ALTER COLUMN url DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_creatives_status ON student_creatives(status);

CREATE TABLE IF NOT EXISTS agent_usage (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  surface         TEXT NOT NULL,
  provider        TEXT NOT NULL,
  model           TEXT,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  cached_tokens   INTEGER,
  input_chars     INTEGER,
  audio_seconds   NUMERIC,
  image_count     INTEGER,
  cost_usd        NUMERIC(10, 6),
  cost_eur        NUMERIC(10, 6),
  latency_ms      INTEGER,
  student_email   TEXT,
  meta            JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usage_created_at ON agent_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_surface    ON agent_usage(surface);
CREATE INDEX IF NOT EXISTS idx_usage_provider   ON agent_usage(provider);
CREATE INDEX IF NOT EXISTS idx_usage_model      ON agent_usage(model);
