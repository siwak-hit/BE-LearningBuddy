const supabaseService = require('../supabase/supabase.service');
const documentModel = require('../../models/document.model');
const crypto = require('crypto');
const path = require('path');

const BUCKET = process.env.SUPABASE_DOCUMENT_BUCKET || 'documents';

const documentUploadService = {
  async processAndUpload(project_id, title, topic, file) {
    // 1. Siapkan path & nama unik di Storage
    const ext = path.extname(file.originalname);
    const uniqueHash = crypto.randomBytes(8).toString('hex');
    const storageFileName = `${project_id}/${Date.now()}-${uniqueHash}${ext}`;

    // 2. Upload ke Supabase Storage
    await supabaseService.uploadFile(BUCKET, storageFileName, file.buffer, file.mimetype);

    // 3. Dapatkan Public URL
    const publicUrl = supabaseService.getPublicUrl(BUCKET, storageFileName);

    // 4. Siapkan ekstensi murni untuk db (tanpa titik)
    const fileType = ext.replace('.', '').toLowerCase();

    // 5. Simpan metadata ke tabel documents
    const docPayload = {
      project_id,
      title,
      topic: topic || '',
      file_name: storageFileName, // Simpan path storage untuk kebutuhan delete nanti
      file_url: publicUrl,
      file_type: fileType,
      source_type: 'upload',
      status: 'uploaded'
    };

    return documentModel.create(docPayload);
  },

  async deleteDocument(id) {
    // 1. Cari dokumen untuk mendapatkan path file di storage
    const document = await documentModel.findById(id);
    if (!document) {
      throw new Error('Dokumen tidak ditemukan');
    }

    // 2. Hapus file dari Supabase Storage
    if (document.file_name) {
      await supabaseService.deleteFile(BUCKET, document.file_name);
    }

    // 3. Hapus record dari database
    return documentModel.delete(id);
  }
};

module.exports = documentUploadService;
