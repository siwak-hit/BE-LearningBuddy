-- ============================================================
-- CLEANUP SQL — AI Learning Buddy (v0.2.0)
-- Tanggal: 2026-06-16
--
-- ⚠️  REVIEW DULU sebelum dijalankan. Jalankan di Supabase SQL Editor.
-- ⚠️  BACKUP dulu (atau jalankan di project staging) — perintah ini destruktif.
-- Hasil audit kode: hanya 1 tabel yang benar-benar TIDAK dipakai aplikasi.
-- ============================================================


-- ------------------------------------------------------------
-- 1) DROP TABEL TIDAK TERPAKAI: public.users
-- ------------------------------------------------------------
-- Alasan:
--   • Tidak ada satupun query ke tabel ini di seluruh BE/src.
--   • Login admin/guru memakai Supabase Auth bawaan (auth.users) via
--     supabaseAdmin.auth.signInWithPassword() — lihat BE/src/models/auth.model.js.
--   • Tidak ada foreign key yang menunjuk ke public.users.
--   • Bonus keamanan: tabel ini menyimpan kolom `password` plaintext (risiko).
DROP TABLE IF EXISTS public.users CASCADE;


-- ============================================================
-- 2) PEMBERSIHAN DATA (OPSIONAL) — tabel TETAP dipakai, hanya buang baris basi.
--    Hapus tanda komentar (--) pada blok yang ingin dijalankan.
-- ============================================================

-- 2a) Buang cache AI yang sudah kedaluwarsa (aman; akan terisi ulang).
-- DELETE FROM public.ai_response_cache
--  WHERE expires_at IS NOT NULL AND expires_at < now();

-- 2b) Buang baris registry sesi siswa yang sudah di-soft-delete.
-- DELETE FROM public.student_session_registry
--  WHERE is_deleted = true;

-- 2c) Buang sesi chat anonim lama yang tidak terhubung siswa (> 30 hari).
--     CATATAN: chat_messages diasumsikan ON DELETE CASCADE ke chat_sessions.
--     Jika tidak, hapus pesannya lebih dulu (lihat 2d).
-- DELETE FROM public.chat_sessions
--  WHERE started_at < now() - interval '30 days'
--    AND (student_alias IS NULL OR student_alias LIKE 'Pengunjung #%');

-- 2d) (Hanya jika TIDAK ada CASCADE) hapus pesan yatim lebih dulu:
-- DELETE FROM public.chat_messages
--  WHERE session_id NOT IN (SELECT id FROM public.chat_sessions);


-- ============================================================
-- 3) TABEL YANG DIPERTAHANKAN (JANGAN di-drop) — untuk dokumentasi:
--   • ai_response_cache        -> akan di-wiring untuk fitur cache-first (#1).
--   • page_question_rules,
--     action_rules,
--     question_suggestions     -> masih dipakai rule.service.js (saran & rule halaman).
--   • moderation_logs          -> dipakai chat.model.js & log.model.js.
--   • student_session_registry -> dipakai fitur reuse sesi (SM-4).
-- ============================================================
