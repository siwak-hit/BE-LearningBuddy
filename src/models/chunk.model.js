const supabaseService = require('../services/supabase/supabase.service');
const { supabaseAdmin } = require('../config/supabase.config');
const TABLE = 'document_chunks';

const chunkModel = {
  async createMany(payloadArray) {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .insert(payloadArray)
      .select();

    if (error) throw error;
    return data;
  },

  async findByDocumentId(documentId) {
    return supabaseService.findMany(TABLE, { document_id: documentId });
  },

  async findByProjectId(projectId) {
    return supabaseService.findMany(TABLE, { project_id: projectId });
  },

  async deleteByDocumentId(documentId) {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .delete()
      .eq('document_id', documentId);

    if (error) throw error;
    return data;
  },

  // [dedup] Jadikan chunk dokumen ini LINTAS-COURSE: metadata.moodle_course_id = null +
  // tandai shared_across_courses. Dipakai saat konten identik ditemukan di >1 course → satu
  // salinan disimpan & dibuat agar bisa diambil dari kelas manapun yang isinya sama.
  async setCourseAgnostic(documentId) {
    const chunks = await this.findByDocumentId(documentId);
    for (const c of chunks) {
      const metadata = { ...(c.metadata || {}), moodle_course_id: null, shared_across_courses: true };
      const { error } = await supabaseAdmin.from(TABLE).update({ metadata }).eq('id', c.id);
      if (error) throw error;
    }
    return chunks.length;
  }
};

module.exports = chunkModel;
