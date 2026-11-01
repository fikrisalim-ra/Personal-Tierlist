// Versi file ini (untuk memastikan browser memuat file terbaru, bukan cache)
const APP_VERSION = '3f-2';
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
state.fit = 'cover';   // 'cover' = isi penuh (dipotong), 'contain' = utuh (ada ruang kosong)
let dragId = null;       // id gambar yang sedang diseret
let dragTierId = null;   // id tier yang sedang diseret (lewat pegangan ⠿)

// ---------- Penyimpanan (IndexedDB) ----------
// Dua "laci": 'images' = file gambar (blob), 'meta' = susunan tier & urutan gambar.
let db = null;
let initProblem = '';     // alasan database gagal dibuka (kalau gagal)
function dbNotReady() {
    alert('Penyimpanan belum siap' + (initProblem ? ': ' + initProblem : ' (masih memuat). Coba lagi sebentar.'));
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

function saveSoon() {                 // tunggu 0,3 detik supaya tidak menyimpan tiap ketikan
    if (!db) return;
    statusEl.textContent = 'Menyimpan…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
}
async function saveNow() {
    clearTimeout(saveTimer);
    if (!db || !currentId) return;
    try {
        await run('lists', 'readwrite', s => s.put({ id: currentId, name: curName(), tiers: state.tiers, pool: state.pool, fit: state.fit }));
        statusEl.textContent = 'Tersimpan';
        showUsage();
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
            tiers: state.tiers, pool: state.pool, fit: state.fit, images,
        };
        const file = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file);
        a.download = `tierlist-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);   // beri waktu browser menyelesaikan unduhan
        statusEl.textContent = 'Export selesai';
    } catch (err) {
        console.error(err);
        statusEl.textContent = 'Export gagal';
        alert('Export gagal: ' + err.message);
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
        }));
        const pool = take(data.pool);
        blobs.forEach((_, id) => { if (!seen.has(id)) pool.push(id); });
        const fit = data.fit === 'contain' ? 'contain' : 'cover';

        // id gambar dibuat BARU supaya tidak menabrak gambar di tierlist lain
        const idMap = new Map([...blobs.keys()].map(k => [k, crypto.randomUUID()]));
        const remap = ids => ids.map(x => idMap.get(x));
        tiers.forEach(t => { t.items = remap(t.items); });
        const newPool = remap(pool);
        const name = String(data.name || file.name.replace(/\.json$/i, '') || 'Import').slice(0, 60);
        const id = 'l' + crypto.randomUUID().slice(0, 8);

        await saveNow();
        // Tulis dalam SATU transaksi: berhasil semua, atau batal semua
        await new Promise((resolve, reject) => {
            const t = db.transaction(['images', 'lists'], 'readwrite');
            const imgStore = t.objectStore('images');
            blobs.forEach((blob, oldId) => imgStore.put({ id: idMap.get(oldId), blob, listId: id }));
            t.objectStore('lists').put({ id, name, tiers, pool: newPool, fit });
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
        alert('Import gagal: ' + err.message);
    }
}

document.getElementById('btnFit').addEventListener('click', () => {
    state.fit = state.fit === 'cover' ? 'contain' : 'cover';
    applyFit();
    saveSoon();
});
document.getElementById('btnAddTier').addEventListener('click', addTier);
document.getElementById('btnUndo').addEventListener('click', undo);
document.getElementById('btnRedo').addEventListener('click', redo);
document.getElementById('btnFoldAll').addEventListener('click', () => setAllFolded(true));
document.getElementById('btnUnfoldAll').addEventListener('click', () => setAllFolded(false));
document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (document.activeElement && document.activeElement.isContentEditable) return;   // saat mengetik nama, pakai undo teks bawaan browser
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
const takeSnapshot = () => ({ tiers: structuredClone(state.tiers), pool: [...state.pool] });

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

const PALETTE = ['#e5534b', '#e8943a', '#e5c94b', '#6fbf5f', '#4f9de0', '#a07be0', '#e07bb4', '#7fc4c4'];
function addTier() {
    pushUndo();
    state.tiers.push({
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
function makeItem(id) {
    const el = document.createElement('div');
    el.className = 'item';
    el.draggable = true;
    el.innerHTML = `<img src="${state.images[id].url}" alt=""><button class="del" title="Hapus">×</button>`;
    el.addEventListener('dragstart', e => {
        dragId = id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        setTimeout(() => el.classList.add('dragging'));
    });
    el.addEventListener('dragend', () => { dragId = null; render(); });
    el.querySelector('.del').addEventListener('click', () => deleteImage(id));
    return el;
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
    tiersEl.innerHTML = '';
    for (const tier of state.tiers) {
        const row = document.createElement('div');
        row.className = 'tier';
        row.innerHTML = `
      <div class="label" style="background:${tier.color}">
        <div class="name" contenteditable="true" spellcheck="false"></div>
        <span class="count"></span>
        <input type="color" value="${tier.color}" title="Ganti warna">
        <button class="tdel" title="Hapus tier (gambarnya kembali ke area gambar)">×</button>
        <button class="tfold" title="Lipat / buka tier">▾</button>
        <div class="thandle" draggable="true" title="Seret untuk memindahkan tier">⠿</div>
      </div>
      <div class="zone"></div>`;
        const nameEl = row.querySelector('.name');
        nameEl.textContent = tier.name;
        let nameEdited = false;       // satu sesi mengetik = satu langkah undo
        nameEl.addEventListener('input', () => {
            if (!nameEdited) { pushUndo(); nameEdited = true; }
            tier.name = nameEl.textContent;
            saveSoon();
        });
        nameEl.addEventListener('blur', () => { nameEdited = false; });
        nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } });
        row.querySelector('.tdel').addEventListener('click', () => deleteTier(tier.id));
        const handle = row.querySelector('.thandle');
        handle.addEventListener('dragstart', e => {
            dragTierId = tier.id;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', tier.id);
            e.dataTransfer.setDragImage(row, 20, 20);     // yang tampak ikut terseret: satu baris penuh
            setTimeout(() => row.classList.add('moving'));
        });
        handle.addEventListener('dragend', () => { dragTierId = null; tmarker.remove(); render(); });
        let colorEdited = false;
        const colorEl = row.querySelector('input');
        colorEl.addEventListener('change', () => { colorEdited = false; });
        colorEl.addEventListener('input', e => {
            if (!colorEdited) { pushUndo(); colorEdited = true; }
            tier.color = e.target.value;
            row.querySelector('.label').style.background = tier.color;
            saveSoon();
        });
        row.classList.toggle('collapsed', !!tier.collapsed);
        row.querySelector('.count').textContent = `${tier.items.length} gambar`;
        const fold = row.querySelector('.tfold');
        fold.textContent = tier.collapsed ? '▸' : '▾';
        fold.addEventListener('click', () => { tier.collapsed = !tier.collapsed; render(); saveSoon(); });
        const zone = row.querySelector('.zone');
        if (!tier.collapsed) tier.items.forEach(id => zone.appendChild(makeItem(id)));   // tier terlipat tidak perlu digambar
        wireZone(zone, tier.id);
        tiersEl.appendChild(row);
    }
    const poolEl = document.getElementById('pool');
    poolEl.innerHTML = '';
    state.pool.forEach(id => poolEl.appendChild(makeItem(id)));
}

// ---------- Mulai ----------
// ---------- Banyak tierlist ----------
function defaultTiers() {
    return [['S', '#e5534b'], ['A', '#e8943a'], ['B', '#e5c94b'], ['C', '#6fbf5f'], ['D', '#4f9de0']]
        .map(([name, color], i) => ({ id: 't' + (i + 1), name, color, items: [] }));
}
async function createList(name) {
    const id = 'l' + crypto.randomUUID().slice(0, 8);
    await run('lists', 'readwrite', s => s.put({ id, name, tiers: defaultTiers(), pool: [], fit: 'cover' }));
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
document.getElementById('listSelect').addEventListener('change', e => switchList(e.target.value));
document.getElementById('btnNewList').addEventListener('click', async () => {
    if (!db) return dbNotReady();
    const name = prompt('Nama tierlist baru:', 'Tierlist ' + (lists.length + 1));
    if (name && name.trim()) await newList(name.trim().slice(0, 60));
});
document.getElementById('btnRenameList').addEventListener('click', () => {
    const cur = lists.find(l => l.id === currentId);
    if (!db) return dbNotReady();
    const name = prompt('Nama tierlist:', cur.name);
    if (!name || !name.trim()) return;
    cur.name = name.trim().slice(0, 60);
    renderListSelect();
    saveNow();
});
document.getElementById('btnDeleteList').addEventListener('click', async () => {
    if (!db) return dbNotReady();
    if (lists.length < 2) { alert('Minimal harus ada satu tierlist.'); return; }
    if (confirm(`Hapus tierlist "${curName()}" beserta SEMUA gambarnya? Ini tidak bisa di-undo. Sebaiknya Export dulu.`)) await deleteCurrentList();
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