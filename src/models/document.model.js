const supabaseService = require('../services/supabase/supabase.service');
const TABLE = 'documents';

const documentModel = {
  create: async (payload) => supabaseService.create(TABLE, payload),
  findAll: async () => supabaseService.findAll(TABLE),
  findById: async (id) => supabaseService.findById(TABLE, id),
  findByProjectId: async (projectId) => supabaseService.findMany(TABLE, { project_id: projectId }),
  delete: async (id) => supabaseService.deleteById(TABLE, id),
  update: async (id, payload) => supabaseService.updateById(TABLE, id, payload)
};

module.exports = documentModel;
