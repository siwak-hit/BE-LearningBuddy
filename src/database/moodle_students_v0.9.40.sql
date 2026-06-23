-- ============================================================================
-- moodle_students_v0.9.40.sql
-- INDEX LOKAL daftar siswa (email → user/kelas) supaya VERIFIKASI SISWA cepat:
-- tak perlu lagi memanggil Moodle live & menarik ~200 peserta tiap kali (yang bikin
-- request lama / timeout). Tabel ini di-ISI saat admin "Sinkron Moodle", lalu resolve
-- cukup query indeks ini (milidetik).
--
-- Cara pakai: jalankan di Supabase SQL Editor SEKALI, lalu klik "Sinkron Moodle" di
-- dashboard (sekarang sekalian mengisi tabel ini).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.moodle_students (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  course_id integer NOT NULL,
  class_code text,
  moodle_user_id bigint NOT NULL,
  email text,        -- disimpan lowercase
  username text,     -- disimpan lowercase
  fullname text,
  idnumber text,     -- disimpan lowercase
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moodle_students_pkey PRIMARY KEY (id),
  CONSTRAINT moodle_students_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);

CREATE INDEX IF NOT EXISTS idx_moodle_students_project_email
  ON public.moodle_students (project_id, email);
CREATE INDEX IF NOT EXISTS idx_moodle_students_project_username
  ON public.moodle_students (project_id, username);
CREATE INDEX IF NOT EXISTS idx_moodle_students_project
  ON public.moodle_students (project_id);
