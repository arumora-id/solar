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
`DATABASE_URL` / `S3_*` diisi).

## Memasang sebagai aplikasi (PWA)

- **Chrome / Edge (Windows, macOS, Linux, Android):** tombol **Pasang aplikasi** di bilah atas SOLAR, atau
  *Pengaturan -> Sistem -> Aplikasi*, atau menu browser -> *Instal SOLAR AI AGENT*.
- **iPhone / iPad (Safari):** Bagikan -> *Tambahkan ke Layar Utama*.

Aplikasi terpasang punya jendela dan ikon sendiri, dan tampilannya tetap terbuka saat server tidak terjangkau. Task dan
artefak tetap membutuhkan server. Versi baru dipasang otomatis; SOLAR menawarkan **Muat ulang** saat sudah siap.

Browser hanya mengizinkan pemasangan dari **HTTPS** atau dari **localhost**. Untuk perangkat lain di jaringan:

1. Di `.env`: `HOST=0.0.0.0` dan `SOLAR_ACCESS_TOKEN=<token acak yang panjang>` (wajib bila SOLAR terbuka ke jaringan).
2. Pasang reverse proxy HTTPS di depan port 8790, misalnya [Caddy](https://caddyserver.com):

   ```text
   solar.contoh.id {
     reverse_proxy 127.0.0.1:8790
   }
   ```

   Status task dikirim sebagai stream (`/api/stream`); Caddy dan nginx meneruskannya tanpa pengaturan tambahan.
3. Buka `https://solar.contoh.id`, masukkan token akses, lalu pasang aplikasinya.

## Memperbarui

Ekstrak paket versi baru ke folder baru, lalu salin `.env` dan folder `data/` dari folder lama. Aplikasi yang sudah
terpasang memperbarui dirinya sendiri saat dibuka berikutnya.
