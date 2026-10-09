# REST API SOLAR

Base URL: `http://127.0.0.1:8790/api`. Semua body JSON, kecuali unggah lampiran (isi file mentah). Bila `SOLAR_ACCESS_TOKEN` diisi, kirim header
`Authorization: Bearer <token>` (atau query `?token=<token>` untuk SSE/unduhan). `GET /api/health` tidak memerlukan token.

## Sistem

| Method | Path | Keterangan |
|---|---|---|
| GET | `/health` | `{ ok, name, version }` |
| GET | `/config` | Konfigurasi publik: provider (OpenAI), model, reasoning effort, `openaiConfigured`, mode penyimpanan, status GitHub/Plane, apakah token wajib. |
| GET | `/stream` | Server-Sent Events: `hello`, `task`, `event`, `delta`, `plugins` (lihat `StreamMessage` di `packages/shared`). |

## Task

| Method | Path | Body / Query | Keterangan |
|---|---|---|---|
| POST | `/tasks` | `{ prompt, sessionId, attachmentIds? }` | Membuat task (status `queued`). `attachmentIds` (maks. 10) harus lampiran milik `sessionId` yang sama. Respons `201` berisi `Task`. |
| GET | `/tasks` | `limit`, `offset`, `sessionId`, `status` | Daftar task terbaru. |
| GET | `/tasks/stats` | | Total per status dan estimasi biaya. |
| GET | `/tasks/:id` | | `TaskDetail`: task, events, artifacts, confirmations, attachments. |
| POST | `/tasks/:id/cancel` | | Membatalkan task yang antre/berjalan (`409` bila sudah selesai). |
| GET | `/tasks/:id/artifacts.zip` | | Semua artefak task dalam ZIP. |

Contoh:

```bash
curl -s -X POST http://127.0.0.1:8790/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Buatkan sequence diagram reset password via email","sessionId":"cli"}'
```

## Konfirmasi

| Method | Path | Body | Keterangan |
|---|---|---|---|
| GET | `/confirmations` | | Permintaan persetujuan yang sedang menunggu. |
| POST | `/confirmations/:id` | `{ approved: boolean, note?: string }` | Menyetujui / menolak. |

## Artefak

| Method | Path | Keterangan |
|---|---|---|
| GET | `/artifacts/:id` | Metadata artefak. |
| GET | `/artifacts/:id/content` | Isi file (`?download=1` untuk unduh). Disajikan dengan `Content-Security-Policy: sandbox`. |
| POST | `/artifacts/:id/docx` | Membuat dokumen **Word (.docx)** sebuah TSD yang dibuat sebelum ada file Word. `:id` = artefak mana pun dari paket TSD (`.md`, `.html`, `.tsd.json`). Dokumen dibangun ulang dari `.tsd.json` paket itu dengan diagram SVG task yang sama, tanggal dokumen = tanggal TSD dibuat, lalu disimpan di task & paket yang sama sebagai `<nama>.docx` (`kind: "tsd-docx"`, judul "<judul> (Word)") dan diumumkan lewat event `artifact` di `/stream` seperti artefak buatan agent. `201` `{ artifact, created: true, warnings }`; `200` `{ artifact, created: false, warnings: [] }` bila paket sudah punya file Word (file itu yang dikembalikan, tidak dibuat ulang); `404` artefak tidak ada; `400` paket tidak punya `.tsd.json` atau isinya bukan spesifikasi yang valid (pesan `error` menyebut kesalahannya); `500` dokumen gagal dirender (pesan `error` menyebut sebabnya, mis. waktu habis atau batas memori). Dokumen dirender di *worker thread* terpisah (`docx-worker.mjs`), jadi server tetap melayani permintaan lain: biasanya 1-3 detik; bila menata halaman melewati 30 detik, dokumen dibuat ulang tanpa nomor halaman daftar isi (Word mengisinya saat dibuka, ada di `warnings`), dan bila itu juga melewati 30 detik hasilnya `500`. Permintaan untuk paket yang sama (juga file Word yang sedang dibuat agent untuk paket itu) diproses satu per satu, jadi klik ganda tidak membuat dua file. |

File Word disajikan dengan `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`;
UI tidak mempratinjaunya di browser, hanya menawarkan unduhan (dan pratinjau versi HTML dari paket yang sama).

```bash
curl -s -X POST http://127.0.0.1:8790/api/artifacts/art_123/docx   # art_123 = id .md/.html/.tsd.json sebuah TSD
```

## Lampiran dokumen

Dokumen proyek (PDF, Word `.docx`, Excel `.xlsx`/`.xlsm`/`.csv`, PowerPoint `.pptx`, Markdown, `.txt`) diunggah
**sebelum** task dibuat, lalu id-nya dikirim di `attachmentIds`. Server langsung mengekstrak teksnya menjadi Markdown
(judul, daftar, tabel, penanda halaman/slide/sheet) - teks itulah yang dibaca agen.

| Method | Path | Body / query | Keterangan |
|---|---|---|---|
| POST | `/attachments` | query `sessionId`, `name`; body = isi file mentah (`Content-Type: application/octet-stream`) | Unggah + ekstraksi. `201` → `Attachment` (`kind`, `parts` = halaman/slide/sheet, `chars`, `outline`, `warnings`). `413` terlalu besar (`ATTACHMENT_MAX_MB`, default 25) atau terindikasi zip bomb, `415` jenis tidak didukung (termasuk `.doc`/`.xls`/`.ppt` lama - juga bila diberi ekstensi modern, `.xlsb`, `.vsdx`, OpenDocument, file biner berekstensi teks), `400` isi file kosong, `422` file rusak, terenkripsi/berpassword, atau melewati batas waktu baca. Pesan error (`error`) berbahasa Indonesia dan bisa langsung ditampilkan. |
| GET | `/attachments?sessionId=` | | Lampiran sebuah percakapan (terlama dulu). |
| GET | `/attachments/:id` | | Metadata. |
| GET | `/attachments/:id/text` | | Markdown hasil ekstraksi (persis yang dibaca agen). |
| GET | `/attachments/:id/content` | | File asli, selalu sebagai unduhan (`Content-Disposition: attachment`, CSP `sandbox`). |
| DELETE | `/attachments/:id` | | Menghapus lampiran yang belum dipakai task (`204`); `409` bila sudah dipakai (tetap disimpan sebagai riwayat task). |

## Skills

| Method | Path | Body | Keterangan |
|---|---|---|---|
| GET | `/skills` | | Semua skill (bawaan + pengguna) beserta isinya. |
| GET | `/skills/:id` | | Satu skill. |
| POST | `/skills` | `{ name, description, content, enabled? }` | Skill pengguna baru (id = slug nama). |
| POST | `/skills/import` | `{ markdown }` | Impor `SKILL.md` dengan front matter. |
| PUT | `/skills/:id` | sebagian field | Edit (skill bawaan disimpan sebagai override) / aktif-nonaktif. |
| DELETE | `/skills/:id` | | Hapus skill pengguna (override bawaan → kembali ke versi bawaan). |

## Model AI (provider & rute)

| Method | Path | Body | Keterangan |
|---|---|---|---|
| GET | `/llm` | | Provider (`openai` dari `.env` + provider pengguna, API key literal disamarkan) dan rute (`default` = utama lalu cadangan). |
| POST | `/llm/providers` | `LlmProviderConfig` | Provider baru (`kind`: `openai-chat` atau `openai-responses`). |
| PUT | `/llm/providers/:id` | sebagian field | Ubah provider. Kirim `••••••••` untuk mempertahankan API key tersimpan. |
| DELETE | `/llm/providers/:id` | | Hapus provider. |
| POST | `/llm/providers/:id/test` | | Tes koneksi: daftar model dari `GET /models`. |
| PUT | `/llm/routes` | `{ routes: { default: ["provider/model", ...] } }` | Simpan rute; `{}` = kembali ke model `.env`. |

## Knowledge base

| Method | Path | Body | Keterangan |
|---|---|---|---|
| GET | `/knowledge` | | Semua file (termasuk panduan `README.md` / `_templates/`). |
| GET | `/knowledge/search?q=&type=` | | Pencarian kata kunci dengan potongan baris. |
| GET | `/knowledge/file?path=` | | Isi satu file + metadata. |
| PUT | `/knowledge/file` | `{ path, content }` | Buat / ubah file (file bawaan disimpan sebagai override). |
| DELETE | `/knowledge/file?path=` | | Hapus file pengguna (override → versi bawaan kembali). |
| POST | `/knowledge/import` | `{ files: [{ path, content }] }` | Impor banyak file .md. |
| POST | `/knowledge/import-artifact` | `{ artifactId, type, path?, id?, title?, description?, aliases?, tags?, status?, overwrite? }` | Simpan artefak Markdown sebagai file knowledge (front matter ditambahkan, `source: artifact:<id>/<nama>`). 404 artefak tidak ada, 400 bukan Markdown (menyebut `.md` dari paket yang sama), 409 path sudah dipakai (kirim `overwrite: true`). |
| POST | `/knowledge/tables?name=` | isi file (raw) | Pratinjau sheet Excel/CSV: header, jumlah baris, contoh. |
| POST | `/knowledge/import-table?name=&options=` | isi file (raw) | Satu file per baris + `INDEX.md`. `options` (JSON): `sheet`, `idColumn`, `titleColumn?`, `statusColumn?`, `aliasColumns[]`, `folder`, `type?`, `headerRow?`, `removeStale?`. |
| POST | `/knowledge/import-document?name=&options=` | isi file (raw) | Word/PDF/PowerPoint/Markdown sebagai knowledge. `options`: `folder`, `split` (`"none"`, `1`, `2`), `type?`, `title?`, `removeStale?`. |

## Plugin MCP

| Method | Path | Body | Keterangan |
|---|---|---|---|
| GET | `/plugins` | | Konfigurasi (rahasia literal disamarkan) + status koneksi + daftar tool. |
| POST | `/plugins` | `PluginConfig` | Plugin baru, langsung dihubungkan. |
| PUT | `/plugins/:id` | sebagian field | Ubah & hubungkan ulang. Kirim nilai `••••••••` untuk mempertahankan rahasia yang tersimpan. |
| POST | `/plugins/:id/reconnect` | | Hubungkan ulang. |
| DELETE | `/plugins/:id` | | Hapus plugin. |

`PluginConfig`:

```json
{
  "id": "jira",
  "name": "Jira",
  "description": "Issue tracker",
  "transport": "http",
  "url": "https://example.com/mcp",
  "headers": { "Authorization": "Bearer ${JIRA_TOKEN}" },
  "confirm": "writes",
  "toolAllowlist": []
}
```

Transport `stdio` memakai `command`, `args`, `env` sebagai pengganti `url`/`headers`.
