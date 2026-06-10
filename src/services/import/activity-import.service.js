const excelParser = require('./excel-parser.service');
const activityModel = require('../../models/activity.model');

const activityImportService = {
  async importActivities(projectId, fileBuffer) {
    if (!projectId) {
      throw new Error('project_id wajib diisi');
    }

    if (!fileBuffer) {
      throw new Error('File Excel wajib diupload');
    }

    const { totalRows, validRows, failedRows } = excelParser.parseActivityExcel(fileBuffer);

    const payload = validRows.map((row) => ({
      ...row,
      project_id: projectId
    }));


    console.log('[IMPORT ACTIVITY] valid rows:', validRows.length);
    console.log('[IMPORT ACTIVITY] failed rows:', failedRows);
    console.log('[IMPORT ACTIVITY] sample payload:', payload[0]);

    let inserted = [];

    if (payload.length > 0) {
      inserted = await activityModel.createMany(payload);
    }

    return {
      totalRows,
      successCount: inserted.length || payload.length,
      failedCount: failedRows.length,
      inserted,
      failedRows
    };
  },

  // Alias biar kode lama yang masih manggil importExcel tetap aman
  async importExcel(projectId, fileBuffer) {
    return this.importActivities(projectId, fileBuffer);
  }
};

module.exports = activityImportService;
