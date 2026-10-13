# REST API SOLAR

Base URL: `http://127.0.0.1:8790/api`. Semua body JSON, kecuali unggah lampiran (isi file mentah). Setiap endpoint
memerlukan pengguna yang **masuk** (cookie sesi `solar_session`, lihat [Autentikasi](#autentikasi--pengguna)) atau
`SOLAR_ACCESS_TOKEN` (header `Authorization: Bearer <token>`, atau query `?token=<token>` untuk SSE/unduhan) yang
bertindak sebagai superadmin. Publik (tanpa login): `GET /health`, `GET /auth/state`, `POST /auth/login`,
`POST /auth/register`, `POST /auth/setup`, `POST /auth/logout`, dan file web statis.
Pesan untuk manusia (`error`, peringatan, status) ditulis dalam Bahasa Indonesia atau English - lihat [Bahasa](#bahasa).
Error berupa `{ error, code? }`: `error` untuk ditampilkan, `code` (mis. `account_pending`) untuk logika klien.

## Bahasa

SOLAR menjawab dalam Bahasa Indonesia (`id`) atau English (`en`). Tanpa bahasa yang disebut, server memakai `id`.

**Bahasa sebuah permintaan** (pesan `error` API termasuk error validasi, error dan `warnings` unggah lampiran, hasil
impor knowledge, hasil tes koneksi provider, status plugin MCP, README di dalam ZIP), urutan prioritas:

1. header `X-Solar-Language: id | en` - web UI mengirimnya di setiap request, sesuai bahasa antarmuka;
2. query `?lang=id | en` - untuk yang tidak bisa mengirim header: `GET /stream` (EventSource) dan link unduhan
   (`/tasks/:id/artifacts.zip`, `/artifacts/:id/content?download=1`, `/attachments/:id/content`);
3. header `Accept-Language` (bahasa pertama yang dikenali menurut nilai `q`: `en…` → `en`; `id…`, `in…`, `ms…` → `id`);
4. selain itu `id`.

`warnings` sebuah lampiran ditulis sekali saat diunggah, dalam bahasa unggahan itu, dan disimpan bersama lampirannya.

**Bahasa sebuah task** (`Task.language`): dikirim di body `POST /tasks` (`"language": "en"`); bila tidak ada, bahasa
permintaannya (urutan di atas). Semua teks milik task ditulis dalam bahasa ini - `currentStep`, pesan event `status`,
`displayName` event `tool_call`, `summary` event `tool_result`, `displayName` dan `reason` sebuah `Confirmation`,
`error` task - karena `/stream` mengirim task yang sama ke semua klien, apa pun bahasa mereka. Task lama tanpa
`language` dianggap `id`. Agent menjawab dalam bahasa tulisan permintaan dan memakai `Task.language` bila itu tidak
jelas; TSD tanpa `language` eksplisit ditulis dalam `Task.language`.

Tidak diterjemahkan (data): isi knowledge base, skill, deskripsi plugin dari konfigurasi, isi artefak, teks pengguna.

## Autentikasi & pengguna

### Peran

| Izin (`Permission`) | `superadmin` | `head_of_it` (Head of IT Solar) | `staff` (Solar Staff) |
|---|:-:|:-:|:-:|
| `agent.use` - membuat task, unggah lampiran, artefak & persetujuan task **sendiri** | ✓ | ✓ | ✓ |
| `tasks.all` - melihat & bertindak atas task **semua** pengguna (event, artefak, lampiran, persetujuan, batal) | ✓ | ✓ | - |
| `users.view` - daftar akun, jumlah pendaftaran menunggu | ✓ | ✓ | - |
| `users.approve` - menyetujui pendaftaran | ✓ (peran apa pun) | ✓ (hanya sebagai `staff`) | - |
| `users.disable` - menonaktifkan / mengaktifkan akun | ✓ | ✓ (hanya akun `staff`) | - |
| `users.manage` - membuat akun, ubah peran & nama, reset password, hapus akun | ✓ | - | - |
| `knowledge.read` / `knowledge.write` - baca / tulis & impor knowledge base | ✓ | ✓ | ✓ |
| `skills.read` / `skills.manage` - baca / kelola skill | ✓ | ✓ | ✓ |
| `settings.manage` - provider & rute LLM, tes model, plugin MCP (termasuk membaca daftarnya), konfigurasi & token | ✓ | - | - |
| `activity.view_all` - log aktivitas **semua** pengguna, filter per pengguna, ekspor CSV | ✓ | ✓ | - |
| `activity.view_own` - log aktivitas **sendiri** | ✓ | ✓ | ✓ |

Tabelnya ada sekali, di `packages/shared` (`ROLE_PERMISSIONS`, `ROLE_INFO` untuk nama & deskripsi, `can(role,
permission)`, `canActOnUser`, `assignableRoles`) - server dan web memakai yang sama; dengan Postgres, isinya juga
disalin ke tabel `solar_roles` setiap server start (kode tetap acuannya, lihat [`GET /roles`](#peran-get-roles)). Aturan tambahan: tidak ada yang bisa mengubah peran,
menonaktifkan, mereset password (lewat admin) atau menghapus akunnya sendiri; superadmin aktif terakhir tidak bisa
dinonaktifkan, diturunkan perannya atau dihapus (`409 last_superadmin`). Peran dibaca ulang dari penyimpanan setiap
permintaan (cache 30 detik yang dikosongkan oleh setiap perubahan akun di server ini).

**Task milik siapa.** Task dan lampiran menyimpan `ownerId` (pembuat / pengunggah). `staff` hanya melihat miliknya
sendiri - di semua route (daftar, detail, event, artefak, isi & ZIP & `.docx` artefak, lampiran, persetujuan, batal)
dan di `/stream`. Task milik orang lain dijawab **404** (sama dengan id yang tidak ada, sehingga keberadaannya tidak
bocor); `POST /tasks/:id/cancel` menjawab **409** untuk keduanya (jawaban lama untuk id yang tidak dikenal). Task dari
sebelum ada akun (tanpa `ownerId`) hanya terlihat oleh `superadmin` dan `head_of_it`. Percakapan (`sessionId`) bersifat
per pengguna: riwayat percakapan dan dokumen yang dibaca agen hanya dari task pengguna yang sama. Agen juga hanya bisa
membaca / mem-publish / menyimpan ke knowledge artefak dari task yang boleh dilihat peminta. Untuk `tasks.all`, task di
daftar, detail dan pesan `task` di `/stream` membawa `owner`: `{ id, name, username, role, kind: "user" | "token",
deleted }` (`deleted: true` = akun sudah dihapus, `name` = "Pengguna terhapus"/"Deleted user"; `null` = task lama).
Task yang dibuat dengan `SOLAR_ACCESS_TOKEN` memiliki `ownerId: "system:access-token"`.

### Sesi & cookie

- Login membuat token acak 32 byte (base64url) yang dikirim sebagai cookie
  `solar_session=<token>; Path=/; Max-Age=<SESSION_MAX_DAYS>; HttpOnly; SameSite=Lax` (+ `; Secure` bila permintaan
  datang lewat HTTPS - langsung, atau `X-Forwarded-Proto: https` dari proxy yang dipercaya lewat `TRUST_PROXY`).
  Server hanya menyimpan SHA-256 token itu (+ pengguna, waktu dibuat/terakhir dipakai/kedaluwarsa, user agent, IP).
- Masa berlaku bergeser: habis setelah `SESSION_TTL_HOURS` (default 168 = 7 hari) tanpa dipakai, dan paling lama
  `SESSION_MAX_DAYS` (default 30) sejak login. Sesi kedaluwarsa dibersihkan tiap jam.
- Logout menghapus sesi itu. Ganti password sendiri mengakhiri sesi **lain** milik pengguna itu; reset password oleh
  admin, nonaktif, hapus akun dan perubahan peran mengakhiri **semua** sesinya. Login baru dari browser yang masih
  membawa cookie sesi yang sah mengakhiri sesi lama itu (cookie-nya diganti). Stream `/stream` sesi yang berakhir
  menerima `{ kind: "signed_out" }` lalu ditutup.
- **CSRF**: permintaan yang mengubah data (`POST/PUT/PATCH/DELETE`) tanpa token akses yang **valid** harus berasal dari
  origin SOLAR sendiri (sekadar mengirim token apa pun, mis. `?token=` di form situs lain, tidak melewati cek ini): header `Origin` harus sama dengan `Host` (atau `X-Forwarded-Host` bila `TRUST_PROXY`), dan tanpa `Origin`,
  `Sec-Fetch-Site` tidak boleh `cross-site`/`same-site`. Selain itu `403`. (SameSite=Lax saja tidak cukup: port lain
  dan subdomain dihitung "same-site".) Di belakang reverse proxy: teruskan `Host` asli, atau set `TRUST_PROXY` dan
  kirim `X-Forwarded-Host`/`-Proto`/`-For`.
- **`SOLAR_ACCESS_TOKEN`** tetap ada sebagai token mesin (skrip, CI, test): permintaan yang membawanya bertindak sebagai
  superadmin (bukan akun; `GET /auth/me` → `user: null, via: "token"`). Token yang dikirim tetapi salah → `401
  invalid_token` (tidak jatuh ke cookie) - **kecuali** di rute publik `GET /auth/state`, `POST /auth/login`,
  `/register`, `/setup`, `/logout`: di sana token yang salah diabaikan (dianggap tidak ada; cookie tetap berlaku), agar
  browser yang masih menyimpan token lama (sudah diganti/dihapus) tidak terkunci dari form login. Tanpa token, API tetap hanya melayani nama host komputer ini (127.0.0.1 /
  localhost / `HOST`) - perlindungan DNS rebinding.

### Superadmin pertama

Selama belum ada akun sama sekali, `GET /auth/state` menjawab `setupRequired: true` dan pendaftaran ditutup. Superadmin
pertama dibuat dengan salah satu cara:

1. `.env`: `SOLAR_ADMIN_USERNAME`, `SOLAR_ADMIN_EMAIL`, `SOLAR_ADMIN_PASSWORD` (opsional `SOLAR_ADMIN_NAME`) - dibuat
   (aktif) saat server start bila belum ada akun; diabaikan bila sudah ada. Nilai yang tidak valid (mis. password < 10
   karakter) membuat server **gagal start** dengan pesan yang jelas.
2. `POST /auth/setup`, hanya bila belum ada akun **dan** salah satu:
   - permintaan membawa `SOLAR_ACCESS_TOKEN` (dari mana pun), **atau**
   - permintaan datang langsung dari komputer server itu sendiri (alamat loopback, `Host` localhost/127.0.0.1, `Origin`
     lokal bila ada, tanpa header proxy `X-Forwarded-*`/`Forwarded`/`Via`/`X-Real-IP`, dan `TRUST_PROXY` tidak di-set)
     **dan** membawa **kode penyiapan** sekali pakai (`setupCode`).

   Kode penyiapan (`XXXX-XXXX-XXXX-XXXX`, 80 bit acak; huruf besar/kecil, spasi dan tanda hubung diabaikan) dibuat
   setiap kali server start selama belum ada akun, dicetak di log server, dan disimpan di `DATA_DIR/setup-code.txt`
   (mode 0600). Kode itu hilang (file dihapus) begitu superadmin pertama ada. Aplikasi desktop yang menjalankan server
   di prosesnya sendiri bisa membacanya lewat `RunningServer.setupCode()`. `GET /auth/state` memberi tahu UI lewat
   `setupCodeRequired`.

   Alasannya: server baru yang sudah terbuka di jaringan tidak boleh bisa "diklaim" oleh siapa pun yang pertama kali
   menemukannya. "Datang dari localhost" saja tidak cukup: reverse proxy di komputer yang sama dengan setelan bawaan
   (mis. nginx `proxy_pass http://127.0.0.1:8790;` - `Host` ditulis ulang ke 127.0.0.1, tanpa header `X-Forwarded-*`)
   membuat setiap permintaan dari luar terlihat lokal. Kode penyiapan hanya bisa dibaca oleh operator (log / folder
   data), sehingga syarat lokal + kode tetap aman di belakang proxy seperti itu. Setup yang berjalan bersamaan
   diserialkan (file: antrean dalam proses; Postgres: transaksi dengan advisory lock) - tepat satu yang menang, sisanya
   `409`. Untuk server yang dibuka ke jaringan, cara 1 tetap yang paling sederhana.

### Endpoint `/auth`

| Method | Path | Body | Jawaban |
|---|---|---|---|
| GET | `/auth/state` | | Publik. `AuthState`: `{ appName, version, setupRequired, setupCodeRequired, registrationOpen, me: AuthMe \| null, passwordPolicy: { minLength: 10, maxLength: 128 } }`. `setupCodeRequired` = setup menunggu dan permintaan tidak membawa token akses (form setup perlu kolom kode). |
| POST | `/auth/register` | `{ username, email, name, password }` | Publik. `201 { status: "pending" }` - akun `staff` berstatus `pending`, **tidak** login (tanpa cookie). `400 invalid_input` (username/email/nama tidak valid) / `weak_password`; `409 username_taken` / `email_taken`; `409 registration_closed` (belum ada superadmin); `429 rate_limited` (5 per IP per jam) + `Retry-After`; `503 busy`. |
| POST | `/auth/login` | `{ identifier, password }` (`identifier` = username **atau** email, tidak peka huruf besar) | Publik. `200 AuthMe` + `Set-Cookie`. `401 invalid_credentials` (pesan sama untuk akun tak dikenal dan password salah; akun tak dikenal tetap menjalankan scrypt penuh); `403 account_pending` / `account_disabled` (hanya setelah password terbukti benar); `429 rate_limited` + `Retry-After` (10 kegagalan per 15 menit per IP, dan per akun/identifier - juga untuk percobaan yang dikirim paralel, lihat di bawah); `503 busy` + `Retry-After`. Bila permintaan masih membawa cookie sesi yang sah (browser yang sama, akun lain atau akun yang sama), sesi lama itu **diakhiri** setelah login berhasil: cookie-nya diganti, dan event stream tab lain yang masih memakai sesi lama menerima `signed_out` (log aktivitas: `auth.session_revoked`, `reason: replaced_by_login`). |
| POST | `/auth/logout` | | `204`, cookie dihapus (`Max-Age=0`). |
| GET | `/auth/me` | | `200 AuthMe { user, role, permissions, via: "session" \| "token" }`; `401 unauthenticated`. |
| POST | `/auth/password` | `{ currentPassword, newPassword }` | `204`, sesi lain diakhiri. `400 wrong_password` / `weak_password`; `400 forbidden` untuk token akses; `429` setelah 10 password lama salah per 15 menit (juga paralel); `503 busy`. |
| POST | `/auth/setup` | `{ username, email, name, password, setupCode? }` | Publik. `201 AuthMe` + `Set-Cookie` (superadmin aktif pertama, langsung login). `403 setup_forbidden` (bukan loopback & tanpa token), `403 setup_code_invalid` (kode penyiapan salah/tidak ada; tidak perlu dengan token), `409 setup_not_available` (sudah ada akun), `400`, `429`, `503 busy`. |

**Batas percobaan & beban.** Setiap percobaan login dihitung **sebelum** password diperiksa, dalam langkah yang sama
dengan pengecekan batasnya; percobaan yang membuktikan password benar (termasuk akun `pending`/`disabled`), atau yang
tidak sempat diperiksa (`429`, `503`), dikembalikan. Jadi percobaan yang dikirim paralel tidak bisa melewati batas:
paling banyak 10 password diperiksa per IP dan per akun dalam 15 menit, bagaimanapun waktunya diatur. Hal yang sama
berlaku untuk password lama di `POST /auth/password`. Catatan: karena percobaan yang sedang berjalan ikut dihitung,
lebih dari 10 login yang benar-benar bersamaan dari satu IP (mis. satu kantor di balik NAT, dalam sepersekian detik)
bisa mendapat `429` sesaat. Selain itu semua hash scrypt (login, pendaftaran, setup, ganti/reset password) melewati
satu gerbang per proses: paling banyak separuh thread pool libuv (`UV_THREADPOOL_SIZE`, default 4 → 2) bekerja
bersamaan dan 32 lainnya menunggu; sisanya langsung dijawab `503 busy` + `Retry-After: 5`. Dengan begitu banjir login
dari banyak IP tidak memenuhi thread pool yang juga dipakai penyimpanan file dan file statis.

**Aturan akun**: username 3-32 karakter `a-z 0-9 . _ -` (disimpan huruf kecil), email valid (disimpan huruf kecil),
keduanya unik tanpa memandang huruf besar; nama tampilan 1-80 karakter tanpa karakter kontrol. Password 10-128
karakter (setelah normalisasi Unicode NFKC), tidak boleh hanya spasi, tidak boleh sama dengan username/email. Hash:
scrypt (`node:crypto`, N=2^15, r=8, p=1, salt 16 byte, kunci 64 byte), disimpan sebagai `scrypt$N$r$p$salt$hash`
sehingga parameternya bisa dinaikkan nanti (hash lama diperbarui otomatis saat login berhasil). Hash tidak pernah
dikembalikan API atau ditulis ke log.

`409 username_taken` / `email_taken` sengaja membedakan keduanya: username maupun email sama-sama bisa dipakai login,
jadi menyembunyikan salah satunya tidak melindungi apa pun, sedangkan pengguna perlu tahu field mana yang harus
diganti; SOLAR adalah alat internal tanpa pengiriman email, dan pendaftaran dibatasi 5 per IP per jam sehingga
enumerasi lambat.

### Endpoint `/users`

| Method | Path | Body / query | Izin | Jawaban |
|---|---|---|---|---|
| GET | `/users` | `?status=pending\|active\|disabled` | `users.view` | `User[]` (terlama dulu). |
| GET | `/users/pending-count` | | `users.view` | `{ count }`. |
| GET | `/users/:id` | | `users.view` | `User`; `404 user_not_found`. |
| POST | `/users` | `{ username, email, name, password, role? }` (default `staff`) | `users.manage` | `201 User` (aktif). `409 username_taken`/`email_taken`, `400`. |
| PATCH | `/users/:id` | `{ role?, status?: "active" \| "disabled", name? }` | sesuai aksi | `200 User`. `status: "active"` pada akun `pending` = persetujuan. `403 forbidden` (peran/target tidak boleh), `403 self_action`, `409 last_superadmin`, `400` (mis. `status: "pending"`), `404`. |
| POST | `/users/:id/approve` | `{ role? }` (default `staff`) | `users.approve` | `200 User` (aktif, `approvedAt`, `approvedBy`). `head_of_it` hanya sebagai `staff`. `409 not_pending`. |
| POST | `/users/:id/password` | `{ password }` | `users.manage` (bukan akun sendiri) | `204`; semua sesi akun itu berakhir. |
| DELETE | `/users/:id` | | `users.manage` (bukan akun sendiri) | `204`; sesi ikut terhapus; task-nya tetap menyimpan `ownerId` (tampil sebagai pengguna terhapus). `409 last_superadmin`. |

Setiap pendaftaran baru dan perubahan akun mengirim `{ kind: "users_changed", pendingCount }` di `/stream` kepada
pengguna dengan `users.view` (untuk badge jumlah pendaftaran yang menunggu).

### Peran: `GET /roles`

Semua pengguna yang masuk (untuk label peran di UI). Jawaban dari kode (`ROLE_INFO` + `ROLE_PERMISSIONS`), sama untuk
penyimpanan file maupun Postgres:

```json
[
  { "id": "superadmin", "name": "Superadmin", "description": "...", "names": { "id": "Superadmin", "en": "Superadmin" },
    "descriptions": { "id": "...", "en": "..." }, "permissions": ["agent.use", "...", "activity.view_all", "activity.view_own"], "sortOrder": 1 },
  { "id": "head_of_it", "name": "Head of IT Solar", ... , "sortOrder": 2 },
  { "id": "staff", "name": "Staf Solar", ... , "sortOrder": 3 }
]
```

`name` / `description` dalam bahasa permintaan; `names` / `descriptions` berisi kedua bahasa (kolom `name_id`,
`name_en`, `description_id`, `description_en` di `solar_roles`). `permissions` dalam urutan `PERMISSIONS`.

### Kode error

`unauthenticated` (401), `invalid_token` (401), `invalid_credentials` (401), `account_pending` (403),
`account_disabled` (403), `forbidden` (403), `self_action` (403), `setup_forbidden` (403), `setup_code_invalid` (403),
`user_not_found` (404),
`username_taken` / `email_taken` / `registration_closed` / `setup_not_available` / `not_pending` / `last_superadmin`
(409), `invalid_input` / `weak_password` / `wrong_password` (400), `rate_limited` (429, dengan `Retry-After` dalam detik),
`busy` (503, dengan `Retry-After`).

Contoh:

```bash
# pendaftaran mandiri (menunggu persetujuan)
curl -s -X POST http://127.0.0.1:8790/api/auth/register -H "Content-Type: application/json" \
  -d '{"username":"budi.santoso","email":"budi@solar.co.id","name":"Budi Santoso","password":"kata sandi yang panjang"}'

# login (cookie disimpan di cookies.txt), lalu memakai API dengan cookie itu
curl -s -c cookies.txt -X POST http://127.0.0.1:8790/api/auth/login -H "Content-Type: application/json" \
  -d '{"identifier":"budi@solar.co.id","password":"kata sandi yang panjang"}'
curl -s -b cookies.txt http://127.0.0.1:8790/api/tasks

# skrip dengan token akses (bertindak sebagai superadmin)
curl -s -H "Authorization: Bearer $SOLAR_ACCESS_TOKEN" "http://127.0.0.1:8790/api/users?status=pending"
```

## Log aktivitas

Jejak audit: siapa melakukan apa dan kapan. Ditulis di latar belakang dalam batch (tidak memperlambat atau
menggagalkan permintaan; kegagalan menulis hanya dicatat di log server). Nama dan peran pelaku disimpan sebagai
**snapshot** saat itu (tetap sama walau akun diganti namanya, perannya diubah atau dihapus). Tidak pernah berisi
password, token, hash, kode penyiapan, atau isi file; user agent dan label dipendekkan. Disimpan
`ACTIVITY_RETENTION_DAYS` hari (default 365, `0` = selamanya), dibersihkan saat start lalu setiap hari.

| Method | Path | Query | Izin | Jawaban |
|---|---|---|---|---|
| GET | `/activity` | `actor`, `action`, `outcome`, `from`, `to`, `q`, `cursor`, `limit` | `activity.view_own` | `ActivityPage { items: ActivityItem[], nextCursor: string \| null }`, terbaru dulu. |
| GET | `/activity/actions` | | `activity.view_own` | `ActivityActionInfo[]`: `{ action, group, label }` untuk setiap kode aksi (label dalam bahasa permintaan) - untuk dropdown filter. |
| GET | `/activity.csv` | sama dengan `/activity` tanpa `cursor`/`limit` | `activity.view_all` | File CSV (UTF-8 dengan BOM, `\r\n`, maks. 100.000 baris), `Content-Disposition: attachment; filename="solar-activity-YYYYMMDD.csv"`. Ekspor ini sendiri dicatat (`activity.export`). |

**Siapa melihat apa.** `superadmin` dan `head_of_it` (`activity.view_all`, juga `SOLAR_ACCESS_TOKEN`) melihat semua
entri; `actor=<id pengguna>` atau `actor=me` menyaringnya. `staff` hanya melihat entri **miliknya sendiri** (pelaku =
dirinya), apa pun isi `actor`.

**Query.**
- `actor` - id pengguna (`usr_...`), `system:access-token`, atau `me`.
- `action` - satu atau beberapa kode dipisah koma (`auth.login,auth.logout`); `user.*` = semua kode berawalan `user.`.
  Kode yang tidak dikenal → `400`.
- `outcome` - `success` | `failure`.
- `from` / `to` - ISO 8601. Tanggal saja (`2026-10-12`) = awal hari itu (UTC); untuk `to` tanggal saja berarti
  **sampai akhir** hari itu. `from` inklusif, `to` eksklusif. Tidak valid → `400`.
- `q` - teks (tidak peka huruf besar) di nama pelaku, label/id target, kode aksi, atau `details`.
- `limit` - 1-200 (default 50). `cursor` - `nextCursor` halaman sebelumnya (opaque); tidak valid → `400`.

**Halaman.** Lanjutkan selama `nextCursor` tidak `null`. Sebuah halaman bisa berisi **kurang dari `limit` entri, bahkan
nol, dengan `nextCursor`**: di penyimpanan file satu permintaan membaca paling banyak 10.000 baris log, jadi filter yang
jarang cocok (mis. entri milik seorang staf di log yang besar, atau `q`) menjawab dengan yang sudah ditemukan dan cursor
untuk melanjutkan. UI sebaiknya menampilkan "muat lagi" alih-alih menyimpulkan bahwa log sudah habis.

**`ActivityItem`** (`packages/shared`):

```json
{
  "id": "act_mg5x0k2q8000a1b2c3d4e5",
  "at": "2026-10-12T08:15:02.123Z",
  "actorId": "usr_...", "actorName": "Budi Santoso", "actorRole": "staff", "actorKind": "user",
  "action": "knowledge.write",
  "targetType": "knowledge", "targetId": "systems/AD1GATE.md", "targetLabel": "systems/AD1GATE.md",
  "outcome": "success",
  "ip": "10.0.0.12", "userAgent": "Mozilla/5.0 ...",
  "details": { "title": "AD1GATE API Gateway", "type": "system", "replaced": null, "via": "agent", "taskId": "task_..." },
  "summary": "Budi Santoso menyimpan knowledge systems/AD1GATE.md (lewat agen)"
}
```

`actorKind`: `user` (akun), `token` (`SOLAR_ACCESS_TOKEN`; `actorId` = `system:access-token`), `anonymous` (belum
masuk, mis. login gagal), `system`. `id` diawali waktu sehingga urutannya = urutan waktu. `action` adalah kode (UI
menerjemahkannya); `summary` adalah satu kalimat dalam bahasa permintaan. Tulisan agen atas nama pengguna (setelah
pengguna menyetujui) dicatat dengan pelaku = **pemilik task**, `details.via = "agent"`, `details.taskId`, tanpa IP.

**Kode aksi** (`ACTIVITY_ACTIONS` di `packages/shared`):

| Kode | Dicatat saat | `details` (contoh) |
|---|---|---|
| `auth.login` | login berhasil | |
| `auth.login_failed` (`failure`) | login gagal | `reason`: `wrong_password` \| `pending` \| `disabled` \| `rate_limited`; `identifier` = **username** akun hanya bila yang diketik cocok dengan akun yang ada (tidak pernah teks yang diketik - bisa jadi password yang salah ketik). Pelaku = akun bila password terbukti (`pending`/`disabled`), selain itu `anonymous`. Percobaan yang diblokir dicatat paling banyak sekali per menit per IP/akun. |
| `auth.logout` | logout | |
| `auth.register` | pendaftaran mandiri (pelaku = akun baru) | |
| `auth.setup` | superadmin pertama dibuat (juga dari `SOLAR_ADMIN_*` saat server mulai: pelaku `system`); juga `failure` untuk setup yang ditolak | `role`; `via`: `setup_code` \| `token` \| `env`; `reason`: `setup_code_invalid`, `setup_forbidden`, `setup_not_available`, `rate_limited` |
| `auth.password_change` | ganti password sendiri; `failure` bila password lama salah / diblokir | `sessionsEnded`; `reason` |
| `auth.session_revoked` | sesi akun diakhiri oleh tindakan admin, atau oleh login lain di browser yang sama | `sessions`, `reason`: `role_change` \| `disable` \| `password_reset` \| `replaced_by_login` (pelaku = akun yang baru masuk) |
| `user.create` | admin membuat akun | `role` |
| `user.approve` | pendaftaran disetujui (juga `PATCH status: active` pada akun `pending`) | `role` |
| `user.role_change` | peran diubah | `from`, `to` |
| `user.disable` / `user.enable` | akun dinonaktifkan / diaktifkan | |
| `user.password_reset` | admin mereset password | |
| `user.delete` | akun dihapus | `username`, `name`, `role`, `sessionsEnded` |
| `user.rename` | nama tampilan diubah | `from`, `to` |
| `task.create` / `task.cancel` | task dibuat / dibatalkan | `language`, `attachments`, `sessionId` / `status` |
| `confirmation.approve` / `confirmation.reject` | persetujuan dijawab | `tool`, `taskId`, `taskTitle`, `pluginId?` |
| `knowledge.write` | file knowledge disimpan (form, impor banyak file: `via: "import"`, agen: `via: "agent"`) | `title`, `type`, `replaced?` |
| `knowledge.import_artifact` | artefak disimpan sebagai knowledge (route atau agen) | `artifactId`, `artifactName`, `replaced` |
| `knowledge.delete` / `knowledge.revert` | file pengguna dihapus / override dihapus sehingga versi bawaan kembali | |
| `knowledge.table_import` / `knowledge.document_import` | impor tabel / dokumen | `file`, `sheet`/`split`, `written`, `removed` |
| `skill.create` / `skill.update` / `skill.delete` / `skill.enable` / `skill.disable` | skill dibuat (juga impor: `via: "import"`), isinya diubah, dihapus (`result`: `deleted` \| `reverted`), diaktifkan / dinonaktifkan | `fields` |
| `settings.llm.provider_create` / `_update` / `_delete` | provider AI | `kind`, `models`, `fields` (nama field saja - API key dan header tidak pernah dicatat) |
| `settings.llm.route_change` | rute model diubah | `from`, `to`: daftar `{ name, models }` (nama rute sebagai nilai, jadi rute seperti `token-saver` tidak pernah tersaring) |
| `settings.llm.provider_test` | tes koneksi (`failure` bila gagal) | `models` |
| `settings.plugin.create` / `_update` / `_delete` / `_reconnect` | plugin MCP | `preset`, `transport`, `fields`, `state` (tanpa `env`/`headers`) |
| `artifact.docx_export` | `POST /artifacts/:id/docx` membuat file Word | `sourceArtifactId`, `taskId` |
| `artifact.publish_github` | tool agen `publish_artifacts_to_github` dijalankan (`failure` bila gagal) | `repository`, `branch`, `path`, `files`, `commitSha` |
| `activity.export` | ekspor CSV | `rows`, `filters` |

Penolakan tindakan admin (`forbidden`, `self_action`, `last_superadmin`, `not_pending`, `user_not_found`) dicatat
dengan aksi yang dicoba, `outcome: "failure"` dan `details.reason`. Ini termasuk percobaan yang sudah ditolak oleh cek
izin route (`403`) sebelum apa pun berjalan: perubahan di `/api/users` (`user.create`, `user.approve`,
`user.role_change`, `user.disable`/`enable`/`rename`, `user.password_reset`, `user.delete`), perubahan pengaturan
(`settings.llm.*`, `settings.plugin.*`) dan ekspor CSV (`activity.export`), dengan `details.reason = "forbidden"`.
Target-nya adalah id di URL apa adanya (tanpa dicari namanya: staf melihat entri miliknya sendiri), isi permintaan
tidak pernah dicatat, dan percobaan yang sama (akun + aksi + target) dicatat paling banyak sekali per menit. Penolakan
membaca (mis. `GET /api/plugins`) dan kesalahan isian (username dipakai, password lemah) tidak dicatat.

**Teks yang disimpan.** Satu baris, dipendekkan, selalu *well-formed* dan terlihat: karakter kontrol jadi spasi;
surrogate UTF-16 tunggal, kontrol bidi (mis. U+202E yang membuat `invoice\u202efdp.exe` tampil sebagai
`invoiceexe.pdf`) dan karakter tak terlihat (zero-width, BOM) jadi `U+FFFD` (sambungan emoji tetap utuh). Kunci
`details` yang tampak rahasia (`password`, `token`, `secret`, `hash`, `content`, ...) dibuang dan jumlahnya dicatat di
`details.redactedKeys`. Entri yang `details`-nya tetap ditolak Postgres disimpan dengan `details: { "invalid": true }`
(entri lain di batch yang sama tidak terpengaruh).

**CSV** - kolom: `id, at, actor_id, actor_name, actor_role, actor_kind, action, action_label, outcome, target_type,
target_id, target_label, summary, ip, user_agent, details` (label & ringkasan dalam bahasa permintaan, `details` JSON).
Setiap sel diberi tanda kutip; sel yang diawali `=`, `+`, `-`, `@` (juga setelah spasi), tab atau CR diberi awalan `'`
agar spreadsheet tidak menjalankannya sebagai formula (CSV injection).

```bash
curl -s -b cookies.txt "http://127.0.0.1:8790/api/activity?action=auth.login_failed&from=2026-10-01&limit=100"
curl -s -b cookies.txt -H "X-Solar-Language: en" -o activity.csv "http://127.0.0.1:8790/api/activity.csv?action=user.*"
```

## Sistem

| Method | Path | Keterangan |
|---|---|---|
| GET | `/health` | `{ ok, name, version }` |
| GET | `/config` | Semua pengguna yang masuk. Konfigurasi publik (tanpa rahasia): provider, model, reasoning effort, `openaiConfigured`, mode penyimpanan, status GitHub/Plane, `authRequired` (= `SOLAR_ACCESS_TOKEN` di-set). |
| GET | `/stream` | Server-Sent Events: `hello`, `task`, `event`, `delta`, `plugins`, `users_changed`, `signed_out` (lihat `StreamMessage` di `packages/shared`). Setiap pengguna hanya menerima task miliknya (semua task untuk `tasks.all`, dengan `owner`), `plugins` untuk semua, `users_changed` untuk `users.view`. Query `?lang=id\|en`: bahasa status plugin di pesan `plugins` (teks task mengikuti `Task.language`). Web UI membuka ulang stream saat bahasa antarmuka diganti. |

## Task

| Method | Path | Body / Query | Keterangan |
|---|---|---|---|
| POST | `/tasks` | `{ prompt, sessionId, attachmentIds?, language? }` | Membuat task (status `queued`) milik pengguna yang meminta (`ownerId`). `attachmentIds` (maks. 10) harus lampiran **unggahan pengguna itu** di `sessionId` yang sama (lampiran orang lain = "tidak ditemukan", `400`). `language` (`"id"` \| `"en"`, opsional): bahasa antarmuka klien, disimpan sebagai `Task.language` (default: bahasa permintaan, lihat [Bahasa](#bahasa)). Respons `201` berisi `Task`. |
| GET | `/tasks` | `limit`, `offset`, `sessionId`, `status`, `owner` | Daftar task terbaru: task sendiri; untuk `tasks.all` semua task (dengan `owner`). `sessionId` selalu percakapan milik peminta. `owner` (hanya `tasks.all`): `me`, `none` (task dari sebelum ada akun) atau id pengguna. |
| GET | `/tasks/stats` | | Total per status dan estimasi biaya (task sendiri; semua untuk `tasks.all`). |
| GET | `/tasks/:id` | | `TaskDetail`: task, events, artifacts, confirmations, attachments. `404` juga untuk task orang lain. |
| POST | `/tasks/:id/cancel` | | Membatalkan task yang antre/berjalan (`409` bila sudah selesai, tidak dikenal, atau milik orang lain). |
| GET | `/tasks/:id/artifacts.zip` | `lang?` | Semua artefak task dalam ZIP; `README.md` di dalamnya dalam bahasa permintaan (`?lang=` karena berupa link unduhan). |

Contoh (dengan cookie dari `POST /auth/login`, lihat [Autentikasi](#autentikasi--pengguna); skrip juga bisa memakai
`-H "Authorization: Bearer $SOLAR_ACCESS_TOKEN"`):

```bash
curl -s -b cookies.txt -X POST http://127.0.0.1:8790/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Buatkan sequence diagram reset password via email","sessionId":"cli"}'

# task berbahasa Inggris (langkah, status, error dalam English; error API juga)
curl -s -b cookies.txt -X POST http://127.0.0.1:8790/api/tasks \
  -H "Content-Type: application/json" -H "X-Solar-Language: en" \
  -d '{"prompt":"Create a sequence diagram for password reset by email","sessionId":"cli","language":"en"}'
```

## Konfirmasi

| Method | Path | Body | Keterangan |
|---|---|---|---|
| GET | `/confirmations` | | Permintaan persetujuan yang sedang menunggu (task sendiri; semua untuk `tasks.all`). |
| POST | `/confirmations/:id` | `{ approved: boolean, note?: string }` | Menyetujui / menolak - pemilik task, atau `tasks.all` (`404` untuk persetujuan task orang lain). |

## Artefak

Artefak mengikuti task-nya: hanya pemilik task dan `tasks.all` yang bisa membuka (`404` untuk yang lain).

| Method | Path | Keterangan |
|---|---|---|
| GET | `/artifacts/:id` | Metadata artefak. |
| GET | `/artifacts/:id/content` | Isi file (`?download=1` untuk unduh). Disajikan dengan `Content-Security-Policy: sandbox`. |
| POST | `/artifacts/:id/docx` | Membuat dokumen **Word (.docx)** sebuah TSD yang dibuat sebelum ada file Word. `:id` = artefak mana pun dari paket TSD (`.md`, `.html`, `.tsd.json`). Dokumen dibangun ulang dari `.tsd.json` paket itu dengan diagram SVG task yang sama, tanggal dokumen = tanggal TSD dibuat, lalu disimpan di task & paket yang sama sebagai `<nama>.docx` (`kind: "tsd-docx"`, judul "<judul> (Word)") dan diumumkan lewat event `artifact` di `/stream` seperti artefak buatan agent. `201` `{ artifact, created: true, warnings }`; `200` `{ artifact, created: false, warnings: [] }` bila paket sudah punya file Word (file itu yang dikembalikan, tidak dibuat ulang); `404` artefak tidak ada; `400` paket tidak punya `.tsd.json` atau isinya bukan spesifikasi yang valid (pesan `error` menyebut kesalahannya); `500` dokumen gagal dirender (pesan `error` menyebut sebabnya, mis. waktu habis atau batas memori). Dokumen dirender di *worker thread* terpisah (`docx-worker.mjs`), jadi server tetap melayani permintaan lain: biasanya 1-3 detik; bila menata halaman melewati 30 detik, dokumen dibuat ulang tanpa nomor halaman daftar isi (Word mengisinya saat dibuka, ada di `warnings`), dan bila itu juga melewati 30 detik hasilnya `500`. Permintaan untuk paket yang sama (juga file Word yang sedang dibuat agent untuk paket itu) diproses satu per satu, jadi klik ganda tidak membuat dua file. |

File Word disajikan dengan `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`;
UI tidak mempratinjaunya di browser, hanya menawarkan unduhan (dan pratinjau versi HTML dari paket yang sama).

```bash
curl -s -b cookies.txt -X POST http://127.0.0.1:8790/api/artifacts/art_123/docx   # art_123 = id .md/.html/.tsd.json sebuah TSD
```

## Lampiran dokumen

Dokumen proyek (PDF, Word `.docx`, Excel `.xlsx`/`.xlsm`/`.csv`, PowerPoint `.pptx`, Markdown, `.txt`) diunggah
**sebelum** task dibuat, lalu id-nya dikirim di `attachmentIds`. Server langsung mengekstrak teksnya menjadi Markdown
(judul, daftar, tabel, penanda halaman/slide/sheet) - teks itulah yang dibaca agen.

| Method | Path | Body / query | Keterangan |
|---|---|---|---|
| POST | `/attachments` | query `sessionId`, `name`; body = isi file mentah (`Content-Type: application/octet-stream`) | Unggah + ekstraksi. `201` → `Attachment` (`kind`, `parts` = halaman/slide/sheet, `chars`, `outline`, `warnings`). `413` terlalu besar (`ATTACHMENT_MAX_MB`, default 25) atau terindikasi zip bomb, `415` jenis tidak didukung (termasuk `.doc`/`.xls`/`.ppt` lama - juga bila diberi ekstensi modern, `.xlsb`, `.vsdx`, OpenDocument, file biner berekstensi teks), `400` isi file kosong, `422` file rusak, terenkripsi/berpassword, atau melewati batas waktu baca. Pesan error (`error`) dan `warnings` dalam bahasa permintaan ([Bahasa](#bahasa)) dan bisa langsung ditampilkan; `warnings` disimpan bersama lampiran. |
| GET | `/attachments?sessionId=` | | Lampiran sebuah percakapan milik peminta (terlama dulu); `&unsent=1` = yang belum dipakai task. |
| GET | `/attachments/:id` | | Metadata. |
| GET | `/attachments/:id/text` | | Markdown hasil ekstraksi (persis yang dibaca agen). |
| GET | `/attachments/:id/content` | | File asli, selalu sebagai unduhan (`Content-Disposition: attachment`, CSP `sandbox`). |
| DELETE | `/attachments/:id` | | Menghapus lampiran yang belum dipakai task (`204`); `409` bila sudah dipakai (tetap disimpan sebagai riwayat task). |

Lampiran menyimpan `ownerId` (pengunggah): `GET`/`DELETE` lampiran orang lain → `404` (kecuali `tasks.all`).

## Skills

Membaca: `skills.read`; membuat/mengubah/mengimpor/menghapus: `skills.manage` - keduanya dimiliki semua peran.

| Method | Path | Body | Keterangan |
|---|---|---|---|
| GET | `/skills` | | Semua skill (bawaan + pengguna) beserta isinya. |
| GET | `/skills/:id` | | Satu skill. |
| POST | `/skills` | `{ name, description, content, enabled? }` | Skill pengguna baru (id = slug nama). |
| POST | `/skills/import` | `{ markdown }` | Impor `SKILL.md` dengan front matter. |
| PUT | `/skills/:id` | sebagian field | Edit (skill bawaan disimpan sebagai override) / aktif-nonaktif. |
| DELETE | `/skills/:id` | | Hapus skill pengguna (override bawaan → kembali ke versi bawaan). |

## Model AI (provider & rute)

Hanya `superadmin` (`settings.manage`), termasuk `GET /llm`; peran lain `403 forbidden`.

| Method | Path | Body | Keterangan |
|---|---|---|---|
| GET | `/llm` | | Provider (`openai` dari `.env` + provider pengguna, API key literal disamarkan) dan rute (`default` = utama lalu cadangan). |
| POST | `/llm/providers` | `LlmProviderConfig` | Provider baru (`kind`: `openai-chat` atau `openai-responses`). |
| PUT | `/llm/providers/:id` | sebagian field | Ubah provider. Kirim `••••••••` untuk mempertahankan API key tersimpan. |
| DELETE | `/llm/providers/:id` | | Hapus provider. |
| POST | `/llm/providers/:id/test` | | Tes koneksi: daftar model dari `GET /models`. |
| PUT | `/llm/routes` | `{ routes: { default: ["provider/model", ...] } }` | Simpan rute; `{}` = kembali ke model `.env`. |

## Knowledge base

Membaca: `knowledge.read`; menulis, menghapus, mengimpor: `knowledge.write` - keduanya dimiliki semua peran.
`POST /knowledge/import-artifact` hanya untuk artefak dari task yang boleh dilihat peminta (`404` selain itu).

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

Hanya `superadmin` (`settings.manage`), termasuk `GET /plugins` (plugin bisa menjalankan perintah dan menyimpan
kredensial); semua pengguna tetap menerima status koneksi plugin lewat pesan `plugins` di `/stream`.

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
