// HADIRIN GPS engine (klien). Dipakai app karyawan (app.js) dan dites di scripts/test-gps.js.
// Masalah yang diselesaikan ("GPS belum terbaca" padahal GPS aktif):
//  1. Umur titik lokasi dihitung dari WAKTU TIBA di app, bukan p.timestamp (beberapa HP memberi timestamp salah/lama, titik langsung dianggap basi).
//  2. watchPosition di sebagian HP hanya menembak saat posisi BERUBAH: pengguna yang diam dulu dianggap "tidak ada GPS" setelah 20 dtk.
//     Sekarang ada watchdog yang menembak getCurrentPosition berkala dan memulai ulang pemantauan bila sunyi.
//  3. Dua pemantau paralel: jaringan/WiFi (cepat, tembus ruangan) + GPS akurat. Sebelumnya hanya satu tembakan jaringan lalu GPS saja.
//  4. Kesalahan code 2 (POSITION_UNAVAILABLE) dan 3 (TIMEOUT) dulu diabaikan begitu saja; sekarang dicatat, dipulihkan otomatis, dan pesannya sesuai penyebab.
//  5. Izin lokasi dipantau (Permissions API): begitu pengguna mengizinkan, GPS langsung jalan tanpa muat ulang.
const GPS = (() => {
  const TTL = 120000, FRESH = 30000, SCAN_ACC = 150, MAXKEEP = 8;
  const distM = (a, b, c, d) => { const r = (x) => (x * Math.PI) / 180, h = Math.sin(r(c - a) / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(r(d - b) / 2) ** 2; return 2 * 6371000 * Math.asin(Math.sqrt(h)); };   // rumus sama dengan server (api/scan.js)
  const score = (f, n) => f.acc + ((n - f.t) / 1000) * 2;   // fix lebih akurat menang, tapi tiap detik umurnya dihitung 2 m (pengguna bisa bergerak)
  const pick = (fixes, n) => fixes.reduce((b, f) => (!b || score(f, n) < score(b, n) ? f : b), null);
  const errText = (code) => code === 1 ? 'Izin lokasi ditolak. Izinkan akses lokasi untuk HADIRIN di pengaturan browser/HP.'
    : code === 2 ? 'Lokasi tidak tersedia. Pastikan Lokasi/GPS HP aktif, lalu coba lagi.'
    : 'Lokasi belum terbaca (waktu habis). Pindah ke area terbuka atau dekat jendela, lalu coba lagi.';

  // Status chip dari keadaan saat ini. Fungsi murni (mudah dites).
  // s = { fix:{lat,lng,acc,t}|null, office:{lat,lng,r}|null, now, since, err, denied, unsupported }
  function evaluate(s) {
    const wait = (text) => ({ ok: false, out: false, kind: 'wait', text }), bad = (text) => ({ ok: false, out: false, kind: 'error', text });
    if (s.unsupported) return bad('Perangkat/browser ini tidak mendukung GPS');
    if (s.denied) return bad('Aktifkan izin lokasi untuk HADIRIN');
    const f = s.fix;
    if (!f) {
      const age = s.now - s.since;
      if (age < 8000) return wait('Mencari lokasi...');
      if (s.err === 2) return bad('Sinyal lokasi belum ada. Pastikan GPS aktif. Ketuk untuk coba lagi');
      if (age < 30000) return wait('Masih mencari lokasi...');
      return bad('GPS belum terbaca. Ketuk untuk coba lagi atau pindah ke area terbuka');
    }
    const a = Math.round(f.acc), o = s.office;
    if (!o) return { ok: true, out: false, kind: 'ok', text: `Lokasi terbaca (±${a} m)` };
    const d = Math.round(distM(o.lat, o.lng, f.lat, f.lng)), r = o.r;
    const out = { ok: false, out: true, kind: 'out', text: `Di luar area kantor: ${d} m (maks ${r} m)` }, inn = (t) => ({ ok: true, out: false, kind: 'ok', text: t });
    if (d - f.acc > r) return out;                                 // pasti di luar, bahkan di batas kemungkinan terbaik
    if (f.acc <= 50) return d <= r ? inn('Di area kantor') : out;
    if (d + f.acc <= r) return inn('Di area kantor');             // pasti di dalam
    if (f.acc <= 100) return d <= r ? inn('Di area kantor (GPS kurang presisi)') : out;
    return wait(`Akurasi rendah (±${a} m), mencari sinyal lebih baik...`);
  }

  // env: { geo, perm, now, every, stopEvery, setT, clearT } semuanya bisa diganti saat tes
  function create(env = {}) {
    const geo = env.geo, perm = env.perm, now = env.now || Date.now, every = env.every || setInterval, stopEvery = env.stopEvery || clearInterval, setT = env.setT || setTimeout, clearT = env.clearT || clearTimeout;
    let fixes = [], wLo = null, wHi = null, timer = null, running = false, since = 0, lastFixAt = 0, lastPoll = 0, lastRestart = 0, pollHi = false, err = null, denied = false, idleT = null, permSt = null;
    const subs = new Set(), waiters = new Set();
    const prune = () => { const n = now(); fixes = fixes.filter((f) => n - f.t < TTL).slice(-MAXKEEP); };
    const best = () => { prune(); return pick(fixes, now()); };
    const state = () => ({ fix: best(), since, err, denied, unsupported: !geo, now: now() });
    const emit = () => subs.forEach((f) => { try { f(state()); } catch {} });
    const add = (p) => {
      const c = p && p.coords; if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude) || Math.abs(c.latitude) > 90 || Math.abs(c.longitude) > 180) return;
      fixes.push({ lat: c.latitude, lng: c.longitude, acc: Number.isFinite(c.accuracy) && c.accuracy > 0 ? c.accuracy : 150, t: now() });   // umur dari waktu tiba, bukan p.timestamp
      lastFixAt = now(); err = null; denied = false; prune(); emit(); waiters.forEach((w) => w());
    };
    const fail = (e) => { if (e && e.code === 1) denied = true; else err = (e && e.code) || 2; emit(); };
    const watchers = () => {
      stopWatchers();
      try { wLo = geo.watchPosition(add, fail, { enableHighAccuracy: false, maximumAge: 30000, timeout: 20000 }); } catch {}   // jaringan/WiFi: cepat, tembus ruangan
      try { wHi = geo.watchPosition(add, fail, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }); } catch {}       // GPS akurat paralel
      lastRestart = now();
    };
    const stopWatchers = () => { try { if (wLo != null) geo.clearWatch(wLo); if (wHi != null) geo.clearWatch(wHi); } catch {} wLo = wHi = null; };
    const poll = () => {   // tembakan sekali, bergantian jaringan / GPS akurat
      if (!geo) return; lastPoll = now(); pollHi = !pollHi;
      try { geo.getCurrentPosition(add, fail, { enableHighAccuracy: pollHi, maximumAge: pollHi ? 0 : 60000, timeout: 15000 }); } catch {}
    };
    const applyPerm = (st) => { if (st === 'denied') { denied = true; emit(); } else if (st === 'granted' && denied) { denied = false; err = null; if (running) { watchers(); poll(); } emit(); } };
    const tick = () => {
      if (!running) return; const n = now(), quiet = n - (lastFixAt || since);
      if (!denied && geo) {
        if (quiet > 20000 && n - lastPoll > 15000) poll();                 // watch sunyi (HP diam / watch macet): tembak sendiri
        if (quiet > 45000 && n - lastRestart > 45000) { watchers(); poll(); }   // sunyi terlalu lama: daftar ulang pemantau
      }
      emit();   // segarkan teks berbasis waktu ("Mencari..." -> "belum terbaca")
    };
    function start() {
      clearT(idleT); idleT = null; if (running) return emit(); running = true; since = now(); err = null;
      if (!geo) return emit();
      lastFixAt = 0;   // hitungan "sunyi" mulai dari sekarang
      try { geo.getCurrentPosition(add, fail, { enableHighAccuracy: false, maximumAge: 120000, timeout: 10000 }); lastPoll = now(); } catch {}   // titik cepat dari cache/jaringan
      watchers(); timer = every(tick, 2000);
      if (perm && perm.query && !permSt) { try { perm.query({ name: 'geolocation' }).then((p) => { permSt = p; applyPerm(p.state); p.onchange = () => applyPerm(p.state); }).catch(() => {}); } catch {} }
      else if (permSt) applyPerm(permSt.state);
      emit();
    }
    function stop() { clearT(idleT); idleT = null; running = false; if (timer != null) stopEvery(timer); timer = null; stopWatchers(); }
    const stopLater = (ms) => { clearT(idleT); idleT = setT(stop, ms); };   // dibiarkan hangat sebentar (pindah tab), lalu dimatikan hemat baterai
    function restart() { stop(); denied = false; start(); poll(); }   // ketuk chip: ulangi pencarian
    const mk = (code) => { const e = new Error(errText(code)); e.code = code; return e; };
    // Titik untuk scan: pakai yang terbaik; bila belum cukup akurat/segar tunggu sebentar; bila belum ada sama sekali tembak langsung.
    async function getFix(o = {}) {
      const wait = o.wait ?? 5000, good = o.good ?? SCAN_ACC;
      if (!geo) throw mk(2);
      if (denied) throw mk(1);
      const ok = () => { const f = best(); return f && f.acc <= good && now() - f.t <= FRESH ? f : null; };
      let f = ok();
      if (!f) {
        if (running && now() - lastPoll > 3000) poll();
        await new Promise((res) => { let t; const done = () => { clearT(t); waiters.delete(chk); res(); }, chk = () => { if (ok()) done(); }; t = setT(done, wait); waiters.add(chk); });
        f = ok() || best();
      }
      if (!f) f = await new Promise((resolve, reject) => {   // belum ada titik sama sekali: jaringan dan GPS ditembak bersamaan, yang pertama berhasil dipakai
        let left = 2, fin = false, last;
        const bad = (e) => { last = e; if (!fin && --left === 0) reject(mk((last && last.code) || 2)); };
        const good2 = (p) => { if (fin) return; fin = true; add(p); resolve(best()); };
        try { geo.getCurrentPosition(good2, bad, { enableHighAccuracy: false, maximumAge: 120000, timeout: 12000 }); } catch { bad({ code: 2 }); }
        try { geo.getCurrentPosition(good2, bad, { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }); } catch { bad({ code: 2 }); }
      });
      return { latitude: f.lat, longitude: f.lng, accuracy: f.acc };
    }
    return { start, stop, stopLater, restart, getFix, tick, state, best, on: (fn) => { subs.add(fn); return () => subs.delete(fn); }, get running() { return running; } };
  }
  return { create, evaluate, distM, errText, SCAN_ACC };
})();
