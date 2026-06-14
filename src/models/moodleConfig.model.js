const supabaseService = require('../services/supabase/supabase.service');

function sanitizeConfig(config) {
  if (!config) return null;
  return {
    id: config.id,
    project_id: config.project_id,
    rest_endpoint: config.rest_endpoint,
    course_map: config.course_map || {},
    is_active: config.is_active,
    last_test_status: config.last_test_status,
    last_test_message: config.last_test_message,
    last_test_at: config.last_test_at,
    created_at: config.created_at,
    updated_at: config.updated_at,
    hasToken: Boolean(config.token),
    hasEndpoint: Boolean(config.rest_endpoint)
  };
}

const moodleConfigModel = {
  async findByProjectId(projectId) {
    if (!projectId) return null;

    try {
      const config = await supabaseService.findOne('moodle_configs', { project_id: projectId });

      // schema is_active nullable; anggap null sebagai aktif agar data lama tidak ikut hilang.
      if (!config || config.is_active === false) return null;
      return config;
    } catch (error) {
      console.warn('[moodleConfig.model] findByProjectId gagal:', error.message);
      return null;
    }
  },

  async findRawByProjectId(projectId) {
    if (!projectId) return null;
    try {
      return await supabaseService.findOne('moodle_configs', { project_id: projectId });
    } catch (error) {
      console.warn('[moodleConfig.model] findRawByProjectId gagal:', error.message);
      return null;
    }
  },

  async getDebugByProjectId(projectId) {
    const config = await this.findRawByProjectId(projectId);
    if (!config) {
      return {
        projectId,
        hasConfig: false,
        hasEndpoint: false,
        hasToken: false,
        courseMapKeys: [],
        isActive: null,
        lastTestStatus: null,
        lastTestAt: null
      };
    }

    const courseMap = config.course_map || {};
    return {
      projectId,
      hasConfig: true,
      hasEndpoint: Boolean(config.rest_endpoint),
      hasToken: Boolean(config.token),
      courseMapKeys: Object.keys(courseMap),
      isActive: config.is_active !== false,
      lastTestStatus: config.last_test_status || null,
      lastTestAt: config.last_test_at || null
    };
  },

  async upsertByProjectId(projectId, payload) {
    const existing = await this.findRawByProjectId(projectId);
    const safePayload = { ...payload };

    if (existing) {
      const updatedData = await supabaseService.update(
        'moodle_configs',
        { project_id: projectId },
        { ...safePayload, updated_at: new Date().toISOString() }
      );

      return Array.isArray(updatedData) ? updatedData[0] : updatedData;
    }

    return supabaseService.create('moodle_configs', {
      project_id: projectId,
      is_active: safePayload.is_active ?? true,
      ...safePayload
    });
  },

  async updateTestResult(projectId, status, message) {
    return supabaseService.update(
      'moodle_configs',
      { project_id: projectId },
      {
        last_test_status: status,
        last_test_message: message,
        last_test_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    );
  },

  sanitizeConfig
};

module.exports = moodleConfigModel;
