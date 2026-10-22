# Portal Layanan Surat SMK Amanah

Prototipe portal surat sekolah untuk orang tua/wali, Tata Usaha, dan Kepala Sekolah.

## Menjalankan secara lokal

Jalankan dari folder `layanan-surat`:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\serve.ps1
```

Buka `http://localhost:8001`. Akun pengembangan lokal: `tu` / `TU-local-amanah123!` dan `kepsek` / `Kepsek-local-amanah123!`. Untuk production, atur akun berbeda sesuai [panduan akun petugas](STAFF_ACCOUNTS.md).

## Alur dan fitur

- Orang tua mengisi formulir empat tahap. Draf tersimpan di browser; pengajuan, dokumen, dan status tersimpan oleh server.
- Pengajuan aktif dengan NIS/NISN dan jenis surat yang sama ditolak sebagai duplikat. Spasi, titik, dan tanda hubung pada NIS/NISN diabaikan. Status aktif: menunggu TU, disetujui TU, atau menunggu Kepsek. Setelah selesai atau ditolak, siswa boleh mengajukan jenis surat yang sama kembali. Wasmer memakai kunci per siswa/jenis selama transaksi agar pengiriman bersamaan tidak membuat dua record. Nomor pelacakan lama hanya dikembalikan jika nomor WhatsApp cocok; peringatan lainnya mengarahkan pemohon ke TU. Draf dan isian formulir tetap dipertahankan.
- Server membuat nomor pelacakan dengan token acak. Orang tua dapat melihat status, catatan, riwayat perubahan, dan mengunduh surat yang sudah disetujui.
- Tata Usaha meninjau data, menyetujui atau menolak dengan catatan, lalu mengunggah surat.
- Semua jenis pengajuan yang sudah disetujui TU dapat memakai **Buat surat**. Editor umum menyediakan judul, nomor, tujuan/penerima, pembuka, isi, penutup, tempat/tanggal, serta jabatan/nama penandatangan dan NIP. Tabel identitas siswa opsional: nama/NIS/kelas terisi otomatis dan dapat disesuaikan hanya untuk dokumen. Kop resmi dan garis sisi kiri mengikuti PDF contoh pengguna; aset kop tidak memuat data siswa contoh. Setelah pratinjau A4 dan konfirmasi, PDF dapat diunduh atau langsung diteruskan ke Kepsek. Batas satu halaman A4; isi terlalu panjang diminta diringkas. Nomor, tanda tangan, dan stempel tidak dibuat otomatis. Pengaturan sekolah diingat di perangkat. Tombol **Simpan draf** menyimpan isian (termasuk yang belum lengkap) ke database per pengajuan, sehingga TU dapat melanjutkan dari perangkat lain. **Muat draf terbaru** mengambil versi server; versi yang berbeda tidak ditimpa otomatis. Draf hanya dapat diedit TU saat status disetujui TU. Sebelum meneruskan PDF, isian disimpan dan versi draf diperiksa kembali oleh server. Draf tidak dikirim melalui API pelacakan publik dan otomatis tercakup dalam backup record. PDF berupa halaman beresolusi tinggi, sehingga teksnya tidak dapat diseleksi. Unggah berkas manual tetap tersedia.
- Kepala Sekolah meninjau surat, lalu memakai **Tanda tangan & stempel** untuk menggeser dan mengatur ukuran gambar pengesahan yang disediakan sekolah. Halaman penempatan dapat dipilih per aset, termasuk PDF beberapa halaman atau surat JPG/PNG. Kepsek memeriksa pratinjau PDF hasil, mencentang konfirmasi, lalu **Setujui & terbitkan surat**. Hasil PDF menjadi unduhan pemohon; surat sumber disimpan terpisah. Penolakan dengan catatan tetap tersedia.
- Nama Kepala SMK Amanah ditetapkan **MARTIN EKA SUPIANTI., S.T.** pada editor, renderer surat, validasi draf, dan metadata pengesahan. Gambar asli berada di `private/signing/`, disalin oleh persiapan deployment ke `/config/authorization/`. API aset hanya dapat dibaca sesi Kepsek; jangan memindahkannya ke folder aset publik. PDF-LIB dan PDF.js disertakan lokal beserta lisensinya, sehingga surat dan gambar tidak dikirim ke layanan pemrosesan eksternal.
- Login admin menggunakan cookie `HttpOnly`, `SameSite=Strict`, dengan sesi server selama delapan jam. Server memeriksa peran aktif pada API petugas dan membatasi percobaan login.
- Dokumen pendukung dibatasi 5 MB; surat dibatasi 10 MB. Format yang diterima PDF, JPG, dan PNG.
- Menu **Backup data** tersedia untuk petugas: membuat dan mengunduh arsip pengajuan beserta dokumen. Di Wasmer, backup juga dijadwalkan setiap 24 jam dan setelah deployment. Panduan pemeriksaan dan pemulihan: [BACKUP.md](BACKUP.md).
- Menu **Rekap laporan** menampilkan seluruh status pengajuan, dengan filter tanggal pengajuan (WIB), jenis surat, jurusan, status, dan pencarian. Tersedia periode cepat, ringkasan, ekspor Excel `.xlsx` (Ringkasan dan Data Pengajuan), serta cetak seluruh hasil filter. Halaman `rekap.html` dan sumber datanya memerlukan sesi petugas. Pembaruan otomatis setiap 15 detik saat halaman terlihat.
- Pada detail pengajuan, **Siapkan pesan WhatsApp** membuka pratinjau berisi penerima, status, catatan keputusan, dan tautan pelacakan. Petugas dapat menyunting pesan lalu melanjutkan ke WhatsApp dan mengirim sendiri. Nomor Indonesia `08`/`8` dinormalisasi menjadi `628`; nomor internasional juga didukung. Perubahan data saat pratinjau terbuka meminta pembuatan ulang draf. Tombol ini tidak mengirim otomatis atau mencatat bukti pengiriman. Format tautan mengikuti [panduan click to chat WhatsApp](https://faq.whatsapp.com/5913398998672934).

## Penyimpanan lokal

- Database: `data/applications.json`
- Dokumen pendukung: `data/documents/`
- Surat: `data/letters/`
- Draf formulir: penyimpanan lokal browser

Lokasi data dapat diarahkan ke volume persisten dengan variabel `AMANA_DATA_DIR`. Jika tidak diatur, server memakai folder `data` di samping `serve.ps1`.

Lakukan backup berkala dan uji pemulihan. Jangan hapus atau membagikan folder `data` karena dapat berisi data pribadi dan dokumen siswa.

## Konfigurasi server

Untuk production, atur variabel lingkungan berikut sebelum menjalankan server:

```powershell
$env:AMANA_ENV = 'production'
$env:AMANA_TU_USER = '<username-TU>'
$env:AMANA_TU_PASSWORD = '<password-TU-minimal-16-karakter>'
$env:AMANA_PRINCIPAL_USER = '<username-kepala-sekolah>'
$env:AMANA_PRINCIPAL_PASSWORD = '<password-kepala-sekolah-minimal-16-karakter>'
$env:AMANA_COOKIE_SECURE = '1'
$env:AMANA_BIND_ADDRESS = '127.0.0.1'
$env:AMANA_PORT = '8001'
$env:AMANA_DATA_DIR = 'D:\amanah-data\layanan-surat'
```

Password production wajib minimal 16 karakter. Jalankan di belakang reverse proxy HTTPS yang meneruskan permintaan ke server lokal. Jangan membuka port server langsung ke internet. Server ini masih menyimpan data dalam satu file JSON lokal; untuk penggunaan sekolah nyata, pindahkan data ke database yang didukung dan siapkan backup, pemantauan, serta kebijakan retensi. Lihat [DEPLOYMENT.md](DEPLOYMENT.md) untuk panduan rilis.

## Paket Wasmer

Paket deploy PHP untuk Wasmer Edge ada di `wasmer-edge/`. Backend production memakai PostgreSQL dan Storage privat Supabase; MySQL tersedia untuk sumber lama. Jalankan `prepare-wasmer.ps1` sebelum deploy agar halaman dan skema backup tersalin terbaru. Data lokal tidak diimpor otomatis. Ikuti [panduan Supabase](supabase/README.md), [README paket Wasmer](wasmer-edge/README.md), dan [panduan deploy](DEPLOYMENT.md).

## Sebelum deploy

- Bersihkan data uji di `data/applications.json` dan berkas yang terkait di `data/documents/` atau `data/letters/`. Nomor pelacakan lama memiliki format demo; kirim hanya kode baru setelah basis data uji dibersihkan.
- Jangan deploy dengan akun demo. Atur kredensial production dan HTTPS seperti di atas.
- Notifikasi email belum tersedia. Formulir tidak akan mengirim email meskipun orang tua mengisi alamat email.
- Data yang ada sebelum pencatatan riwayat tahap ditambahkan tidak memiliki waktu per tahap yang akurat.
- Lindungi endpoint publik dari spam dan tambahkan validasi operasional serta pemantauan sebelum membuka layanan untuk umum.

Server lokal ini adalah prototipe untuk evaluasi. Review keamanan dan uji pemulihan database tetap diperlukan sebelum memproses data siswa sungguhan.
