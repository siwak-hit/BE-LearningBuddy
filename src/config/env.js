require('dotenv').config();

const requiredEnv = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY'
];

requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    throw new Error(`ENV ${key} belum diisi`);
  }
});

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT) || 3000,
  APP_URL: process.env.APP_URL || 'https://be-learning-buddy-e4iy7dzde-siwak-hits-projects.vercel.app/',

  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,

  SUPABASE_DOCUMENT_BUCKET: process.env.SUPABASE_DOCUMENT_BUCKET || 'documents',
  SUPABASE_SCRIPT_BUCKET: process.env.SUPABASE_SCRIPT_BUCKET || 'generated-scripts',

  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',

  ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN
    ? process.env.ALLOWED_ORIGIN.split(',').map((origin) => origin.trim())
    : ['http://localhost:4321', 'http://localhost:3000'],

  DEFAULT_WIDGET_MODE: process.env.DEFAULT_WIDGET_MODE || 'floating',
  DEFAULT_WIDGET_POSITION: process.env.DEFAULT_WIDGET_POSITION || 'bottom-right'
};

module.exports = env;
