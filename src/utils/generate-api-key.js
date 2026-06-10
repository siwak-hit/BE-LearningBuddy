const crypto = require('crypto');

const generateApiKey = {
  projectKey(prefix = 'alb') {
    const random = crypto.randomBytes(24).toString('hex');
    return `${prefix}_${random}`;
  },

  sessionKey(prefix = 'sess') {
    const random = crypto.randomBytes(16).toString('hex');
    return `${prefix}_${random}`;
  }
};

module.exports = generateApiKey;
