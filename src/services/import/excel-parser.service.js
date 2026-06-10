const xlsx = require('xlsx');

function readFirstSheet(buffer) {
  const workbook = xlsx.read(buffer, {
    type: 'buffer',
    cellDates: true
  });

  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error('File Excel tidak memiliki sheet.');
  }

  return xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], {
    defval: '',
    raw: false
  });
}

function isEmptyRow(row = {}) {
  return Object.values(row).every((value) => String(value ?? '').trim() === '');
}

function normalizeKey(key = '') {
  return String(key).trim().toLowerCase();
}

function normalizeRow(row = {}) {
  const normalized = {};

  Object.keys(row).forEach((key) => {
    normalized[normalizeKey(key)] = row[key];
  });

  return normalized;
}

function cleanString(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function parseRules(value) {
  const text = String(value ?? '').trim();

  if (!text || text === '-') return {};

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    return { text };
  }
}

function parseFaqExcel(buffer) {
  const rawRows = readFirstSheet(buffer).map(normalizeRow);

  const validRows = [];
  const failedRows = [];

  rawRows.forEach((row, index) => {
    const rowNumber = index + 2;

    const question = cleanString(row.question);
    const answer = cleanString(row.answer);

    if (!question || !answer) {
      failedRows.push({
        row: rowNumber,
        reason: 'question dan answer wajib diisi'
      });
      return;
    }

    validRows.push({
      category: cleanString(row.category, 'Umum'),
      question,
      answer
    });
  });

  return {
    totalRows: rawRows.length,
    validRows,
    failedRows
  };
}

function normalizeDeadline(value) {
  const text = String(value ?? '').trim();

  if (!text || text === '-') return null;

  const date = new Date(text);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function parseActivityExcel(buffer) {
  const rows = readFirstSheet(buffer)
    .map(normalizeRow)
    .filter((row) => !isEmptyRow(row));

  const validRows = [];
  const failedRows = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;

    const title = cleanString(row.title);
    const instruction = cleanString(row.instruction);

    if (!title || !instruction) {
      failedRows.push({
        row: rowNumber,
        reason: 'title dan instruction wajib diisi'
      });
      return;
    }

    validRows.push({
      activity_type: cleanString(row.activity_type, 'general'),
      title,
      topic: cleanString(row.topic, null),
      instruction,
      rules: parseRules(row.rules),
      deadline: normalizeDeadline(row.deadline),
      completion_criteria: cleanString(row.completion_criteria, null),
      confusing_points: cleanString(row.confusing_points, null)
    });
  });

  return {
    totalRows: rows.length,
    validRows,
    failedRows
  };
}

module.exports = {
  parseFaqExcel,
  parseActivityExcel
};
