# SOLAR AI AGENT 🍡

**SOLAR AI AGENT** (*SOLution ARchitect*, singkatnya SOLAR) adalah AI agent dengan **karakter 3D beranimasi yang bisa
dipilih** - **Mochi** (default), **Cocoa Kelapa**, atau **Kelinci** klasik - yang membantu seorang Solution Architect
men-deliver pekerjaan lebih cepat dan konsisten:

- **Diagram ArchiMate 3.2** - divalidasi terhadap tabel relasi resmi ArchiMate, diekspor ke
  *Open Group ArchiMate Exchange Format* (bisa di-import ke Archi, Visual Paradigm, BiZZdesign, Sparx EA) + SVG per view.
- **Sequence diagram UML** - SVG siap pakai + sumber **Mermaid** (langsung tampil di GitHub) + **PlantUML**.
- **Technical Specification Document (TSD)** - Markdown (GitHub-ready) dan HTML siap cetak/PDF, lengkap dengan
  diagram tertanam, requirement, NFR, integrasi, API, data model, risiko.

Perintah diberikan dengan **mengetik atau suara**, berjalan di **browser** maupun sebagai **aplikasi desktop Windows**,
bisa ditambah **skills** dan **plugin MCP** (GitHub, Plane `plane.mesthi.com` sebagai backlog, Visual Paradigm dengan
konfirmasi wajib), dan setiap pekerjaan bisa dipantau di **web monitoring task**.

![Halaman agent dengan karakter Mochi dan dokumen terlampir](docs/images/agent-light.png)

| Hasil & artefak (tema gelap, karakter Cocoa Kelapa) | Konfirmasi sebelum aksi eksternal | Monitor task |
|---|---|---|
| ![Hasil](docs/images/agent-dark-result.png) | ![Konfirmasi](docs/images/confirmation.png) | ![Monitor](docs/images/monitor.png) |

<sub>Tangkapan layar menggunakan data demo.</sub>

---

## Daftar isi

1. [Fitur utama](#fitur-utama)
2. [Arsitektur](#arsitektur)
3. [Prasyarat](#prasyarat)
4. [Instalasi & menjalankan di browser](#instalasi--menjalankan-di-browser)
5. [Aplikasi desktop Windows](#aplikasi-desktop-windows)
6. [Konfigurasi kredensial (.env)](#konfigurasi-kredensial-env)
7. [Cara pakai](#cara-pakai)
8. [Lampiran dokumen proyek](#lampiran-dokumen-proyek)
9. [Deliverable yang dihasilkan](#deliverable-yang-dihasilkan)
10. [Skills](#skills)
11. [Plugin MCP: GitHub, Plane, Visual Paradigm](#plugin-mcp-github-plane-visual-paradigm)
12. [Web monitoring task](#web-monitoring-task)
13. [Bagaimana SOLAR mencegah kesalahan](#bagaimana-solar-mencegah-kesalahan)
14. [Keamanan](#keamanan)
15. [Struktur repository](#struktur-repository)
16. [Pengembangan & pengujian](#pengembangan--pengujian)
17. [Troubleshooting](#troubleshooting)
18. [Lisensi pihak ketiga](#lisensi-pihak-ketiga)

---

## Fitur utama

| Area | Kemampuan |
|---|---|
| Karakter 3D | **Bisa dipilih**: **Mochi** (kue mochi merah muda, default), **Cocoa Kelapa** (kelapa cokelat bersedotan & payung kecil), atau **Kelinci** klasik - lewat tombol karakter di pojok panggung atau *Pengaturan → Karakter* (tersimpan di perangkat). Dibangun prosedural (three.js, tanpa aset) dengan animasi **GSAP**: idle, mendengarkan, berpikir, bekerja (membawa tablet), berbicara, bertanya (menunggu persetujuan), senang, sedih. Mata mengikuti kursor; klik karakter untuk mulai bicara. |
| Dokumen proyek | **Lampirkan** PDF, Word (.docx), Excel (.xlsx/.xlsm/.csv), PowerPoint (.pptx), Markdown atau teks (klip kertas, seret & lepas, atau tempel). SOLAR membaca isinya (judul, tabel, sheet, slide, catatan pembicara) sebelum merancang, lalu menyebut sumbernya. |
| Input | Ketik (Enter kirim) atau **suara**: Web Speech API di Chrome/Edge, atau **Whisper lokal** (transformers.js, offline setelah model diunduh) - otomatis dipakai di aplikasi desktop. Berhenti otomatis saat hening. |
| Output suara | Karakter membacakan ringkasan hasil (text-to-speech suara sistem, Bahasa Indonesia/English). |
| Agent | **OpenAI** (API key ChatGPT) lewat Responses API - default **GPT-6.1 Sol** (`gpt-6.1-sol`) dengan reasoning, streaming, tool call paralel, mode stateless (`store: false`); satu task = satu proses end-to-end ("sekali proses"). Model bisa diganti lewat `SOLAR_MODEL`. |
| Deliverable | ArchiMate (Exchange XML + SVG + JSON), sequence diagram (SVG + Mermaid + PlantUML + JSON), TSD (Markdown + HTML + JSON), unduh semua sebagai ZIP. |
| Skills | 6 skill bawaan (delivery package, ArchiMate, sequence, TSD, backlog Plane, publish GitHub); tambah/impor/edit/nonaktifkan dari UI. |
| Plugin MCP | GitHub (remote MCP resmi), Plane `plane.mesthi.com` (MCP resmi Plane), Visual Paradigm (selalu konfirmasi), plugin custom (HTTP/SSE/stdio). |
| Integrasi bawaan | Publish artefak ke GitHub dalam **satu commit**; buat backlog Plane secara **bulk** (epic → story, label, prioritas, anti-duplikat). |
| Monitoring | Halaman `/monitor`: KPI, progres realtime, langkah kerja, penalaran ringkas, persetujuan, token & estimasi biaya, artefak. |
| Penyimpanan | **Neon Postgres** + **object storage S3** (Neon/S3/R2/MinIO), atau otomatis file lokal bila belum dikonfigurasi. |
| Platform | Browser (Chrome/Edge/Firefox/Safari) dan **desktop Windows** (Electron, installer NSIS). |

## Arsitektur

```mermaid
flowchart LR
    U([Solution Architect]) -- ketik / suara --> UI
    subgraph Client["Web UI - React + Vite + TypeScript + GSAP"]
        UI[Agent page<br/>karakter 3D three.js]
        MON[Monitor page]
        SET[Pengaturan<br/>skills & plugin]
    end
    subgraph Server["SOLAR server - Node.js / Express"]
        API[REST API + SSE stream]
        TM[Task manager<br/>antrean, progres, konfirmasi]
        AG[Agent loop<br/>OpenAI GPT-6.1 Sol]
        GEN[Generator + validator<br/>ArchiMate, Sequence, TSD]
        SK[Skill store]
        MCP[MCP client manager]
    end
    UI <--> API
    MON <--> API
    SET <--> API
    API --> TM --> AG
    AG --> GEN
    AG --> SK
    AG --> MCP
    AG -- Responses API --> OPENAI[(OpenAI API)]
    MCP --> GH[GitHub MCP]
    MCP --> PL[Plane MCP<br/>plane.mesthi.com]
    MCP --> VP[Visual Paradigm MCP]
    TM --> DB[(Neon Postgres<br/>atau file lokal)]
    GEN --> OBJ[(Object storage S3<br/>atau file lokal)]
    DESK[Electron desktop<br/>Windows] -. menjalankan server .-> Server
    DESK -. menampilkan .-> Client
```

Detail desain (alur agent, prompt caching, konfirmasi, penyimpanan) ada di
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); referensi endpoint di [docs/API.md](docs/API.md).

## Prasyarat

- **Node.js 22 LTS** (≥ 22.12) dan npm 10 - <https://nodejs.org>
- **API key OpenAI** ("API key ChatGPT") - buat di <https://platform.openai.com/api-keys>. Akun API butuh saldo/billing
  tersendiri di *platform.openai.com → Billing*; langganan ChatGPT Plus/Pro **tidak** termasuk kredit API.
- Opsional: database **Neon**, object storage S3, token **GitHub**, API key **Plane**, endpoint MCP **Visual Paradigm**.
- Plugin Plane memakai `npx` (sudah termasuk di Node.js) sehingga butuh akses internet saat pertama kali dijalankan.

## Instalasi & menjalankan di browser

```bash
git clone https://github.com/arumora-id/solar.git
cd solar
npm install
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
# isi minimal OPENAI_API_KEY di .env

npm run build                 # build web UI + bundle server
npm start                     # http://localhost:8790  (monitor: http://localhost:8790/monitor)
```

Mode pengembangan (hot reload UI di <http://localhost:5173>, API di 8790):

```bash
npm run dev
```

## Aplikasi desktop Windows

**Menjalankan dari source (Windows/macOS/Linux):**

```bash
npm install
npm run desktop:dev           # build lalu buka jendela SOLAR (memakai .env dan data/ di root repo)
```

**Membuat installer Windows (.exe)** - jalankan di Windows:

```bash
npm install
npm run desktop:dist:win      # hasil: apps/desktop/release/SOLAR-AI-AGENT-Setup-1.0.0.exe
```

Atau dari GitHub: tab **Actions → "Desktop installer (Windows)" → Run workflow**, lalu unduh artifact installer.

Catatan aplikasi desktop:

- Server SOLAR berjalan **di dalam aplikasi** (satu proses), UI dimuat dari `http://127.0.0.1:8790`.
- Nama aplikasi & shortcut: **SOLAR AI AGENT**. Folder data tetap `%APPDATA%\SOLAR`, sehingga pengguna versi sebelumnya
  tidak kehilangan `.env`, task, maupun artefak setelah memperbarui.
- Saat pertama kali dibuka, file konfigurasi dibuat di `%APPDATA%\SOLAR\.env` dan dialog menawarkan untuk membukanya.
  Isi kredensial lalu jalankan ulang. Data & artefak lokal disimpan di `%APPDATA%\SOLAR\data`.
- Menu **Jendela → Mode mini (selalu di atas)** menjadikan SOLAR jendela kecil yang selalu tampil - cocok sebagai
  "asisten di samping" saat bekerja.
- Input suara di desktop memakai **Whisper lokal** (Chromium di Electron tidak menyertakan layanan pengenalan suara Google).
  Model diunduh sekali (pilih ukurannya di *Pengaturan → Suara*).

## Konfigurasi kredensial (.env)

Semua kredensial berada di `.env` (tidak pernah di-commit). Nilai kosong = fitur tidak aktif / pakai default.

| Variabel | Wajib | Keterangan |
|---|---|---|
| `OPENAI_API_KEY` | ✅ | API key OpenAI (`sk-…`) dari platform.openai.com. |
| `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID` | | Opsional, bila key Anda dipakai di beberapa organisasi/project. |
| `OPENAI_BASE_URL` | | Opsional: endpoint kompatibel Responses API (mis. gateway/proxy perusahaan). Default `https://api.openai.com/v1`. |
| `SOLAR_MODEL` / `SOLAR_EFFORT` | | Default `gpt-6.1-sol` / `high`. Effort: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` (tidak semua model mendukung semua nilai; `gpt-6.1-sol`: `low`…`max`). Alternatif: `gpt-6-astra` (paling kuat, 5× lebih mahal), `gpt-6-luna` (paling hemat). |
| `SOLAR_PRICE_PER_MTOK` | | Opsional `input,cached_input,output` (USD per 1 juta token) untuk estimasi biaya bila harga berubah. |
| `PORT`, `HOST` | | Default `8790`, `127.0.0.1` (hanya komputer ini). |
| `SOLAR_ACCESS_TOKEN` | jika `HOST=0.0.0.0` | Token akses UI/API saat dibuka dari jaringan. |
| `DATABASE_URL` | | Connection string **Neon** (`postgresql://…neon.tech/neondb?sslmode=require`). Tabel dibuat otomatis. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_PREFIX` | | Object storage S3-compatible untuk file artefak. |
| `GITHUB_TOKEN` | | Fine-grained PAT (Contents RW, Pull requests, Issues, Metadata). Mengaktifkan plugin MCP GitHub dan tool publish. |
| `GITHUB_DEFAULT_REPO`, `GITHUB_DEFAULT_BRANCH` | | Repo tujuan publish default (`owner/repo`) dan branch. |
| `GITHUB_PUBLISH_CONFIRM` | | `never` (default) atau `always` - minta persetujuan sebelum commit. |
| `PLANE_API_HOST_URL` | | Default `https://plane.mesthi.com`. |
| `PLANE_API_KEY`, `PLANE_WORKSPACE_SLUG` | | API token (Workspace Settings → API Tokens) dan slug workspace. |
| `PLANE_PROJECT_ID` | | UUID project backlog default (opsional). |
| `PLANE_CONFIRM` | | `never` (default) atau `always`. |
| `VP_MCP_URL`, `VP_MCP_TOKEN` | | Endpoint MCP Visual Paradigm. **Setiap** pemanggilan selalu dikonfirmasi. |
| `ATTACHMENT_MAX_MB` | | Ukuran maksimum satu dokumen lampiran (default `25`). |
| `TASK_CONCURRENCY`, `CONFIRMATION_TIMEOUT_MINUTES`, `SOLAR_MAX_TOKENS`, `SOLAR_MAX_TURNS`, `LOG_LEVEL` | | Penyetelan lanjutan. |

Tanpa `DATABASE_URL`/`S3_*`, SOLAR tetap berjalan penuh dengan penyimpanan file lokal (`data/`). Begitu kredensial Neon
dan object storage diisi, data baru otomatis disimpan di sana.

## Cara pakai

1. Buka SOLAR (browser atau desktop). Status **Terhubung** tampil di kanan atas.
2. Ketik perintah atau klik **karakter / tombol mikrofon** lalu bicara. Tombol cepat di bawah karakter mengisi template perintah.
   Ganti karakter (Mochi, Cocoa Kelapa, Kelinci) lewat tombol bernama karakter di pojok kiri bawah panggung.
3. SOLAR mengerjakan **seluruh permintaan dalam satu proses**: membuat rencana, memuat skill yang relevan,
   membuat & memvalidasi diagram, menyusun dokumen, lalu memberi ringkasan + daftar artefak. Asumsi dicatat eksplisit
   (tidak berhenti untuk bertanya kecuali benar-benar menghalangi).
4. Bila aksi butuh persetujuan (mis. Visual Paradigm), karakter mengangkat tangan dan dialog **Perlu persetujuan Anda**
   muncul berisi data yang akan dikirim. Setujui atau tolak (bisa dengan catatan).
5. Pratinjau, unduh per file, atau **Unduh semua (ZIP)**. Progres rinci ada di **Monitor**.

Contoh perintah:

```text
Buatkan paket arsitektur lengkap dalam sekali proses untuk sistem pemesanan online:
web storefront dan mobile app, order service, payment via payment gateway eksternal,
notifikasi email, deploy di Kubernetes, database PostgreSQL (Neon), event bus Kafka.
Butuh Layered View, Application Cooperation View, sequence checkout (sukses & pembayaran ditolak),
dan TSD bahasa Indonesia. Setelah selesai, publish ke GitHub di docs/architecture/order-platform
dan buat backlog di Plane.
```

```text
Buat sequence diagram login SSO dengan Keycloak termasuk alur token kedaluwarsa.
```

Percakapan dalam satu sesi saling terhubung: permintaan berikutnya (mis. "tambahkan NFR keamanan ke TSD tadi")
mendapat konteks task sebelumnya. Tombol **Percakapan baru** memulai konteks kosong.

## Lampiran dokumen proyek

Lampirkan dokumen proyek (BRD, spesifikasi, inventaris integrasi, deck arsitektur, catatan rapat) agar rancangan SOLAR
mengikuti isi dokumen tersebut, bukan asumsi.

1. Klik ikon **klip kertas** di kotak perintah, **seret & lepas** file ke jendela, atau **tempel** (Ctrl+V) file.
   Maksimal **10 dokumen** per permintaan, masing-masing maksimal `ATTACHMENT_MAX_MB` (default **25 MB**).
2. Setiap file langsung diunggah dan dibaca; chip menampilkan jumlah halaman/slide/sheet dan peringatan bila ada
   (mis. halaman hasil scan). Klik chip untuk **pratinjau** teks yang dibaca SOLAR (tampilan format atau Markdown mentah)
   dan untuk mengunduh file aslinya.
3. Kirim perintah, mis. *"Rancang arsitektur integrasi pembayaran sesuai dokumen persyaratan dan inventaris integrasi
   terlampir"*. Lampiran yang belum terkirim tetap tersimpan bila halaman dimuat ulang.

| Format | Ekstensi | Yang dibaca |
|---|---|---|
| PDF | `.pdf` | Teks per halaman (penanda `<!-- page N -->`), judul dikenali dari ukuran huruf, kolom tabel tetap berjajar. PDF berpassword pemilik (hanya pembatasan salin/cetak) tetap dibaca. |
| Word | `.docx` | Judul & heading bertingkat, daftar berpoin/bernomor, tabel (termasuk sel gabungan), catatan kaki, versi akhir *track changes*, teks alternatif gambar. |
| Excel | `.xlsx`, `.xlsm` | Setiap sheet (`## Sheet: nama`) sebagai tabel: tanggal ISO, persen, nilai hasil rumus, judul sel gabungan; maks. 50 sheet, 1.000 baris × 50 kolom per sheet (jumlah baris sebenarnya disebutkan). |
| CSV | `.csv` | Satu tabel; pemisah `,` `;` atau tab dikenali otomatis; maks. 2.000 baris. |
| PowerPoint | `.pptx` | Slide sesuai urutan presentasi (`## Slide N: judul`), poin bertingkat, tabel, data grafik, SmartArt, deskripsi gambar, **catatan pembicara**. |
| Markdown / teks | `.md`, `.markdown`, `.txt` | Apa adanya (UTF-8, UTF-16, atau Windows-1252 dari ekspor lama). |

**Cara agent memakai dokumen.** Dokumen pendek (sampai 60.000 karakter) langsung disertakan ke permintaan; dokumen yang
lebih panjang dibaca bertahap dengan tool `list_documents`, `read_document` (per bagian/halaman) dan `search_documents`
(anggaran baca 400.000 karakter per task). Dokumen dari permintaan sebelumnya di percakapan yang sama tetap bisa dibaca.
Agent menyebut sumber (nama dokumen + halaman/slide/sheet) di TSD dan menandai hal yang bertentangan atau tidak ada di
dokumen sebagai asumsi.

**Batasan.**

- Tidak ada **OCR**: PDF hasil scan/gambar tidak punya teks yang bisa dibaca (SOLAR memberi peringatan per halaman).
  Lampirkan PDF dengan lapisan teks atau versi Word-nya.
- Dokumen yang **dilindungi kata sandi** (PDF atau Office terenkripsi) ditolak dengan petunjuk cara melepas kata sandinya.
- Format lama **.doc/.xls/.ppt** (Office 97-2003), **.xlsb**, **.vsdx** dan OpenDocument (**.odt/.ods/.odp**) belum
  didukung - simpan ulang sebagai .docx/.xlsx/.pptx atau PDF. File yang ekstensinya salah dibaca sesuai isinya.
- Teks hasil baca maksimal **2 juta karakter** per dokumen; bagian yang terpotong selalu disebutkan di peringatan.

**Keamanan & penyimpanan.** Dokumen dibaca di *worker thread* terpisah (batas memori 1 GB, batas waktu ±95 detik) sehingga
file bermasalah tidak bisa menghentikan server. Paket Office dibuka dengan pembaca ZIP yang membatasi ukuran hasil
dekompresi (*zip bomb* ditolak), XML tidak pernah memuat entitas/sumber eksternal, dan makro tidak pernah dijalankan.
File asli dan teks hasil baca disimpan di object storage (`attachments/<id>/…`), metadatanya di database; lampiran yang
tidak pernah dikirim dihapus otomatis setelah 24 jam.

## Deliverable yang dihasilkan

| Jenis | File | Keterangan |
|---|---|---|
| ArchiMate | `<nama>.archimate.xml` | Open Group ArchiMate **Exchange Format 3.1** (namespace `http://www.opengroup.org/xsd/archimate/3.0/`), termasuk view & koordinat node. Diuji valid terhadap XSD resmi. Import di Archi (*File › Import › Open Exchange XML Model*) atau tool lain yang mendukung ArchiMate Model Exchange File Format (mis. fitur import ArchiMate Exchange di Visual Paradigm). |
| | `<nama>-<view>.svg` | Satu SVG per view: layered auto-layout per layer (warna standar ArchiMate), ikon notasi per elemen, gaya garis & panah sesuai jenis relasi, legenda. |
| | `<nama>.archimate.json` | Model sumber (untuk revisi berikutnya). |
| Sequence | `<nama>.sequence.svg` | Diagram UML: lifeline, aktivasi, fragment alt/opt/loop/par/critical/break/group, catatan, penomoran. |
| | `<nama>.mmd` | Mermaid `sequenceDiagram` (tampil langsung di GitHub/GitLab). |
| | `<nama>.puml` | PlantUML. |
| TSD | `<nama>.md` | Markdown GitHub-ready: kontrol dokumen, daftar isi, diagram tertaut sebagai file SVG di folder yang sama, sumber Mermaid. |
| | `<nama>.html` | HTML mandiri siap cetak (Print → PDF) dengan diagram tertanam; bisa dibuka di Microsoft Word. |

Contoh output generator:

| ArchiMate Layered View | Sequence diagram |
|---|---|
| ![ArchiMate](docs/images/sample-archimate-layered.png) | ![Sequence](docs/images/sample-sequence.png) |

## Skills

Skill = instruksi "house style" yang dimuat agent saat relevan. Format sama dengan Agent Skills: folder berisi
`SKILL.md` dengan front matter:

```markdown
---
name: Cloud Cost Review
description: Checklist FinOps untuk menilai biaya arsitektur cloud. Pakai saat user meminta estimasi biaya.
---

# Cloud Cost Review
1. ...
```

Skill bawaan (`skills/`):

| Skill | Fungsi |
|---|---|
| `solution-architect-delivery` | Orkestrasi paket lengkap sekali proses, urutan kerja, cek konsistensi, format jawaban akhir. |
| `archimate-modeling` | Pemilihan elemen per layer, pola relasi valid (sudah diverifikasi terhadap tabel resmi), resep viewpoint, penamaan. |
| `sequence-diagram` | Pemilihan skenario, jenis participant, aktivasi, fragment, checklist. |
| `technical-specification` | Isi tiap bagian TSD, aturan penulisan requirement, katalog NFR (`nfr-catalog.md`). |
| `plane-backlog` | Konversi TSD → epic/story di plane.mesthi.com, prioritas MoSCoW, label. |
| `github-publishing` | Struktur folder, file yang dipublish, format commit. |

Menambah skill: **Pengaturan → Skills → Tambah skill / Impor SKILL.md**, atau buat folder baru di
`data/skills/<id>/SKILL.md` (desktop: `%APPDATA%\SOLAR\data\skills`). Skill bawaan bisa dinonaktifkan atau di-override
(edit = salinan di folder pengguna; hapus salinan = kembali ke versi bawaan).

## Plugin MCP: GitHub, Plane, Visual Paradigm

Kelola di **Pengaturan → Plugin MCP**. Konfigurasi tersimpan di `data/plugins.json` (awal dari
`config/plugins.default.json`). Nilai `${NAMA_VARIABEL}` diambil dari `.env`, sehingga rahasia tidak tersimpan di file
plugin. Plugin yang variabelnya belum diisi berstatus **Belum dikonfigurasi** dan tidak dipakai agent.

| Plugin | Transport | Konfigurasi | Kebijakan konfirmasi default |
|---|---|---|---|
| **GitHub** | Streamable HTTP ke `https://api.githubcopilot.com/mcp/` (server MCP resmi GitHub) | `GITHUB_TOKEN` | Tanpa konfirmasi |
| **Plane (plane.mesthi.com)** | stdio `npx -y @makeplane/plane-mcp-server@0.1.5` (server MCP resmi Plane) | `PLANE_API_KEY`, `PLANE_WORKSPACE_SLUG`, `PLANE_API_HOST_URL=https://plane.mesthi.com` | Tanpa konfirmasi |
| **Visual Paradigm** | Streamable HTTP ke `VP_MCP_URL` | `VP_MCP_URL`, `VP_MCP_TOKEN` | **Selalu konfirmasi** |

> **GitHub MCP lokal (alternatif):** bila endpoint remote GitHub tidak dapat diakses dari jaringan/organisasi Anda, edit
> plugin GitHub menjadi transport **stdio** dengan command `docker`, argumen
> `run`, `-i`, `--rm`, `-e`, `GITHUB_PERSONAL_ACCESS_TOKEN`, `ghcr.io/github/github-mcp-server`
> dan environment `GITHUB_PERSONAL_ACCESS_TOKEN=${GITHUB_TOKEN}` (butuh Docker Desktop). Tool publish artefak bawaan
> SOLAR tidak bergantung pada plugin ini.

Kebijakan konfirmasi per plugin: **Tanpa konfirmasi**, **Konfirmasi untuk operasi tulis** (create/update/delete/push/…,
atau anotasi `destructiveHint` dari server MCP), **Selalu konfirmasi**. Persetujuan yang tidak dijawab sampai
`CONFIRMATION_TIMEOUT_MINUTES` dianggap ditolak.

Selain plugin MCP, SOLAR punya tool bawaan yang deterministik:

- `publish_artifacts_to_github` - commit banyak artefak sekaligus (satu commit, branch dibuat bila belum ada) sehingga
  tautan SVG di TSD Markdown langsung berfungsi di GitHub.
- `plane_list_projects` & `plane_create_backlog_items` - membuat epic/story/task di plane.mesthi.com dalam satu panggilan,
  parent dibuat lebih dulu, label dibuat bila belum ada, item dengan nama sama tidak diduplikasi.

> **Visual Paradigm:** Visual Paradigm Online belum menyediakan server MCP/API publik resmi. Hubungkan endpoint MCP yang Anda
> miliki (mis. server MCP komunitas yang terhubung ke Visual Paradigm desktop melalui Plugin API) lewat `VP_MCP_URL`.
> Untuk memindahkan model ke Visual Paradigm tanpa MCP, import file `*.archimate.xml` (Exchange Format) yang dihasilkan SOLAR.

Menambah plugin lain (Jira, Confluence, Notion, dst.): **Tambah plugin MCP** → pilih transport → isi URL/command,
header/env (boleh `${VAR}`), kebijakan konfirmasi, dan opsional daftar tool yang diizinkan.

## Web monitoring task

Buka `/monitor` (mis. <http://localhost:8790/monitor>):

- **KPI**: total task, sedang berjalan, menunggu konfirmasi, selesai, gagal/batal, estimasi biaya API.
- **Tabel task** dengan status (ikon + label), progres realtime, waktu mulai, durasi, biaya; filter & pencarian.
- **Detail task**: langkah aktif, model, jumlah API call, token (input/output/cache), permintaan, hasil, artefak, dan
  **timeline** setiap event (penalaran ringkas, pemanggilan tool beserta input, hasil validasi, persetujuan, error).
- Task aktif dapat **dibatalkan** dari chat maupun monitor. Persetujuan juga bisa diberikan dari halaman mana pun.

## Bagaimana SOLAR mencegah kesalahan

1. **Validator deterministik sebelum file dibuat.** Diagram/dokumen hanya bisa dibuat lewat tool SOLAR. Input diperiksa
   skema (zod) lalu aturan domain; bila ada error, *tidak ada file yang disimpan* dan agent menerima daftar error lengkap
   untuk diperbaiki:
   - **ArchiMate:** setiap relasi dicek terhadap **tabel relasi resmi ArchiMate 3.2** (Appendix B, data dari proyek Archi),
     referensi elemen, id unik, aturan junction (jenis relasi sama), konsistensi view; pesan error menyebut relasi yang
     diizinkan. XML hasil ekspor diuji terhadap **XSD resmi The Open Group** dengan `xmllint`.
   - **Sequence:** participant terdaftar, keseimbangan aktivasi, nesting fragment, cabang `else` hanya di alt/par/critical,
     kata kunci terlarang Mermaid/PlantUML; format output Mermaid diverifikasi dengan parser **Mermaid 11** asli saat
     pengembangan dan dijaga oleh unit test.
   - **TSD:** id requirement/keputusan/risiko unik, referensi diagram harus artefak SVG yang benar-benar ada.
2. **Sekali proses dengan asumsi eksplisit** - agent menyelesaikan semua deliverable dalam satu run dan mencatat asumsi.
3. **Konsistensi lintas artefak** - skill delivery mewajibkan nama komponen yang sama di ArchiMate, sequence dan TSD.
4. **Human-in-the-loop** untuk aksi eksternal yang Anda tentukan (Visual Paradigm selalu).
5. **Riwayat percakapan append-only** - system prompt & daftar tool dibekukan per task (cache prompt efisien, penalaran
   model tetap valid antar giliran).

## Keamanan

- Server default hanya mendengarkan `127.0.0.1`. Untuk akses jaringan set `HOST=0.0.0.0` **dan** `SOLAR_ACCESS_TOKEN`.
- Tanpa `SOLAR_ACCESS_TOKEN`, API hanya melayani permintaan dengan Host/Origin lokal (`127.0.0.1`, `localhost`, `[::1]`); halaman web lain tidak bisa memakai API lewat *DNS rebinding* (mis. menambah plugin stdio).
- Rahasia hanya di `.env`; nilai rahasia literal di konfigurasi plugin disamarkan saat dikirim ke browser.
- Artefak disajikan dengan `Content-Security-Policy: sandbox` dan pratinjau HTML di iframe sandbox - dokumen hasil AI
  tidak dapat menjalankan script. Markdown dirender dengan sanitasi (DOMPurify / HTML mentah di-escape).
- Path file skill/artefak dibatasi dari path traversal. Izin mikrofon desktop hanya untuk UI SOLAR sendiri.
- Tool yang mengubah sistem eksternal hanya dipakai bila diminta; kebijakan konfirmasi bisa diperketat per plugin.

## Struktur repository

```text
solar/
├─ apps/
│  ├─ server/        Node.js + Express: agent loop OpenAI, task manager, generator & validator,
│  │                 pembaca dokumen lampiran (src/documents), skills, plugin MCP, storage Neon/S3/lokal,
│  │                 REST + SSE  (test: vitest)
│  ├─ web/           React + Vite + TypeScript + GSAP + three.js: karakter 3D, chat, suara, monitor, pengaturan
│  └─ desktop/       Electron: menjalankan server + UI sebagai aplikasi Windows (installer NSIS)
├─ packages/shared/  Tipe TypeScript bersama (Task, Event, Artifact, Plugin, Skill, ...)
├─ skills/           Skill bawaan (SKILL.md)
├─ config/           plugins.default.json (preset GitHub, Plane, Visual Paradigm)
├─ docs/             ARCHITECTURE.md, API.md, gambar
├─ scripts/          generate-archimate-relationships.mjs (regenerasi tabel relasi dari Archi)
└─ .env.example      Template konfigurasi
```

## Pengembangan & pengujian

```bash
npm run typecheck   # TypeScript semua workspace
npm test            # unit + end-to-end agent (model tiruan) - tidak memanggil API berbayar
npm run build       # build web + server
npm run check       # ketiganya sekaligus
```

Pengujian opsional tambahan:

```bash
# validasi XML ArchiMate terhadap XSD resmi Open Group (butuh xmllint + file XSD dalam satu folder)
ARCHIMATE_XSD_DIR=/path/ke/xsd npm test

# jalankan skenario end-to-end terhadap Postgres/Neon (tabel solar_* di database tersebut akan DIHAPUS lalu dibuat ulang)
SOLAR_TEST_DATABASE_URL="postgresql://user:pass@host/db_test?sslmode=require" npm test
```

Yang sudah diuji otomatis: validator & renderer ArchiMate/sequence/TSD, store skill & plugin (termasuk penyamaran
rahasia), round-trip object storage S3-compatible, skenario agent end-to-end (model tiruan) dengan konfirmasi,
pembuatan 11 artefak, ZIP, header keamanan, dan riwayat percakapan append-only, serta pembacaan lampiran dari dokumen
nyata (`apps/server/test/fixtures/documents`: Word, PowerPoint, Excel, PDF, file terenkripsi & format lama) termasuk
zip bomb, PDF hasil scan, file rusak, ekstensi yang salah, API unggah dan tool dokumen agent.

## Troubleshooting

| Gejala | Solusi |
|---|---|
| Balon karakter: "OPENAI_API_KEY belum diisi" | Isi di `.env` (desktop: `%APPDATA%\SOLAR\.env`, menu *File → Buka file .env*), lalu restart. |
| Upgrade dari versi Anthropic (`.env` lama) | Tambahkan `OPENAI_API_KEY`; `ANTHROPIC_API_KEY` tidak dipakai lagi. `SOLAR_MODEL=claude-…` otomatis diganti `gpt-6.1-sol` (dengan peringatan di log) - sebaiknya hapus/ubah barisnya. |
| Task gagal "Autentikasi OpenAI gagal" | API key salah/dicabut - buat key baru di platform.openai.com/api-keys. |
| Task gagal "Saldo/kuota API OpenAI habis (insufficient_quota)" | Tambahkan kredit di platform.openai.com → Billing (langganan ChatGPT tidak berlaku untuk API). |
| Task gagal "Model … tidak ditemukan" / "Akses OpenAI ditolak" | Model belum tersedia untuk akun/project Anda (beberapa model butuh verifikasi organisasi). Ganti `SOLAR_MODEL`, mis. `gpt-6-sol`. |
| Plugin "Belum dikonfigurasi" | Isi variabel yang disebut di kartu plugin pada `.env`, lalu *Hubungkan ulang*. |
| Plugin Plane error saat terhubung | Pastikan Node.js/npx terpasang dan bisa mengakses npm registry; cek `PLANE_API_HOST_URL=https://plane.mesthi.com`. |
| Mikrofon tidak bekerja di browser | Izinkan mikrofon; Web Speech API butuh Chrome/Edge + internet. Pilih *Whisper lokal* di Pengaturan → Suara. |
| Karakter tampil sebagai gambar statis | WebGL tidak tersedia (driver/GPU). Fitur lain tetap berjalan normal. |
| Port 8790 dipakai | Ubah `PORT` di `.env` (desktop otomatis memilih port lain). |
| Lampiran ditolak "dilindungi kata sandi" | Buka file di Office → *File → Info → Protect → Encrypt with Password*, kosongkan kata sandi, simpan, lampirkan lagi (PDF: simpan salinan tanpa kata sandi). |
| Lampiran ditolak "Format Word 97-2003 (.doc)" dsb. | Simpan ulang sebagai .docx/.xlsx/.pptx (*File → Save As*) atau ekspor ke PDF. |
| Peringatan "tidak memiliki lapisan teks" pada PDF | PDF hasil scan; OCR belum didukung. Lampirkan versi PDF dengan teks atau dokumen Word aslinya. |
| Lampiran ditolak "terlalu besar" | Naikkan `ATTACHMENT_MAX_MB` (maks. 200) atau pecah dokumen menjadi beberapa file. |
| `npm install` gagal mengunduh Electron | Hanya perlu untuk desktop; untuk mode browser jalankan `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install`. |

`npm audit` melaporkan kerentanan *moderate* pada dependency **electron-builder** (alat build installer, tidak ikut
terpasang di aplikasi atau server) dan pada `argparse`/`sprintf-js` milik **mammoth** (hanya dipakai oleh command-line
mammoth, tidak ikut ter-bundle ke server maupun aplikasi desktop).

## Lisensi pihak ketiga

Lihat [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (antara lain tabel relasi ArchiMate dari proyek Archi - MIT,
serta pembaca dokumen pdf.js - Apache-2.0, mammoth - BSD-2-Clause, dan turndown - MIT).
ArchiMate® adalah merek dagang terdaftar The Open Group.
