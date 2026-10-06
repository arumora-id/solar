# REST API SOLAR

Base URL: `http://127.0.0.1:8790/api`. Semua body JSON. Bila `SOLAR_ACCESS_TOKEN` diisi, kirim header
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
| POST | `/tasks` | `{ prompt, sessionId }` | Membuat task (status `queued`). Respons `201` berisi `Task`. |
| GET | `/tasks` | `limit`, `offset`, `sessionId`, `status` | Daftar task terbaru. |
| GET | `/tasks/stats` | | Total per status dan estimasi biaya. |
| GET | `/tasks/:id` | | `TaskDetail`: task, events, artifacts, confirmations. |
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
