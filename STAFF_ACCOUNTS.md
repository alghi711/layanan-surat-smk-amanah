# Akun TU dan Kepala Sekolah

Login melalui `admin.html`. Username/password menentukan peran; pengguna tidak memilih atau berpindah peran setelah login.

| Akun | Tugas |
| --- | --- |
| Tata Usaha | Mengajukan surat, memeriksa pengajuan orang tua, menyimpan draf, membuat/mengunggah surat, meneruskan ke Kepala Sekolah |
| Kepala Sekolah | Meninjau surat dari TU, menempatkan tanda tangan/stempel, menyetujui penerbitan, atau menolak dengan catatan |

Backend memeriksa peran setiap perubahan status. TU tidak dapat menyetujui sebagai Kepala Sekolah; Kepala Sekolah tidak dapat menyimpan draf atau meneruskan surat sebagai TU. Rekap dan backup tetap tersedia untuk kedua peran.

## Production Wasmer

Tambahkan ke Environment Variables untuk runtime/server:

```text
AMANA_TU_USER=<username-TU>
AMANA_TU_PASSWORD=<password-TU-minimal-16-karakter>
AMANA_PRINCIPAL_USER=<username-kepala-sekolah>
AMANA_PRINCIPAL_PASSWORD=<password-kepala-sekolah-minimal-16-karakter>
```

Kedua username dan password harus berbeda. Jangan menaruh nilainya di source code atau JavaScript browser. `AMANA_ADMIN_USER` dan `AMANA_ADMIN_PASSWORD` lama tidak dipakai lagi oleh kode login baru.

Peran sesi Supabase diatur oleh PHP setelah kredensial cocok, sebelum cookie diberikan. Endpoint `/api/select-role` menolak peran yang berbeda dari sesi; query URL seperti `?role=principal` tidak menentukan izin akun. Tidak perlu menjalankan SQL tambahan untuk pemisahan akun ini.

Sesi admin bersama yang lama tidak berlaku setelah deployment. Perubahan kredensial salah satu akun mengubah kunci sesi dan meminta seluruh petugas login kembali. Beberapa perangkat tetap boleh aktif, masing-masing memakai sesi login sendiri. Logout mengakhiri sesi perangkat tersebut.

## Lokal untuk pengembangan

`serve.ps1` memakai empat variabel yang sama. Jika `AMANA_ENV` bukan `production` dan variabel belum diatur, akun lokal bawaan adalah:

- TU: `tu` / `TU-local-amanah123!`
- Kepala Sekolah: `kepsek` / `Kepsek-local-amanah123!`

Kredensial bawaan tersebut hanya berlaku untuk pengembangan. Pada `production`, empat variabel wajib diisi; tidak ada fallback ke akun admin bersama.
