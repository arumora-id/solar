# Deployment SOLAR ke VPS dengan Docker Compose

Dokumen ini adalah **runbook operator** untuk instalasi SOLAR dengan konfigurasi Docker
Compose terpisah: satu file utama untuk container/network/mount, dan satu override
untuk membangun image dari source. Sesuaikan nama file/direktori dengan lingkungan.
**Jangan menaruh IP privat, path internal, nama jaringan internal, atau kredensial VPS
di repository publik.** Simpan inventaris lingkungan sebenarnya di dokumentasi
operasional privat.

## Release gate

**Jangan deploy hanya karena HTTP 200 atau CI hijau.** Semua syarat berikut wajib:

1. PR fitur sudah di-review secara independen, disetujui, dan di-merge ke `main`.
2. CI di commit final sukses: typecheck, test, build, browser responsive smoke,
   packaging Windows, dan bundling server. Test yang skipped belum diverifikasi.
3. QA manual/staging alur nyata sukses: login, task streaming, approval,
   lampiran, riwayat chat panjang, karakter/mikrofon, Monitoring, dan Electron Windows.
4. GitHub Release dan tag semver baru merujuk ke commit yang sama dengan kode
   yang telah disetujui. Gunakan versi dari `package.json` dan pastikan tag
   serta Release yang sesuai sudah terbit sebelum VPS diperbarui; jangan
   menggunakan ulang tag release sebelumnya.
5. Operator telah menyiapkan window maintenance, backup konsisten dan rollback,
   serta memverifikasi source repo dan konfigurasi deployment yang sebenarnya.

GitHub Release menerbitkan installer Windows dan paket server self-hosted.
**GitHub Release bukan deployment VPS**: Docker image pada VPS harus diperbarui
melalui prosedur operator atau automation terverifikasi secara terpisah.

## Arsitektur dan preflight

Pada pola ini, Docker Compose biasanya mendefinisikan:

- service SOLAR, image yang dibangun lokal, kebijakan restart, dan Docker network
  yang juga diakses reverse proxy HTTPS
- bind mounts menuju konfigurasi rahasia dan direktori data persisten
- override `build.context` ke direktori checkout source serta Dockerfile lokal

Nama logical network Compose bisa berbeda dari nama aktual Docker network. Periksa
pemetaan; tidak adanya published port host **normal** jika reverse proxy berjalan
di network Docker yang sama. HTTP 200 dari HTTPS membuktikan jalur awal merespons,
**bukan** versi UI yang benar, kesehatan backend, ataupun fungsi agent.

Gunakan nama path aktual dari inventaris operasional privat. Contoh pemeriksaan
berikut mengasumsikan dua file Compose yang telah disebut; sesuaikan bila berbeda.

```bash
# Isi DEPLOY_DIR dan SOURCE_DIR dari inventaris privat sebelum menjalankan.
: "${DEPLOY_DIR:?set DEPLOY_DIR}"
: "${SOURCE_DIR:?set SOURCE_DIR}"

cd "$DEPLOY_DIR" || exit 1
docker compose -f compose.vps.yml -f compose.source.yml config --services
git -C "$SOURCE_DIR" status --short
git -C "$SOURCE_DIR" rev-parse HEAD
```

**Jangan memublikasikan** keluaran `docker compose config` atau
`docker inspect` JSON penuh: keduanya dapat mengandung nilai environment
rahasia. Gunakan `docker inspect --format` yang hanya memilih metadata aman.

Jika Dockerfile memakai `COPY . .`, periksa `.dockerignore` sebelum build:
harus mengecualikan `.env`, credential, `.git`, file backup, dan direktori data
agar rahasia tidak ikut tersalin ke image. Dockerfile dan ignore file yang
**untracked** adalah aset deployment lokal: backup, jangan `git clean -fd`,
`git reset --hard` atau memaksa checkout yang akan menimpa file tersebut.

## Rencana backup dan cutover (operator setelah gate lulus)

1. Identifikasi SHA commit/tag rilis, source commit saat ini, container,
   **image ID lama** (`docker inspect <container> --format '{{.Image}}'`),
   image tag efektif Compose, mount, network, dan health.
2. Amankan file Compose, Dockerfile, `.dockerignore` yang dipakai, serta
   konfigurasi `.env` pada backup terlindungi dengan izin khusus operator.
3. **Sebelum build**, simpan image lama dengan tag rollback yang berbeda
   dari image target build, menggunakan image ID yang sudah diverifikasi.
   Jangan memakai tag mutable target sebagai satu-satunya salinan image lama.
4. Ambil backup konsisten file persisten setelah menghentikan/menuntaskan task
   yang masih menulis. Jika ada Postgres/Neon atau S3, buat snapshot eksternal
   yang juga dapat dipulihkan. Backup direktori lokal saja tidak cukup.
5. Di checkout source, `git fetch --tags`; periksa `git status`; checkout tag
   release **tanpa** menghapus/mengubah file lokal deployment. Pastikan
   `git rev-parse HEAD` sama dengan commit rilis. Hentikan operasi jika
   checkout menolak karena konflik.
6. Periksa build context dan `.dockerignore` kembali. Build dulu **tanpa
   cutover** menggunakan `docker compose -f <base> -f <override> build <service>`.
   Periksa image ID baru dan kegagalan build sebelum mengganti service.
7. Saat maintenance window dan backup selesai, ganti container dari image
   yang telah dibangun menggunakan
   `docker compose -f <base> -f <override> up -d --no-build --force-recreate <service>`.
   Jangan lakukan `down -v`, `docker volume prune` atau menghapus bind mount.
8. Verifikasi image ID baru, status `healthy`, routing HTTPS, login,
   Conversation/Monitoring, task streaming, approval, sesi, dan artefak lama.
   Catat timestamp, SHA, hasil smoke test serta bukti perubahan.

## Rollback dan risiko state

Jika acceptance gagal, **hentikan deployment dan rollback**:

1. Pastikan tag rollback immutable tadi masih mengarah ke image ID lama.
2. Re-tag image lama ke tag kerja yang digunakan service Compose, kemudian
   jalankan `docker compose ... up -d --no-build --force-recreate <service>`.
   Jangan membangun ulang saat rollback.
3. Periksa kesehatan, routing HTTPS, login, dan persistensi data.
4. Jangan otomatis memulihkan snapshot database lama atau menurunkan skema
   tanpa menilai perubahan migrasi dan kemungkinan data baru masuk.

**Rencana ini belum merupakan rollback teruji** sampai operator berhasil
melakukan dry-run di staging dengan konfigurasi sepadan. Izin file `.env`
sebaiknya minimum yang diperlukan (umumnya 600) setelah memverifikasi UID
proses dan apakah ada proses lain yang benar-benar membutuhkan group-read.

## Pengujian Windows

Build NSIS `.exe` pada CI memeriksa packaging, bukan bahwa aplikasi pasti
berjalan di Windows. Sebelum GitHub Release umum, buka installer di perangkat
Windows uji, verifikasi startup server lokal, login, fitur Conversation dan
Monitoring, dan preservasi pengaturan saat upgrade.
