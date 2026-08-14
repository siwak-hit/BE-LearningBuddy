-- =============================================================================
-- v0.9.85 — Sinkronisasi Moodle DUA JALUR (Track 1 global + Track 2 personal)
-- Jalankan sekali di Supabase (SQL Editor). Aman diulang (IF NOT EXISTS).
-- =============================================================================

-- TRACK 1 — DATA GLOBAL (course/materi/struktur konten), shared untuk semua siswa.
-- TTL 24 jam dicek per-course lewat kolom lms_course_routes.last_synced_at (di DB,
-- BUKAN localStorage device). Kolomnya sudah dipakai kode sync lama; baris ini hanya
-- memastikan kolom ada bila skema lama belum punya.
ALTER TABLE lms_course_routes
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

-- TRACK 2 — DATA PERSONAL (kemajuan belajar per siswa). Satu baris per siswa per course.
-- TTL 24 jam dicek per-user lewat last_synced_at di baris siswa ITU SENDIRI → tiap siswa
-- sinkron sendiri, tidak bisa "numpang" sinkron milik user lain. Menyimpan daftar cmid
-- (module id) materi yang SUDAH diselesaikan/dibuka siswa (dari core_completion_get_
-- activities_completion_status).
CREATE TABLE IF NOT EXISTS student_content_progress (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid   NOT NULL,
  moodle_user_id    bigint NOT NULL,
  course_id         bigint NOT NULL,
  completed_cmids   jsonb  NOT NULL DEFAULT '[]'::jsonb,
  completion_total  integer NOT NULL DEFAULT 0,
  last_synced_at    timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_student_progress UNIQUE (project_id, moodle_user_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_student_progress_lookup
  ON student_content_progress (project_id, moodle_user_id, course_id);
