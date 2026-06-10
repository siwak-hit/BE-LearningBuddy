const fs = require('fs');
const path = require('path');

const CLIENT_FILES = [
  'state.js',
  'api.js',
  'ui.js',
  'actions.js',
  'main.js'
];

const widgetLoaderService = {
  generate() {
    const clientDir = path.join(__dirname, 'client');
    const clientCode = CLIENT_FILES
      .map((file) => fs.readFileSync(path.join(clientDir, file), 'utf8'))
      .join('\n\n');

    // Ambil URL FE dari .env, kasih fallback ke localhost jika lupa set
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4321';

    return [
      '(function () {',
      '  "use strict";',
      `  var ALB_FRONTEND_URL = "${frontendUrl}";`, // INJEKSI VARIABEL DARI ENV DI SINI
      clientCode,
      '})();'
    ].join('\n');
  }
};

module.exports = widgetLoaderService;
