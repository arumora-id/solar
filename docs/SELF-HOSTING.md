# SOLAR AI AGENT - server + web app (PWA)

Paket ini berisi server SOLAR AI AGENT yang sudah di-bundle (tanpa `npm install`) beserta web UI. Web UI bisa
dipasang sebagai aplikasi (Progressive Web App) di Windows, macOS, Linux, Android dan iPhone/iPad.

## Menjalankan

Butuh **Node.js 22** (≥ 22.12) - <https://nodejs.org>.

```bash
cp .env.example .env            # Windows PowerShell: Copy-Item .env.example .env
# isi minimal OPENAI_API_KEY di .env (atau atur provider lain nanti di Pengaturan -> Model AI)
npm start                       # sama dengan: node apps/server/dist/index.js
```

Buka <http://localhost:8790>. Task, artefak dan pengaturan disimpan di folder `data/` (atau Neon/S3 bila
`DATABASE_URL` / `S3_*` diisi; database harus Postgres 13 atau lebih baru, tabelnya dibuat otomatis saat start).

## Akun pertama & login

Setiap pengguna masuk dengan **username atau email** + password. Selama belum ada akun sama sekali, SOLAR meminta Anda
membuat **superadmin pertama** - pilih salah satu:

- **Kode penyiapan:** buka <http://127.0.0.1:8790> **di komputer server itu sendiri** dan masukkan kode sekali pakai
  `XXXX-XXXX-XXXX-XXXX` yang dicetak di log `npm start` (`First-superadmin setup code: …`) dan disimpan di
  `data/setup-code.txt`. Kode baru dibuat setiap start selama belum ada akun, dan hilang begitu superadmin pertama ada.
  Cara ini tidak bisa dipakai lewat jaringan, lewat reverse proxy, atau selama `TRUST_PROXY` di-set.
- **`.env`:** isi `SOLAR_ADMIN_USERNAME`, `SOLAR_ADMIN_EMAIL` dan `SOLAR_ADMIN_PASSWORD` (minimal 10 karakter; opsional
  `SOLAR_ADMIN_NAME`) sebelum start. Hanya dipakai bila belum ada akun; setelah masuk, ganti password lalu kosongkan
  `SOLAR_ADMIN_PASSWORD`. Cara ini yang paling mudah untuk server yang hanya bisa dibuka lewat jaringan.

Setelah itu pengguna lain **mendaftar sendiri** di layar masuk; akunnya (peran **Staf Solar**) menunggu persetujuan
**Superadmin** atau **Head of IT Solar**. Password yang terlupa direset oleh Superadmin (tidak ada reset lewat email).
Bila tidak ada superadmin yang bisa masuk lagi: isi `SOLAR_ACCESS_TOKEN`, restart, lalu reset password lewat API dari
komputer server (`POST /api/users/<id>/password` dengan header `Authorization: Bearer <token>`; daftar akun:
`GET /api/users`), masuk, ganti password, dan kosongkan token itu lagi bila tidak dipakai. Rincian peran, sesi, batas
percobaan dan log aktivitas: README dan `docs/API.md` di repository SOLAR.

## Memasang sebagai aplikasi (PWA)

- **Chrome / Edge (Windows, macOS, Linux, Android):** tombol **Pasang aplikasi** di bilah atas SOLAR, atau
  *Pengaturan -> Sistem -> Aplikasi*, atau menu browser -> *Instal SOLAR AI AGENT*.
- **iPhone / iPad (Safari):** Bagikan -> *Tambahkan ke Layar Utama*.

Aplikasi terpasang punya jendela dan ikon sendiri, dan tampilannya tetap terbuka saat server tidak terjangkau. Task dan
artefak tetap membutuhkan server. Versi baru dipasang otomatis; SOLAR menawarkan **Muat ulang** saat sudah siap.

Browser hanya mengizinkan pemasangan dari **HTTPS** atau dari **localhost**. Untuk perangkat lain di jaringan:

1. Di `.env`:
   - `SOLAR_ACCESS_TOKEN=<token acak yang panjang>` - wajib: tanpa token, API hanya melayani `127.0.0.1`/`localhost`
     dan menolak permintaan lewat proxy. Token ini untuk skrip/API saja; pengguna di browser masuk dengan akunnya.
     Buat dengan `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
   - `TRUST_PROXY=true` (satu proxy) - agar SOLAR memakai `X-Forwarded-For`/`-Proto`/`-Host` dari proxy: cookie login
     diberi `Secure`, dan batas percobaan login dihitung per alamat pengguna, bukan per proxy. Jangan di-set bila tidak
     ada proxy. Selama di-set, superadmin pertama dibuat lewat `SOLAR_ADMIN_*` (lihat di atas).
   - Biarkan `HOST` pada default `127.0.0.1` bila proxy berjalan di komputer yang sama, agar port 8790 tidak terbuka
     tanpa enkripsi di jaringan. Pakai `HOST=0.0.0.0` hanya bila proxy berada di mesin lain, dan batasi port 8790
     dengan firewall hanya untuk proxy tersebut.
2. Pasang reverse proxy HTTPS di depan port 8790, misalnya [Caddy](https://caddyserver.com):

   ```text
   solar.contoh.id {
     reverse_proxy 127.0.0.1:8790
   }
   ```

   Status task dikirim sebagai stream (`/api/stream`); Caddy dan nginx meneruskannya tanpa pengaturan tambahan. Caddy
   sudah mengirim `X-Forwarded-For`/`-Proto`/`-Host`; di nginx tambahkan `proxy_set_header Host $host;`,
   `X-Forwarded-For $proxy_add_x_forwarded_for;` dan `X-Forwarded-Proto $scheme;`.
3. Buka `https://solar.contoh.id`, masuk dengan akun Anda (atau daftar dan tunggu persetujuan), lalu pasang
   aplikasinya.

## Memperbarui

Ekstrak paket versi baru ke folder baru, lalu salin `.env` dan folder `data/` dari folder lama (akun, sesi dan log
aktivitas ada di `data/` bila `DATABASE_URL` kosong). Aplikasi yang sudah terpasang memperbarui dirinya sendiri saat
dibuka berikutnya.
