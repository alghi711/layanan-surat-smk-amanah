# Backup data sekolah

## Membuat dan mengunduh

1. Login admin, buka dashboard TU atau Kepsek, lalu pilih **Backup data**.
2. Klik **Buat backup** dan tunggu hingga selesai.
3. Unduh ZIP dari daftar backup. Simpan salinan di penyimpanan sekolah yang aksesnya dibatasi.

Di Wasmer, backup dijadwalkan setiap 24 jam dan setelah deployment. Server lokal PowerShell mendukung backup manual. Daftar menampilkan maksimal 20 backup terbaru; arsip lama tetap disimpan dan tidak otomatis dihapus.

ZIP berisi seluruh data pengajuan, dokumen pendukung, surat yang diunggah, skema database, dan manifest checksum SHA256. Password dan sesi login tidak disertakan. Backup dihentikan jika berkas yang dirujuk pengajuan tidak ditemukan.

Draf surat yang telah disimpan ke database termasuk dalam record pengajuan pada backup. Isian yang belum disimpan dari editor belum masuk ke backup.

Setelah pengesahan Kepsek, backup mencakup PDF hasil dan surat sumber (`originalLetterPath`). Gambar tanda tangan/stempel sebagai aset aplikasi berada di `private/signing/` pada proyek dan `/config/authorization/` dalam paket Wasmer; simpan salinan privatnya bersama proyek. Arsip data pengajuan memuat gambar yang sudah digabung ke PDF, tetapi tidak mencadangkan folder konfigurasi paket aplikasi.

Arsip di hosting berada di volume privat `/data/backups`. Backup otomatis ini memakai volume hosting yang sama; salinan terpisah perlu diunduh berkala. Pengiriman otomatis ke penyimpanan di luar Wasmer belum dikonfigurasi. ZIP belum dienkripsi, sehingga hanya boleh disimpan oleh petugas yang berwenang.

## Memeriksa dan menyiapkan pemulihan

Jalankan dari folder `layanan-surat`:

```powershell
# Memeriksa seluruh isi tanpa mengekstrak
.\restore-backup.ps1 -Archive '.\backups\nama-backup.zip'

# Opsional: cocokkan checksum arsip dari metadata atau file .sha256
.\restore-backup.ps1 -Archive '.\backups\nama-backup.zip' -ExpectedSha256 '<sha256>'

# Menyiapkan pemulihan ke folder BARU yang belum ada
.\restore-backup.ps1 -Archive '.\backups\nama-backup.zip' -ExtractTo '.\backups\pemulihan-baru'
```

Script memeriksa manifest, checksum setiap berkas, jumlah pengajuan, dan referensi dokumen. Folder pemulihan berisi:

- `data/applications.json`, `data/documents/`, `data/letters/`: data untuk server lokal.
- `schema.sql`: skema MySQL atau PostgreSQL Supabase, sesuai penyedia pada manifest.
- `restore.sql`: data pengajuan untuk database baru yang kosong, setelah skema dibuat. Untuk backup Supabase, skrip menghasilkan SQL PostgreSQL.

Script tidak mengimpor SQL atau menimpa database produksi. Pemulihan MySQL harus dilakukan terpisah: siapkan database kosong, terapkan skema, impor `restore.sql`, dan salin dokumen ke penyimpanan privat. Periksa hasil di lingkungan terpisah sebelum mengganti layanan aktif.

Untuk pemulihan Supabase, gunakan project kosong: jalankan `schema.sql`, impor `restore.sql`, lalu unggah setiap berkas pada `data/documents/` dan `data/letters/` ke folder `documents/` dan `letters/` dalam bucket privat `amanah-documents`, dengan nama yang sama. Verifikasi semua checksum sebelum mengaktifkan project pemulihan. Proses ekstraksi tidak mengunggah atau mengimpor data secara otomatis. Sumber data baru memakai Supabase, sedangkan ZIP backup tetap berada di volume Wasmer.

## Salinan awal yang telah diperiksa

19 Oktober 2026: `backups/amanah-20261019-113139-cafe85df.zip`, berisi 5 pengajuan dan 4 dokumen. Checksum arsip cocok dengan hosting, seluruh checksum isi valid, dan ekstraksi pemulihan berhasil di `backups/verified-amanah-20261019-113139-cafe85df/`. Pengujian ini tidak mengimpor ulang database produksi.

Folder `backups/` dan `restore-check/` dikecualikan dari Git dan akses file statis server lokal. Paket Wasmer tidak menyertakan kedua folder tersebut.
