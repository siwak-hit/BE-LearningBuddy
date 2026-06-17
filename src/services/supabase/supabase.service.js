const { supabaseAdmin } = require('../../config/supabase.config');

const supabaseService = {
  async findAll(table, options = {}) {
    const {
      select = '*',
      filters = {},
      orderBy = 'created_at',
      ascending = false
    } = options;

    let query = supabaseAdmin
      .from(table)
      .select(select)
      .order(orderBy, { ascending });

    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        query = query.eq(key, value);
      }
    });

    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async findById(table, id, select = '*') {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(select)
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;
    return data;
  },

  async findOne(table, filters = {}, select = '*') {
    let query = supabaseAdmin.from(table).select(select);
    Object.entries(filters).forEach(([key, value]) => {
      query = query.eq(key, value);
    });

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data;
  },

  async create(table, payload) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // --- FUNGSI BARU UNTUK BULK INSERT ---
  async createMany(table, payloads) {
    console.log('[SUPABASE CREATE MANY]', {
      table,
      total: Array.isArray(payloads) ? payloads.length : 0,
      sample: Array.isArray(payloads) ? payloads[0] : payloads
    });

    const { data, error } = await supabaseAdmin
      .from(table)
      .insert(payloads)
      .select();

    if (error) {
      console.error('[SUPABASE CREATE MANY ERROR]', error);
      throw error;
    }

    return data;
  },

  async updateById(table, id, payload) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async deleteById(table, id) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .delete()
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async findMany(table, conditions = {}, options = {}) {
    // [v0.4.0] Dukung pemilihan kolom + urutan agar query tidak selalu SELECT *.
    const { select = '*', orderBy, ascending = true, limit } = options;
    let query = supabaseAdmin.from(table).select(select).match(conditions);
    if (orderBy) query = query.order(orderBy, { ascending });
    if (limit) query = query.limit(limit);

    const { data, error } = await query;
    if (error) throw error;
    return data;
  },

  async uploadFile(bucket, path, fileBuffer, contentType) {
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .upload(path, fileBuffer, {
        contentType,
        upsert: true
      });

    if (error) throw error;
    return data;
  },

  async deleteFile(bucket, path) {
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .remove([path]);

    if (error) throw error;
    return data;
  },

  getPublicUrl(bucket, path) {
    const { data } = supabaseAdmin.storage
      .from(bucket)
      .getPublicUrl(path);

    return data.publicUrl;
  },

  async update(tableName, matchConditions, updateData) {
    const { data, error } = await supabaseAdmin
      .from(tableName)
      .update(updateData)
      .match(matchConditions)
      .select();

    if (error) {
      console.error(`[Supabase Error] Update on ${tableName}:`, error.message);
      throw new Error(`Gagal mengupdate data di ${tableName}: ${error.message}`);
    }

    return data;
  }
};

module.exports = supabaseService;
