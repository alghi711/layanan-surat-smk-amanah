-- Run once in a NEW Supabase project, using SQL Editor as the postgres role.
-- This prepares tables and Storage; run backend.sql next before selecting Supabase in Wasmer.
BEGIN;

CREATE TABLE public.applications (
    tracking_code varchar(80) PRIMARY KEY,
    record_json jsonb NOT NULL CHECK (jsonb_typeof(record_json) = 'object'),
    submitted_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);
CREATE INDEX applications_submitted_idx ON public.applications (submitted_at DESC);

CREATE TABLE public.admin_sessions (
    token_hash char(64) PRIMARY KEY,
    username varchar(120) NOT NULL,
    role varchar(16) NOT NULL DEFAULT '' CHECK (role IN ('', 'tu', 'principal')),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry_idx ON public.admin_sessions (expires_at);

CREATE TABLE public.login_attempts (
    bucket char(64) PRIMARY KEY,
    failures integer NOT NULL CHECK (failures >= 0),
    window_started timestamptz NOT NULL,
    locked_until timestamptz
);

CREATE TABLE public.application_sync (
    id smallint PRIMARY KEY CHECK (id = 1),
    revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
INSERT INTO public.application_sync (id, revision) VALUES (1, 0);

-- Browser clients cannot read requests, session hashes, or login rate limits.
-- Requests will go through the authenticated Wasmer backend, using a server secret.
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.application_sync ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.applications, public.admin_sessions,
    public.login_attempts, public.application_sync FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.applications, public.admin_sessions,
    public.login_attempts, public.application_sync TO service_role;

-- No public Storage policies: documents are served only after backend permission checks.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('amanah-documents', 'amanah-documents', false, 10485760,
    ARRAY['application/pdf', 'image/jpeg', 'image/png']);

COMMIT;
