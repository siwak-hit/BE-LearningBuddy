const supabaseService = require('../services/supabase/supabase.service');

const TABLE = 'widget_configs';

const widgetModel = {
  async create(payload) {
    return supabaseService.create(TABLE, payload);
  },

  async findAll() {
    return supabaseService.findAll(TABLE);
  },

  async findById(id) {
    return supabaseService.findById(TABLE, id);
  },

  async findByProjectKey(projectKey) {
    return supabaseService.findOne(TABLE, {
      project_key: projectKey,
      is_active: true
    });
  },

  async findByProjectId(projectId) {
    return supabaseService.findAll(TABLE, {
      filters: {
        project_id: projectId
      }
    });
  },

  async update(id, payload) {
    return supabaseService.updateById(TABLE, id, payload);
  },

  async delete(id) {
    return supabaseService.deleteById(TABLE, id);
  }
};

module.exports = widgetModel;
