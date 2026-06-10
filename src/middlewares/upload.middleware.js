const multer = require('multer');
const storage = require('../config/multer.config');

// 1. Upload Dokumen Materi (Setup asli Anda)
const uploadDocument = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // Batas ukuran 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
      'text/plain'
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Format file tidak didukung. Gunakan PDF, DOCX, atau TXT.'), false);
    }
  }
});

// 2. Upload Excel (Disimpan di RAM/Memory agar langsung diparse)
const excelStorage = multer.memoryStorage();
const uploadExcel = multer({
  storage: excelStorage,
  limits: {
    fileSize: 5 * 1024 * 1024 // Batas ukuran 5MB untuk Excel
  },
  fileFilter: (req, file, cb) => {
    const isExcel = file.mimetype.includes('excel') ||
                    file.mimetype.includes('spreadsheetml') ||
                    file.originalname.endsWith('.xlsx') ||
                    file.originalname.endsWith('.xls');
    if (isExcel) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file Excel yang diizinkan (.xlsx, .xls)'), false);
    }
  }
});

// Export keduanya
module.exports = {
  uploadDocument,
  uploadExcel
};
