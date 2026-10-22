# Build Wasmer untuk Layanan Surat

Folder ini adalah paket deploy terpisah. Tidak berisi database lokal atau berkas uji.

Alamat aplikasi: https://layanan-surat-smk-amanah.wasmer.app

Dashboard: https://wasmer.io/apps/alghifari1235/layanansuratdigitalsmkamanah

## Backend aktif

Sejak 21 Oktober 2026, `AMANA_BACKEND=supabase`: pengajuan, sesi, dan pembatasan login berada di PostgreSQL Supabase; dokumen memakai bucket privat `amanah-documents`. Konfigurasi runtime memerlukan `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, dan `SUPABASE_STORAGE_BUCKET`. Lihat [panduan Supabase](../supabase/README.md).

Volume `/data` tetap dipakai untuk ZIP backup dan sumber dokumen sebelum cutover. MySQL lama dipertahankan untuk kebutuhan pemulihan; tidak ada sinkronisasi dua arah. Bagian bootstrap/koneksi MySQL di bawah hanya berlaku ketika `AMANA_BACKEND=mysql`.

## Sinkronkan halaman

Dari folder `layanan-surat`, jalankan:

```powershell
.\prepare-wasmer.ps1
```

Script menyalin halaman HTML, CSS, dan JavaScript terkini ke `wasmer-edge/app/`, tanpa menyalin `data/` lokal.

## Secrets dan deploy

1. `owner` dalam `app.yaml` sudah disetel ke `alghifari1235`.
2. Login dengan `wasmer login`.
3. Siapkan `AMANA_TU_USER`, `AMANA_TU_PASSWORD`, `AMANA_PRINCIPAL_USER`, dan `AMANA_PRINCIPAL_PASSWORD` sebagai environment variables runtime. Gunakan username/password berbeda dan password minimal 16 karakter. Akun langsung masuk sesuai perannya; akun admin bersama lama tidak dipakai. Lihat [panduan akun petugas](../STAFF_ACCOUNTS.md).
4. Jalankan `wasmer deploy`. Deployment pertama membuat database MySQL terkelola dan volume `surat-files`; perubahan atau penghapusan nama volume dapat menghapus berkas yang ada.
5. Uji `/api/health`, login TU dan Kepsek, pengajuan baru, pelacakan, serta unggah dan unduh berkas dari URL Wasmer.

Jika CLI yang dijalankan dari editor melaporkan tidak dapat menemukan direktori Wasmer, set `$env:WASMER_DIR = Join-Path $env:USERPROFILE '.wasmer'` pada terminal tersebut. Setelah mengubah Secrets, lakukan redeploy agar instance memakai nilai terbaru.

CLI 7.5.0 menolak format `health_checks` dari dokumentasi dengan pesan `expected a Value::Tagged enum`. Konfigurasi ini tidak memasang pemeriksaan otomatis tersebut; `/api/health` tetap tersedia untuk pemeriksaan manual database dan volume.

Database dan file di paket ini akan mulai kosong. Data demo pada server PowerShell lokal tidak disalin atau diimpor.

## Sesi admin

Setiap perangkat/browser harus login sendiri. Beberapa perangkat boleh aktif bersamaan, dengan token acak terpisah dan masa berlaku maksimal 8 jam. Logout membatalkan token perangkat tersebut pada server. Cookie memakai `HttpOnly`, `Secure`, dan `SameSite=Strict`. Halaman `tu.html` diperiksa di server dan diarahkan ke login jika belum memiliki sesi serta peran petugas.

Hash token terikat pada konfigurasi username/password. Mengubah kredensial dan melakukan redeploy membatalkan semua sesi lama. Pembaruan dari format hash sesi lama juga mengharuskan petugas login ulang satu kali.

Wasmer Edge dapat menjalankan beberapa instance. Server PHP disetel `single_concurrency`; backend aktif menyimpan pengajuan/sesi di Supabase serta berkas di Storage privat. ZIP backup tetap di volume `/data`. Simpan salinan backup secara terpisah.

## Sinkronisasi dan waktu tunggu

Dashboard mengecek revisi sekitar tiap 1 detik tanpa permintaan bertumpuk. Endpoint daftar memakai ETag; jika tidak berubah, server mengirim 304 tanpa daftar JSON. Revisi pada `application_sync` dinaikkan dalam transaksi yang sama dengan insert/update pengajuan. Keputusan petugas mengembalikan record tersimpan agar layar pengirim tidak menunggu GET tambahan. Pengajuan dan keputusan tetap baru dianggap berhasil setelah transaksi server selesai.

Bootstrap tabel dijalankan sekali per versi skema/instance melalui marker pada direktori sementara. Marker hanya optimasi; kegagalan menulisnya tidak menghalangi database. Ubah versi marker bila skema berubah. Koneksi MySQL persisten dibatasi satu per proses dengan rollback otomatis; set `AMANA_DB_PERSISTENT=0` dan redeploy untuk menonaktifkannya bila diperlukan. Lihat [mekanisme koneksi persisten MySQLi](https://www.php.net/manual/en/mysqli.persistconns.php).

Header `Server-Timing` membantu memisahkan waktu database/aplikasi dari latensi jaringan. Waktu unggah tetap bergantung pada ukuran berkas dan koneksi pengguna.
