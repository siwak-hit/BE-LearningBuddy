const excelParser = require('./excel-parser.service');
const faqModel = require('../../models/faq.model');

const faqImportService = {
  async importFaqs(projectId, fileBuffer) {
    if (!projectId) {
      throw new Error('project_id wajib diisi');
    }

    if (!fileBuffer) {
      throw new Error('File Excel wajib diupload');
    }

    const { totalRows, validRows, failedRows } = excelParser.parseFaqExcel(fileBuffer);

    const payload = validRows.map((row) => ({
      ...row,
      project_id: projectId
    }));

    let inserted = [];

    if (payload.length > 0) {
      inserted = await faqModel.createMany(payload);
    }

    return {
      totalRows,
      successCount: inserted.length || payload.length,
      failedCount: failedRows.length,
      inserted,
      failedRows
    };
  }
};

module.exports = faqImportService;
