# SOLAR AI AGENT 🍡

**SOLAR AI AGENT** (*SOLution ARchitect*, singkatnya SOLAR) adalah AI agent dengan **karakter 3D beranimasi yang bisa
dipilih** - **Robo** si robot (default), **Mochi**, **Cocoa Kelapa**, atau **Kelinci** klasik - yang membantu seorang
Solution Architect men-deliver pekerjaan lebih cepat dan konsisten:

- **Diagram ArchiMate 3.2** - divalidasi terhadap tabel relasi resmi ArchiMate, diekspor ke
  *Open Group ArchiMate Exchange Format* (bisa di-import ke Archi, Visual Paradigm, BiZZdesign, Sparx EA) + SVG per view.
- **Sequence diagram UML** - SVG siap pakai + sumber **Mermaid** (langsung tampil di GitHub) + **PlantUML**.
- **Technical Specification Document (TSD)** - dokumen **Word (.docx)** siap diserahkan ke klien (sampul, lembar
  persetujuan, daftar isi, nomor halaman), Markdown (GitHub-ready) dan HTML siap cetak/PDF, lengkap dengan diagram
  tertanam, requirement, NFR, integrasi, API, data model, risiko.

Perintah diberikan dengan **mengetik atau suara**, berjalan di **browser** maupun sebagai **aplikasi desktop Windows**,
bisa ditambah **skills** dan **plugin MCP** (GitHub, Plane `plane.mesthi.com` sebagai backlog, Visual Paradigm dengan
konfirmasi wajib), dan setiap pekerjaan bisa dipantau di **web monitoring task**.

![Halaman agent dengan karakter 3D dan dokumen terlampir](docs/images/agent-light.png)

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
6. [Web app (PWA)](#web-app-pwa)
7. [Konfigurasi kredensial (.env)](#konfigurasi-kredensial-env)
8. [Akun, login & peran](#akun-login--peran)
9. [Cara pakai](#cara-pakai)
10. [Bahasa antarmuka: Indonesia / English](#bahasa-antarmuka-indonesia--english)
11. [Lampiran dokumen proyek](#lampiran-dokumen-proyek)
12. [Deliverable yang dihasilkan](#deliverable-yang-dihasilkan)
13. [Model AI: multi-provider & cadangan](#model-ai-multi-provider--cadangan)
14. [Knowledge base](#knowledge-base)
15. [Skills](#skills)
16. [Plugin MCP: GitHub, Plane, Visual Paradigm](#plugin-mcp-github-plane-visual-paradigm)
17. [Web monitoring task](#web-monitoring-task)
18. [Bagaimana SOLAR mencegah kesalahan](#bagaimana-solar-mencegah-kesalahan)
19. [Keamanan](#keamanan)
20. [Struktur repository](#struktur-repository)
21. [Pengembangan & pengujian](#pengembangan--pengujian)
22. [Troubleshooting](#troubleshooting)
23. [Lisensi pihak ketiga](#lisensi-pihak-ketiga)

---

## Fitur utama

| Area | Kemampuan |
|---|---|
| Karakter 3D | **Bisa dipilih**: **Robo** (robot putih-biru dengan wajah layar bercahaya dan dua antena, default), **Mochi** (kue mochi merah muda), **Cocoa Kelapa** (kelapa cokelat bersedotan & payung kecil), atau **Kelinci** klasik - lewat tombol karakter di pojok panggung atau *Pengaturan → Karakter* (tersimpan di perangkat). Dibangun prosedural (three.js, tanpa aset) dengan animasi **GSAP**: idle, mendengarkan, berpikir, bekerja (membawa tablet), berbicara, bertanya (menunggu persetujuan), senang, sedih. Mata mengikuti kursor; klik karakter untuk mulai bicara. |
| Dokumen proyek | **Lampirkan** PDF, Word (.docx), Excel (.xlsx/.xlsm/.csv), PowerPoint (.pptx), Markdown atau teks (klip kertas, seret & lepas, atau tempel). SOLAR membaca isinya (judul, tabel, sheet, slide, catatan pembicara) sebelum merancang, lalu menyebut sumbernya. |
| Input | Ketik (Enter kirim) atau **suara**: Web Speech API di Chrome/Edge, atau **Whisper lokal** (transformers.js, offline setelah model diunduh) - otomatis dipakai di aplikasi desktop. Berhenti otomatis saat hening. |
| Bahasa | Seluruh aplikasi dalam **Bahasa Indonesia atau English**: tombol **ID \| EN** di bilah atas atau *Pengaturan → Sistem*, langsung berlaku tanpa memuat ulang. Default mengikuti bahasa browser. Agent menjawab dalam bahasa permintaan Anda. Lihat [Bahasa antarmuka](#bahasa-antarmuka-indonesia--english). |
| Output suara | Karakter membacakan ringkasan hasil (text-to-speech suara sistem, mengikuti bahasa antarmuka atau bahasa yang dipilih di *Pengaturan → Suara*). |
| Agent | **Multi-provider**: OpenAI Responses API (default **GPT-6.1 Sol**, `gpt-6.1-sol`) atau API **Chat Completions** yang kompatibel OpenAI - OmniRoute, OpenRouter, LiteLLM, Claude, Gemini, Ollama/vLLM lokal. **Rute model** utama → cadangan dengan fallback otomatis bila provider gagal; diatur di *Pengaturan → Model AI* tanpa restart. Streaming, tool call paralel; satu task = satu proses end-to-end ("sekali proses"). |
| Knowledge base | Aturan & fakta Anda sebagai file Markdown (sistem, integrasi, standar ArchiMate/PlantUML/API, prinsip, status lifecycle). Agent membacanya sebelum mendesain dan mengutamakannya di atas aturan bawaan. Impor registry **Excel/CSV** (satu file per baris) dan dokumen **Word/PDF/PowerPoint** (dipecah per bab). |
| Deliverable | ArchiMate (Exchange XML + SVG + JSON), sequence diagram (SVG + Mermaid + PlantUML + JSON), TSD (Word .docx + Markdown + HTML + JSON), unduh semua sebagai ZIP. |
| Skills | 6 skill bawaan (delivery package, ArchiMate, sequence, TSD, backlog Plane, publish GitHub); tambah/impor/edit/nonaktifkan dari UI. |
| Plugin MCP | GitHub (remote MCP resmi), Plane `plane.mesthi.com` (MCP resmi Plane), Visual Paradigm (selalu konfirmasi), plugin custom (HTTP/SSE/stdio). |
| Integrasi bawaan | Publish artefak ke GitHub dalam **satu commit**; buat backlog Plane secara **bulk** (epic → story, label, prioritas, anti-duplikat). |
| Akun & peran | Masuk dengan **username atau email** + password (layar masuk beranimasi GSAP), **pendaftaran mandiri** yang disetujui Superadmin / Head of IT Solar, tiga peran - **Superadmin**, **Head of IT Solar**, **Staf Solar** - dengan izin berbeda (staf hanya melihat task-nya sendiri), sesi cookie HttpOnly, batas percobaan login, dan **log aktivitas** (audit) dengan filter & ekspor CSV. Lihat [Akun, login & peran](#akun-login--peran). |
| Monitoring | Halaman `/monitor`: KPI, progres realtime, langkah kerja, penalaran ringkas, persetujuan, token & estimasi biaya, artefak. |
| Penyimpanan | **Neon Postgres** + **object storage S3** (Neon/S3/R2/MinIO), atau otomatis file lokal bila belum dikonfigurasi. |
| Platform | Browser (Chrome/Edge/Firefox/Safari) dan **desktop Windows** (Electron, installer NSIS). |

## Arsitektur

```mermaid
flowchart LR
    U([Solution Architect]) -- masuk, lalu ketik / suara --> UI
    subgraph Client["Web UI - React + Vite + TypeScript + GSAP"]
        UI[Agent page<br/>karakter 3D three.js]
        MON[Monitor page]
        SET[Pengaturan<br/>skills & plugin]
    end
    subgraph Server["SOLAR server - Node.js / Express"]
        API[REST API + SSE stream]
        AUTH[Akun & sesi<br/>peran, izin, log aktivitas]
        TM[Task manager<br/>antrean, progres, konfirmasi]
        AG[Agent loop<br/>OpenAI GPT-6.1 Sol]
        GEN[Generator + validator<br/>ArchiMate, Sequence, TSD]
        SK[Skill store]
        MCP[MCP client manager]
    end
    UI <--> API
    MON <--> API
    SET <--> API
    API --> AUTH
    API --> TM --> AG
    AG --> GEN
    AG --> SK
    AG --> MCP
    AG -- Responses API --> OPENAI[(OpenAI API)]
    MCP --> GH[GitHub MCP]
    MCP --> PL[Plane MCP<br/>plane.mesthi.com]
    MCP --> VP[Visual Paradigm MCP]
    TM --> DB[(Neon Postgres<br/>atau file lokal)]
    AUTH --> DB
    GEN --> OBJ[(Object storage S3<br/>atau file lokal)]
    DESK[Electron desktop<br/>Windows] -. menjalankan server .-> Server
    DESK -. menampilkan .-> Client
```

Detail desain (alur agent, prompt caching, konfirmasi, penyimpanan, autentikasi & izin) ada di
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

Saat pertama kali dibuka, SOLAR meminta Anda membuat **superadmin pertama**; kode penyiapannya tercetak di log
`npm start` dan tersimpan di `data/setup-code.txt` (atau isi `SOLAR_ADMIN_*` di `.env` sebelum start). Lihat
[Akun, login & peran](#akun-login--peran).

Mode pengembangan (hot reload UI di <http://localhost:5173>, API di 8790):

```bash
npm run dev
```

## Aplikasi desktop Windows

**Unduh installer:** halaman [Releases](https://github.com/arumora-id/solar/releases) →
`SOLAR-AI-AGENT-Setup-<versi>.exe`. Installer belum ditandatangani: bila Windows SmartScreen muncul, pilih
*More info → Run anyway*.

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

Atau dari GitHub: tab **Actions → "Desktop installer (Windows)" → Run workflow**, lalu unduh artifact installer
(cara menerbitkan rilis: lihat [Rilis](#rilis)).

Catatan aplikasi desktop:

- Server SOLAR berjalan **di dalam aplikasi** (satu proses), UI dimuat dari `http://127.0.0.1:8790`.
- Nama aplikasi & shortcut: **SOLAR AI AGENT**. Folder data tetap `%APPDATA%\SOLAR`, sehingga pengguna versi sebelumnya
  tidak kehilangan `.env`, task, maupun artefak setelah memperbarui.
- Saat pertama kali dibuka, file konfigurasi dibuat di `%APPDATA%\SOLAR\.env` dan dialog menawarkan untuk membukanya.
  Isi kredensial lalu jalankan ulang. Data & artefak lokal disimpan di `%APPDATA%\SOLAR\data`.
- **Akun pertama:** selama belum ada akun, jendela SOLAR menampilkan form pembuatan superadmin pertama dengan kode
  penyiapan yang **sudah terisi** - cukup isi username, email, nama dan password. Kode itu hanya diberikan ke jendela
  SOLAR sendiri (bukan ke halaman lain) dan tidak berlaku lagi setelah akun dibuat. Untuk membuat akun lewat browser di
  komputer yang sama, buka menu **Bantuan → Kode penyiapan superadmin pertama…** (salin kode). Pengguna lain mendaftar
  sendiri lalu disetujui - lihat [Akun, login & peran](#akun-login--peran).
- Menu **Jendela → Mode mini (selalu di atas)** menjadikan SOLAR jendela kecil yang selalu tampil - cocok sebagai
  "asisten di samping" saat bekerja.
- Input suara di desktop memakai **Whisper lokal** (Chromium di Electron tidak menyertakan layanan pengenalan suara Google).
  Model diunduh sekali (pilih ukurannya di *Pengaturan → Suara*).
- Menu dan dialog aplikasi desktop berbahasa Indonesia atau English, mengikuti tombol **ID | EN** di UI (lihat
  [Bahasa antarmuka](#bahasa-antarmuka-indonesia--english)); installer Windows tampil dalam Bahasa Indonesia atau
  English sesuai bahasa Windows.

## Web app (PWA)

Web UI SOLAR adalah *Progressive Web App*: bisa dipasang sebagai aplikasi dengan jendela dan ikon sendiri di Windows,
macOS, Linux, Android dan iPhone/iPad.

- **Chrome / Edge:** tombol **Pasang aplikasi** di bilah atas, *Pengaturan → Sistem → Aplikasi*, atau menu browser →
  *Instal SOLAR AI AGENT*. **iPhone/iPad (Safari):** Bagikan → *Tambahkan ke Layar Utama*.
- Browser hanya mengizinkan pemasangan dari **HTTPS** atau **localhost**. Di komputer yang menjalankan SOLAR (`npm start`
  atau aplikasi desktop) buka <http://127.0.0.1:8790> di Chrome/Edge. Untuk perangkat lain: jalankan server dengan
  `SOLAR_ACCESS_TOKEN` di balik reverse proxy HTTPS - lihat [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md).
- Tampilan aplikasi disimpan per versi oleh *service worker*, sehingga tetap terbuka (status **Terputus**) saat server
  tidak terjangkau; task, event stream, unggahan dan unduhan (`/api`) selalu langsung ke server dan tidak pernah
  di-cache. Saat versi baru tersedia, SOLAR menampilkan **Versi baru tersedia → Muat ulang**.
- Paket **SOLAR-AI-AGENT-server-<versi>.zip** di halaman Releases berisi server yang sudah di-bundle + web app untuk
  dijalankan sendiri dengan Node.js 22 (tanpa `npm install`).
- Ikon aplikasi (PWA, ikon Apple, ikon *maskable* Android, ikon installer Windows) bergambar Robo dan semuanya dibuat
  dari satu file, `apps/web/public/favicon.svg`: ubah SVG itu lalu jalankan `node scripts/generate-icons.mjs`
  (butuh Playwright + Chromium, bukan dependensi proyek).

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
| `SOLAR_ACCESS_TOKEN` | jika `HOST=0.0.0.0` / reverse proxy | Token API untuk skrip/CI (`Authorization: Bearer <token>`), bertindak sebagai superadmin. Wajib bila SOLAR dibuka dengan nama host lain; pengguna browser tetap masuk dengan akun. Lihat [Token API](#token-api-solar_access_token). |
| `SOLAR_ADMIN_USERNAME`, `SOLAR_ADMIN_EMAIL`, `SOLAR_ADMIN_PASSWORD`, `SOLAR_ADMIN_NAME` | | Superadmin pertama, dibuat saat start **hanya bila belum ada akun** (diabaikan setelahnya). Tiga yang pertama wajib diisi bersama; password minimal 10 karakter. Tanpa ini: kode penyiapan (lihat [Superadmin pertama](#superadmin-pertama)). |
| `SESSION_TTL_HOURS`, `SESSION_MAX_DAYS` | | Sesi login berakhir setelah sekian jam tidak dipakai (default `168` = 7 hari) dan paling lama sekian hari sejak masuk (default `30`). |
| `TRUST_PROXY` | di balik reverse proxy | Jumlah hop proxy yang dipercaya (`true` = 1). Untuk IP klien (batas percobaan login), cookie `Secure` dan cek Origin. Jangan di-set tanpa proxy. Selama di-set, form superadmin pertama dengan kode penyiapan tidak tersedia. |
| `DATABASE_URL` | | Connection string **Neon** (`postgresql://…neon.tech/neondb?sslmode=require`) atau Postgres **13+** lainnya. Tabel (task, akun, sesi, peran, log aktivitas, …) dibuat otomatis saat start; skema lengkapnya di [`docs/schema.sql`](docs/schema.sql) (`npm run -s db:schema`). |
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
| `ACTIVITY_RETENTION_DAYS` | | Lama log aktivitas (audit) disimpan, dalam hari (default `365`; `0` = selamanya). |
| `TASK_CONCURRENCY`, `CONFIRMATION_TIMEOUT_MINUTES`, `SOLAR_MAX_TOKENS`, `SOLAR_MAX_TURNS`, `LOG_LEVEL` | | Penyetelan lanjutan. |

Tanpa `DATABASE_URL`/`S3_*`, SOLAR tetap berjalan penuh dengan penyimpanan file lokal (`data/`). Begitu kredensial Neon
dan object storage diisi, data baru otomatis disimpan di sana.

## Akun, login & peran

Setiap orang memakai SOLAR dengan **akunnya sendiri**: masuk dengan **username atau email** dan password. Layar masuk,
pendaftaran dan pembuatan superadmin pertama memakai animasi **GSAP** (dikurangi otomatis bila *prefers-reduced-motion*
aktif). Task, lampiran dan log aktivitas tercatat atas nama akun yang membuatnya. Rincian endpoint dan kode error ada di
[docs/API.md](docs/API.md#autentikasi--pengguna).

### Masuk & pendaftaran mandiri

- **Masuk:** isi username **atau** email (huruf besar/kecil tidak berpengaruh) dan password. Pesan untuk akun yang tidak
  dikenal dan untuk password yang salah sengaja sama.
- **Daftar sendiri:** dari layar masuk, isi username (3-32 karakter: huruf a-z, angka, `.`, `_`, `-`; disimpan huruf
  kecil), email, nama tampilan dan password (10-128 karakter, tidak boleh sama dengan username/email). Username dan
  email harus unik. Akun baru berperan **Staf Solar** dan berstatus **menunggu persetujuan**: belum bisa masuk sampai
  disetujui.
- **Persetujuan:** Superadmin dan Head of IT Solar melihat jumlah pendaftaran yang menunggu (diperbarui langsung) lalu
  menyetujuinya. Head of IT Solar menyetujui sebagai Staf Solar; Superadmin juga bisa langsung memberi peran lain. Setelah
  disetujui, pengguna masuk seperti biasa. Mencoba masuk sebelum disetujui (atau dengan akun yang dinonaktifkan)
  menampilkan pesan yang menyebut statusnya - hanya bila passwordnya benar.
- Pendaftaran baru dibuka setelah **superadmin pertama** ada (lihat di bawah).
- SOLAR tidak mengirim email: tidak ada verifikasi email maupun "lupa password" lewat email. Password yang terlupa
  direset oleh Superadmin; setiap pengguna bisa mengganti passwordnya sendiri setelah masuk.

### Peran

| Yang bisa dilakukan | Superadmin | Head of IT Solar | Staf Solar |
|---|:-:|:-:|:-:|
| Memakai agent: membuat task, melampirkan dokumen, mengunduh artefak, menjawab persetujuan - untuk task **sendiri** | ✅ | ✅ | ✅ |
| Melihat & menangani task **semua** pengguna (detail, artefak, persetujuan, batal); task menampilkan pemiliknya | ✅ | ✅ | - |
| Membaca & menulis knowledge base, melihat & mengelola skill | ✅ | ✅ | ✅ |
| Melihat daftar akun dan jumlah pendaftaran yang menunggu | ✅ | ✅ | - |
| Menyetujui pendaftaran | ✅ peran apa pun | ✅ sebagai Staf Solar | - |
| Menonaktifkan / mengaktifkan akun | ✅ | ✅ hanya akun Staf Solar | - |
| Membuat akun, mengubah peran & nama, mereset password, menghapus akun | ✅ | - | - |
| Pengaturan sistem: model AI & provider LLM, plugin MCP, konfigurasi | ✅ | - | - |
| Log aktivitas **semua** pengguna (filter per pengguna, ekspor CSV) | ✅ | ✅ | - |
| Log aktivitas **sendiri**, mengganti password sendiri | ✅ | ✅ | ✅ |

Aturan pengaman: tidak ada yang bisa mengubah peran, menonaktifkan, mereset password (sebagai admin) atau menghapus
**akunnya sendiri**, dan superadmin aktif **terakhir** tidak bisa diturunkan perannya, dinonaktifkan atau dihapus.
Perubahan peran, nonaktif, reset password dan hapus akun langsung mengakhiri semua sesi akun itu (jendela SOLAR yang
terbuka ikut keluar). Task dari versi sebelum ada akun (tanpa pemilik) hanya terlihat oleh Superadmin dan Head of IT
Solar. Acuan izin satu-satunya: `ROLE_PERMISSIONS` di `packages/shared` (dipakai server dan web UI; kode izinnya di
[docs/API.md](docs/API.md#peran)).

### Superadmin pertama

Selama belum ada akun sama sekali, SOLAR menampilkan layar pembuatan **superadmin pertama** dan pendaftaran ditutup.
Pilih salah satu cara:

| Cara | Cocok untuk | Langkah |
|---|---|---|
| **Aplikasi desktop** | Installer Windows, `npm run desktop:dev` | Isi form di jendela SOLAR. Kode penyiapan sudah **terisi otomatis**. |
| **Kode penyiapan** | `npm start` / paket server, dibuka di komputer server itu sendiri | Buka <http://127.0.0.1:8790> **di komputer server**, isi form dan kode penyiapan (lihat di bawah). |
| **`.env`** | Server yang hanya bisa dibuka lewat jaringan, instalasi otomatis | Isi `SOLAR_ADMIN_USERNAME`, `SOLAR_ADMIN_EMAIL`, `SOLAR_ADMIN_PASSWORD` (opsional `SOLAR_ADMIN_NAME`), lalu start server. |
| **Token API** | Skrip | `POST /api/auth/setup` dengan header `Authorization: Bearer <SOLAR_ACCESS_TOKEN>` (dari mana pun). |

**Kode penyiapan** (`XXXX-XXXX-XXXX-XXXX`, sekali pakai) dibuat setiap kali server start selama belum ada akun; kode
dari start sebelumnya tidak berlaku lagi. Tempat menemukannya:

- **Log server** saat start: baris `First-superadmin setup code: XXXX-XXXX-XXXX-XXXX (also in …/setup-code.txt; …)`.
- **File** `DATA_DIR/setup-code.txt` - default `data/setup-code.txt`; aplikasi desktop:
  `%APPDATA%\SOLAR\data\setup-code.txt`. Di Linux/macOS hanya bisa dibaca pemilik file (mode 0600).
- **Aplikasi desktop:** terisi otomatis di jendela SOLAR. Untuk membuat akun lewat browser di komputer yang sama, menu
  **Bantuan → Kode penyiapan superadmin pertama…** menampilkan kodenya dan bisa menyalinnya (menu ini hanya muncul selama
  belum ada akun).

Huruf besar/kecil, spasi dan tanda hubung pada kode diabaikan. Begitu superadmin pertama dibuat, kode tidak berlaku lagi
dan file-nya dihapus. Form dengan kode hanya diterima dari **komputer server itu sendiri**, langsung - bukan lewat
jaringan atau reverse proxy, dan tidak sama sekali selama `TRUST_PROXY` di-set. Alasannya: server baru yang sudah
terbuka di jaringan tidak boleh bisa "diklaim" oleh siapa pun yang pertama kali menemukannya. Untuk server yang hanya
bisa dibuka lewat jaringan, pakai `SOLAR_ADMIN_*` atau token API.

`SOLAR_ADMIN_*` hanya dipakai bila **belum ada akun sama sekali**; setelah itu diabaikan (tidak mereset password dan
tidak membuat akun baru). Nilai yang tidak valid (mis. password kurang dari 10 karakter) membuat server gagal start
dengan pesan yang jelas. Setelah masuk pertama kali, ganti password lalu kosongkan `SOLAR_ADMIN_PASSWORD` di `.env`.

### Sesi & cookie

- Setelah masuk, browser menerima cookie `solar_session`: **HttpOnly** (tidak bisa dibaca script), `SameSite=Lax`, dan
  `Secure` bila dibuka lewat HTTPS. Server hanya menyimpan hash SHA-256 token sesi, tidak pernah tokennya.
- Sesi berakhir setelah `SESSION_TTL_HOURS` jam tidak dipakai (default 168 = 7 hari) dan paling lama
  `SESSION_MAX_DAYS` hari sejak masuk (default 30), walau terus dipakai. Setelah itu pengguna masuk lagi.
- **Keluar** mengakhiri sesi itu saja. Mengganti password sendiri mengakhiri sesi **lain** milik akun itu (perangkat
  lain); tindakan admin (ubah peran, nonaktif, reset password, hapus) mengakhiri **semua** sesinya.
- Keluar baru dianggap selesai bila server menjawab. Bila server tidak terjangkau (mis. offline atau sedang restart),
  menu akun menampilkan pesan bahwa Anda **masih masuk** di perangkat ini; coba lagi sampai berhasil, terutama di
  komputer bersama.
- **Satu browser, satu akun.** Semua tab di satu browser memakai cookie yang sama. Masuk dengan akun lain di browser
  itu (mis. dari tab yang masih menampilkan layar masuk) **mengakhiri sesi sebelumnya**: tab lain yang masih
  menampilkan akun lama ikut beralih ke akun yang baru masuk, dan keluar di satu tab mengeluarkan semua tab. Log
  aktivitas mencatatnya sebagai `auth.session_revoked` dengan alasan `replaced_by_login`. Untuk memakai dua akun
  sekaligus, pakai browser lain atau jendela penyamaran.
- Perubahan data dari browser (`POST/PUT/PATCH/DELETE`) hanya diterima dari origin SOLAR sendiri (perlindungan CSRF).
- Di belakang reverse proxy HTTPS: set `TRUST_PROXY` agar cookie diberi `Secure` dan batas percobaan dihitung per alamat
  klien yang sebenarnya (lihat [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md)).

### Batas percobaan

| Aksi | Batas | Bila terlampaui |
|---|---|---|
| Login gagal | 10 per 15 menit per alamat IP **dan** per akun | `429` + `Retry-After` (detik) |
| Pendaftaran | 5 per jam per alamat IP | `429` + `Retry-After` |
| Pembuatan superadmin pertama | 10 per 15 menit per alamat IP | `429` + `Retry-After` |
| Password lama salah saat ganti password | 10 per 15 menit per akun | `429` + `Retry-After` |

Batas pendaftaran menghitung **semua** pendaftaran, termasuk yang berhasil (perlindungan dari pendaftaran massal).
Satu kantor di balik satu alamat IP publik/NAT berbagi batas ini: bila banyak orang perlu akun sekaligus, Superadmin
bisa membuatkannya langsung lewat **Pengaturan → Pengguna → Tambah pengguna** (langsung aktif, tanpa persetujuan).
Layar pendaftaran menyebut hal ini dan menghitung mundur sampai bisa mendaftar lagi.

Percobaan yang dikirim bersamaan ikut dihitung, jadi batasnya tidak bisa dilewati dengan permintaan paralel. Saat
server sedang sangat sibuk memeriksa password (mis. banjir login), permintaan berikutnya dijawab `503` + `Retry-After: 5`.
Hitungan batas disimpan di memori server (mulai dari nol lagi setelah restart). Tanpa `TRUST_PROXY` di belakang reverse
proxy, semua pengguna terlihat dari alamat IP proxy dan berbagi satu batas login.

### Token API (`SOLAR_ACCESS_TOKEN`)

- Untuk skrip, CI dan integrasi: header `Authorization: Bearer <token>` (atau `?token=<token>` untuk event stream dan
  unduhan). Permintaan dengan token bertindak sebagai **superadmin**, tetapi bukan akun (`GET /api/auth/me` →
  `"via": "token"`); di log aktivitas pelakunya tercatat sebagai `SOLAR_ACCESS_TOKEN`.
- Token yang dikirim tetapi salah dijawab `401 invalid_token`. Pengguna di browser **tidak** memakai token: mereka masuk
  dengan akun. Token lama yang mungkin masih tersimpan di browser dari versi sebelumnya diabaikan di layar masuk.
- Token juga **wajib** bila SOLAR dibuka dengan nama host lain (`HOST=0.0.0.0` atau reverse proxy): tanpa token, API
  hanya melayani `127.0.0.1`/`localhost` (perlindungan *DNS rebinding*).
- Buat token acak yang panjang, mis. `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
  Mengganti token: ubah nilainya di `.env` lalu restart.

### Log aktivitas

Jejak audit siapa melakukan apa dan kapan: masuk/keluar dan login gagal, pendaftaran & persetujuan, semua perubahan akun
(juga percobaan yang ditolak), task dibuat/dibatalkan, jawaban persetujuan, perubahan knowledge & skill, pengaturan model
AI dan plugin MCP, ekspor Word, publish GitHub, ekspor CSV. Superadmin dan Head of IT Solar melihat entri semua pengguna
(filter per pengguna, aksi, hasil, rentang waktu dan teks; ekspor CSV); Staf Solar hanya melihat entrinya sendiri. Log
tidak pernah berisi password, token, hash, kode penyiapan atau isi file. Disimpan `ACTIVITY_RETENTION_DAYS` hari
(default 365, `0` = selamanya), dibersihkan saat start lalu setiap hari. API dan daftar kode aksi:
[docs/API.md](docs/API.md#log-aktivitas).

### Pemulihan bila tidak ada superadmin yang bisa masuk

Bila masih ada superadmin lain yang aktif, cukup minta dia mereset password Anda. Bila tidak ada (password terlupa,
satu-satunya superadmin sudah tidak di tim), `SOLAR_ADMIN_*` **tidak** membantu - nilainya hanya dipakai saat belum ada
akun sama sekali. Jalan yang aman adalah token API, dikerjakan oleh orang yang memegang `.env` server:

1. Isi `SOLAR_ACCESS_TOKEN` di `.env` dengan nilai acak yang panjang (aplikasi desktop: menu *File → Buka file .env*),
   lalu restart SOLAR.
2. Di komputer server, cari id akun superadmin (`usr_…`):

   ```bash
   TOKEN='<isi SOLAR_ACCESS_TOKEN>'
   curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:8790/api/users?status=active"
   ```

3. Setel password sementara untuk akun itu (semua sesi lamanya berakhir):

   ```bash
   curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"password":"password sementara yang panjang"}' "http://127.0.0.1:8790/api/users/<id>/password"
   ```

   Windows PowerShell (juga untuk aplikasi desktop):

   ```powershell
   $h = @{ Authorization = 'Bearer <isi SOLAR_ACCESS_TOKEN>' }
   Invoke-RestMethod -Headers $h 'http://127.0.0.1:8790/api/users?status=active'
   Invoke-RestMethod -Method Post -Headers $h -ContentType 'application/json' `
     -Body '{"password":"password sementara yang panjang"}' 'http://127.0.0.1:8790/api/users/<id>/password'
   ```

   Akun yang dinonaktifkan diaktifkan lagi dengan `PATCH /api/users/<id>` body `{"status":"active"}`; superadmin baru
   bisa dibuat dengan `POST /api/users` body `{"username", "email", "name", "password", "role": "superadmin"}`.
4. Masuk dengan password sementara itu dan langsung ganti password.
5. Bila token tidak dipakai untuk keperluan lain, kosongkan lagi `SOLAR_ACCESS_TOKEN` lalu restart.

Port aplikasi desktop biasanya 8790; bila port itu dipakai program lain, lihat alamatnya lewat *Bantuan → Buka SOLAR AI
AGENT di browser*. Semua langkah ini tercatat di log aktivitas dengan pelaku `SOLAR_ACCESS_TOKEN`. **Jangan** menghapus
`data/users.json` atau isi tabel `solar_users` untuk mengulang setup: semua akun ikut hilang (setiap orang harus
mendaftar dan disetujui lagi), sedangkan cara di atas hanya mengubah satu akun dan tercatat.

### Penyimpanan akun & Neon/Postgres

| Data | Tanpa `DATABASE_URL` | Dengan `DATABASE_URL` (Neon / Postgres) |
|---|---|---|
| Akun (hash password scrypt, tidak pernah dikirim API atau ditulis ke log) | `data/users.json` (mode 0600) | tabel `solar_users` |
| Sesi login | `data/sessions.json` (mode 0600) | `solar_sessions` |
| Peran | dari kode | `solar_roles` (salinan dari kode, diperbarui setiap start) |
| Log aktivitas | `data/activity/activity-<YYYY-MM>.jsonl` | `solar_activity` |

- Database harus **Postgres 13 atau lebih baru** (Neon memenuhi). Tabel dibuat/diperbarui otomatis setiap server start.
- Untuk ditinjau atau dibuat lebih dulu oleh DBA: skema lengkapnya ada di [`docs/schema.sql`](docs/schema.sql), atau
  cetak dari kode dengan `npm run -s db:schema > schema.sql`. Skema idempoten (aman di database kosong maupun yang sudah
  terisi): `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f docs/schema.sql`.
- Akun **tidak** ikut pindah saat beralih dari penyimpanan file ke database (atau ke database lain): database baru mulai
  tanpa akun, jadi buat superadmin pertama lagi. Cadangkan folder `data/` (atau database) bersama `.env`.

## Cara pakai

1. Buka SOLAR (browser atau desktop) dan masuk dengan username atau email + password (belum punya akun: daftar, lalu
   tunggu persetujuan - lihat [Akun, login & peran](#akun-login--peran)). Status **Terhubung** tampil di kanan atas.
2. Ketik perintah atau klik **karakter / tombol mikrofon** lalu bicara. Tombol cepat di bawah karakter mengisi template perintah.
   Ganti karakter (Robo, Mochi, Cocoa Kelapa, Kelinci) lewat tombol bernama karakter di pojok kiri bawah panggung.
3. SOLAR mengerjakan **seluruh permintaan dalam satu proses**: membuat rencana, memuat skill yang relevan,
   membuat & memvalidasi diagram, menyusun dokumen, lalu memberi ringkasan + daftar artefak. Asumsi dicatat eksplisit
   (tidak berhenti untuk bertanya kecuali benar-benar menghalangi).
4. Bila aksi butuh persetujuan (mis. Visual Paradigm), karakter mengangkat tangan dan dialog **Perlu persetujuan Anda**
   muncul berisi data yang akan dikirim. Setujui atau tolak (bisa dengan catatan).
5. Pratinjau, unduh per file, atau **Unduh semua (ZIP)**. Dokumen Word TSD (dokumen untuk klien) diunduh lewat tombol
   **Unduh Word (.docx)** di judul kelompok TSD; TSD lama yang belum punya file Word mendapat tombol **Buat Word (.docx)**.
   Progres rinci ada di **Monitor**.

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

## Bahasa antarmuka: Indonesia / English

SOLAR bisa dipakai sepenuhnya dalam **Bahasa Indonesia** atau **English**, dan bahasanya bisa diganti kapan saja.

- **Mengganti bahasa:** tombol **ID | EN** di bilah atas, atau *Pengaturan → Sistem → Bahasa / Language*. Perubahan
  langsung berlaku di seluruh aplikasi tanpa memuat ulang halaman, tersimpan di perangkat (`localStorage`
  `solar.lang`), dan diikuti semua jendela/tab SOLAR lain yang terbuka di browser yang sama.
- **Bahasa awal** (selama Anda belum pernah memilih): bahasa pertama dari daftar bahasa browser/sistem
  (`navigator.languages`) yang dikenali - `id…` atau `ms…` → Bahasa Indonesia, `en…` → English; selain itu Bahasa
  Indonesia. `<html lang>` dan manifest PWA (`manifest.webmanifest` / `manifest.en.webmanifest`) sudah diatur sebelum
  tampilan pertama, jadi tidak ada kedipan bahasa lain saat halaman dibuka.
- **Yang ikut berganti:** semua teks antarmuka; tombol cepat di bawah karakter (label **dan** template perintahnya, jadi
  agent ikut menjawab dalam bahasa itu); format tanggal, angka dan durasi (`11 Okt, 04.29` · `$0,174` /
  `Oct 11, 4:29 AM` · `$0.174`); serta teks dari server: langkah dan status task, alasan persetujuan, nama tool di
  langkah kerja dan timeline, error task, pesan error API, error/peringatan unggah lampiran, hasil impor knowledge,
  tes koneksi provider, dan status plugin MCP.
- **Bahasa task:** teks milik sebuah task (langkah aktif, pesan status, alasan persetujuan, nama tool, error) ditulis
  dalam bahasa antarmuka saat task itu dibuat (`Task.language`), karena semua UI yang terbuka melihat task yang sama.
  Mengganti bahasa tidak menerjemahkan ulang task yang sudah ada; task berikutnya memakai bahasa yang baru. Task dari
  versi sebelum fitur ini dianggap Bahasa Indonesia.
- **Jawaban agent:** dalam bahasa yang Anda pakai di permintaan; bila tidak jelas (mis. hanya nama sistem, file, atau
  kode) agent memakai bahasa task. TSD ditulis dalam bahasa task kecuali Anda meminta lain (mis. *"TSD dalam bahasa
  Inggris"*).
- **Tidak diterjemahkan** karena merupakan data: isi knowledge base (termasuk panduan & template bawaan di
  `knowledge/`, yang berbahasa Indonesia), isi skill, deskripsi plugin dari konfigurasi, isi artefak, dan teks Anda
  sendiri.
- **Suara:** di *Pengaturan → Suara* bahasa **Otomatis** (default) memakai `id-ID` atau `en-US` sesuai bahasa
  antarmuka; pilihan bahasa tertentu tetap dipakai walau antarmuka diganti. Pengaturan suara lama yang masih berisi
  default lama (`id-ID`) otomatis menjadi **Otomatis**.
- **Aplikasi desktop:** menu dan dialog mengikuti bahasa yang dipilih di UI (diingat di `%APPDATA%\SOLAR\language.json`);
  sebelum itu mengikuti bahasa Windows. Installer Windows tampil dalam Bahasa Indonesia atau English sesuai bahasa
  Windows.
- **Klien API lain** (skrip, integrasi): kirim header `X-Solar-Language: en` (atau `Accept-Language`) dan
  `"language": "en"` saat membuat task; tanpa keduanya server menjawab dalam Bahasa Indonesia. Lihat
  [docs/API.md](docs/API.md#bahasa).

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
| PDF | `.pdf` | Teks per halaman (penanda `<!-- page N -->`), judul dikenali dari ukuran huruf (watermark miring tidak dianggap judul), halaman yang diputar dibaca normal, kolom tabel tetap berjajar. PDF berpassword pemilik (hanya pembatasan salin/cetak) tetap dibaca; halaman yang rusak dilewati. |
| Word | `.docx` | Judul & heading bertingkat, daftar berpoin/bernomor (penomoran otomatis Word ikut terbaca, mis. "2.1" dan daftar yang berlanjut), tabel (termasuk sel gabungan), catatan kaki, versi akhir *track changes*, teks alternatif gambar. |
| Excel | `.xlsx`, `.xlsm` | Setiap sheet (`## Sheet: nama`) sebagai tabel: tanggal ISO, persen, nilai hasil rumus, judul sel gabungan; maks. 50 sheet, 1.000 baris × 50 kolom per sheet (jumlah baris sebenarnya disebutkan). |
| CSV | `.csv` | Satu tabel; pemisah `,` `;` tab atau `\|` dikenali otomatis (juga petunjuk `sep=;` dari Excel), baris judul di atas tabel menjadi keterangan; maks. 2.000 baris. |
| PowerPoint | `.pptx` | Slide sesuai urutan presentasi (`## Slide N: judul`), poin bertingkat, tabel, data grafik, SmartArt, deskripsi gambar, **catatan pembicara**. |
| Markdown / teks | `.md`, `.markdown`, `.txt` | Apa adanya (UTF-8, UTF-16 dengan atau tanpa BOM, atau Windows-1252 dari ekspor lama). |

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
  didukung - simpan ulang sebagai .docx/.xlsx/.pptx atau PDF. File PDF/Word/Excel/PowerPoint yang diberi ekstensi lain
  yang didukung (mis. `.docx` bernama `.xlsx`) dibaca sesuai isinya; file berekstensi `.doc/.xls/.ppt` selalu ditolak.
- Teks hasil baca maksimal **2 juta karakter** per dokumen dan sel tabel maksimal 2.000 karakter; bagian yang terpotong
  selalu disebutkan di peringatan.

**Keamanan & penyimpanan.** Dokumen dibaca di *worker thread* terpisah dengan batas waktu ±95 detik dan batas memori
±1 GB per dokumen (heap dan buffer dipantau dari luar, juga bila `NODE_OPTIONS` menaikkan batas heap; dokumen yang
melewatinya dihentikan dengan pesan "terlalu besar"), sehingga file bermasalah tidak bisa menghentikan server. Paket Office
dibuka dengan pembaca ZIP yang membatasi ukuran hasil dekompresi (*zip bomb* ditolak), setiap XML diperiksa dalam waktu
linear sebelum dibaca, XML tidak pernah memuat entitas/sumber eksternal, dan makro tidak pernah dijalankan.
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
| | `<nama>.docx` | **Dokumen Word untuk diserahkan ke klien** (A4): halaman sampul, kontrol dokumen, riwayat revisi, lembar persetujuan (tanda tangan reviewer/penyetuju, bila diisi), daftar isi bernomor halaman, header/footer "Halaman X dari Y", tabel, dan diagram sebagai gambar bernomor - vektor (SVG) dengan cadangan PNG untuk aplikasi yang belum mendukung SVG (mis. Word 2013 ke bawah); diagram dan tabel yang lebar mendapat halaman lanskap sendiri agar teksnya tetap terbaca. Nomor halaman daftar isi sudah terisi saat dibuka tetapi berupa perkiraan (pada dokumen panjang bisa meleset satu halaman; *Update Table* di Word memberi nomor pasti). Dokumen dibuat di *worker thread* terpisah dengan batas waktu dan memori, sehingga TSD yang panjang tidak membuat server atau aplikasi desktop macet. Format memakai style bernama Word (Title, Heading 1-3, Caption, TOC, Table Grid, ...) sehingga bisa diganti dengan template perusahaan. TSD yang dibuat sebelum ada file Word: tombol **Buat Word (.docx)** di daftar artefak atau `POST /api/artifacts/<id>/docx` (id artefak mana pun dari paket TSD, lihat [docs/API.md](docs/API.md#artefak)). |

Contoh output generator:

| ArchiMate Layered View | Sequence diagram |
|---|---|
| ![ArchiMate](docs/images/sample-archimate-layered.png) | ![Sequence](docs/images/sample-sequence.png) |

## Model AI: multi-provider & cadangan

SOLAR tidak terikat ke satu LLM. Buka **Pengaturan → Model AI**:

- **Provider**: tambah sebanyak yang Anda punya akses. Jenis API:
  - *Chat Completions (OpenAI-compatible)* - OmniRoute, OpenRouter, LiteLLM, OpenAI, Anthropic Claude
    (`https://api.anthropic.com/v1`), Google Gemini (`https://generativelanguage.googleapis.com/v1beta/openai`),
    Ollama (`http://localhost:11434/v1`), vLLM, LM Studio. Tombol preset mengisi base URL.
  - *OpenAI Responses API* - OpenAI atau gateway yang mendukung Responses API (reasoning terenkripsi dibawa antar giliran).
- **API key** boleh ditulis langsung (disimpan di `data/llm.json`, ditampilkan tersamar) atau sebagai referensi
  `${NAMA_VARIABEL}` ke `.env`. Model lokal tanpa key cukup diisi base URL.
- **Model** per provider (opsional) dengan opsi `max=` (batas output), `reasoning`, `effort=`, `price=input/cached/output`
  untuk estimasi biaya (isi `0/0/0` untuk model lokal). **Tes koneksi** menampilkan daftar model dari endpoint `/models`.
- **Rute default**: daftar `provider/model` berurutan - yang pertama model utama, sisanya cadangan. Bila model utama gagal
  (koneksi, kuota, rate limit, key salah, model tidak ada, respons terputus), task otomatis berlanjut di model berikutnya
  dan monitor mencatat peralihannya. Perubahan berlaku untuk task berikutnya tanpa restart.

Tanpa pengaturan apa pun, SOLAR memakai provider `openai` dari `.env` (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `SOLAR_MODEL`)
persis seperti sebelumnya.

## Knowledge base

Knowledge base menyimpan **aturan dan fakta milik Anda** sebagai file Markdown, misalnya `systems/AD1GATE.md`,
`systems/ESB.md`, `integrations/API.md`, `integrations/OGG.md`, `standards/ARCHIMATE.md`,
`standards/api-specification.md`. Kelola di **Pengaturan → Knowledge**; file disimpan di `data/knowledge/`
(atau `KNOWLEDGE_DIR`). Panduan struktur dan template ada di [`knowledge/`](knowledge/README.md).

Cara agent memakainya:
- Daftar file (path, jenis, judul, alias, status) ada di system prompt; file sistem/integrasi yang namanya atau aliasnya
  muncul di permintaan atau nama dokumen disodorkan otomatis (`<knowledge_matches>`).
- Tool `list_knowledge`, `search_knowledge`, `read_knowledge` - agent hanya membaca file yang relevan.
- Tool `save_knowledge` (buat/ubah file) dan `import_artifact_to_knowledge` (simpan artefak Markdown, mis. `.md` dari TSD,
  sebagai knowledge) - dipakai hanya bila Anda memintanya, dan **setiap penulisan menunggu persetujuan Anda**. File yang
  sudah ada tidak pernah ditimpa tanpa diminta. Artefak hasil task bukan knowledge sampai disimpan dengan cara ini.
- Isi knowledge mengalahkan aturan bawaan dan skill. Sistem tanpa file tidak dikarang: dicatat sebagai asumsi/open issue,
  dan di akhir jawaban agent menyebut sistem/API yang belum terdaftar.
- Item berstatus `sunset`/`retired`/`deprecated` hanya muncul di kondisi as-is dan migrasi, tidak dipakai untuk solusi baru.

Impor:
- **Artefak Markdown** - tombol buku di samping file `.md` pada daftar artefak (chat atau Monitor) → pilih jenis
  (mis. *Sistem* → `systems/AD1GATE.md`), ID, judul dan alias → **Simpan**. ID artefak dicatat sebagai `source`.
- **File .md / folder** - struktur folder dipertahankan.
- **Excel/CSV registry** (daftar sistem, API, kontrak) - pilih sheet, kolom ID, nama, status dan alias; setiap baris menjadi
  satu file plus `INDEX.md`. Impor ulang memperbarui baris yang berubah dan (opsional) menghapus file baris yang sudah tidak ada.
- **Dokumen Word/PDF/PowerPoint/Markdown** - disimpan utuh atau dipecah per bab (heading), agar agent cukup membaca bab yang relevan.
  PDF hasil scan (gambar) dan isi diagram tidak terbaca.

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
| `guardrail` | Aturan Anda sendiri (`guardrail.md`): agent jadi *thinking partner* yang jujur tanpa basa-basi. Tanpa pujian pembuka, asumsi yang patah disebut sebelum deliverable, permintaan pendapat/review/keputusan dijawab dengan enam langkah, dan setiap jawaban ditutup dengan satu pertanyaan yang Anda hindari. Nonaktifkan skill ini untuk mematikan seluruh guardrail. |

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

- **KPI**: total task, sedang berjalan, menunggu persetujuan, selesai, gagal/batal, estimasi biaya API.
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

- Setiap pengguna masuk dengan akunnya sendiri; izin mengikuti peran (Superadmin, Head of IT Solar, Staf Solar) dan
  diperiksa di server untuk setiap permintaan. Password di-hash dengan scrypt; sesi berupa cookie HttpOnly yang hanya
  disimpan sebagai hash; login, pendaftaran dan setup dibatasi jumlah percobaannya; perubahan data dari browser hanya
  diterima dari origin SOLAR sendiri (CSRF). Superadmin pertama di server yang terbuka di jaringan tidak bisa "diklaim"
  tanpa kode penyiapan, `SOLAR_ADMIN_*` atau token. Semua tindakan penting tercatat di log aktivitas. Lihat
  [Akun, login & peran](#akun-login--peran).
- Server default hanya mendengarkan `127.0.0.1`. Untuk akses jaringan set `HOST=0.0.0.0` **dan** `SOLAR_ACCESS_TOKEN`.
- Tanpa `SOLAR_ACCESS_TOKEN`, API hanya melayani permintaan dengan Host/Origin lokal (`127.0.0.1`, `localhost`, `[::1]`); halaman web lain tidak bisa memakai API lewat *DNS rebinding* (mis. menambah plugin stdio).
- Rahasia hanya di `.env`; nilai rahasia literal di konfigurasi plugin disamarkan saat dikirim ke browser.
- Artefak disajikan dengan `Content-Security-Policy: sandbox` dan pratinjau HTML di iframe sandbox - dokumen hasil AI
  tidak dapat menjalankan script. Markdown dirender dengan sanitasi (DOMPurify / HTML mentah di-escape).
- Path file skill/artefak dibatasi dari path traversal. Izin mikrofon desktop dan kode penyiapan superadmin pertama
  (diisi otomatis di aplikasi desktop) hanya untuk UI SOLAR sendiri di jendela aplikasi.
- Tool yang mengubah sistem eksternal hanya dipakai bila diminta; kebijakan konfirmasi bisa diperketat per plugin.

## Struktur repository

```text
solar/
├─ apps/
│  ├─ server/        Node.js + Express: agent loop, lapisan LLM multi-provider (src/llm), knowledge base
│  │                 (src/knowledge), task manager, generator & validator, pembaca dokumen (src/documents),
│  │                 skills, plugin MCP, storage Neon/S3/lokal, pesan ID/EN (src/i18n.ts + src/i18n/),
│  │                 REST + SSE  (test: vitest)
│  ├─ web/           React + Vite + TypeScript + GSAP + three.js: karakter 3D, chat, suara, monitor, pengaturan;
│  │                 teks antarmuka ID/EN (src/i18n/{id,en}/, src/lib/i18n.ts);
│  │                 PWA: public/manifest.webmanifest (+ manifest.en.webmanifest), pwa/ (service worker +
│  │                 plugin build), public/favicon.svg (sumber semua ikon aplikasi)
│  └─ desktop/       Electron: menjalankan server + UI sebagai aplikasi Windows (installer NSIS);
│                    menu & dialog ID/EN (src/i18n.ts); preload solarDesktop (bahasa, kode penyiapan)
├─ packages/shared/  Tipe TypeScript bersama (Task, Event, Artifact, Plugin, Skill, ...), peran & izin
│                    (ROLE_PERMISSIONS, ROLE_INFO, can()), akun, log aktivitas
├─ skills/           Skill bawaan (SKILL.md)
├─ knowledge/        Panduan & template knowledge base (README, _templates/)
├─ config/           plugins.default.json (preset GitHub, Plane, Visual Paradigm)
├─ docs/             ARCHITECTURE.md, API.md, SELF-HOSTING.md, schema.sql (skema Postgres), gambar
├─ scripts/          generate-archimate-relationships.mjs (regenerasi tabel relasi dari Archi),
│                    generate-icons.mjs (ikon PNG aplikasi/PWA/installer dari apps/web/public/favicon.svg),
│                    pack-server.mjs (paket server + web app untuk rilis),
│                    third-party-licenses.mjs (teks lisensi paket yang ikut di-bundle, untuk rilis)
└─ .env.example      Template konfigurasi
```

## Pengembangan & pengujian

```bash
npm run typecheck   # TypeScript semua workspace
npm test            # unit + end-to-end agent (model tiruan) - tidak memanggil API berbayar
npm run build       # build web + server
npm run check       # ketiganya sekaligus
npm run -s db:schema > schema.sql   # skema Postgres lengkap (sama dengan docs/schema.sql; -- --json = array pernyataan)
```

Pengujian opsional tambahan:

```bash
# validasi XML ArchiMate terhadap XSD resmi Open Group (butuh xmllint + file XSD dalam satu folder)
ARCHIMATE_XSD_DIR=/path/ke/xsd npm test

# jalankan skenario end-to-end terhadap Postgres/Neon (tabel solar_* di database tersebut akan DIHAPUS lalu dibuat ulang)
SOLAR_TEST_DATABASE_URL="postgresql://user:pass@host/db_test?sslmode=require" npm test

# akun, sesi, peran (tabel solar_roles + foreign key) dan log aktivitas di Postgres (juga database yang boleh dihapus)
SOLAR_TEST_AUTH_DATABASE_URL="postgresql://user:pass@host/db_auth_test?sslmode=require" npm test
```

Yang sudah diuji otomatis: validator & renderer ArchiMate/sequence/TSD (termasuk dokumen Word TSD yang dibaca ulang,
rasterisasi diagram ke PNG dan `POST /api/artifacts/:id/docx`), store skill & plugin (termasuk penyamaran rahasia),
round-trip object storage S3-compatible, skenario agent end-to-end (model tiruan) dengan konfirmasi, pembuatan
12 artefak (termasuk `.docx`), ZIP, header keamanan, dan riwayat percakapan append-only, serta pembacaan lampiran dari
dokumen nyata (`apps/server/test/fixtures/documents`: Word, PowerPoint, Excel, PDF, file terenkripsi & format lama) termasuk
zip bomb, PDF hasil scan, file rusak, ekstensi yang salah, API unggah dan tool dokumen agent.

### Rilis

Workflow **Desktop installer (Windows)** membuat installer Windows dan paket server + web app, lalu menerbitkan
GitHub Release berisi keduanya:

1. Samakan versi di `package.json`, `packages/shared`, `apps/server`, `apps/web`, `apps/desktop`, dependency
   `"@solar/shared"` di `apps/server/package.json` dan `apps/web/package.json`, dan `APP_VERSION` di
   `apps/server/src/config.ts` (workflow menolak versi yang tidak sama). Jalankan
   `npm install --package-lock-only --ignore-scripts` agar `package-lock.json` ikut diperbarui, lalu merge ke `main`.
2. Push tag `v<versi>` (mis. `git tag v1.0.0 && git push origin v1.0.0`), **atau** *Actions → Desktop installer
   (Windows) → Run workflow* dari `main` dengan **release** dicentang - tag dibuat otomatis pada commit tersebut.

Tanpa tag/centang, workflow hanya menyimpan installer dan zip sebagai artifact (untuk uji coba).

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
| Langkah/status task lama tetap dalam bahasa sebelumnya | Disengaja: teks sebuah task ditulis dalam bahasa antarmuka saat task dibuat. Task baru memakai bahasa yang sedang dipilih. |
| Agent menjawab dalam bahasa yang tidak diharapkan | Agent mengikuti bahasa tulisan permintaan Anda (bahasa antarmuka hanya bila tidak jelas). Sebutkan bahasanya di permintaan, mis. *"jawab dalam bahasa Inggris"*. |
| Lupa password | Minta Superadmin mereset password Anda (Head of IT Solar tidak bisa); semua sesi lama berakhir. Masuk dengan password sementara itu lalu langsung ganti. SOLAR tidak punya reset lewat email. |
| Tidak ada superadmin yang bisa masuk | `SOLAR_ADMIN_*` tidak membantu (hanya dipakai bila belum ada akun sama sekali). Pulihkan dengan token API: [Pemulihan bila tidak ada superadmin yang bisa masuk](#pemulihan-bila-tidak-ada-superadmin-yang-bisa-masuk). Jangan menghapus `data/users.json` / tabel `solar_users`. |
| Login ditolak: akun menunggu persetujuan (`account_pending`) | Pendaftaran Anda belum disetujui: minta Superadmin atau Head of IT Solar menyetujuinya. |
| Login ditolak: akun dinonaktifkan (`account_disabled`) | Minta Superadmin (atau Head of IT Solar, untuk akun Staf Solar) mengaktifkannya lagi. |
| Terlalu banyak percobaan (`429 rate_limited`) | Tunggu sesuai waktu yang ditampilkan (login: paling lama 15 menit). Di balik reverse proxy set `TRUST_PROXY`, agar batas dihitung per pengguna, bukan per proxy. |
| Membuat superadmin pertama ditolak (`setup_code_invalid` / `setup_forbidden`) | Pakai kode dari start server **terakhir** (log server atau `data/setup-code.txt`; desktop: terisi otomatis atau menu *Bantuan → Kode penyiapan superadmin pertama…*) dan buka SOLAR di komputer server itu sendiri (`http://127.0.0.1:8790`). Lewat jaringan, reverse proxy, atau selama `TRUST_PROXY` di-set, cara ini selalu ditolak: pakai `SOLAR_ADMIN_*` atau token API. |
| Pendaftaran ditolak "ditutup" (`registration_closed`) | Belum ada superadmin: buat superadmin pertama dulu. |
| Server gagal start setelah mengisi `SOLAR_ADMIN_*` | Nilainya tidak valid (mis. password kurang dari 10 karakter, username tidak valid, password sama dengan username/email): perbaiki, atau kosongkan ketiganya. |
| Skrip mendapat `401 invalid_token` | Token tidak sama dengan `SOLAR_ACCESS_TOKEN` di `.env` server (mungkin sudah diganti). |
| Tiba-tiba harus masuk lagi | Sesi habis (`SESSION_TTL_HOURS` tanpa dipakai atau `SESSION_MAX_DAYS` sejak masuk), password diganti dari perangkat lain, atau admin mengubah peran / mereset password / menonaktifkan akun. |
| Staf tidak melihat task lama | Disengaja: Staf Solar hanya melihat task-nya sendiri, dan task dari sebelum ada akun (tanpa pemilik) hanya terlihat oleh Superadmin dan Head of IT Solar. |
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
