const pdfService = require('./pdf.service');
const docxService = require('./docx.service');
const textCleanerService = require('./text-cleaner.service');

const documentParserService = {
  async parse(fileBuffer, fileType) {
    if (fileType === 'pdf') {
      const pages = await pdfService.extractText(fileBuffer);
      // Bersihkan teks pada masing-masing halaman
      return pages.map(page => ({
        pageNumber: page.pageNumber,
        text: textCleanerService.clean(page.text)
      }));
    }

    // Fallback untuk format non-PDF (dianggap seluruhnya halaman 1)
    let rawText = '';
    if (fileType === 'docx' || fileType === 'doc') {
      rawText = await docxService.extractText(fileBuffer);
    } else if (fileType === 'txt') {
      rawText = fileBuffer.toString('utf-8');
    } else {
      throw new Error(`Tipe file ${fileType} belum didukung untuk indexing.`);
    }

    return [{
      pageNumber: 1,
      text: textCleanerService.clean(rawText)
    }];
  }
};

module.exports = documentParserService;
