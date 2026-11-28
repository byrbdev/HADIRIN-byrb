// HADIRIN core: Supabase client, auth guard, layout Spark Admin, helper
const CFG = window.HADIRIN_CONFIG || {};
// Penyimpanan session. Di APK Android, MainActivity menyediakan window.HadirinStore (SharedPreferences native, tahan app ditutup/di-kill).
// Di browser/PWA tidak ada HadirinStore, jadi tetap memakai localStorage bawaan (perilaku web tidak berubah).
const NS = window.HadirinStore, LS = (f) => { try { return f(); } catch { return null; } };
const authOpts = { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false };
if (NS) authOpts.storage = {
  getItem: (k) => { let v = NS.getItem(k); if (v == null) { v = LS(() => localStorage.getItem(k)); if (v != null) NS.setItem(k, v); } return v; },   // migrasi: sesi lama di localStorage dipindah ke native
  setItem: (k, v) => { NS.setItem(k, v); LS(() => localStorage.removeItem(k)); },
  removeItem: (k) => { NS.removeItem(k); LS(() => localStorage.removeItem(k)); } };
const sb = supabase.createClient(CFG.url || 'http://invalid.local', CFG.anon || 'missing', { auth: authOpts });
const $ = (s, r = document) => r.querySelector(s);
const wibDate = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const fmtTime = (t) => t ? new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).replace('.', ':') : '-';
const fmtDur = (a, b) => { if (!a) return '-'; const m = Math.max(0, Math.round(((b ? new Date(b) : new Date()) - new Date(a)) / 6e4)); return `${Math.floor(m / 60)}j ${m % 60}m` + (b ? '' : ' (berjalan)'); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (msg, ok = true) => { const d = document.createElement('div'); d.className = 'position-fixed top-0 end-0 m-3 toast-wrap'; d.style.zIndex = 2000;
  d.innerHTML = `<div class="alert-custom ${ok ? 'alert-custom-success' : 'alert-custom-danger'}"><i class="bi ${ok ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill'} alert-custom-icon"></i><div class="alert-custom-content">${esc(msg)}</div></div>`; document.body.appendChild(d); setTimeout(() => d.remove(), 3000); };
// pagination ala Spark (table-footer-control)
function pager(info, nav, per, redraw) {
  let page = 1, n = 0; const max = () => Math.max(1, Math.ceil(n / per));
  nav.onclick = (e) => { const a = e.target.closest('[data-p]'); if (!a) return; e.preventDefault(); const p = +a.dataset.p; if (p >= 1 && p <= max()) { page = p; redraw(); } };
  return { reset: () => (page = 1), slice(arr) { n = arr.length; if (page > max()) page = max(); const s = (page - 1) * per;
    info.textContent = n ? `Menampilkan ${s + 1} sampai ${Math.min(n, s + per)} dari ${n} data` : 'Tidak ada data';
    let h = `<li class="page-item ${page === 1 ? 'disabled' : ''}"><a class="page-link border-0" href="#" data-p="${page - 1}"><i class="bi bi-chevron-left"></i></a></li>`;
    for (let i = 1; i <= max(); i++) h += `<li class="page-item ${i === page ? 'active' : ''}"><a class="page-link border-0" href="#" data-p="${i}">${i}</a></li>`;
    h += `<li class="page-item ${page === max() ? 'disabled' : ''}"><a class="page-link border-0" href="#" data-p="${page + 1}"><i class="bi bi-chevron-right"></i></a></li>`; nav.innerHTML = h; return arr.slice(s, s + per); } };
}
// dropdown filter ala Spark (btn-table-action)
function filterDropdown(btn, menu, label, onPick) { menu.onclick = (e) => { const a = e.target.closest('[data-v]'); if (!a) return; e.preventDefault(); btn.innerHTML = `<i class="bi bi-funnel"></i> ${esc(a.textContent)}`; onPick(a.dataset.v); }; }
async function api(path, method, body, timeout = 30000) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('Sesi habis, silakan login ulang.');
  const ac = new AbortController(), tm = setTimeout(() => ac.abort(), timeout);   // tanpa batas waktu, koneksi macet membuat layar "Memverifikasi..." menggantung selamanya
  try {
    const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: body && JSON.stringify(body), signal: ac.signal });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Gagal (${r.status})`); return j;
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error('Koneksi lambat, server belum menjawab.'), { timeout: true });
    if (e instanceof TypeError) throw Object.assign(new Error('Koneksi bermasalah. Periksa internet Anda lalu coba lagi.'), { net: true });
    throw e;
  } finally { clearTimeout(tm); }
}
const MENU = [['dashboard', 'bi-grid-fill', 'Dashboard'], ['absensi', 'bi-calendar-check-fill', 'Absensi'], ['karyawan', 'bi-people-fill', 'Karyawan'], ['keterangan', 'bi-file-earmark-medical', 'Keterangan'], ['setting', 'bi-gear-fill', 'Setting']];
const BRAND = 'HADIRIN By RB';
// Foto profil berupa huruf pertama nama (Adit -> A)
const initial = (n) => (String(n || '').trim()[0] || '?').toUpperCase();
const avatar = (n, cls = '') => `<div class="avatar-letter ${cls}" aria-hidden="true">${esc(initial(n))}</div>`;

// ---------- Router admin tanpa reload ----------
// Shell (sidebar + navbar + footer) dibangun SEKALI. Perpindahan halaman hanya menukar isi #app-content.
// Tiap halaman mendaftar dirinya: Pages.nama = (me) => { ...; return cleanupFn }
const Pages = {};
const _scripts = {}, _frag = {};
let _me = null, _shell = false, _cleanup = null, _cur = null, _navId = 0;
const loadScript = (src) => _scripts[src] || (_scripts[src] = new Promise((ok, no) => {
  const ex = document.querySelector(`script[src="${src}"]`);
  if (ex) return ok();   // tag statis sudah dieksekusi sebelum boot dipanggil
  const s = document.createElement('script'); s.src = src; s.onload = () => { s.dataset.ready = 1; ok(); }; s.onerror = () => { delete _scripts[src]; no(new Error('Gagal memuat ' + src)); }; document.head.appendChild(s);
}));
const routeOf = (path) => { const k = path.replace(/^\/+|\/+$/g, '').replace(/\.html$/, '') || 'dashboard'; return MENU.some((m) => m[0] === k) ? k : null; };
const fetchFrag = (k) => _frag[k] || (_frag[k] = fetch('/' + k).then((r) => { if (!r.ok) throw new Error('Halaman tidak ditemukan'); return r.text(); })
  .then((t) => { const d = new DOMParser().parseFromString(t, 'text/html'); const c = d.querySelector('#app-content'); if (!c) throw new Error('Halaman tidak valid'); return { html: c.innerHTML, title: d.title }; })
  .catch((e) => { delete _frag[k]; throw e; }));
// Dialog konfirmasi (hapus dsb.). Mengembalikan Promise<boolean>.
function confirmBox(title, text, okText = 'Hapus') {
  return new Promise((res) => {
    const el = document.createElement('div'); el.className = 'modal fade page-modal'; el.tabIndex = -1;
    el.innerHTML = `<div class="modal-dialog modal-dialog-centered"><div class="modal-content p-4"><h5 class="card-title mb-2">${esc(title)}</h5><p class="text-muted mb-4">${esc(text)}</p><div class="d-flex gap-2"><button type="button" class="btn-custom btn-custom-danger" data-ok>${esc(okText)}</button><button type="button" class="btn-custom btn-custom-light" data-bs-dismiss="modal">Batal</button></div></div></div>`;
    document.body.appendChild(el); const m = new bootstrap.Modal(el); let ok = false;
    el.querySelector('[data-ok]').onclick = () => { ok = true; m.hide(); };
    el.addEventListener('hidden.bs.modal', () => { m.dispose(); el.remove(); res(ok); }); m.show();
  });
}
// Modal dipindah ke <body> supaya selalu di atas backdrop & terpusat (tidak terjebak di dalam layout halaman)
// Susun isi modal jadi 3 bagian: header (judul + tombol X) tetap, isi yang bisa di-scroll, dan footer (tombol aksi) tetap
function enhanceModal(m) {
  if (m.id === 'qrModal') return;   // modal QR kecil, tetap sederhana
  m.querySelectorAll('.modal-content').forEach((c) => {
    if (c.dataset.enh) return; c.dataset.enh = 1; c.classList.remove('p-4'); c.classList.add('mc-split');
    const kids = [...c.children], x = '<button type="button" class="modal-x" data-bs-dismiss="modal" aria-label="Tutup"><i class="bi bi-x-lg"></i></button>';
    const head = kids[0]?.matches('h5') ? kids[0] : null;
    const last = kids[kids.length - 1], foot = last && last !== head && last.matches('.d-flex') && last.querySelector('button') ? last : null;
    const body = document.createElement('div'); body.className = 'mc-body';
    kids.filter((k) => k !== head && k !== foot).forEach((k) => body.appendChild(k));
    c.innerHTML = '';
    if (head) { const h = document.createElement('div'); h.className = 'mc-head'; head.className = 'mc-title'; h.appendChild(head); h.insertAdjacentHTML('beforeend', x); c.appendChild(h); }
    else c.insertAdjacentHTML('beforeend', x.replace('modal-x', 'modal-x modal-x-abs'));
    c.appendChild(body);
    if (foot) { const f = document.createElement('div'); f.className = 'mc-foot'; f.appendChild(foot); c.appendChild(f); }
  });
}
function hoistModals() { document.querySelectorAll('#app-content .modal').forEach((m) => { enhanceModal(m); m.classList.add('page-modal'); document.body.appendChild(m); }); }
function resetOverlays() {   // tutup modal / backdrop sisa halaman sebelumnya
  document.querySelectorAll('.page-modal').forEach((m) => { try { bootstrap.Modal.getInstance(m)?.dispose(); } catch {} m.remove(); });
  document.querySelectorAll('.modal-backdrop').forEach((b) => b.remove());
  document.body.classList.remove('modal-open'); document.body.style.removeProperty('overflow'); document.body.style.removeProperty('padding-right');
  document.querySelectorAll('.dropdown-menu.show').forEach((d) => d.classList.remove('show'));
}
function setActive(k) { document.querySelectorAll('#sidebar .sidebar-menu-link').forEach((a) => a.classList.toggle('active', a.dataset.k === k)); }
async function render(k, push) {
  const id = ++_navId; if (k === _cur && !push) return;
  let f; try { [f] = await Promise.all([fetchFrag(k), loadScript('/assets/js/hours.js'), loadScript(`/assets/js/pages/${k}.js`)]); } catch (e) { if (id === _navId) toast(e.message, false); return; }
  if (id !== _navId) return;   // ada klik lain yang lebih baru
  try { _cleanup?.(); } catch {} _cleanup = null; resetOverlays();
  const c = $('#app-content'); c.innerHTML = f.html; hoistModals(); c.classList.remove('page-in'); void c.offsetWidth; c.classList.add('page-in');
  document.title = f.title; setActive(k); _cur = k; if (push) history.pushState({ k }, '', '/' + k); scrollTo(0, 0); $('#sidebar')?.classList.remove('show'); $('.sidebar-overlay')?.classList.remove('show');
  try { _cleanup = (await Pages[k](_me)) || null; } catch (e) { console.error(e); toast(e.message, false); }
}
function go(k) { if (k === _cur) return; render(k, true); }
// prefetch halaman lain saat idle / hover supaya perpindahan instan
const prefetch = () => MENU.forEach(([k]) => { fetchFrag(k).catch(() => {}); loadScript(`/assets/js/pages/${k}.js`).catch(() => {}); });

function buildShell(me, session) {
  const content = $('#app-content');
  const side = document.createElement('div'); side.className = 'sidebar-wrapper'; side.id = 'sidebar';
  side.innerHTML = `<a href="/dashboard" class="sidebar-brand" data-k="dashboard"><i class="bi bi-person-check-fill"></i><span>HADIRIN <small class="brand-by">By RB</small></span></a>
   <div class="flex-grow-1"><div class="sidebar-menu-section"><div class="sidebar-menu-title">Menu</div><ul class="sidebar-menu-list">
   ${MENU.map(([k, i, t]) => `<li class="sidebar-menu-item"><a href="/${k}" data-k="${k}" class="sidebar-menu-link"><i class="bi ${i}"></i><span>${t}</span></a></li>`).join('')}
   </ul></div></div>
   <div class="sidebar-profile">${avatar(me.full_name, 'avatar-side')}<div class="sidebar-profile-info"><div class="sidebar-profile-name">${esc(me.full_name)}</div><div class="sidebar-profile-email">${esc(session.user.email)}</div></div></div>`;
  const main = document.createElement('div'); main.className = 'main-wrapper';
  main.innerHTML = `<header class="navbar-custom"><div class="navbar-left"><button class="sidebar-toggle-btn me-2" id="sidebar-toggle" aria-label="Toggle Navigation"><i class="bi bi-list"></i></button><strong id="clock"></strong></div><div></div>
   <div class="navbar-actions"><button class="navbar-action-btn me-1" id="btn-fullscreen" aria-label="Fullscreen"><i class="bi bi-arrows-fullscreen"></i></button>
   <div class="dropdown"><button class="navbar-profile-btn dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">${avatar(me.full_name, 'avatar-nav')}<span class="navbar-profile-name d-none d-md-inline">${esc(me.full_name)}</span><i class="bi bi-chevron-down navbar-profile-caret"></i></button>
   <ul class="dropdown-menu dropdown-menu-end dropdown-menu-profile"><li class="dropdown-header">Selamat datang!</li><li><a class="dropdown-item" href="/setting" data-k="setting"><i class="bi bi-gear"></i> Setting</a></li><li><hr class="dropdown-divider"></li><li><a class="dropdown-item text-danger" href="#" id="logout"><i class="bi bi-box-arrow-right"></i> Keluar</a></li></ul></div></div></header>`;
  main.appendChild(content);
  main.insertAdjacentHTML('beforeend', `<footer class="footer-custom"><div class="footer-left"><span class="footer-logo"><i class="bi bi-person-check-fill"></i> ${BRAND}</span><span class="footer-separator">|</span><span class="footer-copy">&copy; ${new Date().getFullYear()} ${BRAND} &bull; Sistem Absensi Karyawan</span></div>
   <div class="footer-right"><span class="footer-made">Dibuat oleh <a href="https://byrb.vercel.app" target="_blank" rel="noopener noreferrer" class="footer-made-link">By RB Developer</a></span></div></footer>`);
  document.body.prepend(main); document.body.prepend(side);
  const ov = document.createElement('div'); ov.className = 'sidebar-overlay'; document.body.appendChild(ov);
  const tg = (f) => { side.classList.toggle('show', f); ov.classList.toggle('show', f); };
  $('#sidebar-toggle').onclick = () => tg(!side.classList.contains('show')); ov.onclick = () => tg(false);
  $('#btn-fullscreen').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  $('#logout').onclick = async (e) => { e.preventDefault(); await sb.auth.signOut(); location.replace('/login'); };
  const tick = () => { const n = new Date(); $('#clock').innerHTML = `<span class="clk-date">${n.toLocaleDateString('id-ID', { dateStyle: 'full', timeZone: 'Asia/Jakarta' })}</span><span class="clk-time">${n.toLocaleTimeString('id-ID', { timeStyle: 'medium', timeZone: 'Asia/Jakarta' })}</span>`; };
  tick(); setInterval(tick, 1000);
  // tabel responsif: beri data-label pada tiap sel (dari header) supaya bisa tampil sebagai kartu di mobile
  let _lt = 0; const labelTables = () => { _lt = 0; document.querySelectorAll('#app-content table.table-custom').forEach((t) => { const h = [...t.querySelectorAll('thead th')].map((x) => x.textContent.trim()); t.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => { if (td.colSpan > 1 || td.dataset.label !== undefined) return; td.dataset.label = h[i] || ''; })); }); };
  new MutationObserver(() => { if (!_lt) _lt = requestAnimationFrame(labelTables); }).observe($('#app-content'), { childList: true, subtree: true });
  // navigasi tanpa reload: semua link menu dicegat
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-k]'); if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault(); go(a.dataset.k);
  });
  document.addEventListener('pointerover', (e) => { const a = e.target.closest?.('a[data-k]'); if (a) { fetchFrag(a.dataset.k).catch(() => {}); loadScript(`/assets/js/pages/${a.dataset.k}.js`).catch(() => {}); } });
  addEventListener('popstate', () => { const k = routeOf(location.pathname); if (k) render(k, false); });
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') location.replace('/login'); });
  _shell = true;
}

// Dipanggil sekali oleh tiap halaman admin (halaman pertama yang dibuka). Halaman berikutnya dimuat lewat router.
async function bootAdmin(first) {
  const root = document.documentElement;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return location.replace('/login');
  const { data: me, error: pe } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
  if (me && me.role === 'employee' && me.active) return location.replace('/app');
  if (!me && pe && pe.code !== 'PGRST116') return location.replace('/login?e=' + encodeURIComponent('Koneksi bermasalah. Coba lagi.'));   // gangguan jaringan bukan alasan untuk logout
  if (!me || me.role !== 'admin' || !me.active) { await sb.auth.signOut(); const why = pe ? 'Gagal membaca profiles: ' + pe.message : !me ? 'Akun belum punya data di tabel profiles. Jalankan: npm run seed' : 'Akun ini bukan admin'; return location.replace('/login?e=' + encodeURIComponent(why)); }
  _me = me; await loadScript('/assets/js/hours.js');
  buildShell(me, session); setActive(first); _cur = first; history.replaceState({ k: first }, '', location.pathname);
  hoistModals(); $('#app-content').classList.add('page-in');
  root.classList.remove('boot');   // baru tampil setelah login terverifikasi & shell siap: tidak ada glitch
  try { _cleanup = (await Pages[first](me)) || null; } catch (e) { console.error(e); toast(e.message, false); }
  (window.requestIdleCallback || setTimeout)(prefetch, 300);
}
