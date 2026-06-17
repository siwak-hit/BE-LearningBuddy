// src/services/ai/evaluation.service.js
// [v0.8.4] Fase 4 — Harness Evaluasi untuk skripsi.
// Hitung confusion matrix + accuracy/precision/recall/F1 (per kelas & makro)
// dari pasangan (prediksi model, label asli peneliti).

const LABELS = ['lancar', 'mulai_bingung', 'kesulitan'];
const LABEL_TEXT = { lancar: 'Lancar', mulai_bingung: 'Mulai Bingung', kesulitan: 'Kesulitan' };

// Normalisasi input label biar fleksibel (mis. "Mulai Bingung" / "mulai bingung").
function normLabel(v = '') {
  const s = String(v || '').toLowerCase().trim().replace(/\s+/g, '_');
  if (LABELS.includes(s)) return s;
  if (s === 'bingung') return 'mulai_bingung';
  if (s === 'sulit' || s === 'kesusahan') return 'kesulitan';
  return null;
}

const evaluationService = {
  LABELS,
  LABEL_TEXT,
  normLabel,

  computeMetrics(pairs = []) {
    const valid = (Array.isArray(pairs) ? pairs : [])
      .map((p) => ({ predicted: normLabel(p.predicted), actual: normLabel(p.actual) }))
      .filter((p) => p.predicted && p.actual);

    const n = valid.length;

    // Confusion matrix: cm[actual][predicted]
    const cm = {};
    LABELS.forEach((a) => { cm[a] = {}; LABELS.forEach((pp) => { cm[a][pp] = 0; }); });
    let correct = 0;
    valid.forEach((p) => {
      cm[p.actual][p.predicted] += 1;
      if (p.predicted === p.actual) correct += 1;
    });

    const accuracy = n ? correct / n : 0;

    const perClass = {};
    LABELS.forEach((lab) => {
      const tp = cm[lab][lab];
      let fp = 0; let fn = 0;
      LABELS.forEach((o) => { if (o !== lab) { fp += cm[o][lab]; fn += cm[lab][o]; } });
      const precision = (tp + fp) ? tp / (tp + fp) : 0;
      const recall = (tp + fn) ? tp / (tp + fn) : 0;
      const f1 = (precision + recall) ? (2 * precision * recall) / (precision + recall) : 0;
      const support = LABELS.reduce((s, pp) => s + cm[lab][pp], 0);
      perClass[lab] = { precision, recall, f1, support };
    });

    const macro = {
      precision: LABELS.reduce((s, l) => s + perClass[l].precision, 0) / LABELS.length,
      recall: LABELS.reduce((s, l) => s + perClass[l].recall, 0) / LABELS.length,
      f1: LABELS.reduce((s, l) => s + perClass[l].f1, 0) / LABELS.length
    };

    return { labels: LABELS, label_text: LABEL_TEXT, n, accuracy, confusion_matrix: cm, per_class: perClass, macro };
  }
};

module.exports = evaluationService;
