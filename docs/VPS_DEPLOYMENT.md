# Deployment SOLAR AI AGENT ke VPS (Docker Compose)

Dokumen ini menjelaskan **topologi VPS yang dilaporkan operator pada 14 Oktober 2026**,
bukan instruksi deployment universal. Perintah yang bertanda deployment/rollback **tidak
boleh dijalankan** sebelum release gate, backup, dan jadwal pemeliharaan disetujui.

## Topologi yang sudah diverifikasi dari output operator

| Elemen | Nilai |
|---|---|
| Domain | `https://solar.mesthi.com/` (HTTP 200 saat diperiksa; bukan verifikasi versi aplikasi) |
| Compose project / service | `solar` / `solar` |
| Container | `solar-app` |
| Image | `mesthi/solar:local` (tag mutable, **bukan** version pin) |
| Compose files di VPS | `/home/ubuntu/ai-project/solar/compose.vps.yml` dan `compose.source.yml` |
| Build context | `/home/ubuntu/ai-project/solar-source` |
| Dockerfile | `Dockerfile.vps` di source |
| Compose network logical | `nginx`, nama nyata `ai-engineer_default` |
| Akses publik | Melalui container reverse-proxy `nginx` di jaringan yang sama; service tidak publish port host |
| Mount permanen | `/home/ubuntu/ai-project/solar/.env:/app/.env` dan `data:/app/data` |
| Runtime | UID 1000 (`node`), restart `unless-stopped` |

Di direktori `solar-source`, `.dockerignore` dan `Dockerfile.vps` **untracked** pada
saat diperiksa. Keduanya adalah bagian deployment lokal yang harus dipertahankan.
Jangan jalankan `git clean -fd`, `git reset --hard`, atau menghapus source directory
tanpa mengetahui seluruh perubahan dan backup. Image `mesthi/solar:local` bisa
ditimpa saat build; simpan image ID dan tag rollback **sebelum** build.

## Release gate (wajib sebelum perubahan produksi)

1. PR fitur telah disetujui reviewer independen dan digabung ke `main` **setelah**
   seluruh review dan QA diselesaikan.
2. CI pada **commit final** lulus: typecheck, unit/integration, build,
   Chromium UI dan paket installer Windows. Test skipped bukan test passed.
3. QA alur yang tidak tercakup CI dilakukan di lingkungan aman: task nyata,
   login, streaming, persetujuan, lampiran, riwayat panjang, dan aplikasi Electron
   di Windows. Jangan gunakan task produksi yang berisiko untuk pengujian.
4. Tag versi baru dan GitHub Release mengarah pada commit main yang disetujui.
   Pastikan tag `v1.0.1` memang telah dipublikasikan, bukan mengasumsikannya.
5. Pastikan sumber `solar-source` dapat dibangun dan `Dockerfile.vps` beserta
   `.dockerignore` cocok dengan aplikasi pada tag tersebut.
   Karena Dockerfile memakai `COPY . .`, pastikan `.dockerignore` menyingkirkan
   `.env`, kredensial, `.git`, direktori data, dan berkas sensitif dari build context.
6. Tentukan window maintenance/drain task, kesiapan backup data **yang konsisten**,
   termasuk snapshot Neon/Postgres atau S3 apabila layanan tersebut dipakai.
   Backup folder `data` saja tidak melindungi database eksternal.
7. Review pemetaan trafik nginx, izin secret, kapasitas VPS, rencana rollback,
   dan smoke test sesudah deploy dengan operator.

## Pemeriksaan read-only sebelum cutover

```bash
cd /home/ubuntu/ai-project/solar || exit 1

docker compose -f compose.vps.yml -f compose.source.yml config --services
docker inspect solar-app --format \
  'State={{.State.Status}} ImageID={{.Image}} Restart={{.HostConfig.RestartPolicy.Name}}'
docker inspect solar-app --format \
  '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
docker network inspect ai-engineer_default \
  --format '{{range .Containers}}{{println .Name}}{{end}}'
git -C /home/ubuntu/ai-project/solar-source status --short
git -C /home/ubuntu/ai-project/solar-source rev-parse HEAD
curl -sS -o /dev/null --max-time 15 -w 'HTTP %{http_code}\n' \
  https://solar.mesthi.com/
```

Jangan tampilkan `docker inspect` JSON penuh atau `docker compose config` lengkap:
keduanya dapat memuat kredensial dari environment. Pada 14 Oktober, host `.env`
berizin `664`; UID host dan container sama-sama 1000 dan uji baca sebagai
`node` berhasil. Evaluasi pembatasan ke `600` setelah memastikan tidak ada
proses lain yang memerlukan group-read. Jangan mempublikasikan isi `.env`.

## Prosedur operator setelah semua gate lulus

1. **Kunci identitas artefak**: catat SHA commit/tag GitHub, SHA source VPS,
   Docker image ID saat ini, dan hasil pemeriksaan HTTPS/health. Tidak boleh
   ada perubahan source lain di tengah prosedur.
2. **Amankan konfigurasi lokal**: backup `compose.vps.yml`,
   `compose.source.yml`, `Dockerfile.vps`, dan `.dockerignore` dengan
   mempertahankan permissions; simpan di lokasi hanya dapat diakses operator.
   Pastikan Git worktree tidak berisi modifikasi tracked yang tidak diharapkan.
3. **Simpan image lama**: sebelum `docker compose build`, catat
   `docker inspect solar-app --format '{{.Image}}'` lalu buat tag rollback
   terpisah yang tidak digunakan untuk build, misalnya
   `docker image tag <OLD_IMAGE_ID> mesthi/solar:rollback-pre-v1.0.1`.
   Ganti placeholder dengan ID **nyata yang diperiksa**.
4. **Backup state**: hentikan/selesaikan task yang menulis data, ambil backup
   konsisten `.env` serta `data` dan, apabila dikonfigurasi, snapshot database
   dan object storage eksternal. Pastikan dapat dipulihkan tanpa menghapus akun.
5. **Sinkronisasi source terverifikasi**: pada `solar-source` fetch tag rilis
   yang sudah diterbitkan dan pindah ke commit tag secara aman tanpa menghapus
   `Dockerfile.vps` serta `.dockerignore` untracked. Hentikan proses jika
   checkout konflik atau status Git tidak sesuai; **jangan** paksa checkout.
6. **Build tanpa cutover** (baru setelah pemeriksaan Dockerfile dan ignore file):
   `docker compose -f compose.vps.yml -f compose.source.yml build solar`.
   Verifikasi hasil build dan image ID baru sebelum mengganti container.
7. **Cutover terkontrol** dalam maintenance window:
   `docker compose -f compose.vps.yml -f compose.source.yml up -d --no-build --force-recreate solar`.
   Perintah tersebut memakai konfigurasi dan mount yang telah diverifikasi;
   tidak menjalankan ulang build pada tahap cutover.
8. **Acceptance**: `docker inspect` menunjukkan image baru dan health
   `healthy`; `https://solar.mesthi.com/` bisa diakses. Periksa login,
   Conversation dan Monitoring penuh/responsif, sesi yang sudah ada, realtime
   task/stream, persetujuan, dan data/artifact lama. HTTP 200 **saja**
   tidak cukup. Simpan bukti hasil serta timestamp.
9. Jika acceptance gagal, **rollback segera** sesuai bagian berikut dan
   periksa log secara tersaring agar secret tidak terpapar.

## Rollback yang telah disiapkan, bukan diuji pada VPS ini

Gunakan hanya jika image lama sebelumnya telah ditandai dan datanya kompatibel:

```bash
cd /home/ubuntu/ai-project/solar || exit 1
docker image inspect mesthi/solar:rollback-pre-v1.0.1 >/dev/null || exit 1

# Kembalikan tag kerja ke image lama yang telah diamankan; tanpa build.
docker image tag mesthi/solar:rollback-pre-v1.0.1 mesthi/solar:local
docker compose -f compose.vps.yml -f compose.source.yml \
  up -d --no-build --force-recreate solar
```

Cek ulang image ID, health, HTTPS, login, task dan data setelah rollback.
**Jangan** otomatis memulihkan backup state lama ke database yang sudah
berubah, apalagi menjalankan downgrade skema, tanpa penilaian migrasi dan
integritas data. Prosedur rollback di atas masih memerlukan **dry-run pada
lingkungan staging** sebelum dianggap teruji.

## Catatan GitHub Release vs deployment VPS

Workflow `Desktop installer (Windows)` menghasilkan installer Windows (.exe)
dan ZIP server self-hosted serta dapat memublikasikan GitHub Release.
Workflow itu **tidak mengeksekusi** deployment Docker di VPS ini.
Installer Windows juga perlu QA peluncuran di perangkat Windows nyata;
lulus packaging tidak membuktikan keseluruhan pengalaman pengguna.
