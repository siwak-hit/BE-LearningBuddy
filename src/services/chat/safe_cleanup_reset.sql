-- ===========================================================
-- SAFE CLEANUP RESET - AI Buddy / Moodle RAG
-- Tujuan: mengosongkan data runtime/hasil sinkron lama agar DB ringan.
-- Jalankan di Supabase SQL Editor.
-- ===========================================================

-- OPSI 1: RESET GLOBAL SEMUA PROJECT
-- Cocok untuk tahap testing lokal/dev.
-- Jangan jalankan kalau sudah production multi-project kecuali memang ingin reset semua.

BEGIN;

-- 1) Cache jawaban AI lama. Aman dihapus, nanti dibuat ulang otomatis.
DELETE FROM public.ai_response_cache;

-- 2) Log moderasi lama. Aman dihapus untuk reset testing.
DELETE FROM public.moderation_logs;

-- 3) Chat runtime lama. Hapus messages dulu karena FK ke chat_sessions.
DELETE FROM public.chat_messages;
DELETE FROM public.chat_sessions;

-- 4) Session registry siswa dari fitur 1 siswa = 1 session.
-- Aman dihapus kalau ingin semua siswa mulai ulang session dari awal.
DELETE FROM public.student_session_registry;

-- 5) Catatan siswa.
-- Komentari baris ini kalau catatan siswa mau tetap disimpan.
-- DELETE FROM public.student_notes;

-- 6) RAG hasil sync / upload materi. Hapus chunk dulu baru dokumen.
-- Aman dihapus kalau ingin sinkron Moodle dari nol.
DELETE FROM public.document_chunks;
DELETE FROM public.documents;

COMMIT;

-- ===========================================================
-- OPSI 2: RESET KHUSUS 1 PROJECT SAJA
-- Ganti ISI_PROJECT_ID_DI_SINI, lalu jalankan blok ini saja.
-- ===========================================================

-- BEGIN;
--
-- DELETE FROM public.ai_response_cache
-- WHERE project_id = 'ISI_PROJECT_ID_DI_SINI';
--
-- DELETE FROM public.moderation_logs ml
-- USING public.chat_sessions cs
-- WHERE ml.session_id = cs.id
--   AND cs.project_id = 'ISI_PROJECT_ID_DI_SINI';
--
-- DELETE FROM public.chat_messages cm
-- USING public.chat_sessions cs
-- WHERE cm.session_id = cs.id
--   AND cs.project_id = 'ISI_PROJECT_ID_DI_SINI';
--
-- DELETE FROM public.chat_sessions
-- WHERE project_id = 'ISI_PROJECT_ID_DI_SINI';
--
-- DELETE FROM public.student_session_registry
-- WHERE project_id = 'ISI_PROJECT_ID_DI_SINI';
--
-- -- Komentari kalau catatan siswa mau tetap ada.
-- -- DELETE FROM public.student_notes
-- -- WHERE project_id = 'ISI_PROJECT_ID_DI_SINI';
--
-- DELETE FROM public.document_chunks
-- WHERE project_id = 'ISI_PROJECT_ID_DI_SINI';
--
-- DELETE FROM public.documents
-- WHERE project_id = 'ISI_PROJECT_ID_DI_SINI';
--
-- COMMIT;

-- ===========================================================
-- TABEL YANG SENGAJA TIDAK DIHAPUS:
-- - projects
-- - widget_configs
-- - moodle_configs
-- - lms_course_routes
-- - lms_activity_routes
-- - faqs
-- - activity_instructions
-- - page_templates
-- - users
-- Alasannya: itu data konfigurasi/master yang masih penting.
-- ===========================================================
