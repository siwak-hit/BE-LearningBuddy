const supabaseService = require('../services/supabase/supabase.service');
const TABLE = 'faqs';

const faqModel = {
  create: async (payload) => supabaseService.create(TABLE, payload),
  findAll: async () => supabaseService.findAll(TABLE),
  findByProjectId: async (projectId) => supabaseService.findMany(TABLE, { project_id: projectId }),
  update: async (id, payload) => supabaseService.updateById(TABLE, id, payload),
  delete: async (id) => supabaseService.deleteById(TABLE, id),

  // Menggunakan service object pattern
  createMany: async (payloads) => supabaseService.createMany(TABLE, payloads),
};

module.exports = faqModel;
