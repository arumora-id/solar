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
