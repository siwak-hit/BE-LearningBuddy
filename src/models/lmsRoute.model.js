const { supabaseAdmin } = require('../config/supabase.config');

const COURSE_TABLE = 'lms_course_routes';
const ACTIVITY_TABLE = 'lms_activity_routes';

function getClient() {
  if (!supabaseAdmin || typeof supabaseAdmin.from !== 'function') {
    throw new Error('[lmsRoute.model] Supabase client tidak ditemukan dari config.');
  }
  return supabaseAdmin;
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

  async findCourseRouteAny(projectId, classCode) {
    if (!projectId || !classCode) return null;

    const { data, error } = await getClient()
      .from(COURSE_TABLE)
      .select('*')
      .eq('project_id', projectId)
      .eq('class_code', classCode)
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
  },

  async upsertCourseRoute(projectId, payload) {
    if (!projectId) throw new Error('projectId wajib diisi');
    if (!payload?.class_code) throw new Error('class_code wajib diisi');

    const now = new Date().toISOString();
    const safePayload = {
      ...payload,
      project_id: projectId,
      is_active: payload.is_active !== false,
      updated_at: now,
      last_synced_at: payload.last_synced_at || now
    };

    const existing = await this.findCourseRouteAny(projectId, safePayload.class_code);

    if (existing) {
      const { data, error } = await getClient()
        .from(COURSE_TABLE)
        .update(safePayload)
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    }

    const { data, error } = await getClient()
      .from(COURSE_TABLE)
      .insert(safePayload)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async getCoursesByProject(projectId) {
    const { data, error } = await getClient()
      .from(COURSE_TABLE)
      .select('*')
      .eq('project_id', projectId)
      .order('class_code', { ascending: true });

    if (error) throw error;
    return data || [];
  },


  async bulkUpsertCourseRoutes(projectId, courses = []) {
    if (!projectId) throw new Error('projectId wajib diisi');
    const result = [];

    for (const course of courses || []) {
      if (!course?.class_code || !course?.course_id) continue;
      const saved = await this.upsertCourseRoute(projectId, {
        class_code: course.class_code,
        course_id: Number(course.course_id),
        course_url: course.course_url,
        course_title: course.course_title || `Course ${course.course_id}`,
        teacher_name: course.teacher_name || null,
        is_active: course.is_active !== false,
        last_synced_at: new Date().toISOString()
      });
      result.push(saved);
    }

    return result;
  },

  async upsertActivityRoute(projectId, payload) {
    if (!projectId) throw new Error('projectId wajib diisi');
    if (!payload?.class_code) throw new Error('class_code wajib diisi');
    if (!payload?.moodle_module_id) throw new Error('moodle_module_id wajib diisi');

    const now = new Date().toISOString();
    const safePayload = {
      ...payload,
      project_id: projectId,
      is_active: payload.is_active !== false,
      updated_at: now,
      last_synced_at: payload.last_synced_at || now
    };

    const { data: existing, error: findError } = await getClient()
      .from(ACTIVITY_TABLE)
      .select('id')
      .eq('project_id', projectId)
      .eq('class_code', safePayload.class_code)
      .eq('moodle_module_id', safePayload.moodle_module_id)
      .maybeSingle();

    if (findError) throw findError;

    if (existing) {
      const { data, error } = await getClient()
        .from(ACTIVITY_TABLE)
        .update(safePayload)
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    }

    const { data, error } = await getClient()
      .from(ACTIVITY_TABLE)
      .insert(safePayload)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  async deleteActivitiesForClass(projectId, classCode) {
    if (!projectId || !classCode) return 0;

    const { data, error } = await getClient()
      .from(ACTIVITY_TABLE)
      .delete()
      .eq('project_id', projectId)
      .eq('class_code', classCode)
      .select('id');

    if (error) throw error;
    return Array.isArray(data) ? data.length : 0;
  },

  async replaceActivitiesForClass(projectId, classCode, activities = []) {
    await this.deleteActivitiesForClass(projectId, classCode);

    if (!activities.length) return [];

    const now = new Date().toISOString();
    const rows = activities.map((item) => ({
      ...item,
      project_id: projectId,
      class_code: classCode,
      is_active: item.is_active !== false,
      updated_at: now,
      last_synced_at: item.last_synced_at || now
    }));

    const inserted = [];
    const chunkSize = 200;

    for (let i = 0; i < rows.length; i += chunkSize) {
      const batch = rows.slice(i, i + chunkSize);
      const { data, error } = await getClient()
        .from(ACTIVITY_TABLE)
        .insert(batch)
        .select();

      if (error) throw error;
      inserted.push(...(data || []));
    }

    return inserted;
  },

  async getActivitiesByClass(projectId, classCode) {
    const { data, error } = await getClient()
      .from(ACTIVITY_TABLE)
      .select('*')
      .eq('project_id', projectId)
      .eq('class_code', classCode)
      .eq('is_active', true)
      .order('section_name', { ascending: true })
      .order('activity_type', { ascending: true })
      .order('activity_title', { ascending: true });

    if (error) throw error;
    return data || [];
  },

  async getActivitiesByType(projectId, classCode, activityType) {
    const { data, error } = await getClient()
      .from(ACTIVITY_TABLE)
      .select('*')
      .eq('project_id', projectId)
      .eq('class_code', classCode)
      .eq('moodle_activity_type', activityType)
      .eq('is_active', true)
      .order('deadline', { ascending: true });

    if (error) throw error;
    return data || [];
  },

  async getUpcomingActivities(projectId, classCode, options = {}) {
    let query = getClient()
      .from(ACTIVITY_TABLE)
      .select('*')
      .eq('project_id', projectId)
      .eq('class_code', classCode)
      .eq('is_active', true)
      .not('deadline', 'is', null);

    if (options.todayOnly) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);
      query = query
        .gte('deadline', todayStart.toISOString())
        .lte('deadline', todayEnd.toISOString());
    } else {
      query = query
        .gte('deadline', new Date().toISOString())
        .limit(options.limit || 5);
    }

    const { data, error } = await query.order('deadline', { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async findActivityByKeyword(projectId, classCode, keyword) {
    const { data, error } = await getClient()
      .from(ACTIVITY_TABLE)
      .select('*')
      .eq('project_id', projectId)
      .eq('class_code', classCode)
      .ilike('activity_title', `%${keyword}%`)
      .eq('is_active', true)
      .limit(5);

    if (error) throw error;
    return data || [];
  }
};

module.exports = lmsRouteModel;
