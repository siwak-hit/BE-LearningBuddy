const { supabaseAdmin } = require('../config/supabase.config');

const isValidUUID = (id) => {
  if (id === undefined || id === null) return false;
  const text = String(id).trim();
  if (!text || text === 'null' || text === 'undefined' || text === 'all' || text === 'semua') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(text);
};

const LogModel = {
  getSummaryCounts: async (projectId) => {
    let sessionQuery = supabaseAdmin.from('chat_sessions').select('*', { count: 'exact', head: true });
    let messageQuery = supabaseAdmin.from('chat_messages').select('*', { count: 'exact', head: true });
    let modQuery = supabaseAdmin.from('moderation_logs').select('*', { count: 'exact', head: true });

    let specificModQuery = supabaseAdmin.from('moderation_logs').select('type');
    let specificMsgQuery = supabaseAdmin.from('chat_messages').select('intent');

    if (isValidUUID(projectId)) {
      sessionQuery = sessionQuery.eq('project_id', projectId);
    }

    const [sessions, messages, moderations, modLogs, msgLogs] = await Promise.all([
      sessionQuery, messageQuery, modQuery, specificModQuery, specificMsgQuery
    ]);

    // Kembalikan format asli yang dibutuhkan oleh log.service.js
    return {
      totalSessions: sessions.count || 0,
      totalMessages: messages.count || 0,
      totalModerationAlerts: moderations.count || 0,
      modLogs: modLogs.data || [],
      msgLogs: msgLogs.data || []
    };
  },

  getSessionsPaginated: async ({ page, limit, projectId, date, sessionIds }) => {
    let query = supabaseAdmin
      .from('chat_sessions')
      .select('*, projects(name)', { count: 'exact' });

    if (isValidUUID(projectId)) {
      query = query.eq('project_id', projectId);
    }

    // FILTER BERDASARKAN TANGGAL
    if (date) {

      const startOfDay = new Date(`${date}T00:00:00+07:00`).toISOString();
      const endOfDay = new Date(`${date}T23:59:59+07:00`).toISOString();

      query = query.gte('started_at', startOfDay).lte('started_at', endOfDay);
    }

    if (sessionIds) {
      const validIds = sessionIds.filter(id => isValidUUID(id));
      if (validIds.length > 0) {
        query = query.in('id', validIds);
      } else if (sessionIds.length > 0 && validIds.length === 0) {
        return { data: [], count: 0 };
      } else if (sessionIds.length === 0) {
        return { data: [], count: 0 };
      }
    }

    const fromOffset = (page - 1) * limit;
    const toOffset = fromOffset + limit - 1;

    const { data, count, error } = await query
      .order('started_at', { ascending: false })
      .range(fromOffset, toOffset);

    if (error) throw error;

    const mappedData = data.map(item => {
      const safety = item.page_context?.safety_state || {};
      const isLocked = safety.locked === true;
      const shortCode = item.session_key.substring(5, 8).toUpperCase();
      const alias = item.student_alias || item.page_context?.session_meta?.display_name || `Pengunjung #${shortCode}`;

      return {
        ...item,
        is_locked: isLocked,
        session_label: alias,
        project_name: item.projects?.name || 'Sesi Umum'
      };
    });

    mappedData.sort((a, b) => {
      if (a.is_locked && !b.is_locked) return -1;
      if (!a.is_locked && b.is_locked) return 1;
      return new Date(b.started_at).getTime() - new Date(a.started_at).getTime();
    });

    return { data: mappedData, count };
  },

  getMessagesBySessionIds: async (sessionIds) => {
    // FIX: Cegah array masuk jika null atau isinya null
    const validIds = sessionIds?.filter(id => isValidUUID(id)) || [];
    if (validIds.length === 0) return [];

    const { data, error } = await supabaseAdmin
      .from('chat_messages')
      .select('id, session_id, role, message, intent, created_at')
      .in('session_id', validIds)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data;
  },

  getModerationsBySessionIds: async (sessionIds) => {
    // FIX: Cegah array masuk jika null atau isinya null
    const validIds = sessionIds?.filter(id => isValidUUID(id)) || [];
    if (validIds.length === 0) return [];

    const { data, error } = await supabaseAdmin
      .from('moderation_logs')
      .select('id, session_id, message_id, type, severity')
      .in('session_id', validIds);
    if (error) throw error;
    return data;
  },

  getSessionDetail: async (sessionId) => {
    if (!isValidUUID(sessionId)) throw new Error("Invalid Session ID");

    const { data: session, error: errSession } = await supabaseAdmin
      .from('chat_sessions')
      .select('*, projects(name)')
      .eq('id', sessionId)
      .single();
    if (errSession) throw errSession;

    const { data: messages, error: errMsgs } = await supabaseAdmin
      .from('chat_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    if (errMsgs) throw errMsgs;

    const { data: moderations, error: errMods } = await supabaseAdmin
      .from('moderation_logs')
      .select('*')
      .eq('session_id', sessionId);
    if (errMods) throw errMods;

    if(session) {
        const shortCode = session.session_key.substring(5, 8).toUpperCase();
        const alias = session.student_alias || session.page_context?.session_meta?.display_name || `Pengunjung #${shortCode}`;
        session.session_label = alias;
        session.project_name = session.projects?.name || 'Sesi Umum';
    }

    return { session, messages: messages || [], moderations: moderations || [] };
  },

  findSessionIdsByMessageFilter: async ({ q, moderationType }) => {
    let sessionIds = new Set();
    let hasFilter = false;

    if (q) {
      hasFilter = true;

      // 1. Cari keyword pada isi pesan (tabel chat_messages)
      const { data: msgData } = await supabaseAdmin.from('chat_messages').select('session_id').ilike('message', `%${q}%`);
      if (msgData) {
        msgData.forEach(d => { if (isValidUUID(d.session_id)) sessionIds.add(d.session_id); });
      }

      // 2. Cari keyword pada nama siswa atau ID sesi (tabel chat_sessions)
      const { data: sessionData } = await supabaseAdmin
        .from('chat_sessions')
        .select('id')
        .or(`student_alias.ilike.%${q}%,session_key.ilike.%${q}%`);

      if (sessionData) {
        sessionData.forEach(d => { if (isValidUUID(d.id)) sessionIds.add(d.id); });
      }
    }

    if (moderationType) {
      let modQ = supabaseAdmin.from('moderation_logs').select('session_id').eq('type', moderationType);
      const { data } = await modQ;
      let modIds = new Set();

      if (data) {
        data.forEach(d => { if (isValidUUID(d.session_id)) modIds.add(d.session_id); });
      }

      if (hasFilter) {
        sessionIds = new Set([...sessionIds].filter(x => modIds.has(x)));
      } else {
        sessionIds = modIds;
        hasFilter = true;
      }
    }

    return hasFilter ? Array.from(sessionIds) : null;
  }
};

module.exports = LogModel;
