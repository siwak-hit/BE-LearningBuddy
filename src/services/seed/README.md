# AI Buddy HTML/CSS Seed + Chat Context Fix

Isi ZIP ini adalah patch siap tempel untuk memperbaiki:

1. Seeder `page_templates` supaya hanya mengambil elemen HTML/CSS yang penting sesuai alur panduan.
2. Visual iframe supaya tidak memuat JS, tidak direct cross-origin asset, dan style Moodle tidak meluber ke web AI Buddy.
3. Chat flow supaya quick menu memakai jawaban sistem dulu, bukan AI bebas.
4. Context switch saat user bertanya halaman lain: tampil tombol pindah konteks atau tetap di halaman ini.
5. Tinggi visual iframe mengikuti elemen yang dirender, tidak selalu tinggi besar.

## File yang diganti

Salin file berikut ke project kamu:

```txt
be/src/services/seed/seed_template.js
be/src/services/chat/chat.service.js
fe/src/scripts/pages/buddy/chat.js
fe/src/scripts/pages/buddy/dom-ui.js
fe/src/scripts/pages/buddy/events.js
```

## Cara pakai

1. Backup file lama dulu.
2. Copy file dari ZIP ini ke folder project sesuai path di atas.
3. Pastikan file HTML sample berada di:

```txt
be/src/services/seed/html-samples/
```

Seeder baru mendukung nama file berikut:

```txt
LANDING PAGE.html
LOGIN PAGE.html
DASHBOARD.html
COURSE DETAIL.html
LIST AKTIVITAS.html
NILAI.html
FORUM.html
FORUM DETAIL.html
FORUM-DETAIL.html
QUIZ.html
QUIZ ASSIGMENT.html
QUIS SUMMARY.html
QUIS REVIEW.html
RANGKUMAN MATERI.html
TUGAS.html
TUGAS DETAIL.html
TUGAS SELESAI.html
```

4. Jalankan seed ulang:

```bash
cd D:\WEB AI SKRIPSI\be\src\services\seed
node seed_template.js
```

5. Restart backend dan frontend.

## Catatan penting

- Seeder hanya menyimpan HTML/CSS penting, bukan JS.
- Script, iframe, object, embed, image, svg, hidden input, dan atribut event `onclick/onload/...` dibersihkan dari visual snippet.
- CSS Moodle tetap dipakai di iframe melalui proxy backend `/page-templates/proxy-asset`, bukan direct cross-origin.
- Iframe preview memakai `sandbox=""`, jadi hanya visual, tidak menjalankan JS dan tidak melakukan navigasi.
- Jawaban quick guide memakai sistem + visual. Tombol “Belum jelas, jelaskan dengan AI” tetap tersedia di akhir.

## Quick guide yang diperbaiki

- Cara reply forum
- Cara mengerjakan kuis
- Cara logout
- Cara melihat tugas
- Cara melihat nilai
- Cara mengumpulkan tugas
