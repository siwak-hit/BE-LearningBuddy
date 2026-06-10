const multer = require('multer');

// Gunakan memory storage agar file tersedia sebagai buffer di req.file
const storage = multer.memoryStorage();

module.exports = storage;
