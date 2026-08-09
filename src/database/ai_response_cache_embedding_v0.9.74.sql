-- ============================================================================
-- ai_response_cache_embedding_v0.9.74.sql
-- Menambah kolom `embedding` pada tabel ai_response_cache untuk SEMANTIC CACHE.
-- Sebelumnya pencocokan pertanyaan berulang hanya leksikal (Jaccard, cocok kata),
-- sehingga parafrase beda kata tapi maksud sama (mis. "gimana bikin akun" vs
-- "cara registrasi") tidak kena cache dan tetap menembak Gemini. Dengan embedding,
-- pencocokan pakai cosine similarity di sisi aplikasi (≤30 kandidat, di-scope intent).
--
-- Disimpan sebagai jsonb (array float dari model text-embedding-004). Entri lama tetap
-- valid: embedding NULL → sistem otomatis jatuh balik ke Jaccard sampai vektor terisi.
--
-- Cara pakai: jalankan di Supabase SQL Editor SEKALI.
-- ============================================================================

ALTER TABLE public.ai_response_cache
  ADD COLUMN IF NOT EXISTS embedding jsonb;
