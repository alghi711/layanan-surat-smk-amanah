# Supabase untuk Layanan Surat

Status: backend Supabase sudah diimplementasikan dan diaktifkan pada Wasmer, 21 Oktober 2026.
Data pengajuan, sesi, dan pembatasan login berada di PostgreSQL Supabase. Dokumen pendukung dan surat berada di Storage privat.
MySQL dan volume lama dipertahankan sebagai sumber sebelum cutover; keduanya bukan salinan yang terus disinkronkan.

Project yang dipilih: `jdvnxpaybatitmxcissb`.

- [Dashboard project](https://supabase.com/dashboard/project/jdvnxpaybatitmxcissb)
- [SQL Editor](https://supabase.com/dashboard/project/jdvnxpaybatitmxcissb/sql/new)
- Project URL API: `https://jdvnxpaybatitmxcissb.supabase.co`

Link dashboard berbeda dari Project URL API. Dashboard memerlukan sesi login pemilik; tautan saja tidak memberikan akses konfigurasi kepada aplikasi.

## 1. Buat project

1. Buka https://supabase.com/dashboard dan login.
2. Buat **New project** pada organization milik sekolah.
3. Beri nama `layanan-surat-smk-amanah`, pilih region yang sesuai, dan simpan password database di pengelola password.
4. Tunggu project siap. Salin **Project URL** dari dialog **Connect** atau pengaturan API project.
5. Kirim Project URL saja untuk melanjutkan integrasi. Jangan kirim password database atau secret key ke chat.

## 2. Siapkan tabel dan bucket

Gunakan project baru yang khusus untuk aplikasi ini. Di **SQL Editor → New query**, tempel isi [schema.sql](schema.sql), lalu jalankan sekali.

Skema membuat:

| Bagian | Kegunaan |
| --- | --- |
| `applications` | Pengajuan, draf surat, status, riwayat, dan metadata pengesahan |
| `admin_sessions` | Sesi login per perangkat, dengan token berupa hash |
| `login_attempts` | Pembatasan percobaan login |
| `application_sync` | Revisi data untuk penyegaran halaman TU/Kepsek |
| Storage `amanah-documents` | Bucket privat PDF, JPG, dan PNG; maksimal 10 MB per objek |

Semua tabel mengaktifkan RLS, tanpa akses langsung untuk `anon` dan `authenticated`.
Bucket tidak memiliki policy publik. Backend akan memeriksa peran petugas dan status surat sebelum melayani dokumen.
Batas dokumen pendukung 5 MB tetap harus ditegakkan backend; surat maksimal 10 MB.

Script berada dalam satu transaksi dan sengaja tidak memakai `DROP` atau `CREATE IF NOT EXISTS`.
Jika tabel atau bucket sudah ada, transaksi gagal agar tidak menimpa konfigurasi project lain.
Jangan menjalankannya ulang setelah berhasil. Selanjutnya jalankan [backend.sql](backend.sql), yang menyediakan fungsi `amanah_backend` dengan akses hanya untuk `service_role`. Fungsi ini menangani perubahan atomik, pemeriksaan versi, sesi, dan snapshot backup. `backend.sql` dapat dijalankan ulang untuk memperbarui fungsi.

## 3. Konfigurasi backend

`wasmer-edge/app/supabase.php` memanggil Data API dan Storage dari server PHP. Browser tetap memakai endpoint `/api` Wasmer.

Konfigurasi yang akan dipakai di **Environment Variables Wasmer**, untuk server/runtime:

```text
SUPABASE_URL=https://jdvnxpaybatitmxcissb.supabase.co
SUPABASE_SECRET_KEY=<secret-key-dari-project>
SUPABASE_STORAGE_BUCKET=amanah-documents
AMANA_BACKEND=supabase
AMANA_DASHBOARD_BATCH=1
AMANA_MIGRATING=0
```

Gunakan secret key server (`sb_secret_...`) dari pengaturan API keys. Jangan masukkan key tersebut ke HTML, JavaScript browser, source control, atau screenshot. Key ini melewati RLS dan hanya boleh digunakan backend.

Perilaku integrasi:

1. Pembuatan pengajuan memakai advisory lock dalam transaksi untuk mencegah pengajuan jenis yang sama bagi siswa yang masih diproses.
2. Penyimpanan draf/status memakai perbandingan record sebelumnya di dalam transaksi. Perubahan dari perangkat lain menghasilkan konflik, bukan menimpa diam-diam.
3. Login, peran TU/Kepsek, pembatasan percobaan login, dan akses unduhan tetap diperiksa backend. Sesi MySQL lama tidak dipindahkan; petugas harus login kembali setelah cutover.
4. Berkas disimpan dengan nama unik tanpa upsert. Surat sumber dan PDF yang disahkan tetap terpisah. Validasi hash membaca surat dari Storage.
5. Backup mengambil satu snapshot database dan berkas rujukannya dari Storage. ZIP tetap disimpan di volume privat Wasmer. Pemulihan menyiapkan SQL PostgreSQL untuk backup Supabase; lihat [BACKUP.md](../BACKUP.md).
6. `/api/health` menunjukkan `supabase-postgres-and-private-storage`. Pemeriksaan `/api/admin/supabase-health` membutuhkan login petugas.

Fungsi `backend.sql` versi 2 menambahkan operasi `dashboard`: sesi, peran, revisi, dan daftar/hasil tidak berubah diperiksa dalam satu permintaan Supabase. Aktifkan `AMANA_DASHBOARD_BATCH=1` setelah SQL versi 2 dijalankan. Dashboard menyegarkan data dengan jeda 2,5 detik sesudah respons selesai, atau 5 detik ketika editor surat/pengesahan terbuka, agar tidak mengirim permintaan terus-menerus saat server sedang sibuk.

Saat memindahkan backend lain, set `AMANA_MIGRATING=1` terlebih dahulu agar penulisan berhenti sementara. Buat dan verifikasi backup, salin semua record dan berkas rujukan, lalu cocokkan data serta checksum sebelum cutover. Setelah itu aktifkan backend tujuan dan set `AMANA_MIGRATING=0`.

Mengubah `AMANA_BACKEND=mysql` hanya memilih sumber MySQL lama; perubahan baru di Supabase tidak otomatis ikut. Sebelum rollback setelah ada penulisan baru, hentikan penulisan dan pindahkan perubahan tersebut agar tidak hilang.

Batas operasional: respons Supabase dibatasi 24 MB dan gagal secara eksplisit bila lebih besar. Untuk dataset besar, daftar dan snapshot perlu dipaginasi. Upload yang hasil transaksi databasenya tidak diketahui tetap dibiarkan privat agar berkas yang mungkin sudah dirujuk tidak terhapus. Pembersihan objek yatim harus didahului pencocokan referensi.

Backup Supabase memakai direktori kunci `/data/backups/.supabase-backup.lock`. Jika proses terhenti paksa dan backup berikutnya terus tertolak, administrator perlu memastikan tidak ada proses backup berjalan sebelum menghapus direktori kunci kosong tersebut.

Tampilan dan URL website tetap di Wasmer. Login tetap melalui backend yang ada; migrasi Supabase Auth dan Realtime belum termasuk tahap ini.

## Dokumentasi resmi

- [API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Membuat bucket](https://supabase.com/docs/guides/storage/buckets/creating-buckets)
- [Bucket privat](https://supabase.com/docs/guides/storage/buckets/fundamentals)
