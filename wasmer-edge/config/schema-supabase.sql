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

-- Run AFTER schema.sql. Only the server role may call this function.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS applications_code_case_idx ON public.applications (lower(tracking_code));

CREATE OR REPLACE FUNCTION public.amanah_backend(p_action text, p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    v_record jsonb;
    v_existing jsonb;
    v_result jsonb;
    v_row public.applications%ROWTYPE;
    v_rate public.login_attempts%ROWTYPE;
    v_code text := p_data->>'code';
    v_now timestamptz := now();
    v_failures integer;
    v_phone text;
BEGIN
    CASE p_action
    WHEN 'health' THEN
        RETURN jsonb_build_object('ok', true, 'version', 2);
    WHEN 'dashboard' THEN
        IF NOT EXISTS (SELECT 1 FROM public.admin_sessions WHERE token_hash = p_data->>'hash'
            AND expires_at > v_now AND role IN ('tu', 'principal')) THEN
            RETURN jsonb_build_object('error', 'Login petugas diperlukan.', 'httpStatus', 401);
        END IF;
        SELECT jsonb_build_object('revision', (SELECT revision FROM public.application_sync WHERE id = 1),
            'records', CASE WHEN (p_data->>'etag') = '"applications-v5-supabase-' || (SELECT revision::text FROM public.application_sync WHERE id = 1) || '"'
                THEN NULL ELSE (SELECT coalesce(jsonb_agg(record_json ORDER BY submitted_at DESC, tracking_code), '[]'::jsonb) FROM public.applications) END)
            INTO v_result;
        RETURN v_result;
    WHEN 'record' THEN
        SELECT record_json INTO v_record FROM public.applications WHERE lower(tracking_code) = lower(v_code);
        RETURN v_record;
    WHEN 'list' THEN
        SELECT coalesce(jsonb_agg(record_json ORDER BY submitted_at DESC, tracking_code), '[]'::jsonb) INTO v_result FROM public.applications;
        RETURN v_result;
    WHEN 'revision' THEN
        SELECT jsonb_build_object('revision', revision) INTO v_result FROM public.application_sync WHERE id = 1;
        RETURN v_result;
    WHEN 'snapshot' THEN
        SELECT jsonb_build_object('revision', (SELECT revision FROM public.application_sync WHERE id = 1),
            'rows', coalesce(jsonb_agg(jsonb_build_object('tracking_code', tracking_code, 'record_json', record_json,
                'submitted_at', submitted_at, 'updated_at', updated_at) ORDER BY tracking_code), '[]'::jsonb))
            INTO v_result FROM public.applications;
        RETURN v_result;
    WHEN 'session' THEN
        SELECT jsonb_build_object('username', username, 'role', role, 'expires_at', expires_at) INTO v_result
            FROM public.admin_sessions WHERE token_hash = p_data->>'hash' AND expires_at > v_now;
        RETURN v_result;
    WHEN 'role' THEN
        IF p_data->>'role' NOT IN ('tu', 'principal') THEN RAISE EXCEPTION 'Invalid role'; END IF;
        UPDATE public.admin_sessions SET role = p_data->>'role' WHERE token_hash = p_data->>'hash' AND expires_at > v_now;
        IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Sesi berakhir. Silakan login kembali.', 'httpStatus', 401); END IF;
        RETURN jsonb_build_object('ok', true);
    WHEN 'logout' THEN
        DELETE FROM public.admin_sessions WHERE token_hash = p_data->>'hash';
        RETURN jsonb_build_object('ok', true);
    WHEN 'login_rate' THEN
        SELECT * INTO v_rate FROM public.login_attempts WHERE bucket = p_data->>'bucket';
        RETURN jsonb_build_object('failures', coalesce(v_rate.failures, 0), 'window_started', v_rate.window_started, 'locked_until', v_rate.locked_until);
    WHEN 'login_failure' THEN
        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('login:' || (p_data->>'bucket'), 0));
        SELECT * INTO v_rate FROM public.login_attempts WHERE bucket = p_data->>'bucket' FOR UPDATE;
        IF v_rate.locked_until > v_now THEN RETURN jsonb_build_object('failures', 8); END IF;
        v_failures := CASE WHEN v_rate.window_started > v_now - interval '15 minutes' THEN v_rate.failures + 1 ELSE 1 END;
        INSERT INTO public.login_attempts (bucket, failures, window_started, locked_until)
            VALUES (p_data->>'bucket', v_failures,
                CASE WHEN v_rate.window_started > v_now - interval '15 minutes' THEN v_rate.window_started ELSE v_now END,
                CASE WHEN v_failures >= 8 THEN v_now + interval '15 minutes' ELSE NULL END)
            ON CONFLICT (bucket) DO UPDATE SET failures = excluded.failures, window_started = excluded.window_started, locked_until = excluded.locked_until;
        RETURN jsonb_build_object('failures', v_failures);
    WHEN 'login_success' THEN
        DELETE FROM public.admin_sessions WHERE expires_at < v_now OR token_hash = p_data->>'previousHash';
        DELETE FROM public.login_attempts WHERE window_started < v_now - interval '1 day' OR bucket = p_data->>'bucket';
        INSERT INTO public.admin_sessions (token_hash, username, role, expires_at)
            VALUES (p_data->>'hash', p_data->>'username', '', v_now + interval '8 hours');
        RETURN jsonb_build_object('ok', true);
    WHEN 'create' THEN
        v_record := p_data->'record';
        IF jsonb_typeof(v_record) <> 'object' OR coalesce(v_record->>'code', '') = '' THEN RAISE EXCEPTION 'Invalid record'; END IF;
        PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('request:' || (p_data->>'identity') || '|' || (v_record->>'type'), 0));
        SELECT record_json INTO v_existing FROM public.applications
            WHERE record_json->>'status' IN ('Menunggu konfirmasi TU', 'Disetujui Tata Usaha', 'Menunggu persetujuan Kepala Sekolah')
                AND upper(regexp_replace(record_json->>'nis', '[[:space:].-]+', '', 'g')) = p_data->>'identity'
                AND record_json->>'type' = v_record->>'type'
            ORDER BY submitted_at DESC LIMIT 1;
        IF v_existing IS NOT NULL THEN
            v_result := jsonb_build_object('httpStatus', 409, 'duplicate', true, 'error', 'Siswa ini masih memiliki pengajuan jenis surat yang sama dalam proses. Silakan hubungi Tata Usaha.');
            v_phone := regexp_replace(coalesce(v_existing->>'phone', ''), '[^0-9]', '', 'g');
            v_phone := CASE WHEN left(v_phone, 2) = '00' THEN substr(v_phone, 3) WHEN left(v_phone, 1) = '0' THEN '62' || substr(v_phone, 2) WHEN left(v_phone, 1) = '8' THEN '62' || v_phone ELSE v_phone END;
            IF v_phone <> '' AND v_phone = p_data->>'phone' THEN
                v_result := v_result || jsonb_build_object('code', v_existing->>'code', 'status', v_existing->>'status', 'error', 'Pengajuan jenis surat ini masih diproses untuk siswa tersebut. Gunakan nomor pelacakan yang sudah ada.');
            END IF;
            RETURN v_result;
        END IF;
        INSERT INTO public.applications (tracking_code, record_json, submitted_at, updated_at)
            VALUES (v_record->>'code', v_record, (v_record->>'submittedAt')::timestamptz, (v_record->>'updatedAt')::timestamptz);
        UPDATE public.application_sync SET revision = revision + 1 WHERE id = 1;
        RETURN v_record;
    WHEN 'save' THEN
        v_record := p_data->'record';
        SELECT * INTO v_row FROM public.applications WHERE lower(tracking_code) = lower(v_record->>'code') FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('error', 'Pengajuan tidak ditemukan.', 'httpStatus', 404); END IF;
        IF v_row.record_json IS DISTINCT FROM p_data->'expected' THEN
            RETURN jsonb_build_object('error', 'Data sudah diperbarui dari perangkat lain. Muat ulang sebelum menyimpan.', 'httpStatus', 409, 'draftConflict', true);
        END IF;
        UPDATE public.applications SET record_json = v_record, updated_at = v_now WHERE tracking_code = v_row.tracking_code;
        UPDATE public.application_sync SET revision = revision + 1 WHERE id = 1;
        RETURN v_record;
    ELSE
        RAISE EXCEPTION 'Unknown operation';
    END CASE;
END;
$$;

REVOKE ALL ON FUNCTION public.amanah_backend(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.amanah_backend(text, jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
