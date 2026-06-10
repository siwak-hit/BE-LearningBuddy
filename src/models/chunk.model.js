const supabaseService = require('../services/supabase/supabase.service');
const { supabaseAdmin } = require('../config/supabase.config');
const TABLE = 'document_chunks';

const chunkModel = {
  async createMany(payloadArray) {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .insert(payloadArray)
      .select();

    if (error) throw error;
    return data;
  },

  async findByDocumentId(documentId) {
    return supabaseService.findMany(TABLE, { document_id: documentId });
  },

  async findByProjectId(projectId) {
    return supabaseService.findMany(TABLE, { project_id: projectId });
  },

  async deleteByDocumentId(documentId) {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .delete()
      .eq('document_id', documentId);

    if (error) throw error;
    return data;
  }
};

module.exports = chunkModel;
