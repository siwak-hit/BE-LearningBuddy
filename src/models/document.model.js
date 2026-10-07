const supabaseService = require('../services/supabase/supabase.service');
const TABLE = 'documents';

const documentModel = {
  create: async (payload) => supabaseService.create(TABLE, payload),
  findAll: async () => supabaseService.findAll(TABLE),
  findById: async (id) => supabaseService.findById(TABLE, id),
  findLiteByProjectId: async (projectId) =>
    supabaseService.findMany(TABLE, { project_id: projectId }, { select: 'id, title, source_url' }),
  delete: async (id) => supabaseService.deleteById(TABLE, id),
  update: async (id, payload) => supabaseService.updateById(TABLE, id, payload)
};

module.exports = documentModel;
