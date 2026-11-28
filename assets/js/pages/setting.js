Pages.setting = () => {
  const DEF = [{ out: '11:40', back: '12:40', due: '13:00', grace: 15 }, { out: '14:40', back: '15:40', due: '16:00', grace: 15 }];
  const setBrk = (v) => { const d = Array.isArray(v) && v.length === 2 ? v : DEF; $('#o1').value = d[0].out; $('#b1').value = d[0].back; $('#o2').value = d[1].out; $('#b2').value = d[1].back; $('#d1').value = d[0].due || DEF[0].due; $('#d2').value = d[1].due || DEF[1].due; $('#gr').value = Number.isInteger(d[0].grace) ? d[0].grace : DEF[0].grace; };
  (async () => {
    const { data: s } = await sb.from('settings').select('*').eq('id', 1).single(); if (!s || !$('#lat')) return;
    $('#lat').value = s.office_lat; $('#lng').value = s.office_lng; $('#rad').value = s.radius_m; $('#tm').value = s.target_minutes || 480; setBrk(s.break_slots);
  })();
  // Titik kantor menentukan semua absen: ambil beberapa titik GPS akurat selama maks 12 dtk dan pakai yang paling akurat (dulu: satu titik pertama, bisa meleset ratusan meter)
  $('#loc').onclick = () => {
    const btn = $('#loc'), geo = navigator.geolocation; if (!geo) return toast('Browser tidak mendukung GPS', false);
    const html = btn.innerHTML; let best = null, id, t, fin = false; btn.disabled = true; btn.textContent = 'Mengambil lokasi...';
    const done = (denied) => {
      if (fin) return; fin = true; geo.clearWatch(id); clearTimeout(t); btn.disabled = false; btn.innerHTML = html;
      if (denied) return toast('Izin lokasi ditolak. Izinkan akses lokasi di pengaturan browser', false);
      if (!best) return toast('Lokasi belum terbaca. Aktifkan GPS lalu coba lagi di area terbuka', false);
      $('#lat').value = best.latitude.toFixed(6); $('#lng').value = best.longitude.toFixed(6);
      toast(`Lokasi terisi (akurasi ±${Math.round(best.accuracy)} m)` + (best.accuracy > 50 ? '. Kurang presisi, coba lagi di area terbuka' : ''), best.accuracy <= 50);
    };
    id = geo.watchPosition((p) => { if (!best || p.coords.accuracy < best.accuracy) best = p.coords; if (best.accuracy <= 15) done(); }, (e) => { if (e.code === 1) done(true); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    t = setTimeout(() => done(), 12000);
  };
  $('#f1').onsubmit = async (e) => {
    e.preventDefault(); const { error } = await sb.from('settings').update({ office_lat: +$('#lat').value, office_lng: +$('#lng').value, radius_m: +$('#rad').value, target_minutes: +$('#tm').value }).eq('id', 1);
    error ? toast(error.message, false) : toast('Setting tersimpan');
  };
  $('#brk-def').onclick = () => setBrk(DEF);
  $('#f3').onsubmit = async (e) => {
    e.preventDefault(); const o1 = $('#o1').value, b1 = $('#b1').value, d1 = $('#d1').value, o2 = $('#o2').value, b2 = $('#b2').value, d2 = $('#d2').value, gr = Math.round(+$('#gr').value);
    if (!(o1 < b1)) return toast('Istirahat pertama: scan masuk harus setelah scan keluar', false);
    if (!(b1 <= d1)) return toast('Istirahat pertama: jam masuk kembali tidak boleh sebelum scan masuk dibuka', false);
    if (!(d1 <= o2)) return toast('Istirahat kedua harus dimulai setelah jam masuk kembali istirahat pertama', false);
    if (!(b2 <= d2)) return toast('Istirahat kedua: jam masuk kembali tidak boleh sebelum scan masuk dibuka', false);
    if (!(gr >= 0 && gr <= 120)) return toast('Toleransi 0 sampai 120 menit', false);
    if (!(b1 <= o2)) return toast('Istirahat kedua harus dimulai setelah scan masuk istirahat pertama', false);
    if (!(o2 < b2)) return toast('Istirahat kedua: scan masuk harus setelah scan keluar', false);
    const { error } = await sb.from('settings').update({ break_slots: [{ out: o1, back: b1, due: d1, grace: gr }, { out: o2, back: b2, due: d2, grace: gr }] }).eq('id', 1);
    error ? toast(/break_slots/.test(error.message) ? 'Kolom break_slots belum ada: jalankan supabase/migration-jam-istirahat.sql di Supabase SQL Editor' : error.message, false) : toast('Jam istirahat tersimpan');
  };
  $('#f2').onsubmit = async (e) => {
    e.preventDefault(); if ($('#np').value !== $('#np2').value) return toast('Password tidak sama', false);
    const { error } = await sb.auth.updateUser({ password: $('#np').value }); error ? toast(error.message, false) : (toast('Password diubah'), e.target.reset());
  };
};
