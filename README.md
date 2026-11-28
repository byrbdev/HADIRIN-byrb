# HADIRIN By RB — sisi Admin (Spark Admin + Supabase)

## Jalankan lokal (tanpa Vercel)
1. `npm install`
2. Edit `.env`: isi `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `QR_SECRET`.
   - Cloud: proyek Supabase gratis, atau lokal penuh: `npx supabase start` (URL `http://127.0.0.1:54321`, key tampil di terminal).
3. Jalankan `supabase/schema.sql` di Supabase SQL Editor (tanpa baris komentar terakhir).
4. `npm run seed` → membuat admin default + 3 karyawan contoh.
5. `npm run dev` (dev-server.js) → buka http://localhost:3000

Akun default (dari `.env`): admin `admin@hadirin.test` / `admin12345`; karyawan `karyawan1..3@hadirin.test` / `karyawan123`.
Di mode dev, form login terisi otomatis.

## Deploy ke Vercel
Set env `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `QR_SECRET` di Vercel, lalu deploy.
Untuk produksi: ganti password default / hapus akun contoh, dan jangan set `HADIRIN_DEV`
(kredensial default hanya dikirim ke browser pada mode dev lokal).

## Aturan jam kerja (kerja bersih)
- Jam masuk bebas; sistem hanya mencatat scan masuk. Istirahat (dzuhur, ashar, dst.) dicatat lewat scan keluar/kembali
  (di app: pilih **Istirahat** lalu scan; scan berikutnya = kembali). Durasi = selisih scan; tidak ada batas minimal.
- **Jendela scan istirahat (dicek di server, WIB):** keluar istirahat ke-1 dibuka 11:40, ke-2 dibuka 14:40; scan masuk setelah
  istirahat ke-1 dibuka 12:40, ke-2 dibuka 15:40. Tiap istirahat hanya sekali. Angka ini bawaan; admin mengubahnya di **Setting > Jam Istirahat**
  (disimpan di `settings.break_slots`; **database lama:** jalankan `supabase/migration-jam-istirahat.sql` sekali). Bawaan ada di `BREAK_SLOTS` (`api/_hours.js` + `assets/js/hours.js`).
- **Toleransi masuk kembali:** tiap istirahat punya jam masuk kembali tepat waktu (bawaan **13:00** dan **16:00**) dan toleransi (bawaan **15 menit**, diatur di Setting).
  Scan masuk setelah istirahat yang telat tapi masih dalam toleransi dicatat tepat jam tersebut (scan 13:07 → dicatat 13:00, jadi tidak ada utang menit). Scan lebih awal dicatat jam aslinya; lewat toleransi dicatat jam aslinya.
  **Database lama:** jalankan `supabase/migration-toleransi-istirahat.sql` sekali (opsional, karena data lama otomatis memakai bawaan 13:00/16:00).
  Di app, scan istirahat/masuk yang berhasil menampilkan overlay "Selamat Istirahat" / "Selamat bekerja!".
- Kerja bersih = (sekarang atau jam pulang − jam masuk) − total istirahat. Pulang hanya boleh bila kerja bersih ≥ `target_minutes`
  (default 480 = 8 jam) dan tidak sedang istirahat. Jam pulang paling cepat = jam masuk + target + total istirahat.
- Tidak ada konsep telat masuk: jam masuk bebas, tidak ada data/kolom telat di app maupun laporan.
- Target diubah di Setting. Laporan admin memuat kolom Total Istirahat, Kerja Bersih (juga di Export CSV).
- **Database lama:** jalankan `supabase/migration-istirahat.sql` sekali di SQL Editor. Instalasi baru cukup `schema.sql`.
- Tes aturan: `npm run test:rules`. Logika hitung ada di `api/_hours.js` (server) dan `assets/js/hours.js` (klien); tes memastikan keduanya sama.

## Struktur admin (tanpa reload antar halaman)
- `assets/js/guard.js` jalan di `<head>`: tanpa sesi login langsung ke `/login`, dan halaman ditutup layar boot sampai admin terverifikasi (tidak ada kilatan dashboard).
- `assets/js/core.js` membangun sidebar/navbar sekali, lalu router menukar isi `#app-content` (fetch + prefetch, `history.pushState`).
- Tiap halaman punya skrip sendiri di `assets/js/pages/<nama>.js` (`Pages.nama = () => { ...; return cleanup }`). Cleanup menutup realtime, interval, dan modal saat pindah halaman.
- Jabatan: **Karyawan** (role `employee`, memakai app) atau **Admin** (role `admin`, masuk dashboard). NIP otomatis berawalan `RB-`.

## Catatan app karyawan
- Kamera tidak pernah dibuka sebelum status absen hari ini terbaca; bila gagal membaca (jaringan), kamera tetap tertutup dan dicoba ulang otomatis.
- Layar mati / pindah aplikasi = kamera dimatikan; saat kembali, status dibaca ulang dari server dulu.
- Kamera otomatis hanya terbuka: sebelum absen masuk, 40 menit sejak jam keluar istirahat dibuka, saat scan masuk setelah istirahat dibuka, dan saat sudah boleh pulang. Selain itu ketuk 2x.
  Aturannya ada di `HOURS.camWanted` (`assets/js/hours.js`). Pengecekan dijadwalkan **tepat** saat jendela berubah (`HOURS.nextEdge`), bukan menunggu polling 20 detik. Kamera manual (ketuk 2x) menutup sendiri setelah 90 detik.
- Hasil scan yang sudah diterima server langsung dipakai untuk memperbarui tampilan; pembacaan ulang status berjalan di latar belakang (dengan coba ulang). Jadi gangguan jaringan setelah scan tidak lagi menampilkan "Absen Gagal" untuk scan yang sebenarnya tercatat.
- Bila scan gagal, QR yang sama diabaikan sampai dijauhkan dari kamera (tidak mengulang error terus-menerus). Permintaan ke `/api/scan` punya batas waktu 20 detik.

## GPS app karyawan (`assets/js/gps.js`)
- Dua pemantau paralel: jaringan/WiFi (cepat, tembus ruangan) dan GPS akurat. Titik pertama diambil dari cache/jaringan.
- Umur titik dihitung dari waktu tiba di app (bukan `timestamp` HP). Titik dipakai sampai 2 menit, dan dipilih yang terbaik dengan memperhitungkan akurasi dan umur.
- Watchdog: bila tidak ada titik baru >20 dtk (HP diam), app menembak `getCurrentPosition` sendiri; >45 dtk sunyi, pemantau didaftarkan ulang. Error code 2/3 dicatat dan dipulihkan otomatis.
- Pesan status sesuai penyebab (izin ditolak / sinyal belum ada / masih mencari / akurasi rendah). Ketuk chip lokasi = ulangi pencarian. Bila izin diubah di pengaturan, app langsung memakainya tanpa muat ulang.
- **APK/WebView:** bila di sebagian HP GPS tetap tidak jalan sama sekali hanya di APK (bukan di Chrome), periksa sisi native: `ACCESS_FINE_LOCATION` diminta saat runtime, dan `WebChromeClient.onGeolocationPermissionsShowPrompt` meneruskan izin (`callback.invoke(origin, true, false)`). Tanpa itu WebView selalu error code 1/2 walau GPS HP menyala.
- Setting > "Pakai lokasi saya" kini mengumpulkan titik selama maks 12 dtk dan memakai yang paling akurat.

## Library lokal
`supabase-js` dan `jsQR` kini di `assets/libs/` (sebelumnya dari cdn.jsdelivr.net, yang bisa terblokir ISP). Service worker menyimpannya di cache.

## Tes
- `npm test` = `test:rules` (jam kerja + aturan kamera) + `test:gps` (mesin GPS, HP palsu) + `test:scan` (`api/scan.js`, database palsu).
- `npm i --no-save jsdom && node scripts/smoke-app.js` menjalankan `app.js` asli di jsdom (alur scan masuk, istirahat, kembali, gagal, GPS mati). jsdom sengaja tidak dijadikan dependency agar deploy Vercel tetap ringan.
