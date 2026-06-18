// src/services/log/log.service.js
const LogModel = require('../../models/log.model');

const formatSessionLabel = (session) => {
  if (session.student_alias) return session.student_alias;
  const shortId = session.session_key ? session.session_key.substring(0, 8).toUpperCase() : session.id.substring(0, 8).toUpperCase();
  return `Sesi #${shortId}`;
};

const LogService = {
  getSummary: async (projectId) => {
    const rawCounts = await LogModel.getSummaryCounts(projectId);

    // Aggregate spesifik
    let hateSpeech = 0, profanity = 0, mentalHealth = 0;
    rawCounts.modLogs.forEach(log => {
      if (log.type === 'hate_speech') hateSpeech++;
      if (log.type === 'profanity') profanity++;
      if (log.type === 'mental_health') mentalHealth++;
    });

    let quizAnswerReq = 0, outOfContext = 0;
    rawCounts.msgLogs.forEach(log => {
      if (log.intent === 'quiz_answer_request') quizAnswerReq++;
      if (log.intent === 'out_of_context') outOfContext++;
    });

    return {
      totalSessions: rawCounts.totalSessions,
      totalMessages: rawCounts.totalMessages,
      totalModerationAlerts: rawCounts.totalModerationAlerts,
      hateSpeech,
      profanity,
      mentalHealth,
      quizAnswerRequest: quizAnswerReq,
      outOfContext
    };
  },

  getSessions: async (filters) => {
    // Ambil date dari filters
    const { page = 1, limit = 10, projectId, q, date, moderationType } = filters;

    // findSessionIdsByMessageFilter sekarang menangani q (search bar luas) dan moderationType
    const filterSessionIds = await LogModel.findSessionIdsByMessageFilter({ q, moderationType });

    const { data: sessions, count } = await LogModel.getSessionsPaginated({
      page: Number(page),
      limit: Number(limit),
      projectId,
      date,
      sessionIds: filterSessionIds
    });

    if (sessions.length === 0) {
      return { items: [], pagination: { page: Number(page), limit: Number(limit), total: 0, totalPages: 0 } };
    }

    const sessionIds = sessions.map(s => s.id);
    const messages = await LogModel.getMessagesBySessionIds(sessionIds);
    const moderations = await LogModel.getModerationsBySessionIds(sessionIds);

    const items = sessions.map(session => {
      const sessionMsgs = messages.filter(m => m.session_id === session.id);
      const sessionMods = moderations.filter(m => m.session_id === session.id);
      const lastMsg = sessionMsgs[0]; // Karena sudah di-order desc

      // Hitung dominan intent (contoh sederhana)
      let intentDominan = null;
      if (sessionMsgs.length > 0) {
         const intentCounts = sessionMsgs.reduce((acc, m) => {
           if (m.intent) acc[m.intent] = (acc[m.intent] || 0) + 1;
           return acc;
         }, {});
         if(Object.keys(intentCounts).length > 0){
             intentDominan = Object.keys(intentCounts).reduce((a, b) => intentCounts[a] > intentCounts[b] ? a : b);
         }
      }

      return {
        id: session.id,
        session_key: session.session_key,
        session_label: session.session_label, // FIX: Ambil murni dari model (Nama & Kelas)
        project_id: session.project_id,
        project_name: session.project_name, // FIX: Ambil project name dari model
        source_url: session.source_url,
        started_at: session.started_at,
        last_active_at: lastMsg ? lastMsg.created_at : session.started_at,
        total_messages: sessionMsgs.length,
        last_message: lastMsg ? lastMsg.message : '-',
        dominant_intent: intentDominan,
        alert_count: sessionMods.length,
        alert_types: [...new Set(sessionMods.map(m => m.type))]
      };
    });

    // FIX: SORTING DESCENDING. Paling baru ngobrol / interaksi = Paling Atas
    items.sort((a, b) => {
      const aLocked = sessions.find(s => s.id === a.id)?.is_locked;
      const bLocked = sessions.find(s => s.id === b.id)?.is_locked;
      if (aLocked && !bLocked) return -1;
      if (!aLocked && bLocked) return 1;

      // Urutkan berdasarkan waktu terakhir pesan terkirim
      return new Date(b.last_active_at).getTime() - new Date(a.last_active_at).getTime();
    });

    return {
      items,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: count,
        totalPages: Math.ceil(count / limit)
      }
    };
  },

  getSessionDetail: async (sessionId) => {
    const { session, messages, moderations } = await LogModel.getSessionDetail(sessionId);

    const cleanMessages = messages.map(msg => {
      let safeContext = null;
      if (msg.context_used) {
         const parsed = typeof msg.context_used === 'string' ? JSON.parse(msg.context_used) : msg.context_used;
         safeContext = {
           results_count: parsed?.results_count || 0,
           top_sources: parsed?.top_sources || [],
           element_info: parsed?.element_info || null,
           // [v0.9.6] Dibutuhkan FE untuk memberi label "Jawaban AI" vs "Jawaban Sistem".
           response_source: parsed?.response_source || null,
           used_model: parsed?.used_model || null
         };
      }

      return {
        id: msg.id,
        role: msg.role,
        message: msg.message,
        intent: msg.intent,
        created_at: msg.created_at,
        context_used: safeContext,
        moderation: moderations.find(m => m.message_id === msg.id) || null
      };
    });

    return {
      session: {
        id: session.id,
        session_key: session.session_key,
        session_label: formatSessionLabel(session),
        project_name: session.projects?.name || 'Unknown',
        source_url: session.source_url,
        page_context: session.page_context,
        started_at: session.started_at
      },
      messages: cleanMessages
    };
  }
};

module.exports = LogService;
