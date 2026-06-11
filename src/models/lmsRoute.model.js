const supabaseService = require('../services/supabase/supabase.service');

const COURSE_TABLE = 'lms_course_routes';
const ACTIVITY_TABLE = 'lms_activity_routes';

function getClient() {
  const client =
    supabaseService.client ||
    supabaseService.supabase ||
    supabaseService.db ||
    supabaseService;

  if (!client || typeof client.from !== 'function') {
    throw new Error('[lmsRoute.model] Supabase client tidak ditemukan. Cek export di supabase.service.js');
  }

  return client;
}

const lmsRouteModel = {
  async findCourseRoute(projectId, classCode) {
    if (!projectId || !classCode) return null;

    const { data, error } = await getClient()
      .from(COURSE_TABLE)
      .select('*')
      .eq('project_id', projectId)
      .eq('class_code', classCode)
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  },

  async findActivityRoute(projectId, classCode, courseId, activityTitle) {
    if (!projectId || !classCode || !courseId || !activityTitle) return null;

    const { data, error } = await getClient()
      .from(ACTIVITY_TABLE)
      .select('*')
      .eq('project_id', projectId)
      .eq('class_code', classCode)
      .eq('course_id', courseId)
      .eq('activity_title', activityTitle)
      .eq('is_active', true)
      .maybeSingle();

    if (error) throw error;
    return data || null;
  }
};

module.exports = lmsRouteModel;
