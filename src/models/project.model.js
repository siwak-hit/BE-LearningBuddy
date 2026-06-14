const supabaseService = require('../services/supabase/supabase.service');

const TABLE = 'projects';

const projectModel = {
  async create(payload) {
    return supabaseService.create(TABLE, payload);
  },

  async findAll() {
    return supabaseService.findAll(TABLE, {
      select: '*, widget_configs(project_key)'
    });
  },

  async findById(id) {
    if (!id) return null;
    return supabaseService.findById(TABLE, id);
  },

  async findBySlug(slug) {
    if (!slug) return null;
    return supabaseService.findOne(TABLE, { slug });
  },

  async findByProjectKey(projectKey) {
    if (!projectKey) return null;

    const widgetConfig = await supabaseService.findOne('widget_configs', {
      project_key: projectKey
    });

    if (!widgetConfig?.project_id) return null;
    return this.findById(widgetConfig.project_id);
  },

  async resolveProjectId({ projectId, projectKey } = {}) {
    if (projectId) return projectId;
    const project = await this.findByProjectKey(projectKey);
    return project?.id || null;
  },

  async update(id, payload) {
    return supabaseService.updateById(TABLE, id, payload);
  },

  async delete(id) {
    return supabaseService.deleteById(TABLE, id);
  }
};

module.exports = projectModel;
