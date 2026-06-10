const pdfParse = require('pdf-parse');

const pdfService = {
  async extractText(fileBuffer) {
    try {
      const pages = [];

      // Fungsi kustom untuk me-render teks per halaman
      function render_page(pageData) {
        const render_options = {
          normalizeWhitespace: false,
          disableCombineTextItems: false
        };

        return pageData.getTextContent(render_options).then(function(textContent) {
          let lastY, text = '';
          for (let item of textContent.items) {
            if (lastY == item.transform[5] || !lastY) {
              text += item.str + ' ';
            } else {
              text += '\n' + item.str + ' ';
            }
            lastY = item.transform[5];
          }

          pages.push({
            pageNumber: pageData.pageIndex + 1,
            text: text
          });

          return text;
        });
      }

      const options = { pagerender: render_page };
      await pdfParse(fileBuffer, options);

      return pages; // Sekarang mengembalikan Array of Objects [{ pageNumber, text }]
    } catch (error) {
      throw new Error(`Gagal parsing PDF: ${error.message}`);
    }
  }
};

module.exports = pdfService;
