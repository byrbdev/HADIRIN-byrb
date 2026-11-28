// npm run test:scan : menguji api/scan.js dengan database palsu di memori dan jam terkendali (tanpa Supabase / jaringan)
import { mock } from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL = 'http://db.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'; process.env.QR_SECRET = 'rahasia-tes';
const { db, tokenFor } = await import('../api/_lib.js');
const { default: handler } = await import('../api/scan.js');
const OFFICE = { office_lat: -6.9175, office_lng: 107.6191, radius_m: 100 };
let S;
const reset = (over = {}) => { S = { profile: { role: 'employee', active: true }, settings: { ...OFFICE, target_minutes: 480, work_start: '08:00', break_slots: null }, att: null, readErr: null, updateRows: null, insertErr: null, ...over }; };
db.auth.getUser = async () => ({ data: { user: S.noUser ? null : { id: 'u1' } } });
db.from = (t) => { const q = { op: 'select', f: [] }; const o = {
  select: () => o, single: () => o, maybeSingle: () => o, eq: (c, v) => (q.f.push([c, v]), o), is: (c, v) => (q.f.push([c, v]), o),
  insert: (row) => ((q.op = 'insert'), (q.row = row), o), update: (p) => ((q.op = 'update'), (q.patch = p), o),
  then: (ok, no) => Promise.resolve((() => {
    if (t === 'profiles') return S.readErr === 'profiles' ? { data: null, error: { code: 'XX', message: 'x' } } : { data: S.profile, error: null };
    if (t === 'settings') return S.readErr === 'settings' ? { data: null, error: { message: 'x' } } : { data: S.settings, error: null };
    if (q.op === 'insert') { if (S.insertErr) return { error: S.insertErr }; S.att = { id: 1, ...q.row }; return { error: null }; }
    if (q.op === 'update') { if (S.updateRows === 0) return { data: [], error: null }; S.att = { ...S.att, ...q.patch }; return { data: [{ id: 1 }], error: null }; }
    return S.readErr === 'attendance' ? { data: null, error: { message: 'x' } } : { data: S.att, error: null }; })()).then(ok, no) }; return o; };
const wib = (d, hm) => new Date(`${d}T${hm}:00+07:00`).getTime();
const DAY = '2026-02-02';
const call = async (body, hm, extra = {}) => {
  mock.timers.reset(); mock.timers.enable({ apis: ['Date'], now: wib(DAY, hm) });
  const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { token: tokenFor(DAY), lat: OFFICE.office_lat, lng: OFFICE.office_lng, ...body }, ...extra }, res); mock.timers.reset(); return res;
};
const iso = (hm, sec = '00') => new Date(`${DAY}T${hm}:${sec}+07:00`).toISOString();

// validasi masukan
reset(); let r = await call({ lat: NaN }, '08:00'); assert.equal(r.code, 400); assert.match(r.body.error, /Lokasi tidak terbaca/);
r = await call({ lat: 'x' }, '08:00'); assert.equal(r.code, 400); r = await call({ lat: 123 }, '08:00'); assert.equal(r.code, 400); r = await call({ lng: 999 }, '08:00'); assert.equal(r.code, 400);
r = await call({ token: 'HDR.salah' }, '08:00'); assert.equal(r.code, 400); assert.match(r.body.error, /QR tidak valid/);
reset({ noUser: true }); r = await call({}, '08:00'); assert.equal(r.code, 401);
reset({ profile: { role: 'admin', active: true } }); r = await call({}, '08:00'); assert.equal(r.code, 403);
reset({ profile: { role: 'employee', active: false } }); r = await call({}, '08:00'); assert.equal(r.code, 403);
assert.equal(r.headers['Cache-Control'], 'no-store');
// gangguan baca database = 503, BUKAN dianggap belum absen (dulu bisa mencoba absen masuk ganda)
for (const k of ['attendance', 'settings', 'profiles']) { reset({ readErr: k }); r = await call({}, '08:00'); assert.equal(r.code, 503, k); assert.equal(S.att, null); }
// lokasi kantor belum diatur: dulu jarak NaN lolos dari mana saja
reset({ settings: { ...OFFICE, office_lat: null, target_minutes: 480 } }); r = await call({}, '08:00'); assert.equal(r.code, 500); assert.match(r.body.error, /Lokasi kantor belum diatur/);
// radius
reset(); r = await call({ lat: OFFICE.office_lat + 0.0025 }, '08:00'); assert.equal(r.code, 403); assert.match(r.body.error, /2\d\d m dari kantor/);
// masuk, dan masuk bersamaan (unique violation) -> 409 ramah
reset(); r = await call({}, '08:00'); assert.equal(r.code, 200); assert.equal(r.body.action, 'in');
reset({ insertErr: { code: '23505', message: 'duplicate key' } }); r = await call({}, '08:00'); assert.equal(r.code, 409); assert.match(r.body.error, /sudah tercatat/);
// scan terlalu cepat setelah masuk
reset({ att: { id: 1, check_in: iso('08:00'), check_out: null, breaks: [] } }); r = await call({ action: 'break' }, '08:00', {}); assert.equal(r.code, 409); assert.match(r.body.error, /baru saja tercatat/);
// istirahat: di luar jendela ditolak, di jendela diterima
const A = () => ({ id: 1, check_in: iso('08:00'), check_out: null, breaks: [] });
reset({ att: A() }); r = await call({ action: 'break' }, '11:39'); assert.equal(r.code, 409); assert.match(r.body.error, /11:40/);
reset({ att: A() }); r = await call({ action: 'break' }, '11:40'); assert.equal(r.code, 200); assert.equal(r.body.action, 'break_start'); assert.equal(r.body.back_at, '12:40');
// kembali: sebelum 12:40 ditolak; 12:40 ok; telat 13:07 dicatat 13:00 (toleransi)
const OB = () => ({ ...A(), breaks: [{ s: iso('11:45'), e: null }] });
reset({ att: OB() }); r = await call({}, '12:39'); assert.equal(r.code, 409); assert.match(r.body.error, /12:40/);
reset({ att: OB() }); r = await call({}, '12:41'); assert.equal(r.code, 200); assert.equal(r.body.action, 'break_end'); assert.equal(r.body.snapped, false);
reset({ att: OB() }); r = await call({}, '13:07'); assert.equal(r.code, 200); assert.equal(r.body.snapped, true); assert.equal(r.body.time, iso('13:00')); assert.equal(r.body.break_min, 75);
// scan istirahat ke-2 kali dalam slot yang sama ditolak (jatah sekali)
reset({ att: { ...A(), breaks: [{ s: iso('11:45'), e: iso('12:45') }] } }); r = await call({ action: 'break' }, '13:30'); assert.equal(r.code, 409);
// pulang: belum cukup ditolak, cukup diterima; sedang istirahat tidak boleh pulang
reset({ att: { ...A(), breaks: [{ s: iso('11:45'), e: iso('12:45') }] } }); r = await call({ action: 'out' }, '16:59'); assert.equal(r.code, 409); assert.match(r.body.error, /Belum boleh pulang/);
reset({ att: { ...A(), breaks: [{ s: iso('11:45'), e: iso('12:45') }] } }); r = await call({ action: 'out' }, '17:00'); assert.equal(r.code, 200); assert.equal(r.body.action, 'out'); assert.ok(r.body.netMin >= 480);
// sudah pulang
reset({ att: { ...A(), check_out: iso('16:00') } }); r = await call({ action: 'out' }, '17:00'); assert.equal(r.code, 409); assert.match(r.body.error, /sudah lengkap/);
// tanpa pilihan aksi
reset({ att: A() }); r = await call({}, '10:00'); assert.equal(r.code, 400);
// pembaruan tidak mengenai baris (mis. sudah pulang di perangkat lain): dulu dianggap sukses
reset({ att: A(), updateRows: 0 }); r = await call({ action: 'break' }, '11:41'); assert.equal(r.code, 409); assert.match(r.body.error, /berubah/);
// pengecualian tak terduga -> JSON 500, bukan halaman error
reset({ att: A() }); const g0 = db.auth.getUser; db.auth.getUser = async () => { throw new Error('boom'); }; const e0 = console.error; console.error = () => {}; r = await call({}, '10:00'); console.error = e0; db.auth.getUser = g0; assert.equal(r.code, 500); assert.match(r.body.error, /Server sedang bermasalah/);
// metode salah
reset(); mock.timers.reset(); const rr = { setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } }; await handler({ method: 'GET', headers: {}, body: {} }, rr); assert.equal(rr.code, 405);
console.log('Semua tes api/scan lulus.');
process.exit(0);
