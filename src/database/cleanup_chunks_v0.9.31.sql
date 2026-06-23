-- ============================================================================
-- cleanup_chunks_v0.9.31.sql
-- Hapus DATA CHUNK MATERI LAMA dari Moodle sebelum re-sync dengan logika baru:
--   • Chunk PER PARAGRAF (1 paragraf = 1 chunk) — v0.9.31 #5
--   • HANYA modname `page` yang di-chunk (resource/file di-skip) — v0.9.31 #A
--   • Materi tersembunyi (visible=0 / stealth) tidak ikut di-chunk — v0.9.31 #2
--   • Filter course (kelas) lebih ketat (anti bocor lintas-kelas) — v0.9.31 #B
--
-- Kenapa perlu dihapus manual: re-sync hanya menimpa dokumen Moodle yang MASIH
-- ada modulnya. Dokumen lama yang sumbernya `resource`, materi yang sudah
-- disembunyikan, atau materi kurikulum lama (mis. "Media Sosial" yang sudah
-- diganti "WordPress/CMS") TIDAK akan tersentuh → chunk basinya tetap nyangkut &
-- bikin AI salah jawab. Maka bersihkan dulu, lalu Sinkron Ulang dari dashboard.
--
-- AMAN untuk materi upload manual: hanya menghapus yang source_type = 'moodle'.
-- Dokumen/chunk hasil upload manual (source_type 'upload'/'manual') TIDAK dihapus.
--
-- Cara pakai (Supabase SQL Editor):
--   1) Jalankan blok di bawah (urutan penting: chunk dulu, baru dokumen).
--   2) Buka dashboard → Basis Pengetahuan → Integrasi Moodle → "Sinkron Ulang".
--   3) Cek @materi & tanya materi: jawaban kini dari materi kelas yang benar.
--
-- (Opsional) Batasi ke 1 project: tambahkan `AND project_id = '<PROJECT_UUID>'`
-- pada tiap statement, atau ganti subquery documents dengan filter project.
-- ============================================================================

BEGIN;

-- 1) Hapus chunk milik dokumen Moodle (FK: chunk → documents, jadi chunk dulu).
DELETE FROM public.document_chunks
WHERE document_id IN (
  SELECT id FROM public.documents WHERE source_type = 'moodle'
);

-- 2) Hapus chunk "yatim" yang asalnya Moodle tapi dokumennya sudah tak terlacak
--    (mis. tertinggal dari sinkron lama). Berdasar metadata, bukan source_type.
DELETE FROM public.document_chunks
WHERE (metadata->>'source_origin') = 'moodle';

-- 3) Hapus dokumen Moodle. Akan dibuat ulang otomatis saat "Sinkron Ulang".
DELETE FROM public.documents
WHERE source_type = 'moodle';

COMMIT;

-- Verifikasi (harus 0 setelah cleanup, sebelum re-sync):
-- SELECT COUNT(*) AS sisa_chunk_moodle FROM public.document_chunks
--   WHERE (metadata->>'source_origin') = 'moodle';
-- SELECT COUNT(*) AS sisa_doc_moodle FROM public.documents
--   WHERE source_type = 'moodle';
