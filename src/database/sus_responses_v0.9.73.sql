-- ============================================================================
-- sus_responses_v0.9.73.sql
-- Menyimpan jawaban kuesioner SUS (System Usability Scale) tiap siswa saat uji coba
-- terpandu selesai. 1 baris = 1 pengisian SUS. `answers` = 10 jawaban skala 1..5
-- (urutan item standar SUS). `score` = skor SUS 0..100 (rumus resmi × 2.5).
--
-- Cara pakai: jalankan di Supabase SQL Editor SEKALI. Setelah itu form SUS otomatis
-- muncul di akhir alur uji coba (/buddy?...&new_chat=true) dan tersimpan ke tabel ini.
-- Guru mengunduh CSV-nya di dashboard Analitik.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.sus_responses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  session_id uuid,
  student_email text,        -- lowercase
  class_code text,
  student_name text,
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [q1..q10], tiap 1..5
  score numeric(5,2) NOT NULL DEFAULT 0,        -- 0..100
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sus_responses_pkey PRIMARY KEY (id),
  CONSTRAINT sus_responses_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);

CREATE INDEX IF NOT EXISTS idx_sus_responses_project
  ON public.sus_responses (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sus_responses_email
  ON public.sus_responses (project_id, student_email);
