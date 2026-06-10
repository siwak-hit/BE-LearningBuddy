const supabaseService = require('../services/supabase/supabase.service');

const TABLE = 'page_templates';
// ID MASTER PROJECT KAMU
const MASTER_PROJECT_ID = 'c4ec8eba-e342-4c31-b5de-2d4218dcfd86';

const pageTemplateModel = {
  create: async (payload) => supabaseService.create(TABLE, payload),

  findAll: async () => supabaseService.findAll(TABLE),

  // BAJAK DI SINI AGAR DROPDOWN SELALU MENGAMBIL DARI MASTER
  findByProjectId: async (projectId) =>
    supabaseService.findMany(TABLE, { project_id: MASTER_PROJECT_ID }),

  update: async (id, payload) =>
    supabaseService.updateById(TABLE, id, payload),

  delete: async (id) =>
    supabaseService.deleteById(TABLE, id)
};

module.exports = pageTemplateModel;
