// npm run test:rules : memeriksa aturan jam kerja (contoh dari kebijakan) dan kesamaan salinan server vs klien
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { summarize, breakState, breakEnd, normSlots, BREAK_SLOTS } from '../api/_hours.js';
const ctx = {}; vm.runInNewContext(fs.readFileSync(new URL('../assets/js/hours.js', import.meta.url), 'utf8') + ';this.HOURS=HOURS', ctx);
const at = (hm) => new Date(`2026-01-05T${hm}:00+07:00`).toISOString(), hm = (ms) => new Date(ms + 7 * 3600e3).toISOString().slice(11, 16);
const B = (a, b) => ({ s: at(a), e: at(b) });
// Contoh 1: masuk 07:00, istirahat total 60 menit -> pulang paling cepat 15:00
let a = { check_in: at('07:00'), breaks: [B('12:00', '12:30'), B('15:00', '15:30')] }; // (jam sengaja di luar; diganti di bawah)
a = { check_in: at('07:00'), breaks: [B('12:00', '12:30'), B('14:00', '14:30')] };
let m = summarize(a, new Date(at('15:00')).getTime()); assert.equal(m.breakMin, 60); assert.equal(hm(m.earliest), '15:00'); assert.equal(m.canOut, true);
m = summarize(a, new Date(at('14:59')).getTime()); assert.equal(m.canOut, false); assert.equal(m.remainMin, 1);
// Contoh 2: masuk 07:20, istirahat total 40 menit -> pulang 15:00 (utang telat lunas), dengan jam acuan 07:00
a = { check_in: at('07:20'), breaks: [B('12:00', '12:20'), B('14:00', '14:20')] };
m = summarize(a, new Date(at('15:00')).getTime(), 420, '07:00'); assert.equal(hm(m.earliest), '15:00'); assert.equal(m.canOut, true)
// Sedang istirahat: tidak boleh pulang walau jam sudah lewat, kerja bersih tidak bertambah
a = { check_in: at('07:00'), breaks: [{ s: at('15:00'), e: null }] };
m = summarize(a, new Date(at('16:00')).getTime()); assert.equal(m.onBreak, true); assert.equal(m.canOut, false); assert.equal(m.netMin, 480);
// Tanpa istirahat: 07:00 -> 14:00
m = summarize({ check_in: at('07:00'), breaks: [] }, new Date(at('14:00')).getTime()); assert.equal(m.canOut, true);
// Detik dibulatkan ke bawah per menit (sesuai tampilan HH:MM)
m = summarize({ check_in: '2026-01-05T00:00:20Z', breaks: [] }, new Date('2026-01-05T07:00:05Z').getTime()); assert.equal(m.canOut, true);
// Jendela istirahat: keluar 11:40 / 14:40, masuk lagi 12:40 / 15:40 (masing-masing sekali)
const T = (x) => new Date(at(x)).getTime(), noBrk = { check_in: at('07:00'), breaks: [] };
let g = breakState(noBrk, T('11:39')); assert.equal(g.canStart, false); assert.equal(g.nextAt, '11:40');
g = breakState(noBrk, T('11:40')); assert.equal(g.canStart, true); assert.equal(g.backAt, '12:40');
g = breakState(noBrk, T('14:39')); assert.equal(g.canStart, true); assert.equal(g.slot, 0);
g = breakState({ ...noBrk, breaks: [B('11:45', '12:45')] }, T('13:00')); assert.equal(g.canStart, false); assert.equal(g.nextAt, '14:40');
g = breakState({ ...noBrk, breaks: [B('11:45', '12:45')] }, T('14:40')); assert.equal(g.canStart, true); assert.equal(g.backAt, '15:40');
g = breakState({ ...noBrk, breaks: [B('11:45', '12:45'), B('14:45', '15:45')] }, T('16:00')); assert.equal(g.canStart, false); assert.equal(g.nextAt, null);
g = breakState({ ...noBrk, breaks: [{ s: at('11:45'), e: null }] }, T('12:39')); assert.equal(g.onBreak, true); assert.equal(g.canEnd, false); assert.equal(g.backAt, '12:40');
g = breakState({ ...noBrk, breaks: [{ s: at('11:45'), e: null }] }, T('12:40')); assert.equal(g.canEnd, true);
g = breakState({ ...noBrk, breaks: [B('11:45', '12:45'), { s: at('14:45'), e: null }] }, T('15:39')); assert.equal(g.canEnd, false);
g = breakState({ ...noBrk, breaks: [B('11:45', '12:45'), { s: at('14:45'), e: null }] }, T('15:40')); assert.equal(g.canEnd, true);
// Target tercapai = boleh pulang, tanpa harus mengambil istirahat (kedua / pertama) lebih dulu
let e = { check_in: at('06:00'), breaks: [] };                      // masuk pagi sekali, tidak istirahat sama sekali
assert.equal(summarize(e, T('12:59')).canOut, false); assert.equal(summarize(e, T('13:00')).canOut, true); assert.equal(hm(summarize(e, T('13:00')).earliest), '13:00');
e = { check_in: at('07:00'), breaks: [] };                          // tidak istirahat: 07:00 -> 14:00 (sebelum jendela istirahat ke-2 dibuka 14:40)
assert.equal(summarize(e, T('14:00')).canOut, true); assert.equal(breakState(e, T('14:00')).canStart, true);   // jendela istirahat tidak menghalangi
e = { check_in: at('06:30'), breaks: [B('11:45', '12:45')] };       // hanya istirahat pertama (60 mnt) -> pulang 14:30
assert.equal(summarize(e, T('14:29')).canOut, false); assert.equal(summarize(e, T('14:30')).canOut, true); assert.equal(breakState(e, T('14:30')).canStart, false);
e = { check_in: at('07:00'), breaks: [B('11:45', '12:45')] };       // 07:00 + 7j + 60 mnt = 15:00; di 14:45 istirahat ke-2 sudah dibuka tapi target belum tercapai
assert.equal(summarize(e, T('14:45')).canOut, false); assert.equal(summarize(e, T('15:00')).canOut, true);
e = { check_in: at('06:00'), breaks: [{ s: at('11:45'), e: null }] }; // sedang istirahat: tetap harus kembali masuk dulu
assert.equal(summarize(e, T('14:00')).canOut, false);
// Jam istirahat dari Setting: jam custom dipakai; data tidak valid / kosong -> kembali ke bawaan
const CS = [{ out: '11:30', back: '12:15', due: '12:15', grace: 15 }, { out: '14:00', back: '14:45', due: '14:45', grace: 15 }];
g = breakState(noBrk, T('11:30'), CS); assert.equal(g.canStart, true); assert.equal(g.backAt, '12:15');
g = breakState(noBrk, T('11:39'), BREAK_SLOTS); assert.equal(g.canStart, false);
g = breakState({ ...noBrk, breaks: [{ s: at('11:35'), e: null }] }, T('12:14'), CS); assert.equal(g.canEnd, false); assert.equal(g.msg, 'Scan masuk setelah istirahat dibuka pukul 12:15.');
g = breakState({ ...noBrk, breaks: [{ s: at('11:35'), e: null }] }, T('12:15'), CS); assert.equal(g.canEnd, true);
for (const bad of [null, undefined, [], [CS[0]], [{ out: '12:00', back: '11:00' }, CS[1]], [CS[1], CS[0]], [{ out: '25:00', back: '26:00' }, CS[1]], 'x']) assert.deepEqual(normSlots(bad), BREAK_SLOTS);
assert.deepEqual(normSlots(CS), CS);
// Data lama tanpa due/grace tetap valid: due diambil dari bawaan (13:00 / 16:00) bila masuk akal, grace 15
assert.deepEqual(normSlots([{ out: '11:40', back: '12:40' }, { out: '14:40', back: '15:40' }]), BREAK_SLOTS);
assert.deepEqual(normSlots([{ out: '11:30', back: '12:15' }, { out: '12:50', back: '13:30' }]).map((x) => x.due), ['12:15', '13:30']);
// Toleransi masuk kembali setelah istirahat: telat <= 15 menit dicatat tepat jam due
const op1 = { s: at('11:45'), e: null }, op2 = { s: at('14:45'), e: null }, hmAt = (r) => hm(r.at);
let be = breakEnd(op1, T('12:50')); assert.equal(hmAt(be), '12:50'); assert.equal(be.snapped, false);   // lebih awal: waktu asli
be = breakEnd(op1, T('13:00')); assert.equal(hmAt(be), '13:00'); assert.equal(be.snapped, false);
be = breakEnd(op1, T('13:07')); assert.equal(hmAt(be), '13:00'); assert.equal(be.snapped, true);       // contoh dari kebijakan
be = breakEnd(op1, T('13:15')); assert.equal(hmAt(be), '13:00'); assert.equal(be.snapped, true);
be = breakEnd(op1, T('13:16')); assert.equal(hmAt(be), '13:16'); assert.equal(be.snapped, false);      // lewat toleransi: waktu asli
be = breakEnd(op2, T('16:07')); assert.equal(hmAt(be), '16:00'); assert.equal(be.snapped, true);
be = breakEnd(op2, T('15:45')); assert.equal(hmAt(be), '15:45');
be = breakEnd(op1, T('13:10'), [{ ...BREAK_SLOTS[0], grace: 5 }, BREAK_SLOTS[1]]); assert.equal(hmAt(be), '13:10');   // toleransi diatur admin
// Efek ke kerja bersih: istirahat 11:45 - 13:07 dihitung 11:45 - 13:00 (75 menit)
let nb = { check_in: at('07:00'), breaks: [{ s: at('11:45'), e: new Date(breakEnd(op1, T('13:07')).at).toISOString() }] };
assert.equal(summarize(nb, T('14:00')).breakMin, 75);
// Salinan klien identik dengan server
for (let i = 0; i < 2000; i++) {
  const t0 = Date.UTC(2026, 0, 5, 0, 0) + Math.floor(Math.random() * 3e6), br = []; let c = t0 + Math.floor(Math.random() * 3e6);
  for (let k = 0; k < Math.floor(Math.random() * 3); k++) { const e = c + Math.floor(Math.random() * 3e6); br.push({ s: new Date(c).toISOString(), e: Math.random() < .2 ? null : new Date(e).toISOString() }); c = e + 1e5; if (br.at(-1).e === null) break; }
  const x = { check_in: new Date(t0).toISOString(), check_out: Math.random() < .3 ? new Date(c + 3e6).toISOString() : null, breaks: br }, now = c + Math.floor(Math.random() * 3e7);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.HOURS.summarize(x, now, 420, '08:00'))), JSON.parse(JSON.stringify(summarize(x, now, 420, '08:00'))));
}
for (let i = 0; i < 2000; i++) {
  const d0 = Date.UTC(2026, 0, 4, 17, 0), r = () => d0 + Math.floor(Math.random() * 15 * 36e5), s0 = r(), x = { breaks: Math.random() < .5 ? [] : [{ s: new Date(s0).toISOString(), e: Math.random() < .5 ? null : new Date(s0 + 36e5).toISOString() }] }, now = r();
  for (const sl of [undefined, CS, null]) assert.deepEqual(JSON.parse(JSON.stringify(ctx.HOURS.breakState(x, now, sl))), JSON.parse(JSON.stringify(breakState(x, now, sl))));
}
for (let i = 0; i < 2000; i++) {
  const d0 = Date.UTC(2026, 0, 4, 17, 0), r = () => d0 + Math.floor(Math.random() * 15 * 36e5), s0 = r(), now = s0 + Math.floor(Math.random() * 4 * 36e5), o = { s: new Date(s0).toISOString(), e: null };
  for (const sl of [undefined, CS, null]) assert.deepEqual(JSON.parse(JSON.stringify(ctx.HOURS.breakEnd(o, now, sl))), breakEnd(o, now, sl));
}
// ---- Kamera otomatis (khusus klien): HOURS.camWanted + HOURS.nextEdge ----
const H = ctx.HOURS, cw = (a, t, sl) => H.camWanted(a, T(t), sl, 480, '08:00'), ne = (a, t, sl) => H.nextEdge(a, T(t), sl, 480, '08:00');
assert.equal(cw(null, '07:00'), true);                                                    // belum absen: kamera terbuka
assert.equal(cw({ check_in: at('07:00'), breaks: [] }, '09:00'), false);                  // sedang bekerja, bukan jendela istirahat: tertutup
assert.equal(cw({ check_in: at('07:00'), breaks: [] }, '11:39'), false);
assert.equal(cw({ check_in: at('07:00'), breaks: [] }, '11:40'), true);                   // jendela keluar istirahat dibuka
assert.equal(cw({ check_in: at('07:00'), breaks: [] }, '12:19'), true);
assert.equal(cw({ check_in: at('07:00'), breaks: [] }, '12:20'), false);                  // BREAK_WIN 40 menit habis
assert.equal(cw({ check_in: at('07:00'), breaks: [{ s: at('11:45'), e: null }] }, '12:39'), false);   // istirahat, scan masuk belum dibuka
assert.equal(cw({ check_in: at('07:00'), breaks: [{ s: at('11:45'), e: null }] }, '12:40'), true);    // scan masuk dibuka
assert.equal(cw({ check_in: at('07:00'), breaks: [B('11:45', '12:45')] }, '13:00'), false);           // sudah kembali, tutup lagi
assert.equal(cw({ check_in: at('07:00'), breaks: [B('11:45', '12:45')] }, '14:40'), true);             // istirahat kedua
const two = { check_in: at('07:00'), breaks: [B('11:45', '12:45'), B('14:45', '15:45')] };   // total istirahat 120 mnt -> boleh pulang 17:00
assert.equal(cw(two, '16:59'), false); assert.equal(cw(two, '17:00'), true);              // sudah boleh pulang: kamera terbuka
assert.equal(cw({ ...two, check_out: at('17:05') }, '17:10'), false);                      // sudah pulang: tertutup
assert.equal(cw({ check_in: at('06:00'), breaks: [] }, '13:59'), false); assert.equal(cw({ check_in: at('06:00'), breaks: [] }, '14:00'), true);   // target (8j) tercapai tanpa istirahat: terbuka
assert.equal(cw({ check_in: at('07:00'), breaks: [] }, '11:40', CS), true); assert.equal(cw({ check_in: at('07:00'), breaks: [] }, '12:10', CS), false);   // jam custom 11:30: terbuka 11:30-12:09
// nextEdge: waktu (ms) sampai keputusan kamera bisa berubah, supaya kamera buka/tutup TEPAT waktu
const w0 = { check_in: at('07:00'), breaks: [] };
assert.equal(ne(w0, '09:00'), 9600000);                                                    // 09:00 -> 11:40
assert.equal(H.nextEdge(w0, T('11:40') + 30000, undefined, 480, '08:00'), 2370000);        // 11:40:30 -> 12:20 (akhir BREAK_WIN)
assert.equal(ne({ check_in: at('07:00'), breaks: [{ s: at('11:45'), e: null }] }, '12:30'), 600000);   // 12:30 -> 12:40 (scan masuk dibuka)
assert.equal(ne(two, '16:30'), 1800000);                                                   // 16:30 -> 17:00 (jam boleh pulang)
assert.equal(ne({ ...two, check_out: at('17:05') }, '17:10'), null);                       // selesai: tidak ada lagi
assert.equal(ne(null, '17:00'), null);
// Setiap jadwal edge benar-benar mengubah keputusan kamera atau memang tidak ada perubahan: tidak pernah terlewat
for (let i = 0; i < 3000; i++) {
  const t0 = Date.UTC(2026, 0, 4, 22, 0) + Math.floor(Math.random() * 4 * 36e5), br = Math.random() < .5 ? [] : [{ s: new Date(t0 + 4.8 * 36e5).toISOString(), e: Math.random() < .5 ? null : new Date(t0 + 5.9 * 36e5).toISOString() }];
  const x = { check_in: new Date(t0).toISOString(), breaks: br }, now = t0 + Math.floor(Math.random() * 10 * 36e5), before = H.camWanted(x, now, undefined, 480, '08:00'), ms = H.nextEdge(x, now, undefined, 480, '08:00');
  // sampai SEBELUM edge pertama keputusan tidak boleh berubah
  const eod = Math.floor((now + 7 * 36e5) / 864e5) * 864e5 + 864e5 - 7 * 36e5 - 1000, probe = Math.min(eod, ms == null ? Infinity : now + ms - 1000);   // sampai akhir hari WIB (ganti hari = app memuat ulang) for (const tt of [now + 1000, (now + probe) / 2, probe]) if (tt <= probe) assert.equal(H.camWanted(x, tt, undefined, 480, '08:00'), before, 'keputusan kamera berubah sebelum edge terjadwal');
}
console.log('Semua tes aturan jam kerja lulus.');
