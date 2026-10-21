# Deploy SOLAR AI AGENT v1.0.10 ke VPS

**Tujuan:** deploy source persis GitHub Release **v1.0.10**, tanpa mengambil perubahan `main` sesudah rilis, tanpa mengganti `.env`, dan tanpa menimpa data production.

- Release: https://github.com/arumora-id/solar/releases/tag/v1.0.10
- SHA tag terverifikasi: `566a2b0d65569401491946103dafb8768fc3d062`
- Script: `scripts/deploy-v1.0.10-vps.sh`
- Panduan dan aturan gate keseluruhan: [VPS_DEPLOYMENT.md](VPS_DEPLOYMENT.md)

> Script **tidak deploy otomatis**. Operator harus menjalankannya secara eksplisit dalam maintenance window setelah QA, approval, serta backup database dan object storage yang dapat dipulihkan.

## 1. Sumber rilis dan Compose

Gunakan **checkout terpisah** untuk kode v1.0.10. Jangan mengubah `main` yang mungkin berisi commit setelah tag.

```bash
# Contoh variabel lokal; ganti dengan direktori nyata dari inventaris privat.
export RELEASE_SOURCE="/path/to/solar-release-v1.0.10"
export PROD_DIR="/path/to/solar-production"
export OPS_REPO="/path/to/solar-ops-repository"

git clone --branch v1.0.10 --single-branch \
  https://github.com/arumora-id/solar.git "$RELEASE_SOURCE"
git -C "$RELEASE_SOURCE" rev-parse HEAD
# HARUS: 566a2b0d65569401491946103dafb8768fc3d062
```

`OPS_REPO` adalah checkout terbaru repository SOLAR yang sudah memiliki script `deploy-v1.0.10-vps.sh`. Script boleh berada di luar checkout tag, karena menerima `SOURCE_DIR` eksplisit.

Docker Compose production **harus sudah** menunjuk build context service ke `RELEASE_SOURCE` dan mempertahankan mount `.env` serta `data` production. Evaluasi file `compose.vps.yml` dan `compose.source.yml` secara privat. Backup konfigurasi asli secara terpisah sebelum mengubah overlay. Script akan menolak build context atau mount yang tidak sesuai, dan tidak mengeditnya otomatis. Jangan cetak `docker compose config` lengkap ke log publik karena berpotensi memuat secrets.

## 2. Pemeriksaan tanpa deploy

```bash
SOURCE_DIR="$RELEASE_SOURCE" PROD_DIR="$PROD_DIR" \
  bash "$OPS_REPO/scripts/deploy-v1.0.10-vps.sh" --preflight
```

Pemeriksaan: git origin resmi; tag lokal dan tag remote; SHA yang dipin; GitHub Release publik dengan installer dan ZIP server; versi root, workspaces, dan `APP_VERSION`; Compose service, build context, mount configuration/data; health versi aplikasi yang sedang aktif. Mode ini tidak menjalankan build atau mengganti container, namun dapat membuat file lock `.solar-deploy.lock` untuk serialisasi.

Jika salah satu pemeriksaan gagal, **hentikan proses** dan perbaiki penyebabnya. Jangan gunakan `git reset --hard`, `docker compose down -v`, atau menghapus volume untuk memaksa deployment.

## 3. Backup dan approval

Sebelum cutover, simpan dan uji pemulihan backup konsisten untuk **Neon/Postgres** dan **S3/object store** jika dipakai. Pastikan tidak ada task yang masih menulis saat mengambil snapshot konsisten, serta siapkan window maintenance. Backup lokal script berisi file konfigurasi dan salinan `data` best-effort saat service berjalan; salinan tersebut **bukan** pengganti snapshot database atau object store.

Setelah mendapat approval perubahan dan mengonfirmasi backup eksternal:

```bash
SOURCE_DIR="$RELEASE_SOURCE" PROD_DIR="$PROD_DIR" \
  DEPLOY_APPROVED=YES BACKUP_CONFIRMED=YES \
  bash "$OPS_REPO/scripts/deploy-v1.0.10-vps.sh" --deploy
```

Proses deploy membuat checkpoint di `$PROD_DIR/.solar-deploy-backups/release-*`, melindungi image sebelumnya dengan rollback tag tersendiri, membangun source tag, melakukan `compose up -d --no-deps --no-build --force-recreate`, lalu memeriksa mount dan endpoint internal `/api/health` agar mengembalikan **1.0.10**. Jika cutover gagal, script mencoba rollback image otomatis. Data persisten tidak pernah dipulihkan otomatis.

## 4. Verifikasi dan rollback

Lakukan smoke test HTTPS, login, Conversation fullscreen dan preview artefak (SVG/HTML/Markdown/XML), task streaming, approval, Monitoring, serta output `.drawio` dan `.puml`. Pastikan task dan dokumen lama tetap ada. Periksa juga `docker compose ps` dan log service secara privat.

Jika masalah muncul setelah deploy dan diperlukan rollback manual, gunakan checkpoint yang dicetak saat deployment:

```bash
PROD_DIR="$PROD_DIR" \
  CHECKPOINT="$PROD_DIR/.solar-deploy-backups/release-YYYYMMDDTHHMMSSZ-XXXXXX" \
  ROLLBACK_APPROVED=YES \
  bash "$RELEASE_SOURCE/scripts/rollback-conversation-proposals-vps.sh"
```

Jangan jalankan downgrade skema atau restore database lama tanpa menilai data yang masuk sejak deployment. Catat commit, image ID sebelumnya/baru, hasil health check, waktu cutover, dan hasil acceptance.

## Ruang lingkup

Script ini khusus Docker Compose production VPS dengan file `compose.vps.yml` dan `compose.source.yml`, `.env` dipasang di `/app/.env`, dan data di `/app/data`. Jika setup VPS berbeda (systemd, Kubernetes, docker image remote, atau susunan mount lain), jangan gunakan script tanpa review dan adaptasi yang relevan. **GitHub Release tidak berarti VPS sudah dideploy.**
