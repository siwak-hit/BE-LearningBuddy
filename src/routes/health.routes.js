const express = require('express');
const response = require('../utils/response');

const router = express.Router();

router.get('/health', (req, res) => {
  return response.success(res, 'Server aktif', {
    service: 'AI Learning Buddy API',
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
