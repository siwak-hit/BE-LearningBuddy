const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase.config');

const TABLE = 'ai_response_cache';

function getClient() {
  if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function') {
    throw new Error('[aiResponseCache.model] Supabase client tidak ditemukan dari config.');
  }
  return supabaseAdmin;
}

function normalizeQuestion(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/log\s*in/g, 'login')
    .replace(/sosial\s*media/g, 'media sosial')
    .replace(/sosmed/g, 'media sosial')
    .replace(/hoaks/g, 'hoax')
    .replace(/word\s*press/g, 'wordpress')
    .replace(/content\s+management\s+system/g, 'cms')
    .replace(/content\s+manajemen\s+sistem/g, 'cms')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\b(apa|itu|ini|yang|dan|atau|di|ke|dari|pada|dong|sih|ya|kak|min|tolong|jelaskan|pengertian|maksud|definisi|gimana|bagaimana|kenapa|mengapa)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashText(value = '') {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

// [v0.9.74] Cosine similarity untuk semantic cache. Dipakai saat kedua sisi punya
// embedding (vektor dari model yang sama). Return 0 kalau bentuk vektor tak valid.
function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function jaccard(a = '', b = '') {
  const aSet = new Set(normalizeQuestion(a).split(/\s+/).filter(Boolean));
  const bSet = new Set(normalizeQuestion(b).split(/\s+/).filter(Boolean));
  if (!aSet.size || !bSet.size) return 0;
  let inter = 0;
  aSet.forEach((x) => { if (bSet.has(x)) inter += 1; });
  return inter / (aSet.size + bSet.size - inter);
}

const aiResponseCacheModel = {
  hashText,
  normalizeQuestion,
  cosine,

  buildCacheKey(projectId, normalizedQuestion, contextHash = '') {
    return hashText([projectId || '-', normalizedQuestion || '-', contextHash || '-'].join('|'));
  },

  async findByKey(projectId, cacheKey) {
    if (!projectId || !cacheKey) return null;
    const now = new Date().toISOString();
    const { data, error } = await getClient()
      .from(TABLE)
      .select('id, answer, intent, context_hash, hit_count, expires_at, updated_at')
      .eq('project_id', projectId)
      .eq('cache_key', cacheKey)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  async findBestSimilar(projectId, question, options = {}) {
    if (!projectId || !question) return null;
    const normalized = normalizeQuestion(question);
    if (!normalized || normalized.length < 3) return null;

    const now = new Date().toISOString();
    let query = getClient()
      .from(TABLE)
      .select('id, answer, question, normalized_question, intent, context_hash, hit_count, embedding')
      .eq('project_id', projectId)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('updated_at', { ascending: false })
      .limit(30);

    if (options.intent) query = query.eq('intent', options.intent);
    if (options.contextHash) query = query.eq('context_hash', options.contextHash);

    const { data, error } = await query;
    if (error) throw error;
    const rows = data || [];

    // 1) SEMANTIK (cosine) — jalur utama. Menangkap parafrase yang beda kata tapi
    // maksud sama (mis. "gimana bikin akun" vs "cara registrasi"). Hanya jalan bila
    // query embedding tersedia DAN baris cache punya embedding. Threshold sengaja
    // ketat (default 0.88) agar tidak salah menyajikan jawaban pertanyaan lain.
    const qEmb = options.queryEmbedding;
    if (Array.isArray(qEmb) && qEmb.length) {
      let best = null;
      let bestScore = 0;
      rows.forEach((row) => {
        if (!Array.isArray(row.embedding) || row.embedding.length === 0) return;
        const score = cosine(qEmb, row.embedding);
        if (score > bestScore) {
          best = row;
          bestScore = score;
        }
      });
      const cosineThreshold = Number(options.cosineThreshold || 0.88);
      if (best && bestScore >= cosineThreshold) {
        return { ...best, similarity_score: bestScore, similarity_method: 'cosine' };
      }
    }

    // 2) LEKSIKAL (Jaccard) — jaring pengaman bila embedding kosong/gagal (mis. entri
    // cache lama sebelum kolom embedding terisi, atau API embedding sedang down).
    let best = null;
    let bestScore = 0;
    rows.forEach((row) => {
      const score = jaccard(normalized, row.normalized_question || row.question || '');
      if (score > bestScore) {
        best = row;
        bestScore = score;
      }
    });

    const threshold = Number(options.threshold || 0.72);
    if (!best || bestScore < threshold) return null;
    return { ...best, similarity_score: bestScore, similarity_method: 'jaccard' };
  },

  async incrementHit(id) {
    if (!id) return null;
    const { data: current, error: readError } = await getClient()
      .from(TABLE)
      .select('hit_count')
      .eq('id', id)
      .maybeSingle();
    if (readError) throw readError;

    const { data, error } = await getClient()
      .from(TABLE)
      .update({
        hit_count: Number(current?.hit_count || 0) + 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  async upsertCache(payload = {}) {
    if (!payload.project_id || !payload.cache_key || !payload.question || !payload.answer) return null;
    const now = new Date().toISOString();
    const safePayload = {
      response_source: 'ai',
      source_type: 'document_chunk',
      hit_count: 0,
      ...payload,
      normalized_question: payload.normalized_question || normalizeQuestion(payload.question),
      updated_at: now
    };

    const existing = await this.findByKey(safePayload.project_id, safePayload.cache_key);
    if (existing) {
      const { data, error } = await getClient()
        .from(TABLE)
        .update(safePayload)
        .eq('id', existing.id)
        .select()
        .maybeSingle();
      if (error) throw error;
      return data || null;
    }

    const { data, error } = await getClient()
      .from(TABLE)
      .insert({ ...safePayload, created_at: now })
      .select()
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }
};

module.exports = aiResponseCacheModel;
