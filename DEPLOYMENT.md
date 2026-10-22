# Persiapan deploy Layanan Surat

## Target Wasmer Edge

Paket Wasmer sekarang tersedia di `wasmer-edge/`. Backend API dipindahkan ke PHP yang dijalankan lewat runtime PHP Wasmer; halaman, login TU/Kepsek, pengajuan, pelacakan, dan unduhan memakai endpoint yang sama. Wasmer Edge menjalankan package HTTP/WCGI, dan mendukung aplikasi PHP melalui template resminya. [Panduan PHP Wasmer](https://docs.wasmer.io/edge/guides/php/)

Backend aktif memakai PostgreSQL Supabase untuk data pengajuan, sesi, dan pembatasan percobaan login; dokumen berada di Storage privat Supabase. ZIP backup tetap di volume privat `/data/backups`. Konfigurasi dan skema ada di [supabase/README.md](supabase/README.md). MySQL terkelola lama masih tersedia ketika `AMANA_BACKEND=mysql`, memakai `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, dan `DB_PASSWORD`.

Untuk menyiapkan rilis:

1. Dari folder `layanan-surat`, jalankan `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\prepare-wasmer.ps1` untuk menyalin halaman terbaru ke paket.
2. Ganti `owner` contoh dalam `wasmer-edge/app.yaml` dengan namespace Wasmer milik sekolah.
3. Login melalui `wasmer login`; siapkan empat variabel akun TU/Kepsek sesuai [STAFF_ACCOUNTS.md](STAFF_ACCOUNTS.md). Kedua username dan password harus berbeda; password minimal 16 karakter.
4. Dari folder `wasmer-edge`, jalankan `wasmer deploy` dan uji hasilnya di URL staging.

Project Supabase baru perlu disiapkan dengan `supabase/schema.sql` dan `supabase/backend.sql`. Deploy tidak mengimpor data lokal atau menyalin sumber MySQL secara otomatis. Sesi backend Supabase tersimpan di PostgreSQL. Volume Wasmer dipakai untuk backup, bukan database JSON. [Arsitektur aplikasi](https://docs.wasmer.io/edge/learn/apps/), [volume Wasmer](https://docs.wasmer.io/edge/learn/volumes/)

Dokumentasi Wasmer saat ini mencantumkan lokasi database di AS, Prancis, dan Kanada. Periksa pilihan region dan kebijakan penyimpanan sekolah sebelum memakai data siswa sungguhan; tidak ada region database Indonesia pada daftar tersebut.

## Kebutuhan hosting

Aplikasi lokal juga dapat dijalankan pada host yang menyediakan Windows PowerShell 5.1 atau PowerShell 7+, reverse proxy HTTPS, dan direktori data persisten. Hosting statis saja tidak dapat menjalankan server PowerShell lokal.

## Konfigurasi production

Atur variabel berikut di pengelola environment/secret milik hosting. Jangan simpan password di source code atau commit file `.env`.

```text
AMANA_ENV=production
AMANA_TU_USER=<username-TU>
AMANA_TU_PASSWORD=<password-TU-minimal-16-karakter>
AMANA_PRINCIPAL_USER=<username-kepala-sekolah>
AMANA_PRINCIPAL_PASSWORD=<password-kepala-sekolah-minimal-16-karakter>
AMANA_COOKIE_SECURE=1
AMANA_BIND_ADDRESS=127.0.0.1
AMANA_PORT=8001
AMANA_DATA_DIR=<path-volume-persisten>/layanan-surat-data
```

Jika reverse proxy berjalan di container atau mesin lain, bind ke interface privat yang dapat dijangkau proxy dan batasi port tersebut dengan firewall. Jangan publikasikan port aplikasi langsung ke internet. Pasang TLS di reverse proxy dan teruskan header host/protokol dengan benar.

Jalankan `serve.ps1` dengan PowerShell 7+ sebagai service yang otomatis hidup kembali saat host restart. Siapkan endpoint pemeriksaan kesehatan `GET /api/health`.

## Sebelum membuka akses publik

- Siapkan volume persisten untuk `AMANA_DATA_DIR`; pastikan akun service dapat membaca/menulis direktori tersebut.
- Buat backup terenkripsi terjadwal untuk `applications.json`, `documents/`, dan `letters/`; uji pemulihan ke lingkungan terpisah.
- Pastikan paket rilis tidak membawa folder `data/` lokal. `.gitignore` sudah mengecualikannya, tetapi periksa paket akhir sebelum unggah.
- Jangan gunakan akun demo. Password production minimal 16 karakter dan disimpan sebagai secret di platform hosting.
- Uji HTTPS, login TU/Kepsek, pengajuan, pelacakan, unggah/unduh dokumen, pemulihan backup, dan restart service di staging.
- Tentukan petugas yang boleh melihat dokumen, masa retensi data siswa, prosedur penghapusan, dan kontak bantuan sekolah.
- Siapkan pembatasan spam/rate limit di reverse proxy untuk pengajuan publik. Server aplikasi saat ini hanya membatasi percobaan login.

## Batasan yang perlu diketahui

Server ini prototipe PowerShell satu proses dan menyimpan data dalam JSON lokal; gunakan hanya pada host Windows/PowerShell yang terkelola dan beban rendah. Untuk layanan sekolah yang dipakai banyak orang, rencanakan backend dengan database transaksional, penyimpanan objek privat, logging audit, dan pemantauan sebelum peluncuran luas. Notifikasi email belum tersedia.

Untuk deploy Wasmer gunakan hanya paket `wasmer-edge/` dan sinkronkan aset dengan script di atas; mengunggah HTML saja tidak menyertakan API.

## Backup yang sudah tersedia

Dashboard menyediakan **Backup data** untuk membuat dan mengunduh ZIP lengkap. Wasmer menjalankan command `backup` setiap 24 jam serta setelah deployment, menyimpan arsip di `/data/backups` pada volume privat. Server lokal mendukung backup manual. Lihat [BACKUP.md](BACKUP.md) untuk verifikasi, salinan terpisah, dan persiapan pemulihan. Arsip saat ini tidak dienkripsi dan tidak dikirim otomatis ke penyimpanan luar.
