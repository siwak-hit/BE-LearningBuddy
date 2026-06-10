const mammoth = require('mammoth');

const docxService = {
  async extractText(fileBuffer) {
    try {
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      return result.value;
    } catch (error) {
      throw new Error(`Gagal parsing DOCX: ${error.message}`);
    }
  }
};

module.exports = docxService;
