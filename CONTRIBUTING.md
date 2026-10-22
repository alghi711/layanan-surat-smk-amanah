# Kolaborasi proyek

## Mulai bekerja

```powershell
git clone https://github.com/alghi711/layanan-surat-smk-amanah.git
cd layanan-surat-smk-amanah
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\serve.ps1
```

Buka http://localhost:8001. Lihat README.md untuk akun pengembangan lokal dan STAFF_ACCOUNTS.md untuk akun production.

## Mengirim perubahan

```powershell
git switch main
git pull --ff-only
git switch -c fitur/nama-perubahan
# Edit file sesuai kebutuhan.
git add nama-file-yang-diubah
git commit -m "Jelaskan perubahan"
git push -u origin fitur/nama-perubahan
```

Buat Pull Request di GitHub dengan tujuan branch main. Jelaskan perubahan dan pemeriksaan yang dilakukan. Minta rekan meninjau sebelum digabungkan.

## Letak kode

- HTML, CSS, JavaScript, dan assets utama ada di folder paling atas.
- Backend PHP ada di wasmer-edge/app/.
- SQL Supabase ada di supabase/.
- Setelah mengubah frontend, jalankan prepare-wasmer.ps1 untuk menyalin file ke paket Wasmer. Hindari mengedit salinan frontend di wasmer-edge/app/ langsung.
- Deployment mengikuti DEPLOYMENT.md. Push GitHub sendiri tidak menerbitkan perubahan ke Wasmer.

## Data dan konfigurasi

Gunakan data contoh lokal untuk pengembangan. Secret production dipasang melalui environment variables Wasmer. Jangan commit .env, folder data, backups, private, atau wasmer-edge/config/authorization. Gambar tanda tangan dan stempel tidak disertakan dalam clone; fitur pengesahan memerlukan aset privat yang disediakan sekolah secara terpisah.
