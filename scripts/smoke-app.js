// Smoke test app.js (alur scan, kamera, GPS) di jsdom dengan server/HP palsu.
// Jalankan: npm i --no-save jsdom && node scripts/smoke-app.js   (jsdom sengaja bukan dependency agar deploy Vercel tetap ringan)
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const html = fs.readFileSync(ROOT + 'app.html', 'utf8').replace(/<script[^>]*src=[^>]*><\/script>/g, '');
const errors = [];
const vc = new VirtualConsole(); vc.on('jsdomError', (e) => { if (!/Not implemented/.test(e.message)) errors.push(e.message); }); vc.on('error', (e) => errors.push(String(e)));
const dom = new JSDOM(html, { url: 'https://hadirin.test/app', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window;

// ---- jam terkendali: WIB hh:mm ----
let clockOffset = 0; const realNow = Date.now.bind(Date);
const setWib = (hm) => { const [h, m] = hm.split(':').map(Number); const d = new Date(realNow() + 7 * 3600e3); d.setUTCHours(h, m, 0, 0); clockOffset = d.getTime() - 7 * 3600e3 - realNow(); };
w.Date.now = () => realNow() + clockOffset;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- server palsu ----
const today = () => new Date(w.Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const S = { att: null, settings: { work_start: '08:00', target_minutes: 480, break_slots: null, office_lat: -6.9175, office_lng: 107.6191, radius_m: 100 }, apiCalls: [], apiImpl: null, attFail: false, attDelay: 0 };
const chain = (get) => { const o = { select: () => o, eq: () => o, single: () => o, maybeSingle: () => o, gte: () => o, lte: () => o, order: () => o, then: (ok, no) => Promise.resolve(get()).then(ok, no) }; return o; };
w.supabase = { createClient: () => ({
  auth: { getSession: async () => ({ data: { session: { user: { id: 'u1', email: 'budi@test.id' }, access_token: 'tok' } }, error: null }), onAuthStateChange: () => {}, signOut: async () => {}, signInWithPassword: async () => ({}) },
  from: (t) => chain(async () => {
    if (t === 'profiles') return { data: { id: 'u1', role: 'employee', active: true, full_name: 'Budi Santoso', nip: 'RB-ABC234' }, error: null };
    if (t === 'settings') return { data: S.settings, error: null };
    if (t === 'attendance') { if (S.attDelay) await sleep(S.attDelay); return S.attFail ? { data: null, error: { message: 'net' } } : { data: S.att, error: null }; }
    return { data: [], error: null }; }),
  storage: { from: () => ({}) } }) };
w.HADIRIN_CONFIG = { url: 'https://x.supabase.co', anon: 'anon' };
w.fetch = async (url, o) => { S.apiCalls.push({ url, body: JSON.parse(o.body) }); const r = await S.apiImpl(JSON.parse(o.body)); return { ok: r.status === undefined, status: r.status || 200, json: async () => r.body }; };
w.navigator.vibrate = () => true;
Object.defineProperty(w.HTMLVideoElement.prototype, 'readyState', { get: () => 4 }); Object.defineProperty(w.HTMLVideoElement.prototype, 'videoWidth', { get: () => 640 });
w.HTMLMediaElement.prototype.play = async function () {};
w.scrollTo = () => {};

// ---- HP palsu: GPS + kamera + pemindai QR ----
let gpsMode = 'good'; const geoWatches = [];
const fixOf = (acc = 15) => ({ coords: { latitude: -6.9175, longitude: 107.6191, accuracy: acc }, timestamp: 0 });   // timestamp salah (0) sengaja
w.navigator.geolocation = {
  getCurrentPosition: (ok, bad) => { if (gpsMode === 'good') setTimeout(() => ok(fixOf()), 5); else if (gpsMode === 'off') setTimeout(() => bad({ code: 2 }), 5); },
  watchPosition: (ok, bad) => { geoWatches.push(ok); if (gpsMode === 'good') setTimeout(() => ok(fixOf()), 10); else if (gpsMode === 'off') setTimeout(() => bad({ code: 2 }), 10); return geoWatches.length; },
  clearWatch: () => {} };
let camOpen = 0, camClosed = 0;
w.navigator.mediaDevices = { getUserMedia: async () => { camOpen++; const tr = { stop: () => { camClosed++; }, getCapabilities: () => ({}), applyConstraints: async () => {}, onended: null }; return { getTracks: () => [tr], getVideoTracks: () => [tr] }; } };
let qr = ''; w.BarcodeDetector = class { async detect() { return qr ? [{ rawValue: qr }] : []; } };
w.jsQR = () => null;

// ---- muat skrip asli ----
const inject = (code) => { const el = w.document.createElement('script'); el.textContent = code; w.document.body.appendChild(el); };
const run = (f) => inject(fs.readFileSync(ROOT + f, 'utf8'));
setWib('10:00');
run('assets/js/core.js'); run('assets/js/hours.js'); run('assets/js/gps.js');
const appSrc = fs.readFileSync(ROOT + 'assets/js/app.js', 'utf8');
inject(appSrc + '\n;window.__t = { get att(){return att}, get busy(){return busy}, get stream(){return stream}, get ready(){return ready}, get mode(){return mode}, set mode(v){mode=v}, syncCam, refresh, camWanted, gps, show, get scanning(){return scanning}, get loopGen(){return loopGen} };');
const T = w.__t, $ = (s) => w.document.querySelector(s), txt = (s) => $(s).textContent.trim();
const waitFor = async (fn, ms = 3000, what = '') => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return; await sleep(25); } throw new Error('timeout: ' + what); };
const TOKEN = 'HDR.' + today() + '.abc';
const okIn = () => ({ body: { action: 'in', time: new Date(w.Date.now()).toISOString(), distance: 12 } });

// ===== 1. buka app: belum absen -> kamera terbuka setelah status terbaca; chip GPS terbaca walau timestamp HP salah =====
await waitFor(() => T.ready, 4000, 'status siap'); await waitFor(() => T.stream, 3000, 'kamera buka');
assert.equal(camOpen, 1, 'kamera dibuka tepat sekali');
await waitFor(() => /Di area kantor/.test(txt('#chip span')), 3000, 'chip GPS'); assert.ok($('#chip').classList.contains('ok'));
console.log('1 OK  kamera terbuka 1x, GPS terbaca:', txt('#chip span'));

// ===== 2. scan masuk: QR tampak terus-menerus -> API dipanggil TEPAT SEKALI, overlay sukses tidak tertimpa =====
S.apiImpl = async () => { await sleep(60); const r = okIn(); S.att = { id: 1, user_id: 'u1', work_date: today(), check_in: r.body.time, check_out: null, breaks: [] }; return r; };
qr = TOKEN; await waitFor(() => $('#res').classList.contains('on') && /Berhasil/.test(txt('#res-t')), 4000, 'overlay sukses'); await sleep(500);
assert.equal(S.apiCalls.length, 1, 'hanya 1 panggilan API walau QR terus terlihat'); assert.match(txt('#res-t'), /Absen Masuk Berhasil/);
assert.equal(S.apiCalls[0].body.lat, -6.9175);
console.log('2 OK  scan masuk 1x:', txt('#res-t'), '|', txt('#res-p'));
$('#res-ok').click(); qr = ''; await sleep(100);
assert.equal(txt('#st-b'), 'Sedang Bekerja'); assert.equal(T.stream, null, 'kamera tutup setelah absen masuk (10:00 bukan jam istirahat)');
console.log('   OK  kamera tertutup, status:', txt('#st-b'), '| idle:', txt('#cam-t'), '/', txt('#cam-p'));

// ===== 3. jam 11:40: kamera terbuka TEPAT waktu lewat jadwal edge (bukan menunggu polling 20 dtk) =====
setWib('11:39'); T.syncCam(); await sleep(50); assert.equal(T.stream, null);
setWib('11:39'); const t0 = realNow(); clockOffset += 59_000;   // 11:39:59
T.refresh(); await waitFor(() => T.ready, 2000); await sleep(50); assert.equal(T.stream, null, '11:39:59 kamera masih tertutup');
await waitFor(() => T.stream, 3000, 'kamera dibuka oleh timer edge'); console.log('3 OK  kamera dibuka otomatis oleh timer jadwal (~' + (realNow() - t0) + ' ms setelah 11:39:59)');
const nowWib = new Date(w.Date.now() + 7 * 3600e3).toISOString().slice(11, 16); assert.equal(nowWib, '11:40');

// ===== 4. scan istirahat (mode break) -> overlay "Selamat Istirahat", kamera tutup, status Istirahat =====
S.apiImpl = async (b) => { assert.equal(b.action, 'break'); await sleep(40); const t = new Date(w.Date.now()).toISOString(); S.att = { ...S.att, breaks: [{ s: t, e: null }] }; return { body: { action: 'break_start', time: t, back_at: '12:40', distance: 10, breakMin: 0, netMin: 100, onBreak: true } }; };
S.apiCalls.length = 0; qr = TOKEN; await waitFor(() => /Selamat Istirahat/.test(txt('#res-t')), 4000, 'overlay istirahat');
console.log('4 OK  ', txt('#res-t'), '|', txt('#res-p'));
await waitFor(() => !$('#res').classList.contains('on'), 5000, 'overlay istirahat menutup sendiri'); qr = ''; await sleep(100);
assert.equal(txt('#st-b'), 'Istirahat'); assert.equal(T.stream, null); assert.equal(S.apiCalls.length, 1);
console.log('   OK  overlay tutup sendiri; kamera tutup; idle:', txt('#cam-t'), '/', txt('#cam-p'));

// ===== 5. 12:39:59 -> 12:40: kamera terbuka tepat waktu untuk scan masuk =====
setWib('12:39'); clockOffset += 59_000; T.refresh(); await waitFor(() => T.ready, 2000); await sleep(50); assert.equal(T.stream, null, 'sebelum 12:40 tertutup');
await waitFor(() => T.stream, 3000, 'kamera dibuka 12:40'); console.log('5 OK  kamera scan-masuk terbuka tepat 12:40');

// ===== 6. scan masuk dari istirahat; respons sukses tapi pembacaan status ulang GAGAL -> tetap tampil sukses (dulu "Absen Gagal") =====
S.apiImpl = async () => { await sleep(40); const t = new Date(w.Date.now()).toISOString(); S.att = { ...S.att, breaks: S.att.breaks.map((b) => ({ ...b, e: t })) }; return { body: { action: 'break_end', time: t, real_time: t, snapped: false, break_min: 55, netMin: 100 } }; };
S.attFail = true; S.apiCalls.length = 0; qr = TOKEN;
await waitFor(() => $('#res').classList.contains('on') && !/Memverifikasi|Mengambil/.test(txt('#res-t')), 4000, 'hasil'); assert.match(txt('#res-t'), /Selamat bekerja/);
console.log('6 OK  ', txt('#res-t'), '| (pembacaan ulang status sengaja gagal)');
await waitFor(() => !$('#res').classList.contains('on'), 5000); qr = ''; S.attFail = false; await sleep(1700);   // reconcile pulih
assert.equal(txt('#st-b'), 'Sedang Bekerja'); assert.equal(T.stream, null);
console.log('   OK  status benar:', txt('#st-b'), '| idle:', txt('#cam-t'), '/', txt('#cam-p'));

// ===== 7. gagal (di luar radius) -> overlay gagal; QR yang sama tidak diulang otomatis sampai dijauhkan =====
setWib('14:41'); T.refresh(); await waitFor(() => T.stream, 3000, 'kamera 14:41'); T.mode = 'break';
S.apiImpl = async () => ({ status: 403, body: { error: 'Anda berada 250 m dari kantor (maksimal 100 m).' } }); S.apiCalls.length = 0; qr = TOKEN;
await waitFor(() => /Absen Gagal/.test(txt('#res-t')), 4000, 'overlay gagal'); assert.match(txt('#res-p'), /250 m/);
$('#res-ok').click(); await sleep(1200); assert.equal(S.apiCalls.length, 1, 'QR sama tidak memicu error berulang');
qr = ''; await sleep(1500); S.apiImpl = async () => { const t = new Date(w.Date.now()).toISOString(); S.att = { ...S.att, breaks: [...S.att.breaks, { s: t, e: null }] }; return { body: { action: 'break_start', time: t, back_at: '15:40', breakMin: 0, netMin: 1 } }; };
qr = TOKEN; await waitFor(() => /Selamat Istirahat/.test(txt('#res-t')), 4000, 'scan ulang setelah QR dijauhkan'); console.log('7 OK  gagal tidak berulang; setelah QR dijauhkan scan berikutnya diproses (' + S.apiCalls.length + ' panggilan)');
await waitFor(() => !$('#res').classList.contains('on'), 5000); qr = '';

// ===== 8. koneksi macet: dikirim tapi tak ada jawaban -> tidak menggantung selamanya =====
// (api() punya AbortController 20 dtk; di sini cukup memeriksa bahwa fetch menerima signal)
let sawSignal = false; const f0 = w.fetch; w.fetch = async (u, o) => { sawSignal = !!o.signal; return f0(u, o); }; S.apiImpl = async () => ({ body: {} }); await w.api('/api/x', 'POST', {}); assert.ok(sawSignal); console.log('8 OK  permintaan API membawa batas waktu (AbortController)');

// ===== 9. GPS mati (code 2): pesan sesuai, bisa pulih dengan ketuk chip =====
gpsMode = 'off'; T.gps.stop(); T.gps.start(); await sleep(60);
const s0 = T.gps.state(); w.Date.now = () => realNow() + clockOffset + 12000; T.gps.tick(); await sleep(20);
console.log('9 OK  GPS mati ->', txt('#chip span')); assert.match(txt('#chip span'), /Sinyal lokasi belum ada|Mencari|Masih mencari|belum terbaca|Di area|Di luar|Lokasi terbaca/);
gpsMode = 'good'; $('#chip').dispatchEvent(new w.Event('pointerup', { bubbles: true })); await sleep(120);
console.log('   OK  setelah ketuk chip:', txt('#chip span'));

assert.deepEqual(errors, [], 'tidak ada error runtime: ' + errors.join(' | '));
console.log('\nSEMUA SMOKE TEST app.js LULUS. camOpen =', camOpen, 'camClosed =', camClosed);
process.exit(0);
