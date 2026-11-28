// npm run test:gps : menguji mesin GPS (assets/js/gps.js) dengan "HP palsu" yang meniru kasus nyata
// (timestamp salah, watch yang diam, GPS mati, izin ditolak lalu diizinkan, akurasi buruk di dalam ruangan).
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const ctx = {}; vm.runInNewContext(fs.readFileSync(new URL('../assets/js/gps.js', import.meta.url), 'utf8') + ';this.GPS=GPS', ctx);
const GPS = ctx.GPS;

// ---- jam & timer palsu ----
function World() {
  const w = { t: 1_000_000, timers: [], id: 0, calls: [], watches: new Map(), perm: null };
  w.now = () => w.t;
  w.setT = (fn, ms) => { const id = ++w.id; w.timers.push({ id, at: w.t + ms, fn }); return id; };
  w.clearT = (id) => { w.timers = w.timers.filter((x) => x.id !== id); };
  w.every = (fn, ms) => { const id = ++w.id; w.timers.push({ id, at: w.t + ms, fn, every: ms }); return id; };
  w.stopEvery = w.clearT;
  w.advance = (ms) => { const end = w.t + ms; for (;;) { const nx = w.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0]; if (!nx) break; w.t = nx.at; if (nx.every) nx.at += nx.every; else w.timers = w.timers.filter((x) => x !== nx); nx.fn(); } w.t = end; };
  w.geo = {
    getCurrentPosition: (ok, bad, o) => w.calls.push({ type: 'once', ok, bad, o }),
    watchPosition: (ok, bad, o) => { const id = ++w.id; w.watches.set(id, { ok, bad, o }); w.calls.push({ type: 'watch', o }); return id; },
    clearWatch: (id) => w.watches.delete(id),
  };
  w.fire = (c, { lat = -6.9175, lng = 107.6191, acc = 20, ts } = {}) => c.ok({ coords: { latitude: lat, longitude: lng, accuracy: acc }, timestamp: ts ?? w.t });
  w.onceCalls = () => w.calls.filter((c) => c.type === 'once');
  w.env = () => ({ geo: w.geo, perm: w.perm, now: w.now, setT: w.setT, clearT: w.clearT, every: w.every, stopEvery: w.stopEvery });
  return w;
}
const OFFICE = { lat: -6.9175, lng: 107.6191, r: 100 };
const ev = (g, w, office = OFFICE) => GPS.evaluate({ ...g.state(), office });
const m = (lat, dN) => lat + dN / 111320;   // geser ke utara dN meter

// 1. Titik pertama tampil; timestamp HP yang salah (1970) TIDAK membuatnya dianggap basi (penyebab utama "GPS belum terbaca")
{ const w = World(), g = GPS.create(w.env()); g.start();
  assert.equal(ev(g, w).text, 'Mencari lokasi...');
  const watch = [...w.watches.values()][0]; w.fire(watch, { acc: 20, ts: 0 });
  const e = ev(g, w); assert.equal(e.ok, true); assert.equal(e.text, 'Di area kantor'); g.stop(); }

// 2. Dua pemantau paralel (jaringan + GPS akurat) + titik cepat di awal
{ const w = World(), g = GPS.create(w.env()); g.start();
  const ws = w.calls.filter((c) => c.type === 'watch'); assert.equal(ws.length, 2);
  assert.deepEqual(ws.map((c) => c.o.enableHighAccuracy).sort(), [false, true]); assert.equal(w.onceCalls().length, 1); g.stop(); }

// 3. HP DIAM: watch tidak menembak lagi setelah titik pertama. Dulu setelah 20 dtk jadi "GPS belum terbaca"; sekarang tetap terbaca & ada polling mandiri
{ const w = World(), g = GPS.create(w.env()); g.start(); w.fire([...w.watches.values()][0], { acc: 15 });
  const before = w.onceCalls().length;
  w.advance(60000);
  assert.equal(ev(g, w).ok, true, 'titik 60 dtk lalu masih dipakai (TTL 120 dtk)');
  assert.ok(w.onceCalls().length > before, 'watchdog menembak getCurrentPosition sendiri');
  w.fire(w.onceCalls().at(-1), { acc: 12 }); assert.equal(ev(g, w).ok, true); g.stop(); }

// 4. GPS benar-benar sunyi lama: pemantau didaftarkan ulang, dan akhirnya pesan "belum terbaca" + bisa diketuk ulang
{ const w = World(), g = GPS.create(w.env()); g.start(); const w0 = w.calls.filter((c) => c.type === 'watch').length;
  w.advance(9000); assert.equal(ev(g, w).text, 'Masih mencari lokasi...');
  w.advance(21000); assert.match(ev(g, w).text, /^GPS belum terbaca\. Ketuk/);
  w.advance(20000); assert.ok(w.calls.filter((c) => c.type === 'watch').length > w0, 'pemantau didaftarkan ulang setelah >45 dtk sunyi');
  g.restart(); assert.ok(w.calls.filter((c) => c.type === 'watch').length > w0 + 2); g.stop(); }

// 5. Error code 2 (lokasi tidak tersedia) dicatat -> pesan yang sesuai (dulu diabaikan total). Code 3 (timeout) tidak dianggap fatal
{ const w = World(), g = GPS.create(w.env()); g.start(); const c = [...w.watches.values()][0];
  c.bad({ code: 2 }); w.advance(9000); assert.match(ev(g, w).text, /Sinyal lokasi belum ada/);
  w.fire(c, { acc: 30 }); assert.equal(ev(g, w).ok, true, 'pulih sendiri begitu titik datang'); g.stop();
  const w2 = World(), g2 = GPS.create(w2.env()); g2.start(); [...w2.watches.values()][0].bad({ code: 3 }); w2.advance(9000); assert.match(ev(g2, w2).text, /Masih mencari/); g2.stop(); }

// 6. Izin ditolak -> pesan izin; saat pengguna mengizinkan (Permissions API) langsung jalan lagi tanpa muat ulang
{ const w = World(); let st = 'denied'; const perm = { state: st, onchange: null }; w.perm = { query: async () => perm };
  const g = GPS.create(w.env()); g.start(); await Promise.resolve(); await Promise.resolve();
  assert.equal(ev(g, w).text, 'Aktifkan izin lokasi untuk HADIRIN');
  const watches = w.calls.filter((c) => c.type === 'watch').length; perm.state = 'granted'; perm.onchange();
  assert.ok(w.calls.filter((c) => c.type === 'watch').length > watches, 'pemantau dimulai ulang setelah diizinkan');
  w.fire([...w.watches.values()][0], { acc: 20 }); assert.equal(ev(g, w).ok, true); g.stop(); }
{ const w = World(), g = GPS.create(w.env()); g.start(); [...w.watches.values()][0].bad({ code: 1 }); assert.equal(ev(g, w).text, 'Aktifkan izin lokasi untuk HADIRIN');
  w.fire([...w.watches.values()][1], { acc: 20 }); assert.equal(ev(g, w).ok, true, 'titik datang = izin ternyata ada'); g.stop(); }

// 7. Tanpa dukungan GPS
{ const w = World(), g = GPS.create({ ...w.env(), geo: undefined }); g.start(); assert.match(ev(g, w).text, /tidak mendukung/); await assert.rejects(g.getFix(), /Lokasi tidak tersedia/); }

// 8. Status jarak (rumus sama dengan server)
{ const w = World(), g = GPS.create(w.env()); g.start(); const c = [...w.watches.values()][0];
  w.fire(c, { lat: m(OFFICE.lat, 30), acc: 10 }); assert.equal(ev(g, w).text, 'Di area kantor');
  g.stop(); const g2 = GPS.create(World().env());
  const E = (d, acc) => GPS.evaluate({ fix: { lat: m(OFFICE.lat, d), lng: OFFICE.lng, acc, t: 1 }, office: OFFICE, now: 2, since: 0 });
  assert.equal(E(150, 10).kind, 'out'); assert.match(E(150, 10).text, /Di luar area kantor: 150 m/);
  assert.equal(E(60, 80).ok, true); assert.match(E(60, 80).text, /kurang presisi|Di area kantor/);   // d+acc > r tapi d<=r, acc<=100
  assert.equal(E(30, 60).ok, true);                                                                   // pasti di dalam (d+acc<=r)
  assert.equal(E(95, 80).ok, true); assert.equal(E(110, 80).kind, 'out');                            // acc<=100 dan d+acc>r: ditentukan d<=r
  assert.equal(E(50, 300).kind, 'wait'); assert.match(E(50, 300).text, /Akurasi rendah \(±300 m\)/);   // di dalam ruangan: akurasi buruk tidak dipaksa "di luar"
  assert.equal(E(500, 300).kind, 'out');                                                              // sekalipun akurasi buruk, jelas di luar
  assert.equal(GPS.evaluate({ fix: { lat: 1, lng: 1, acc: 20, t: 1 }, office: null, now: 2, since: 0 }).ok, true); }

// 9. Titik tidak valid diabaikan; akurasi kosong/0 dianggap 150 m (bukan "sempurna")
{ const w = World(), g = GPS.create(w.env()); g.start(); const c = [...w.watches.values()][0];
  c.ok({ coords: { latitude: NaN, longitude: 107, accuracy: 10 } }); c.ok({ coords: { latitude: 95, longitude: 107, accuracy: 10 } }); c.ok({}); assert.equal(g.best(), null);
  c.ok({ coords: { latitude: -6.9, longitude: 107.6, accuracy: 0 } }); assert.equal(g.best().acc, 150); g.stop(); }

// 10. Pilih titik terbaik: yang akurat menang, tapi titik akurat yang sudah lama kalah dari titik baru yang cukup akurat
{ const w = World(), g = GPS.create(w.env()); g.start(); const c = [...w.watches.values()][0];
  w.fire(c, { acc: 30 }); w.fire(c, { acc: 400 }); assert.equal(g.best().acc, 30);
  w.advance(100000); w.fire(c, { acc: 45 }); assert.equal(g.best().acc, 45, 'titik 100 dtk lalu (30 m + 200 m umur) kalah dari titik baru 45 m'); g.stop(); }

// 11. getFix: titik akurat -> langsung; kurang akurat -> tunggu lalu pakai yang ada; tidak ada -> tembak langsung; semua gagal -> pesan sesuai penyebab
{ const w = World(), g = GPS.create(w.env()); g.start(); w.fire([...w.watches.values()][0], { acc: 20 });
  const f = await g.getFix(); assert.equal(Math.round(f.accuracy), 20); g.stop(); }
{ const w = World(), g = GPS.create(w.env()); g.start(); w.fire([...w.watches.values()][0], { acc: 400 });
  const p = g.getFix({ wait: 5000 }); w.advance(5000); const f = await p; assert.equal(Math.round(f.accuracy), 400, 'setelah menunggu, titik yang ada tetap dipakai (server yang memutuskan)'); g.stop(); }
{ const w = World(), g = GPS.create(w.env()); g.start(); const p = g.getFix({ wait: 5000 }); w.advance(5000); await Promise.resolve();
  const once = w.onceCalls().slice(-2); assert.equal(once.length, 2); w.fire(once[0], { acc: 60 }); const f = await p; assert.equal(Math.round(f.accuracy), 60); g.stop(); }
{ const w = World(), g = GPS.create(w.env()); g.start(); const p = g.getFix({ wait: 100 }); w.advance(100); await Promise.resolve();
  const once = w.onceCalls().slice(-2); once.forEach((c) => c.bad({ code: 2 })); await assert.rejects(p, /Pastikan Lokasi\/GPS HP aktif/); g.stop(); }
{ const w = World(), g = GPS.create(w.env()); g.start(); const p = g.getFix({ wait: 100 }); w.advance(100); await Promise.resolve();
  w.onceCalls().slice(-2).forEach((c) => c.bad({ code: 3 })); await assert.rejects(p, /area terbuka/); g.stop(); }
{ const w = World(), g = GPS.create(w.env()); g.start(); [...w.watches.values()][0].bad({ code: 1 }); await assert.rejects(g.getFix(), /Izin lokasi ditolak/); g.stop(); }

// 12. Titik basi (>30 dtk) saat scan: tidak langsung dipakai; tunggu titik segar (polling watchdog / pemicu getFix) lalu pakai itu
{ const w = World(), g = GPS.create(w.env()); g.start(); w.fire([...w.watches.values()][0], { acc: 20 }); w.advance(40000);
  let got = null; const p = g.getFix({ wait: 4000 }).then((f) => (got = f)); await Promise.resolve(); assert.equal(got, null, 'menunggu titik segar, bukan langsung memakai titik basi');
  w.fire(w.onceCalls().at(-1), { acc: 18 }); const f = await p; assert.equal(Math.round(f.accuracy), 18); g.stop(); }
{ const w = World(), g = GPS.create(w.env()); g.start(); w.fire([...w.watches.values()][0], { acc: 20 }); w.advance(40000);   // tidak ada titik segar sama sekali: setelah batas tunggu, titik basi masih lebih baik daripada gagal
  const p = g.getFix({ wait: 4000 }); w.advance(4000); const f = await p; assert.equal(Math.round(f.accuracy), 20); g.stop(); }

// 13. Berhenti total: tidak ada pemantau/timer tersisa (hemat baterai); stopLater mematikan setelah jeda
{ const w = World(), g = GPS.create(w.env()); g.start(); g.stop(); assert.equal(w.watches.size, 0); assert.equal(w.timers.length, 0);
  g.start(); g.stopLater(60000); w.advance(59000); assert.equal(g.running, true); w.advance(2000); assert.equal(g.running, false); assert.equal(w.watches.size, 0);
  g.start(); g.stopLater(60000); g.start(); w.advance(120000); assert.equal(g.running, true, 'kembali ke Scan membatalkan stopLater'); g.stop(); }

console.log('Semua tes GPS lulus.');
