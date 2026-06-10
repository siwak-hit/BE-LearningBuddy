const supabaseService = require('../services/supabase/supabase.service');

const TABLE = 'activity_instructions';

const activityModel = {
  create: async (payload) => supabaseService.create(TABLE, payload),

  findAll: async () => supabaseService.findAll(TABLE),

  findByProjectId: async (projectId) =>
    supabaseService.findMany(TABLE, { project_id: projectId }),

  update: async (id, payload) =>
    supabaseService.updateById(TABLE, id, payload),

  delete: async (id) =>
    supabaseService.deleteById(TABLE, id),

  createMany: async (payloads) =>
    supabaseService.createMany(TABLE, payloads)
};

module.exports = activityModel;
