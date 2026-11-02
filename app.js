// ---------- Pop-up buatan sendiri (pengganti prompt / confirm / alert bawaan browser) ----------
function modal({ title, message = '', input = null, ok = 'OK', cancel = 'Batal', danger = false }) {
    return new Promise(resolve => {
        const back = document.createElement('div');
        back.className = 'mback';
        const box = document.createElement('div');
        box.className = 'modal';
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        const h = document.createElement('h3');
        h.textContent = title;
        box.appendChild(h);
        if (message) {
            const p = document.createElement('p');
            p.textContent = message;               // textContent: aman, teks tidak dibaca sebagai HTML
            box.appendChild(p);
        }
        let field = null;
        if (input !== null) {
            field = document.createElement('input');
            field.type = 'text';
            field.value = input;
            field.maxLength = 60;
            box.appendChild(field);
        }
        const btns = document.createElement('div');
        btns.className = 'mbtns';
        if (cancel) {
            const c = document.createElement('button');
            c.textContent = cancel;
            c.addEventListener('click', () => close(null));
            btns.appendChild(c);
        }
        const okB = document.createElement('button');
        okB.textContent = ok;
        okB.className = danger ? 'danger' : 'primary';
        okB.addEventListener('click', () => close(field ? (field.value.trim() || null) : true));
        btns.appendChild(okB);
        box.appendChild(btns);
        back.appendChild(box);
        back.addEventListener('mousedown', e => { if (e.target === back) close(null); });
        document.body.appendChild(back);

        const before = document.activeElement;
        function onKey(e) {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
            else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); e.stopPropagation(); okB.click(); }
        }
        document.addEventListener('keydown', onKey, true);
        function close(value) {
            document.removeEventListener('keydown', onKey, true);
            back.remove();
            if (before && before.focus) before.focus();
            resolve(value);
        }
        if (field) { field.focus(); field.select(); } else okB.focus();
    });
}
const tell = (title, message) => modal({ title, message, cancel: null });
const askConfirm = (title, message, ok = 'Ya', danger = false) => modal({ title, message, ok, danger }).then(v => v === true);
const askText = (title, message, value) => modal({ title, message, input: value, ok: 'Simpan' });
// nama file yang aman dari nama tierlist (karakter terlarang di Windows dibuang)
const fileSafe = n => (n || '').replace(/[\\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'tierlist';

// Versi file ini (untuk memastikan browser memuat file terbaru, bukan cache)
const APP_VERSION = '4i-1';
console.log('Tierlist app.js versi', APP_VERSION);
function showFatal(msg) {
    const el = document.getElementById('status');
    if (el) { el.textContent = 'Error: ' + msg; el.style.color = '#ff7b72'; }
}
window.addEventListener('error', e => showFatal(`${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
window.addEventListener('unhandledrejection', e => showFatal(String((e.reason && e.reason.message) || e.reason)));

// ---------- Data ----------
const state = {
    tiers: [
        { id: 't1', name: 'S', color: '#e5534b', items: [] },
        { id: 't2', name: 'A', color: '#e8943a', items: [] },
        { id: 't3', name: 'B', color: '#e5c94b', items: [] },
        { id: 't4', name: 'C', color: '#6fbf5f', items: [] },
        { id: 't5', name: 'D', color: '#4f9de0', items: [] },
    ],
    pool: [],      // id gambar yang belum masuk tier
    images: {},    // id -> { url }  (url sementara; file aslinya ada di IndexedDB)
};
state.exportedAt = 0;   // waktu export terakhir (ms)
state.updatedAt = 0;    // waktu perubahan terakhir (ms)
state.desc = '';        // deskripsi tierlist (teks bebas, opsional)
state.props = {};      // properti teks per gambar: id -> [{ t: judul, v: isi }]
state.fit = 'cover';   // 'cover' = isi penuh (dipotong), 'contain' = utuh (ada ruang kosong)
let dragId = null;       // id gambar yang sedang diseret
let dragTierId = null;   // id tier yang sedang diseret (lewat pegangan ⠿)

// ---------- Penyimpanan (IndexedDB) ----------
// Dua "laci": 'images' = file gambar (blob), 'meta' = susunan tier & urutan gambar.
let db = null;
let initProblem = '';     // alasan database gagal dibuka (kalau gagal)
function dbNotReady() {
    tell('Penyimpanan belum siap', initProblem ? initProblem : 'Halaman masih memuat. Coba lagi sebentar.');
}
let lists = [];          // daftar tierlist: [{ id, name }]
let currentId = null;    // id tierlist yang sedang dibuka
const curName = () => (lists.find(l => l.id === currentId) || {}).name || '';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('tierlist-db', 2);
        req.onupgradeneeded = e => {
            const tx = req.transaction, d = req.result;
            const imgs = e.oldVersion < 1 ? d.createObjectStore('images', { keyPath: 'id' }) : tx.objectStore('images');
            if (e.oldVersion < 1) d.createObjectStore('meta');
            imgs.createIndex('listId', 'listId');       // supaya gambar bisa dicari per tierlist
            d.createObjectStore('lists', { keyPath: 'id' });
            if (e.oldVersion >= 1) {                    // MIGRASI v1 -> v2: data lama menjadi "Tierlist 1"
                tx.objectStore('meta').get('state').onsuccess = ev => {
                    const old = ev.target.result;
                    if (!old) return;
                    tx.objectStore('lists').put({ id: 'l1', name: 'Tierlist 1', tiers: old.tiers, pool: old.pool, fit: old.fit || 'cover' });
                    tx.objectStore('meta').put('l1', 'current');
                };
                imgs.openCursor().onsuccess = ev => {
                    const c = ev.target.result;
                    if (!c) return;
                    c.update({ ...c.value, listId: 'l1' });
                    c.continue();
                };
            }
        };
        req.onsuccess = () => { req.result.onversionchange = () => req.result.close(); resolve(req.result); };
        req.onerror = () => reject(req.error);
        req.onblocked = () => { statusEl.textContent = 'Tutup tab Tierlist lain yang masih terbuka, lalu muat ulang halaman'; };
    });
}

// Pembungkus kecil supaya operasi IndexedDB bisa dipakai dengan await
function run(storeName, mode, fn) {
    return new Promise((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const request = fn(t.objectStore(storeName));
        t.oncomplete = () => resolve(request ? request.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
    });
}

const statusEl = document.getElementById('status');
const usageEl = document.getElementById('usage');

async function showUsage() {          // perkiraan ruang yang dipakai halaman ini di browser
    try {
        if (!navigator.storage || !navigator.storage.estimate) return;
        const { usage } = await navigator.storage.estimate();
        usageEl.textContent = `· ±${(usage / 1048576).toFixed(1)} MB terpakai`;
    } catch (err) { /* tidak penting */ }
}

function applyFit() {
    document.documentElement.style.setProperty('--fit', state.fit);
    document.getElementById('btnFit').textContent = state.fit === 'cover' ? 'Gambar: Potong' : 'Gambar: Utuh';
}
let saveTimer = null;
let dirty = false;     // ada perubahan yang belum disimpan?

function saveSoon() {                 // tunggu 0,3 detik supaya tidak menyimpan tiap ketikan
    if (!db) return;
    dirty = true;
    statusEl.textContent = 'Menyimpan…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
}
async function saveNow() {
    clearTimeout(saveTimer);
    if (!db || !currentId) return;
    if (dirty) { state.updatedAt = Date.now(); dirty = false; }    // pindah tierlist saja tidak dihitung sebagai perubahan
    try {
        await run('lists', 'readwrite', s => s.put({ id: currentId, name: curName(), tiers: state.tiers, pool: state.pool, fit: state.fit, props: liveProps(), desc: state.desc, exportedAt: state.exportedAt, updatedAt: state.updatedAt }));
        statusEl.textContent = 'Tersimpan';
        showUsage();
        renderBackupInfo();
    } catch (err) {
        console.error(err);
        statusEl.textContent = 'Gagal menyimpan!';
    }
}
// Kalau tab ditutup/disembunyikan, simpan langsung
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

// ---------- Export / Import (JSON) ----------
function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
    });
}

async function exportJSON() {
    if (!db) { dbNotReady(); return; }
    try {
        await saveNow();
        statusEl.textContent = 'Menyiapkan export…';
        const rows = await run('images', 'readonly', s => s.index('listId').getAll(currentId));
        const images = [];
        for (const r of rows) images.push({ id: r.id, type: r.blob.type, data: await blobToDataURL(r.blob) });
        const payload = {
            app: 'tierlist', version: 1, name: curName(), exportedAt: new Date().toISOString(),
            tiers: state.tiers, pool: state.pool, fit: state.fit, props: liveProps(), desc: state.desc, images,
        };
        const file = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file);
        a.download = `${fileSafe(curName())}.json`;      // nama file = nama tierlist
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);   // beri waktu browser menyelesaikan unduhan
        state.exportedAt = Date.now();
        await saveNow();
        renderBackupInfo();
        statusEl.textContent = 'Export selesai';
    } catch (err) {
        console.error(err);
        statusEl.textContent = 'Export gagal';
        tell('Export gagal', err.message);
    }
}

async function importJSON(file) {
    if (!db) { dbNotReady(); return; }
    try {
        const data = JSON.parse(await file.text());
        if (data.app !== 'tierlist' || data.version !== 1 || !Array.isArray(data.tiers)
            || !Array.isArray(data.pool) || !Array.isArray(data.images)) {
            throw new Error('Format file tidak dikenali.');
        }
        statusEl.textContent = 'Membaca file…';

        // 1) Ubah semua gambar jadi blob DULU (di memori). Kalau ada yang gagal, data lama belum disentuh.
        const blobs = new Map();
        for (const im of data.images) {
            if (typeof im.id !== 'string' || typeof im.data !== 'string' || !im.data.startsWith('data:image/')) continue;
            blobs.set(im.id, await (await fetch(im.data)).blob());
        }

        // 2) Bersihkan data dari file (jangan percaya isi file begitu saja)
        const okColor = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
        const seen = new Set();
        const take = ids => (Array.isArray(ids) ? ids : []).filter(id => {
            if (typeof id !== 'string' || !blobs.has(id) || seen.has(id)) return false;
            seen.add(id);
            return true;
        });
        const tiers = data.tiers.map((t, i) => ({
            id: 't' + (i + 1),
            name: String(t.name ?? ''),
            color: okColor(t.color) ? t.color : '#888888',
            items: take(t.items),
            collapsed: !!t.collapsed,
            props: cleanProps(t.props),
        }));
        const pool = take(data.pool);
        blobs.forEach((_, id) => { if (!seen.has(id)) pool.push(id); });
        const fit = data.fit === 'contain' ? 'contain' : 'cover';

        // id gambar dibuat BARU supaya tidak menabrak gambar di tierlist lain
        const idMap = new Map([...blobs.keys()].map(k => [k, crypto.randomUUID()]));
        const remap = ids => ids.map(x => idMap.get(x));
        tiers.forEach(t => { t.items = remap(t.items); });
        const newPool = remap(pool);
        const ts = Date.now();
        const newProps = {};      // properti ikut dipindah ke id gambar yang baru
        Object.entries(data.props || {}).forEach(([oldId, list]) => { if (idMap.has(oldId)) { const c = cleanProps(list); if (c.length) newProps[idMap.get(oldId)] = c; } });
        const name = String(data.name || file.name.replace(/\.json$/i, '') || 'Import').slice(0, 60);
        const id = 'l' + crypto.randomUUID().slice(0, 8);

        await saveNow();
        // Tulis dalam SATU transaksi: berhasil semua, atau batal semua
        await new Promise((resolve, reject) => {
            const t = db.transaction(['images', 'lists'], 'readwrite');
            const imgStore = t.objectStore('images');
            blobs.forEach((blob, oldId) => imgStore.put({ id: idMap.get(oldId), blob, listId: id }));
            t.objectStore('lists').put({ id, name, tiers, pool: newPool, fit, props: newProps, desc: String(data.desc || '').slice(0, 2000), exportedAt: ts, updatedAt: ts });
            t.oncomplete = resolve;
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error);
        });
        lists.push({ id, name });
        await loadList(id);
        showUsage();
        statusEl.textContent = 'Import selesai (jadi tierlist baru)';
    } catch (err) {
        console.error(err);
        statusEl.textContent = 'Import gagal';
        tell('Import gagal', err.message);
    }
}

document.getElementById('btnFit').addEventListener('click', () => {
    state.fit = state.fit === 'cover' ? 'contain' : 'cover';
    applyFit();
    saveSoon();
});
const searchEl = document.getElementById('search');
searchEl.addEventListener('input', () => { searchQ = searchEl.value.trim().toLowerCase(); hitCursor = -1; applySearch(); });
searchEl.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); jumpNext(); }
    else if (e.key === 'Escape') { searchEl.value = ''; searchQ = ''; applySearch(); searchEl.blur(); }
});
document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchEl.focus(); searchEl.select(); }
});
document.getElementById('btnPng').addEventListener('click', exportPNG);
document.getElementById('backupInfo').addEventListener('click', async () => {
    if (!db) return dbNotReady();
    if (await askConfirm('Export tierlist?', `"${curName()}" akan diunduh sebagai ${fileSafe(curName())}.json.`, 'Export')) exportJSON();
});
document.getElementById('btnAddTier').addEventListener('click', () => addTier());
document.getElementById('btnUndo').addEventListener('click', undo);
document.getElementById('btnRedo').addEventListener('click', redo);
document.getElementById('btnFoldAll').addEventListener('click', () => setAllFolded(true));
document.getElementById('btnUnfoldAll').addEventListener('click', () => setAllFolded(false));
document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (document.querySelector('.mback')) return;      // saat ada pop-up/panel terbuka, undo aplikasi dimatikan
    const ae = document.activeElement;
    if (ae && (ae.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))) return;   // saat mengetik, pakai undo teks bawaan browser
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
});
document.getElementById('btnExport').addEventListener('click', exportJSON);
document.getElementById('btnImport').addEventListener('click', () => document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change', e => {
    const f = e.target.files[0];
    e.target.value = '';   // supaya file yang sama bisa dipilih lagi
    if (f) importJSON(f);
});

// ---------- Undo / Redo ----------
const MAX_UNDO = 50;
const undoStack = [], redoStack = [];
const trash = {};   // gambar yang "dihapus" tapi masih bisa dikembalikan lewat undo: id -> { url, blob }

const idsIn = snap => [...snap.pool, ...snap.tiers.flatMap(t => t.items)];
const takeSnapshot = () => ({ tiers: structuredClone(state.tiers), pool: [...state.pool], props: structuredClone(state.props) });

function pushUndo() {            // panggil SEBELUM mengubah data
    undoStack.push(takeSnapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
    updateUndoButtons();
}
function updateUndoButtons() {
    document.getElementById('btnUndo').disabled = undoStack.length === 0;
    document.getElementById('btnRedo').disabled = redoStack.length === 0;
}
function sweepUnreferenced() {   // gambar yang tidak dipakai tier/pool -> tong sampah (dihapus dari database, blob tetap di memori)
    const used = new Set(idsIn(state));
    for (const id of Object.keys(state.images)) {
        if (used.has(id)) continue;
        trash[id] = state.images[id];
        delete state.images[id];
        if (db) run('images', 'readwrite', s => s.delete(id)).catch(console.error);
    }
}
function pruneTrash() {          // buang dari tong sampah gambar yang sudah tidak mungkin dikembalikan
    const keep = new Set();
    [...undoStack, ...redoStack].forEach(sn => idsIn(sn).forEach(id => keep.add(id)));
    for (const id of Object.keys(trash)) {
        if (keep.has(id)) continue;
        URL.revokeObjectURL(trash[id].url);
        delete trash[id];
    }
}
function afterChange() {         // rapikan + gambar ulang + simpan
    sweepUnreferenced();
    pruneTrash();
    render();
    saveSoon();
    updateUndoButtons();
}
function restore(snap) {
    const folded = new Map(state.tiers.map(t => [t.id, t.collapsed]));   // status lipat bukan bagian dari undo
    state.tiers = structuredClone(snap.tiers);
    state.tiers.forEach(t => { if (folded.has(t.id)) t.collapsed = folded.get(t.id); });
    state.pool = [...snap.pool];
    state.props = structuredClone(snap.props || {});
    for (const id of idsIn(snap)) {            // kembalikan gambar yang tadinya dihapus
        if (state.images[id] || !trash[id]) continue;
        state.images[id] = trash[id];
        delete trash[id];
        if (db) run('images', 'readwrite', s => s.put({ id, blob: state.images[id].blob, listId: currentId })).catch(console.error);
    }
    const known = id => id in state.images;
    state.pool = state.pool.filter(known);
    state.tiers.forEach(t => { t.items = t.items.filter(known); });
    afterChange();
}
function undo() { if (!undoStack.length) return; redoStack.push(takeSnapshot()); restore(undoStack.pop()); }
function redo() { if (!redoStack.length) return; undoStack.push(takeSnapshot()); restore(redoStack.pop()); }

// ---------- Helper ----------
function listOf(zone) {
    return zone === 'pool' ? state.pool : state.tiers.find(t => t.id === zone).items;
}
function removeEverywhere(id) {
    state.pool = state.pool.filter(x => x !== id);
    state.tiers.forEach(t => { t.items = t.items.filter(x => x !== id); });
}
function moveTo(id, zone) {
    removeEverywhere(id);
    listOf(zone).push(id);
}
// Ukuran terpanjang gambar setelah dikecilkan. Tampilan cuma 88 px, jadi 400 px sudah sangat tajam.
const MAX_SIDE = 400;
const KEEP_BYTES = 300 * 1024;   // gambar kecil yang sudah ringan tidak diutak-atik

// Deteksi gambar animasi (GIF, WebP animasi, APNG): ini TIDAK boleh dikecilkan lewat canvas,
// karena canvas hanya mengambil 1 frame dan animasinya hilang.
async function isAnimated(file) {
    if (file.type === 'image/gif') return true;
    const buf = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    const text = String.fromCharCode(...buf);
    if (file.type === 'image/webp') return text.slice(8, 12) === 'WEBP' && text.slice(12, 16) === 'VP8X' && (buf[20] & 2) !== 0;
    if (file.type === 'image/png') return text.includes('acTL');
    return false;
}

async function shrinkImage(file) {
    try {
        if (file.type === 'image/svg+xml' || await isAnimated(file)) return file;   // dibiarkan apa adanya
        const bmp = await createImageBitmap(file);
        const longest = Math.max(bmp.width, bmp.height);
        if (longest <= MAX_SIDE && file.size <= KEEP_BYTES) { bmp.close(); return file; }
        const scale = Math.min(1, MAX_SIDE / longest);         // tidak pernah memperbesar
        const w = Math.max(1, Math.round(bmp.width * scale));
        const h = Math.max(1, Math.round(bmp.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);    // seluruh gambar, TIDAK dipotong
        bmp.close();
        const out = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.85));
        return out && out.size < file.size ? out : file;       // kalau hasilnya tidak lebih kecil, pakai asli
    } catch (err) {
        console.error('Gagal mengecilkan, pakai file asli:', err);
        return file;
    }
}

async function addFiles(files, zone, index) {
    if (db && !currentId) { statusEl.textContent = 'Database masih memuat, coba lagi sebentar'; return; }
    const list = [...files].filter(f => f.type.startsWith('image/'));
    const newIds = [];
    for (let i = 0; i < list.length; i++) {
        statusEl.textContent = `Memproses gambar ${i + 1}/${list.length}…`;
        const blob = await shrinkImage(list[i]);
        const id = crypto.randomUUID();
        try {
            if (db) await run('images', 'readwrite', s => s.put({ id, blob, listId: currentId }));
        } catch (err) {
            console.error(err);
            statusEl.textContent = 'Gagal menyimpan gambar (penyimpanan penuh?)';
            continue;
        }
        state.images[id] = { url: URL.createObjectURL(blob), blob };
        newIds.push(id);
    }
    const target = listOf(zone);
    const at = (index == null || index > target.length) ? target.length : index;
    target.splice(at, 0, ...newIds);
}

// ---------- Menu pengaturan tier (⚙) ----------
const SWATCHES = ['#e5534b', '#e8943a', '#e5c94b', '#6fbf5f', '#4f9de0', '#a07be0',
    '#e07bb4', '#7fc4c4', '#8b90a0', '#c9ccd6', '#3b6fd4', '#2f9e8f'];
const tpop = document.createElement('div');
tpop.id = 'tpop';
document.body.appendChild(tpop);

function closeTierMenu() { tpop.style.display = 'none'; tpop.innerHTML = ''; }
document.addEventListener('mousedown', e => { if (!tpop.contains(e.target) && !e.target.closest('.tgear')) closeTierMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTierMenu(); });
window.addEventListener('scroll', closeTierMenu, true);

function openTierMenu(tier, labelEl, anchor) {
    const idx = state.tiers.indexOf(tier);
    tpop.innerHTML = `<div class="sw"></div>
    <div class="row"><span>Warna lain</span><input type="color"></div>
    <button class="act" data-a="above">↑ Tambah baris di atas</button>
    <button class="act" data-a="below">↓ Tambah baris di bawah</button>
    <button class="act" data-a="props">ⓘ Properti / deskripsi tier…</button>
    <button class="act danger" data-a="del">Hapus tier</button>`;
    const sw = tpop.querySelector('.sw');
    SWATCHES.forEach(c => {
        const b = document.createElement('button');
        b.style.background = c;
        b.title = c;
        if (c.toLowerCase() === String(tier.color).toLowerCase()) b.className = 'on';
        b.addEventListener('click', () => { closeTierMenu(); pushUndo(); tier.color = c; afterChange(); });
        sw.appendChild(b);
    });
    const custom = tpop.querySelector('input');
    custom.value = tier.color;
    let picked = false;
    custom.addEventListener('input', () => {        // geser pemilih warna = satu langkah undo
        if (!picked) { pushUndo(); picked = true; }
        tier.color = custom.value;
        labelEl.style.background = tier.color;
        saveSoon();
    });
    tpop.querySelectorAll('.act').forEach(b => b.addEventListener('click', () => {
        closeTierMenu();
        if (b.dataset.a === 'above') addTier(idx);
        else if (b.dataset.a === 'below') addTier(idx + 1);
        else if (b.dataset.a === 'props') openTierProps(tier.id);
        else deleteTier(tier.id);
    }));
    tpop.style.display = 'block';
    const r = anchor.getBoundingClientRect(), w = tpop.offsetWidth, h = tpop.offsetHeight;
    tpop.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';   // rata kanan dengan tombol
    tpop.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - h - 8)) + 'px';
}

const PALETTE = ['#e5534b', '#e8943a', '#e5c94b', '#6fbf5f', '#4f9de0', '#a07be0', '#e07bb4', '#7fc4c4'];
function addTier(at) {          // at = posisi sisip (kosong = paling bawah)
    pushUndo();
    state.tiers.splice(at == null ? state.tiers.length : at, 0, {
        id: 't' + crypto.randomUUID().slice(0, 8),
        name: 'Baru',
        color: PALETTE[state.tiers.length % PALETTE.length],
        items: [],
    });
    afterChange();
}
function deleteTier(id) {
    pushUndo();
    const tier = state.tiers.find(t => t.id === id);
    state.pool.push(...tier.items);          // gambarnya tidak dihapus, kembali ke area gambar
    state.tiers = state.tiers.filter(t => t.id !== id);
    afterChange();
}
function deleteImage(id) {                 // gambar masuk tong sampah, bisa dikembalikan dengan undo
    pushUndo();
    removeEverywhere(id);
    afterChange();
}
function setAllFolded(value) {
    state.tiers.forEach(t => { t.collapsed = value; });
    render();
    saveSoon();
}

// ---------- Tampilan ----------
// ---------- Properti per gambar (teks bebas, opsional) ----------
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const hasProps = id => !!(state.props[id] && state.props[id].length);
const liveProps = () => Object.fromEntries(Object.entries(state.props).filter(([id]) => id in state.images));
function cleanProps(list) {          // dipakai juga saat import: jangan percaya isi file begitu saja
    return (Array.isArray(list) ? list : []).slice(0, 20)
        .map(p => ({ t: String((p && p.t) || '').slice(0, 60), v: String((p && p.v) || '').slice(0, 2000) }))
        .filter(p => p.t.trim() || p.v.trim());
}

const tip = mk('div', 'tip');
document.body.appendChild(tip);
function hideTip() { tip.style.display = 'none'; }
function moveTip(e) {
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + 16, y = e.clientY - h - 16;      // utama: kanan atas kursor, seperti kotak info item di game RPG
    if (x + w > innerWidth - 8) x = e.clientX - w - 16;    // mentok kanan -> kiri atas
    if (y < 8) y = e.clientY + 18;                         // mentok atas -> pindah ke bawah
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = Math.max(8, y) + 'px';
}
function showTip(id, e) { showTipFor(state.props[id], e); }
function showTipFor(list, e) {            // seperti kotak info item di game RPG
    if (!list || !list.length) return;
    tip.replaceChildren();
    list.forEach(p => { if (p.t) tip.appendChild(mk('div', 'k', p.t)); tip.appendChild(mk('div', 'v', p.v)); });
    tip.style.display = 'block';
    moveTip(e);
}

const titleList = mk('datalist');
titleList.id = 'ptitles';
document.body.appendChild(titleList);

// ---------- Form properti (dipakai panel detail gambar dan editor properti tier) ----------
function buildPropsForm(current) {
    const used = new Set([...Object.values(state.props).flat(), ...state.tiers.flatMap(t => t.props || [])].map(p => p.t).filter(Boolean));
    titleList.replaceChildren(...[...used].map(t => { const o = mk('option'); o.value = t; return o; }));   // saran judul
    const el = mk('div'), list = mk('div');
    const addRow = (p = { t: '', v: '' }) => {
        const r = mk('div', 'prow'), t = mk('input'), v = mk('textarea'), x = mk('button', 'x', '×');
        t.type = 'text'; t.value = p.t; t.placeholder = 'Judul'; t.setAttribute('list', 'ptitles'); t.maxLength = 60;
        v.value = p.v; v.placeholder = 'Isi'; v.rows = 2; v.maxLength = 2000;
        x.title = 'Hapus properti ini';
        x.addEventListener('click', () => r.remove());
        r.append(t, v, x);
        list.appendChild(r);
        return t;
    };
    (current && current.length ? current : [{ t: '', v: '' }]).forEach(p => addRow(p));
    const add = mk('button', 'addprop', '+ Tambah properti');
    add.addEventListener('click', () => addRow().focus());
    el.append(list, add);
    return {
        el,
        focus: () => { const f = list.querySelector('input'); if (f) f.focus(); },
        get: () => cleanProps([...list.children].map(r => ({ t: r.querySelector('input').value, v: r.querySelector('textarea').value }))),
    };
}

// ---------- Panel gambar: lihat DAN ubah properti di satu tempat ----------
const PENCIL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
function openDetail(id) {
    hideTip();
    const order = [...state.tiers.flatMap(t => t.items), ...state.pool];      // urutan seperti di layar
    let i = Math.max(0, order.indexOf(id)), form = null;                      // form != null berarti sedang mengedit
    const back = mk('div', 'mback'), box = mk('div', 'modal detail');
    const wrap = mk('div', 'dimg'), img = mk('img');
    const prev = mk('button', 'dnav prev', '‹'), next = mk('button', 'dnav next', '›');
    wrap.append(img, prev, next);
    const side = mk('div', 'dside'), head = mk('div', 'dhead'), where = mk('div', 'dwhere');
    const pencil = mk('button', 'dpencil'), body = mk('div', 'dprops'), foot = mk('div', 'mbtns');
    pencil.innerHTML = PENCIL;
    pencil.title = 'Ubah properti';
    head.append(where, pencil);
    side.append(head, body, foot);
    box.append(wrap, side);
    back.appendChild(box);
    document.body.appendChild(back);

    function show() {
        const cur = order[i], tier = state.tiers.find(t => t.items.includes(cur));
        img.src = state.images[cur].url;
        where.textContent = `${tier ? 'Tier ' + tier.name : 'Area gambar'} · ${i + 1}/${order.length}`;
        prev.hidden = next.hidden = pencil.hidden = !!form;                    // saat mengedit, navigasi dikunci
        body.replaceChildren();
        foot.replaceChildren();
        if (form) {
            body.appendChild(form.el);
            const c = mk('button', '', 'Batal'), s = mk('button', 'primary', 'Simpan');
            c.addEventListener('click', () => { form = null; show(); });
            s.addEventListener('click', saveEdit);
            foot.append(c, s);
            form.focus();
        } else {
            const ps = state.props[cur] || [];
            if (!ps.length) body.appendChild(mk('div', 'dempty', 'Belum ada properti. Klik ikon pensil untuk menambah.'));
            ps.forEach(p => { if (p.t) body.appendChild(mk('div', 'k', p.t)); body.appendChild(mk('div', 'v', p.v)); });
            const x = mk('button', 'primary', 'Tutup');
            x.addEventListener('click', end);
            foot.append(x);
        }
    }
    function saveEdit() {
        const cur = order[i], nextProps = form.get();
        form = null;
        pushUndo();
        if (nextProps.length) state.props[cur] = nextProps; else delete state.props[cur];
        afterChange();                                                         // layar di belakang diperbarui, panel tetap terbuka
        show();
    }
    const go = step => { i = (i + step + order.length) % order.length; show(); };
    function end() { document.removeEventListener('keydown', onKey, true); back.remove(); }
    function onKey(e) {
        const k = e.key;
        if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); if (form) { form = null; show(); } else end(); }
        else if (form && k === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); saveEdit(); }
        else if (!form && (k === 'ArrowLeft' || k === 'ArrowRight')) { e.preventDefault(); e.stopPropagation(); go(k === 'ArrowLeft' ? -1 : 1); }
    }
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('mousedown', e => { if (e.target === back && !form) end(); });   // saat mengedit, tidak tertutup tak sengaja
    prev.addEventListener('click', () => go(-1));
    next.addEventListener('click', () => go(1));
    pencil.addEventListener('click', () => { form = buildPropsForm(state.props[order[i]]); show(); });
    show();
    pencil.focus();
}

function openTierProps(tierId) {
    const t = state.tiers.find(x => x.id === tierId);
    openPropsEditor(`Properti tier "${t.name}"`, t.props, next => {
        pushUndo();
        state.tiers.find(x => x.id === tierId).props = next;      // cari ulang lewat id: undo mengganti objek tier
        afterChange();
    });
}
function openPropsEditor(title, current, onSave) {
    hideTip();
    const back = mk('div', 'mback'), box = mk('div', 'modal wide'), form = buildPropsForm(current);
    box.append(mk('h3', '', title), mk('p', '', 'Opsional. Judul dan isi bebas, misalnya Nama / Dari anime / Alasan.'), form.el);
    const btns = mk('div', 'mbtns'), cancel = mk('button', '', 'Batal'), save = mk('button', 'primary', 'Simpan');
    btns.append(cancel, save);
    box.appendChild(btns);
    back.appendChild(box);
    document.body.appendChild(back);
    function close() { document.removeEventListener('keydown', onKey, true); back.remove(); }
    function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); save.click(); }
    }
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('mousedown', e => { if (e.target === back) close(); });
    cancel.addEventListener('click', close);
    save.addEventListener('click', () => { const next = form.get(); close(); onSave(next); });
    form.focus();
}

// ---------- Export PNG (untuk dipamerkan; dipecah otomatis kalau terlalu tinggi) ----------
const PNG_TILE = 120;        // ukuran tiap gambar di PNG (px)
const PNG_W = 1280, PNG_LABEL = 150, PNG_GAP = 6, PNG_PAD = 8;
const PNG_MAX_H = 12000;     // tinggi maksimum satu file (aman untuk batas canvas Chrome/Firefox/Safari)
const PNG_MAX_ROWS = 25;     // maksimum tier per file
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#000';
const textColorFor = hex => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return '#fff';
    const n = parseInt(m[1], 16);
    return (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) > 150 ? '#111' : '#fff';
};
function wrapLines(ctx, text, maxW) {
    const out = [];
    String(text).split('\n').forEach(par => {
        let line = '';
        par.split(/\s+/).filter(Boolean).forEach(word => {
            const t = line ? line + ' ' + word : word;
            if (!line || ctx.measureText(t).width <= maxW) line = t; else { out.push(line); line = word; }
        });
        out.push(line);
    });
    return out;
}
function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}
const pngPerRow = () => Math.max(1, Math.floor((PNG_W - PNG_LABEL - PNG_PAD) / (PNG_TILE + PNG_GAP)));
const pngRowH = t => {
    const rows = Math.max(1, Math.ceil(t.items.length / pngPerRow()));
    return PNG_PAD * 2 + rows * PNG_TILE + (rows - 1) * PNG_GAP;
};
function pngHeader(ctx, part) {            // deskripsi hanya di file pertama
    ctx.font = '15px system-ui, sans-serif';
    const desc = part === 0 && state.desc.trim() ? wrapLines(ctx, state.desc.trim(), PNG_W - 48) : [];
    return { desc, h: 24 + 40 + (desc.length ? desc.length * 22 + 8 : 0) + 14 };
}
function planPng() {
    const ctx = document.createElement('canvas').getContext('2d');
    const chunks = [];
    let cur = [], h = pngHeader(ctx, 0).h;
    for (const t of state.tiers) {
        const th = pngRowH(t) + PNG_GAP;
        if (cur.length && (cur.length >= PNG_MAX_ROWS || h + th > PNG_MAX_H)) { chunks.push(cur); cur = []; h = pngHeader(ctx, chunks.length).h; }
        cur.push(t);
        h += th;
    }
    if (cur.length) chunks.push(cur);
    return chunks;
}
async function drawTile(ctx, id, x, y, size) {
    const rec = state.images[id];
    ctx.save();
    roundRectPath(ctx, x, y, size, size, 6);
    ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(x, y, size, size);
    try {
        const bmp = await createImageBitmap(rec.blob);               // GIF: hanya frame pertama
        const s = state.fit === 'contain' ? Math.min(size / bmp.width, size / bmp.height) : Math.max(size / bmp.width, size / bmp.height);
        const w = bmp.width * s, h = bmp.height * s;
        ctx.drawImage(bmp, x + (size - w) / 2, y + (size - h) / 2, w, h);
        bmp.close();
    } catch (err) { console.error('Gambar dilewati:', id, err); }
    ctx.restore();
}
async function drawPngChunk(chunk, part, parts) {
    const ctx0 = document.createElement('canvas').getContext('2d');
    const head = pngHeader(ctx0, part);
    const H = head.h + chunk.reduce((s, t) => s + pngRowH(t) + PNG_GAP, 0);
    const canvas = document.createElement('canvas');
    canvas.width = PNG_W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const FONT = 'system-ui, "Segoe UI", sans-serif';
    ctx.fillStyle = cssVar('--bg');
    ctx.fillRect(0, 0, PNG_W, H);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = cssVar('--text');
    ctx.font = `700 28px ${FONT}`;
    ctx.fillText(curName() + (parts > 1 ? `  (${part + 1}/${parts})` : ''), 24, 56, PNG_W - 48);
    ctx.fillStyle = cssVar('--muted');
    ctx.font = `15px ${FONT}`;
    head.desc.forEach((line, i) => ctx.fillText(line, 24, 84 + i * 22, PNG_W - 48));
    let y = head.h;
    for (const t of chunk) {
        const rh = pngRowH(t);
        ctx.fillStyle = cssVar('--panel');
        roundRectPath(ctx, 12, y, PNG_W - 24, rh, 10);
        ctx.fill();
        ctx.save();
        roundRectPath(ctx, 12, y, PNG_W - 24, rh, 10);
        ctx.clip();
        ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : '#888888';
        ctx.fillRect(12, y, PNG_LABEL - 12, rh);                      // kotak warna + nama tier
        ctx.restore();
        ctx.fillStyle = textColorFor(t.color);
        ctx.font = `700 22px ${FONT}`;
        ctx.textAlign = 'center';
        const lines = wrapLines(ctx, t.name || ' ', PNG_LABEL - 36).slice(0, 4);
        lines.forEach((ln, i) => ctx.fillText(ln, 12 + (PNG_LABEL - 12) / 2, y + rh / 2 + (i - (lines.length - 1) / 2) * 26 + 8, PNG_LABEL - 28));
        ctx.textAlign = 'left';
        const perRow = pngPerRow();
        for (let k = 0; k < t.items.length; k++) {
            await drawTile(ctx, t.items[k], PNG_LABEL + (k % perRow) * (PNG_TILE + PNG_GAP), y + PNG_PAD + Math.floor(k / perRow) * (PNG_TILE + PNG_GAP), PNG_TILE);
        }
        y += rh + PNG_GAP;
    }
    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}
function saveBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
async function exportPNG() {
    if (!db) return dbNotReady();
    const chunks = planPng(), nImg = state.tiers.reduce((s, t) => s + t.items.length, 0);
    if (!nImg) { tell('Belum ada gambar di tier', 'Pindahkan gambar ke tier dulu, baru di-export jadi PNG.'); return; }
    const info = `${state.tiers.length} tier dan ${nImg} gambar akan jadi ${chunks.length} file PNG (gambar ${PNG_TILE} px). `
        + 'GIF menjadi gambar diam dan properti tidak ikut.' + (chunks.length > 1 ? ' Browser mungkin meminta izin untuk mengunduh beberapa file sekaligus.' : '');
    if (!(await askConfirm('Export PNG', info, 'Export'))) return;
    try {
        const base = fileSafe(curName());
        for (let p = 0; p < chunks.length; p++) {
            statusEl.textContent = `Membuat PNG ${p + 1}/${chunks.length}…`;
            const blob = await drawPngChunk(chunks[p], p, chunks.length);
            if (!blob) throw new Error('Browser gagal membuat gambar (terlalu besar?)');
            saveBlob(blob, chunks.length > 1 ? `${base} (${p + 1} dari ${chunks.length}).png` : `${base}.png`);
            await new Promise(r => setTimeout(r, 400));
        }
        statusEl.textContent = 'Export PNG selesai';
    } catch (err) {
        console.error(err);
        statusEl.textContent = 'Export PNG gagal';
        tell('Export PNG gagal', err.message);
    }
}

// ---------- Pengingat backup (data hanya ada di browser ini) ----------
function renderBackupInfo() {
    const el = document.getElementById('backupInfo');
    const empty = !state.pool.length && !state.tiers.some(t => t.items.length);
    if (!db || empty) { el.textContent = ''; el.classList.remove('warn'); return; }
    const days = state.exportedAt ? Math.floor((Date.now() - state.exportedAt) / 86400000) : null;
    const changed = state.updatedAt > state.exportedAt;
    let text, warn;
    if (days === null) { text = 'Belum pernah di-export'; warn = true; }
    else {
        text = 'Export terakhir: ' + (days === 0 ? 'hari ini' : days + ' hari lalu') + (changed ? ' · ada perubahan baru' : '');
        warn = changed && days >= 7;
    }
    el.textContent = (warn ? '⚠ ' : '') + text;
    el.classList.toggle('warn', warn);
}

// ---------- Pencarian (menyorot gambar yang properti-nya cocok) ----------
let searchQ = '';
let hitCursor = -1;
const matchId = id => !!searchQ && (state.props[id] || []).some(p => (p.t + ' ' + p.v).toLowerCase().includes(searchQ));
function applySearch() {
    const q = searchQ;
    itemEls.forEach((el, id) => {
        const hit = !!q && matchId(id);
        el.classList.toggle('hit', hit);
        el.classList.toggle('dim', !!q && !hit);
    });
    rowEls.forEach((row, id) => {
        const tier = state.tiers.find(t => t.id === id);
        if (!tier) return;
        const n = q ? tier.items.filter(matchId).length : 0;
        row.classList.toggle('hit', n > 0 && !!tier.collapsed);        // tier terlipat yang menyimpan hasil ikut disorot
        row.querySelector('.count').textContent = `${tier.items.length} gambar` + (q ? ` · ${n} cocok` : '');
    });
    const total = q ? idsIn(state).filter(matchId).length : 0;
    document.getElementById('searchInfo').textContent = q ? (total ? `${total} cocok` : 'tidak ada yang cocok') : '';
}
function jumpNext() {                                                // Enter = loncat ke hasil berikutnya
    const els = [...document.querySelectorAll('.item.hit, .tier.collapsed.hit')];
    if (!els.length) return;
    hitCursor = (hitCursor + 1) % els.length;
    els[hitCursor].scrollIntoView({ block: 'center', behavior: 'smooth' });
}

const itemEls = new Map();   // id gambar -> elemen (dibuat sekali, dipakai ulang agar GIF tidak restart)
const rowEls = new Map();    // id tier -> elemen baris (juga dibuat sekali)

function makeItem(id) {
    let el = itemEls.get(id);
    if (!el) {
        el = document.createElement('div');
        el.className = 'item';
        el.draggable = true;
        el.innerHTML = '<img alt=""><button class="del" title="Hapus">×</button>';
        el.addEventListener('dragstart', e => {
            dragId = id;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', id);
            setTimeout(() => el.classList.add('dragging'));
        });
        el.addEventListener('dragend', () => { dragId = null; render(); });
        el.addEventListener('dragstart', hideTip);
        el.addEventListener('mouseenter', e => showTip(id, e));
        el.addEventListener('mousemove', e => { if (tip.style.display === 'block') moveTip(e); });
        el.addEventListener('mouseleave', hideTip);
        el.addEventListener('click', e => { if (!e.target.closest('.del')) openDetail(id); });
        el.querySelector('.del').addEventListener('click', () => deleteImage(id));
        itemEls.set(id, el);
    }
    const img = el.firstChild;
    if (img.getAttribute('src') !== state.images[id].url) img.src = state.images[id].url;
    el.classList.remove('dragging');
    el.classList.toggle('has-props', hasProps(id));
    return el;
}

// Samakan isi sebuah zona dengan daftar id: hanya memindahkan elemen yang memang posisinya berbeda
function syncItems(zone, ids) {
    const want = ids.map(makeItem), keep = new Set(want);
    [...zone.children].forEach(ch => { if (!keep.has(ch)) ch.remove(); });
    want.forEach((el, i) => { if (zone.children[i] !== el) zone.insertBefore(el, zone.children[i] || null); });
}

// Baris tier dibuat sekali. Pengendali selalu mencari tier lewat id (bukan objek lama), karena undo mengganti objeknya.
function makeRow(id) {
    const T = () => state.tiers.find(t => t.id === id);
    const row = document.createElement('div');
    row.className = 'tier';
    row.innerHTML = `
    <div class="label">
      <div class="name" contenteditable="true" spellcheck="false"></div>
      <button class="tinfo"><svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="2" width="10" height="1.4" rx=".7"/><rect x="1" y="5.3" width="10" height="1.4" rx=".7"/><rect x="1" y="8.6" width="6" height="1.4" rx=".7"/></svg></button>
      <span class="count"></span>
      <button class="tgear" title="Pengaturan tier">⚙</button>
      <button class="tfold" title="Lipat / buka tier">▾</button>
      <div class="thandle" draggable="true" title="Seret untuk memindahkan tier">⠿</div>
    </div>
    <div class="zone"></div>`;
    const label = row.firstElementChild, nameEl = label.querySelector('.name');
    let nameEdited = false;       // satu sesi mengetik = satu langkah undo
    nameEl.addEventListener('input', () => {
        if (!nameEdited) { pushUndo(); nameEdited = true; }
        T().name = nameEl.textContent;
        saveSoon();
    });
    nameEl.addEventListener('blur', () => { nameEdited = false; });
    nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } });
    label.querySelector('.tgear').addEventListener('click', e => openTierMenu(T(), label, e.currentTarget));
    const info = label.querySelector('.tinfo');
    info.addEventListener('mouseenter', e => showTipFor(T().props, e));
    info.addEventListener('mousemove', e => { if (tip.style.display === 'block') moveTip(e); });
    info.addEventListener('mouseleave', hideTip);
    info.addEventListener('click', () => openTierProps(id));
    label.querySelector('.tfold').addEventListener('click', () => { const t = T(); t.collapsed = !t.collapsed; render(); saveSoon(); });
    const handle = label.querySelector('.thandle');
    handle.addEventListener('dragstart', e => {
        dragTierId = id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        e.dataTransfer.setDragImage(row, 20, 20);     // yang tampak ikut terseret: satu baris penuh
        setTimeout(() => row.classList.add('moving'));
    });
    handle.addEventListener('dragend', () => { dragTierId = null; tmarker.remove(); render(); });
    wireZone(row.lastElementChild, id);
    return row;
}

// Garis putih kecil yang menunjukkan di mana gambar akan jatuh
const marker = document.createElement('div');
marker.className = 'marker';

function placeMarker(zoneEl, x, y) {
    const items = [...zoneEl.querySelectorAll('.item:not(.dragging)')];
    // gambar pertama yang posisinya "setelah" kursor: di baris di bawah kursor, atau di baris yang sama tapi di kanan
    const before = items.find(el => {
        const r = el.getBoundingClientRect();
        return y < r.top || (y <= r.bottom && x < r.left + r.width / 2);
    });
    zoneEl.insertBefore(marker, before || null);
}
function markerIndex(zoneEl) {
    let n = 0;
    for (const el of zoneEl.children) {
        if (el === marker) break;
        if (el.classList.contains('item') && !el.classList.contains('dragging')) n++;
    }
    return n;
}

function wireZone(zoneEl, zoneId) {
    zoneEl.addEventListener('dragover', e => {
        if (dragTierId) return;        // yang diseret baris tier, bukan gambar
        e.preventDefault();
        zoneEl.classList.add('over');
        placeMarker(zoneEl, e.clientX, e.clientY);
    });
    zoneEl.addEventListener('dragleave', e => {
        if (!zoneEl.contains(e.relatedTarget)) { zoneEl.classList.remove('over'); marker.remove(); }
    });
    zoneEl.addEventListener('drop', async e => {
        if (dragTierId) return;        // biarkan naik ke penanganan urutan tier
        e.preventDefault();
        e.stopPropagation();
        zoneEl.classList.remove('over');
        const index = markerIndex(zoneEl);
        marker.remove();
        pushUndo();
        if (dragId) {
            removeEverywhere(dragId);
            listOf(zoneId).splice(index, 0, dragId);          // geser gambar ke posisi yang ditunjuk
        } else {
            statusEl.textContent = 'Menyimpan…';
            await addFiles(e.dataTransfer.files, zoneId, index);  // file baru dari komputer
        }
        dragId = null;
        afterChange();
    });
}

// Garis putih horizontal yang menunjukkan di mana baris tier akan jatuh
const tmarker = document.createElement('div');
tmarker.className = 'tmarker';
const tiersBox = document.getElementById('tiers');

tiersBox.addEventListener('dragover', e => {
    if (!dragTierId) return;
    e.preventDefault();
    const rows = [...tiersBox.querySelectorAll(':scope > .tier:not(.moving)')];
    const before = rows.find(r => {
        const b = r.getBoundingClientRect();
        return e.clientY < b.top + b.height / 2;     // kursor di atas tengah baris ini -> sisipkan sebelum baris ini
    });
    tiersBox.insertBefore(tmarker, before || null);
});
tiersBox.addEventListener('drop', e => {
    if (!dragTierId) return;
    e.preventDefault();
    let index = 0;
    for (const el of tiersBox.children) {
        if (el === tmarker) break;
        if (el.classList.contains('tier') && !el.classList.contains('moving')) index++;
    }
    tmarker.remove();
    pushUndo();
    const from = state.tiers.findIndex(t => t.id === dragTierId);
    const [moved] = state.tiers.splice(from, 1);
    state.tiers.splice(index, 0, moved);
    dragTierId = null;
    afterChange();
});

function render() {
    const tiersEl = document.getElementById('tiers');
    tmarker.remove();
    document.querySelectorAll('.zone.over').forEach(z => z.classList.remove('over'));
    const live = new Set(state.tiers.map(t => t.id));
    rowEls.forEach((row, id) => { if (!live.has(id)) { row.remove(); rowEls.delete(id); } });
    state.tiers.forEach((tier, i) => {
        let row = rowEls.get(tier.id);
        if (!row) { row = makeRow(tier.id); rowEls.set(tier.id, row); }
        const label = row.firstElementChild, nameEl = label.querySelector('.name');
        label.style.background = tier.color;
        if (nameEl.textContent !== tier.name && document.activeElement !== nameEl) nameEl.textContent = tier.name;
        row.classList.remove('moving');
        row.classList.toggle('collapsed', !!tier.collapsed);
        label.querySelector('.count').textContent = `${tier.items.length} gambar`;
        label.classList.toggle('has-info', !!(tier.props && tier.props.length));
        label.querySelector('.tfold').textContent = tier.collapsed ? '▸' : '▾';
        syncItems(row.lastElementChild, tier.collapsed ? [] : tier.items);   // tier terlipat tidak menampilkan gambar
        if (tiersEl.children[i] !== row) tiersEl.insertBefore(row, tiersEl.children[i] || null);
    });
    syncItems(document.getElementById('pool'), state.pool);
    itemEls.forEach((el, id) => { if (!(id in state.images)) { el.remove(); itemEls.delete(id); } });   // gambar yang sudah dibuang
    applySearch();
}

// ---------- Mulai ----------
// ---------- Banyak tierlist ----------
function defaultTiers() {
    return [['S', '#e5534b'], ['A', '#e8943a'], ['B', '#e5c94b'], ['C', '#6fbf5f'], ['D', '#4f9de0']]
        .map(([name, color], i) => ({ id: 't' + (i + 1), name, color, items: [] }));
}
async function createList(name) {
    const id = 'l' + crypto.randomUUID().slice(0, 8);
    await run('lists', 'readwrite', s => s.put({ id, name, tiers: defaultTiers(), pool: [], fit: 'cover', props: {}, desc: '', exportedAt: 0, updatedAt: 0 }));
    lists.push({ id, name });
    return id;
}
function renderListSelect() {
    const sel = document.getElementById('listSelect');
    sel.innerHTML = '';
    lists.forEach(l => {
        const o = document.createElement('option');
        o.value = l.id;
        o.textContent = l.name;
        o.selected = l.id === currentId;
        sel.appendChild(o);
    });
}
async function loadList(id) {     // baca satu tierlist dari database ke layar
    const rec = await run('lists', 'readonly', s => s.get(id));
    const imgs = await run('images', 'readonly', s => s.index('listId').getAll(id));
    Object.values(state.images).forEach(i => URL.revokeObjectURL(i.url));
    Object.values(trash).forEach(i => URL.revokeObjectURL(i.url));
    Object.keys(trash).forEach(k => delete trash[k]);
    undoStack.length = 0; redoStack.length = 0;           // riwayat undo tidak dibawa antar tierlist
    state.images = {};
    for (const i of imgs) state.images[i.id] = { url: URL.createObjectURL(i.blob), blob: i.blob };
    state.tiers = rec.tiers;
    state.pool = rec.pool;
    state.props = rec.props || {};
    state.desc = rec.desc || '';
    state.exportedAt = rec.exportedAt || 0;
    state.updatedAt = rec.updatedAt || 0;
    dirty = false;
    document.getElementById('listDesc').value = state.desc;
    document.getElementById('search').value = '';      // pencarian dikosongkan saat pindah tierlist
    searchQ = '';
    fitDesc();
    state.fit = rec.fit === 'contain' ? 'contain' : 'cover';
    const known = x => x in state.images;
    state.pool = state.pool.filter(known);
    state.tiers.forEach(t => { t.items = t.items.filter(known); });
    const used = new Set(idsIn(state));
    Object.keys(state.images).forEach(x => { if (!used.has(x)) state.pool.push(x); });
    currentId = id;
    await run('meta', 'readwrite', s => s.put(id, 'current'));
    renderListSelect();
    updateUndoButtons();
    applyFit();
    render();
    renderBackupInfo();
}
async function switchList(id) {
    if (!db || id === currentId) return;
    await saveNow();
    statusEl.textContent = 'Memuat…';
    await loadList(id);
    statusEl.textContent = 'Tersimpan';
    showUsage();
}
async function newList(name) {
    await saveNow();
    await loadList(await createList(name));
}
async function deleteCurrentList() {
    clearTimeout(saveTimer);
    const gone = currentId;
    const keys = await run('images', 'readonly', s => s.index('listId').getAllKeys(gone));
    await new Promise((resolve, reject) => {
        const t = db.transaction(['images', 'lists'], 'readwrite');
        keys.forEach(k => t.objectStore('images').delete(k));
        t.objectStore('lists').delete(gone);
        t.oncomplete = resolve;
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
    });
    lists = lists.filter(l => l.id !== gone);
    await loadList(lists[0].id);
}
function fitDesc() {              // kolom deskripsi menyesuaikan tinggi isinya
    const ta = document.getElementById('listDesc');
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight + 2, 220) + 'px';
}
document.getElementById('listDesc').addEventListener('input', e => { state.desc = e.target.value.slice(0, 2000); fitDesc(); saveSoon(); });
document.getElementById('listSelect').addEventListener('change', e => switchList(e.target.value));
document.getElementById('btnNewList').addEventListener('click', async () => {
    if (!db) return dbNotReady();
    const name = await askText('Tierlist baru', 'Beri nama untuk tierlist ini.', 'Tierlist ' + (lists.length + 1));
    if (name) await newList(name.slice(0, 60));
});
document.getElementById('btnRenameList').addEventListener('click', async () => {
    const cur = lists.find(l => l.id === currentId);
    if (!db) return dbNotReady();
    const name = await askText('Ganti nama tierlist', '', cur.name);
    if (!name) return;
    cur.name = name.slice(0, 60);
    renderListSelect();
    saveNow();
});
document.getElementById('btnDeleteList').addEventListener('click', async () => {
    if (!db) return dbNotReady();
    if (lists.length < 2) { tell('Tidak bisa dihapus', 'Minimal harus ada satu tierlist.'); return; }
    if (await askConfirm('Hapus tierlist?', `"${curName()}" beserta SEMUA gambarnya akan dihapus permanen dan tidak bisa di-undo. Sebaiknya Export dulu.`, 'Hapus', true)) await deleteCurrentList();
});

// ---------- Mulai ----------
async function init() {
    try {
        db = await Promise.race([openDB(), new Promise((_, no) => setTimeout(() => no(new Error('database tidak merespons dalam 8 detik (apakah tab lama masih terbuka?)')), 8000))]);
        lists = (await run('lists', 'readonly', s => s.getAll())).map(l => ({ id: l.id, name: l.name }));
        if (!lists.length) await createList('Tierlist 1');
        const saved = await run('meta', 'readonly', s => s.get('current'));
        await loadList(lists.some(l => l.id === saved) ? saved : lists[0].id);
        // minta browser supaya data tidak dihapus otomatis saat ruang penyimpanan sempit
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
        statusEl.textContent = 'Tersimpan otomatis';
    } catch (err) {
        console.error(err);
        db = null;
        lists = [{ id: 'tmp', name: 'Tidak tersimpan' }];
        currentId = 'tmp';
        renderListSelect();
        initProblem = (err && err.message) || String(err);
        statusEl.textContent = 'Penyimpanan tidak tersedia: ' + initProblem;
    }
    wireZone(document.getElementById('pool'), 'pool');
    applyFit();
    render();
    showUsage();
}

window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());

renderListSelect();
render();
init();