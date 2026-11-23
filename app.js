// ---------- Helper Animasi Tutup Modal ----------
function closeModalAnim(back, after) {
    if (!back || back.classList.contains('closing')) return;
    back.classList.add('closing');
    setTimeout(() => {
        back.remove();
        if (after) after();
    }, 160);
}

// ---------- Pop-up buatan sendiri (Gaya 2-layer dark blue seperti referensi screenshot) ----------
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

        let field = null;
        if (message || input !== null) {
            const inner = document.createElement('div');
            inner.className = 'm-inner';
            if (message) {
                const p = document.createElement('p');
                p.textContent = message;
                if (input === null) p.style.marginBottom = '0';
                inner.appendChild(p);
            }
            if (input !== null) {
                field = document.createElement('input');
                field.type = 'text';
                field.value = input;
                field.maxLength = 60;
                inner.appendChild(field);
            }
            box.appendChild(inner);
        }

        const btns = document.createElement('div');
        btns.className = 'mbtns';
        if (cancel) {
            const c = document.createElement('button');
            c.type = 'button';
            c.textContent = cancel;
            c.addEventListener('click', () => close(null));
            btns.appendChild(c);
        }
        const okB = document.createElement('button');
        okB.type = 'button';
        okB.textContent = ok;
        okB.className = danger ? 'danger' : 'primary';
        okB.addEventListener('click', () => close(field ? (field.value.trim() || null) : true));
        btns.appendChild(okB);
        box.appendChild(btns);
        back.appendChild(box);
        back.addEventListener('mousedown', e => { if (e.target === back) close(null); });
        document.body.appendChild(back);

        const before = document.activeElement;
        let closed = false;
        function onKey(e) {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); }
            else if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { e.preventDefault(); e.stopPropagation(); okB.click(); }
        }
        document.addEventListener('keydown', onKey, true);
        function close(value) {
            if (closed) return;
            closed = true;
            document.removeEventListener('keydown', onKey, true);
            closeModalAnim(back, () => {
                if (before && before.focus) before.focus();
                resolve(value);
            });
        }
        if (field) { field.focus(); field.select(); } else okB.focus();
    });
}
const tell = (title, message) => modal({ title, message, cancel: null });
const askConfirm = (title, message, ok = 'Ya', danger = false) => modal({ title, message, ok, danger }).then(v => v === true);
const askText = (title, message, value) => modal({ title, message, input: value, ok: 'Simpan' });
const fileSafe = n => (n || '').replace(/[\\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'tierlist';

const APP_VERSION = '8.0';
console.log('Tierlist app.js versi', APP_VERSION);
function showFatal(msg) {
    const el = document.getElementById('status');
    if (el) { el.textContent = 'Error: ' + msg; el.style.color = '#ff5c6c'; }
}
window.addEventListener('error', e => showFatal(`${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
window.addEventListener('unhandledrejection', e => showFatal(String((e.reason && e.reason.message) || e.reason)));

// ---------- Data & Mode Lihat Saja (View-Only) ----------
let viewOnly = false;
let viewOnlyName = '';

const state = {
    tiers: [
        { id: 't1', name: 'S', color: '#e5534b', items: [], desc: '' },
        { id: 't2', name: 'A', color: '#e8943a', items: [], desc: '' },
        { id: 't3', name: 'B', color: '#e5c94b', items: [], desc: '' },
        { id: 't4', name: 'C', color: '#6fbf5f', items: [], desc: '' },
        { id: 't5', name: 'D', color: '#4f9de0', items: [], desc: '' },
    ],
    pool: [],
    images: {},
};
state.exportedAt = 0;
state.updatedAt = 0;
state.desc = '';
state.props = {};          // id utama -> [{ t, v }]
state.crops = {};          // id gambar (utama atau slide) -> { x: 0..100, y: 0..100, z: 1..3 }
state.slides = {};         // id utama -> [idSlide2, idSlide3, ...] (tetap dihitung 1 item & 1 properti)
state.slideSpeed = 3700;   // durasi per slide (ms)
state.fit = 'cover';       // 'cover' | 'contain'
state.ratio = '1:1';       // '1:1' | '3:4' | '16:9'
state.size = 88;           // 68 | 88 | 112 | 140
state.showLabels = false;
let dragId = null;
let dragTierId = null;
let lastDroppedId = null;

// Status frame aktif untuk tiap item yang punya slideshow
const slideCursors = new Map(); // primaryId -> index frame saat ini

// ---------- Auto-Scroll Saat Drag Gambar atau Tier (Untuk 100+ Baris Tier) ----------
let dragActive = false;
let dragClientY = 0;
let lastDragOverTs = 0;
let autoScrollRaf = null;

function startAutoScroll() {
    if (autoScrollRaf) return;
    function tick() {
        if (!dragActive || Date.now() - lastDragOverTs > 260) {
            autoScrollRaf = null;
            return;
        }
        const headerEl = document.getElementById('appHeader');
        const dockEl = document.getElementById('dock');
        const dockBodyEl = document.getElementById('dockBody');
        const headerBottom = headerEl ? headerEl.getBoundingClientRect().bottom : 54;
        const dockTop = (dockEl && !dockEl.classList.contains('closed'))
            ? dockEl.getBoundingClientRect().top
            : innerHeight;

        const EDGE = 95;
        const MAX_SPEED = 22;

        if (dockEl && !dockEl.classList.contains('closed') && dragClientY >= dockTop) {
            const r = dockBodyEl.getBoundingClientRect();
            if (dragClientY < r.top + 48) dockBodyEl.scrollTop -= 8;
            else if (dragClientY > r.bottom - 48) dockBodyEl.scrollTop += 8;
        } else {
            const topTrigger = headerBottom + EDGE;
            const bottomTrigger = dockTop - EDGE;
            if (dragClientY < topTrigger) {
                const ratio = Math.min(1, Math.max(0.1, (topTrigger - dragClientY) / EDGE));
                window.scrollBy(0, -Math.round(MAX_SPEED * ratio * ratio));
            } else if (dragClientY > bottomTrigger) {
                const ratio = Math.min(1, Math.max(0.1, (dragClientY - bottomTrigger) / EDGE));
                window.scrollBy(0, Math.round(MAX_SPEED * ratio * ratio));
            }
        }
        autoScrollRaf = requestAnimationFrame(tick);
    }
    autoScrollRaf = requestAnimationFrame(tick);
}

function stopAutoScroll() {
    dragActive = false;
    if (autoScrollRaf) {
        cancelAnimationFrame(autoScrollRaf);
        autoScrollRaf = null;
    }
}

window.addEventListener('dragover', e => {
    e.preventDefault();
    if (viewOnly) return;
    dragClientY = e.clientY;
    lastDragOverTs = Date.now();
    if (!dragActive) {
        dragActive = true;
        startAutoScroll();
    }
});
window.addEventListener('dragend', stopAutoScroll);
window.addEventListener('drop', e => {
    e.preventDefault();
    stopAutoScroll();
});

// ---------- Penyimpanan (IndexedDB) ----------
let db = null;
let initProblem = '';
function dbNotReady() {
    tell('Penyimpanan belum siap', initProblem ? initProblem : 'Halaman masih memuat. Coba lagi sebentar.');
}
let lists = [];
let currentId = null;
const curName = () => viewOnly ? (viewOnlyName || 'Tierlist') : ((lists.find(l => l.id === currentId) || {}).name || '');

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('tierlist-db', 2);
        req.onupgradeneeded = e => {
            const tx = req.transaction, d = req.result;
            const imgs = e.oldVersion < 1 ? d.createObjectStore('images', { keyPath: 'id' }) : tx.objectStore('images');
            if (e.oldVersion < 1) d.createObjectStore('meta');
            imgs.createIndex('listId', 'listId');
            d.createObjectStore('lists', { keyPath: 'id' });
            if (e.oldVersion >= 1) {
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

async function showUsage() {
    if (viewOnly) { usageEl.textContent = ''; return; }
    try {
        if (!navigator.storage || !navigator.storage.estimate) return;
        const { usage } = await navigator.storage.estimate();
        usageEl.textContent = `· ±${(usage / 1048576).toFixed(1)} MB terpakai`;
    } catch (err) { /* tidak penting */ }
}

// ---------- Pengaturan Tampilan Gambar (Ukuran, Rasio, Fit, Label, Kecepatan Slideshow) ----------
function getTileDimensions(baseSize = state.size, ratio = state.ratio) {
    const s = Number(baseSize) || 88;
    if (ratio === '3:4') return { w: s, h: Math.round(s * 4 / 3) };
    if (ratio === '16:9') return { w: Math.round(s * 16 / 9), h: s };
    return { w: s, h: s };
}

function applyFit() {
    const { w, h } = getTileDimensions();
    document.documentElement.style.setProperty('--tile-w', w + 'px');
    document.documentElement.style.setProperty('--tile-h', h + 'px');
    document.documentElement.style.setProperty('--fit', state.fit);
    document.body.classList.toggle('show-item-labels', !!state.showLabels);
}

function openViewSettings() {
    hideTip();
    const back = mk('div', 'mback');
    const box = mk('div', 'modal');
    box.appendChild(mk('h3', '', 'Tampilan gambar'));
    box.appendChild(mk('p', '', 'Atur ukuran, rasio kotak, label nama, dan kecepatan slideshow.'));

    const inner = mk('div', 'm-inner');

    function makeSegGroup(label, options, currentVal, onPick) {
        const g = mk('div', 'view-opt-group');
        g.appendChild(mk('span', 'tm-label', label));
        const row = mk('div', 'seg-row');
        const btns = [];
        options.forEach(([val, text]) => {
            const b = mk('button', 'seg-btn' + (val === currentVal ? ' active' : ''), text);
            b.type = 'button';
            b.addEventListener('click', () => {
                btns.forEach(x => x.classList.remove('active'));
                b.classList.add('active');
                onPick(val);
            });
            btns.push(b);
            row.appendChild(b);
        });
        g.appendChild(row);
        inner.appendChild(g);
    }

    makeSegGroup('Ukuran gambar', [
        [68, 'Kecil'],
        [88, 'Normal'],
        [112, 'Besar'],
        [140, 'Ekstra']
    ], state.size, val => { state.size = val; applyFit(); saveSoon(); });

    makeSegGroup('Rasio kotak', [
        ['1:1', 'Kotak (1:1)'],
        ['3:4', 'Poster (3:4)'],
        ['16:9', 'Lebar (16:9)']
    ], state.ratio, val => { state.ratio = val; applyFit(); saveSoon(); });

    makeSegGroup('Cara gambar mengisi kotak', [
        ['cover', 'Potong (Penuh)'],
        ['contain', 'Utuh']
    ], state.fit, val => { state.fit = val; applyFit(); saveSoon(); });

    makeSegGroup('Label teks di bawah gambar', [
        [false, 'Sembunyikan'],
        [true, 'Tampilkan jika diisi']
    ], !!state.showLabels, val => { state.showLabels = val; applyFit(); render(); saveSoon(); });

    makeSegGroup('Kecepatan slideshow (jika 1 item berisi banyak gambar)', [
        [1800, 'Cepat (1.8d)'],
        [3700, 'Normal (3.7d)'],
        [5300, 'Santai (5.3d)']
    ], state.slideSpeed || 3700, val => { state.slideSpeed = val; restartSlideshowTimer(); saveSoon(); });

    const btns = mk('div', 'mbtns');
    const okB = mk('button', 'primary', 'Selesai');
    okB.type = 'button';
    btns.appendChild(okB);

    box.append(inner, btns);
    back.appendChild(box);
    document.body.appendChild(back);

    let closed = false;
    function close() {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey, true);
        closeModalAnim(back);
    }
    function onKey(e) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    }
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('mousedown', e => { if (e.target === back) close(); });
    okB.addEventListener('click', close);
}

// ---------- Helper Crop & Slideshow ----------
function getCrop(imgId) {
    const c = state.crops && state.crops[imgId];
    if (!c) return { x: 50, y: 50, z: 1 };
    return {
        x: Math.max(0, Math.min(100, Number(c.x ?? 50))),
        y: Math.max(0, Math.min(100, Number(c.y ?? 50))),
        z: Math.max(1, Math.min(3, Number(c.z ?? 1))),
    };
}
function isDefaultCrop(c) {
    return !c || (Math.abs((c.x ?? 50) - 50) < 0.5 && Math.abs((c.y ?? 50) - 50) < 0.5 && Math.abs((c.z ?? 1) - 1) < 0.02);
}
function applyImgCrop(imgEl, imgId) {
    if (!imgEl) return;
    const c = getCrop(imgId);
    imgEl.style.objectPosition = `${c.x.toFixed(1)}% ${c.y.toFixed(1)}%`;
    imgEl.style.transformOrigin = `${c.x.toFixed(1)}% ${c.y.toFixed(1)}%`;
    imgEl.style.transform = c.z > 1.01 ? `scale(${c.z.toFixed(2)})` : '';
}
function cleanCrops(obj) {
    if (!obj || typeof obj !== 'object') return {};
    const out = {};
    for (const [id, c] of Object.entries(obj)) {
        if (!c || typeof c !== 'object') continue;
        const norm = {
            x: Math.round(Math.max(0, Math.min(100, Number(c.x ?? 50))) * 10) / 10,
            y: Math.round(Math.max(0, Math.min(100, Number(c.y ?? 50))) * 10) / 10,
            z: Math.round(Math.max(1, Math.min(3, Number(c.z ?? 1))) * 100) / 100,
        };
        if (!isDefaultCrop(norm)) out[id] = norm;
    }
    return out;
}

// Ambil semua id frame untuk 1 item (id utama + slide tambahan yang masih valid)
function getFrames(primaryId) {
    const extras = (state.slides && Array.isArray(state.slides[primaryId])) ? state.slides[primaryId] : [];
    return [primaryId, ...extras].filter(fid => fid in state.images);
}
function activeFrameId(primaryId) {
    const frames = getFrames(primaryId);
    if (frames.length <= 1) return primaryId;
    const cur = (slideCursors.get(primaryId) || 0) % frames.length;
    return frames[cur];
}
const liveCrops = () => Object.fromEntries(Object.entries(cleanCrops(state.crops)).filter(([id]) => id in state.images));
const liveSlides = () => {
    const primarySet = new Set([...state.pool, ...state.tiers.flatMap(t => t.items)]);
    const out = {};
    for (const [pid, arr] of Object.entries(state.slides || {})) {
        if (!primarySet.has(pid) || !Array.isArray(arr)) continue;
        const valid = arr.filter(sid => sid !== pid && sid in state.images);
        if (valid.length) out[pid] = valid;
    }
    return out;
};

// Timer otomatis untuk memutar gambar slideshow di board
let slideshowInterval = null;
function stepAllSlideshows() {
    itemEls.forEach((el, id) => {
        const frames = getFrames(id);
        const badge = el.querySelector('.slide-badge');
        if (frames.length <= 1) {
            if (badge) badge.hidden = true;
            return;
        }
        const nextIdx = ((slideCursors.get(id) || 0) + 1) % frames.length;
        slideCursors.set(id, nextIdx);
        const fid = frames[nextIdx];
        const img = el.querySelector('img');
        if (img && state.images[fid]) {
            img.classList.add('slide-fade');
            setTimeout(() => {
                img.src = state.images[fid].url;
                applyImgCrop(img, fid);
                img.classList.remove('slide-fade');
            }, 90);
        }
        if (badge) {
            badge.hidden = false;
            badge.textContent = `${nextIdx + 1}/${frames.length}`;
        }
    });
}
function restartSlideshowTimer() {
    clearInterval(slideshowInterval);
    slideshowInterval = setInterval(stepAllSlideshows, Math.max(1000, Number(state.slideSpeed) || 3700));
}
restartSlideshowTimer();

let saveTimer = null;
let dirty = false;

function saveSoon() {
    if (!db || viewOnly) return;
    dirty = true;
    statusEl.textContent = 'Menyimpan…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
}
async function saveNow() {
    clearTimeout(saveTimer);
    if (!db || !currentId || viewOnly) return;
    if (dirty) { state.updatedAt = Date.now(); dirty = false; }
    try {
        await run('lists', 'readwrite', s => s.put({
            id: currentId,
            name: curName(),
            tiers: state.tiers,
            pool: state.pool,
            fit: state.fit,
            ratio: state.ratio,
            size: state.size,
            showLabels: state.showLabels,
            slideSpeed: state.slideSpeed,
            props: liveProps(),
            crops: liveCrops(),
            slides: liveSlides(),
            desc: state.desc,
            exportedAt: state.exportedAt,
            updatedAt: state.updatedAt
        }));
        statusEl.textContent = 'Tersimpan';
        showUsage();
        renderBackupInfo();
    } catch (err) {
        console.error(err);
        statusEl.textContent = 'Gagal menyimpan!';
    }
}
document.addEventListener('visibilitychange', () => { if (document.hidden && !viewOnly) saveNow(); });

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
    try {
        if (!viewOnly) {
            if (!db) { dbNotReady(); return; }
            await saveNow();
        }
        statusEl.textContent = 'Menyiapkan export…';
        const images = [];
        if (viewOnly) {
            for (const [id, rec] of Object.entries(state.images)) {
                images.push({ id, type: rec.blob.type, data: await blobToDataURL(rec.blob) });
            }
        } else {
            const rows = await run('images', 'readonly', s => s.index('listId').getAll(currentId));
            for (const r of rows) images.push({ id: r.id, type: r.blob.type, data: await blobToDataURL(r.blob) });
        }
        const payload = {
            app: 'tierlist', version: 1, name: curName(), exportedAt: new Date().toISOString(),
            tiers: state.tiers, pool: state.pool, fit: state.fit, ratio: state.ratio,
            size: state.size, showLabels: state.showLabels, slideSpeed: state.slideSpeed,
            props: liveProps(), crops: liveCrops(), slides: liveSlides(), desc: state.desc, images,
        };
        const file = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file);
        a.download = `${fileSafe(curName())}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
        if (!viewOnly) {
            state.exportedAt = Date.now();
            await saveNow();
            renderBackupInfo();
        }
        statusEl.textContent = 'Export selesai';
    } catch (err) {
        console.error(err);
        statusEl.textContent = 'Export gagal';
        tell('Export gagal', err.message);
    }
}

function normalizeTierDesc(t) {
    let d = String(t.desc || '').trim();
    if (!d && Array.isArray(t.props) && t.props.length) {
        d = t.props.map(p => (p && p.t ? p.t + ': ' : '') + ((p && p.v) || '')).filter(Boolean).join('\n');
    }
    return d.slice(0, 2000);
}

async function parseAndCleanTierlistJSON(data) {
    if (!data || data.app !== 'tierlist' || data.version !== 1 || !Array.isArray(data.tiers)
        || !Array.isArray(data.pool) || !Array.isArray(data.images)) {
        throw new Error('Format file tidak dikenali.');
    }
    const blobs = new Map();
    for (const im of data.images) {
        if (typeof im.id !== 'string' || typeof im.data !== 'string' || !im.data.startsWith('data:image/')) continue;
        blobs.set(im.id, await (await fetch(im.data)).blob());
    }
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
        desc: normalizeTierDesc(t),
    }));
    const pool = take(data.pool);

    // Proses slides supaya gambar slide tambahan tidak nyasar masuk ke pool utama
    const slides = {};
    if (data.slides && typeof data.slides === 'object') {
        for (const [pid, arr] of Object.entries(data.slides)) {
            if (!seen.has(pid) || !Array.isArray(arr)) continue;
            const sids = take(arr);
            if (sids.length) slides[pid] = sids;
        }
    }

    blobs.forEach((_, id) => { if (!seen.has(id)) pool.push(id); });
    const fit = data.fit === 'contain' ? 'contain' : 'cover';
    const ratio = ['1:1', '3:4', '16:9'].includes(data.ratio) ? data.ratio : '1:1';
    const size = [68, 88, 112, 140].includes(Number(data.size)) ? Number(data.size) : 88;
    const showLabels = !!data.showLabels;
    const slideSpeed = [1800, 3700, 5300].includes(Number(data.slideSpeed)) ? Number(data.slideSpeed) : 3700;
    const props = {};
    Object.entries(data.props || {}).forEach(([oldId, list]) => {
        if (blobs.has(oldId)) {
            const c = cleanProps(list);
            if (c.length) props[oldId] = c;
        }
    });
    const crops = {};
    Object.entries(cleanCrops(data.crops)).forEach(([oldId, c]) => {
        if (blobs.has(oldId)) crops[oldId] = c;
    });

    return {
        name: String(data.name || 'Tierlist').slice(0, 60),
        desc: String(data.desc || '').slice(0, 2000),
        tiers,
        pool,
        fit,
        ratio,
        size,
        showLabels,
        slideSpeed,
        props,
        crops,
        slides,
        blobs
    };
}

async function importJSON(file) {
    if (!db) { dbNotReady(); return; }
    try {
        const rawData = JSON.parse(await file.text());
        statusEl.textContent = 'Membaca file…';
        const parsed = await parseAndCleanTierlistJSON(rawData);
        const idMap = new Map([...parsed.blobs.keys()].map(k => [k, crypto.randomUUID()]));
        const remap = ids => ids.map(x => idMap.get(x));
        parsed.tiers.forEach(t => { t.items = remap(t.items); });
        const newPool = remap(parsed.pool);
        const ts = Date.now();
        const newProps = {};
        Object.entries(parsed.props).forEach(([oldId, list]) => {
            if (idMap.has(oldId)) newProps[idMap.get(oldId)] = list;
        });
        const newCrops = {};
        Object.entries(parsed.crops).forEach(([oldId, c]) => {
            if (idMap.has(oldId)) newCrops[idMap.get(oldId)] = c;
        });
        const newSlides = {};
        Object.entries(parsed.slides).forEach(([oldPid, arr]) => {
            if (idMap.has(oldPid)) newSlides[idMap.get(oldPid)] = remap(arr).filter(Boolean);
        });

        const name = String(rawData.name || file.name.replace(/\.json$/i, '') || 'Import').slice(0, 60);
        const id = 'l' + crypto.randomUUID().slice(0, 8);

        await saveNow();
        await new Promise((resolve, reject) => {
            const t = db.transaction(['images', 'lists'], 'readwrite');
            const imgStore = t.objectStore('images');
            parsed.blobs.forEach((blob, oldId) => imgStore.put({ id: idMap.get(oldId), blob, listId: id }));
            t.objectStore('lists').put({
                id, name, tiers: parsed.tiers, pool: newPool, fit: parsed.fit,
                ratio: parsed.ratio, size: parsed.size, showLabels: parsed.showLabels,
                slideSpeed: parsed.slideSpeed, props: newProps, crops: newCrops, slides: newSlides,
                desc: parsed.desc, exportedAt: ts, updatedAt: ts
            });
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

document.getElementById('btnFit').addEventListener('click', openViewSettings);
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
document.getElementById('backupInfo').addEventListener('click', confirmAndExport);

// ---------- Inventaris Gambar (#dock) ----------
const dock = document.getElementById('dock');
const grip = document.getElementById('dockGrip');
let dockH = 220;
try { dockH = parseInt(localStorage.getItem('tierlist-dock-h'), 10) || 220; } catch (e) { /* tidak masalah */ }

function updateBodyBottomPad() {
    const closed = dock.classList.contains('closed');
    document.body.style.paddingBottom = (closed ? 72 : (dockH + 72)) + 'px';
}

function setDock(open) {
    dock.classList.toggle('closed', !open);
    updateBodyBottomPad();
    try { localStorage.setItem('tierlist-dock', open ? 'open' : 'closed'); } catch (e) { /* tidak masalah */ }
}
document.getElementById('dockToggle').addEventListener('click', () => setDock(dock.classList.contains('closed')));
document.getElementById('dockToggle').addEventListener('dragenter', () => {
    if (!viewOnly && !dragTierId && dock.classList.contains('closed')) setDock(true);
});

const dockChrome = () => grip.offsetHeight + dock.querySelector('.dock-bar').offsetHeight;
const maxDockH = () => {
    const hdr = document.getElementById('appHeader');
    const bottom = hdr ? hdr.getBoundingClientRect().bottom : 56;
    return Math.max(120, innerHeight - bottom - dockChrome() - 12);
};
function applyDockH(h) {
    dockH = Math.min(Math.max(h, 90), maxDockH());
    dock.style.setProperty('--dock-h', dockH + 'px');
    updateBodyBottomPad();
}
let dockStart = true;
try { dockStart = localStorage.getItem('tierlist-dock') !== 'closed'; } catch (e) { /* tidak masalah */ }
applyDockH(dockH);
setDock(dockStart);
window.addEventListener('resize', () => applyDockH(dockH));

grip.addEventListener('pointerdown', e => {
    e.preventDefault();
    dock.classList.add('resizing');
    document.body.classList.add('resizing-dock');
    const chrome = dockChrome();
    const move = ev => {
        const h = innerHeight - ev.clientY - chrome;
        if (h < 50) { if (!dock.classList.contains('closed')) setDock(false); }
        else { if (dock.classList.contains('closed')) setDock(true); applyDockH(h); }
    };
    const up = () => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.removeEventListener('pointercancel', up);
        dock.classList.remove('resizing');
        document.body.classList.remove('resizing-dock');
        updateBodyBottomPad();
        try { localStorage.setItem('tierlist-dock-h', String(dockH)); } catch (err) { /* tidak masalah */ }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
});

document.getElementById('btnAddTier').addEventListener('click', () => addTier());
document.getElementById('btnAddTierTop').addEventListener('click', () => addTier());
document.getElementById('btnUndo').addEventListener('click', undo);
document.getElementById('btnRedo').addEventListener('click', redo);
document.getElementById('btnFoldAll').addEventListener('click', () => setAllFolded(true));
document.getElementById('btnUnfoldAll').addEventListener('click', () => setAllFolded(false));
document.addEventListener('keydown', e => {
    if (viewOnly) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    if (document.querySelector('.mback')) return;
    const ae = document.activeElement;
    if (ae && (ae.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
});
document.getElementById('btnExport').addEventListener('click', confirmAndExport);
document.getElementById('btnImport').addEventListener('click', () => document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change', e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) importJSON(f);
});

// ---------- Undo / Redo (Mencakup Slideshow & Crop) ----------
const MAX_UNDO = 50;
const undoStack = [], redoStack = [];
const trash = {};

const idsIn = snap => [
    ...snap.pool,
    ...snap.tiers.flatMap(t => t.items),
    ...Object.values(snap.slides || {}).flat()
];
const takeSnapshot = () => ({
    tiers: structuredClone(state.tiers),
    pool: [...state.pool],
    props: structuredClone(state.props),
    crops: structuredClone(state.crops),
    slides: structuredClone(state.slides),
});

function pushUndo() {
    if (viewOnly) return;
    undoStack.push(takeSnapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
    updateUndoButtons();
}
function updateUndoButtons() {
    document.getElementById('btnUndo').disabled = viewOnly || undoStack.length === 0;
    document.getElementById('btnRedo').disabled = viewOnly || redoStack.length === 0;
}
function sweepUnreferenced() {
    if (viewOnly) return;
    const used = new Set(idsIn(state));
    for (const id of Object.keys(state.images)) {
        if (used.has(id)) continue;
        trash[id] = state.images[id];
        delete state.images[id];
        if (db) run('images', 'readwrite', s => s.delete(id)).catch(console.error);
    }
}
function pruneTrash() {
    const keep = new Set();
    [...undoStack, ...redoStack].forEach(sn => idsIn(sn).forEach(id => keep.add(id)));
    for (const id of Object.keys(trash)) {
        if (keep.has(id)) continue;
        URL.revokeObjectURL(trash[id].url);
        delete trash[id];
    }
}
function afterChange() {
    sweepUnreferenced();
    pruneTrash();
    render();
    saveSoon();
    updateUndoButtons();
}
function restore(snap) {
    const folded = new Map(state.tiers.map(t => [t.id, t.collapsed]));
    state.tiers = structuredClone(snap.tiers);
    state.tiers.forEach(t => { if (folded.has(t.id)) t.collapsed = folded.get(t.id); });
    state.pool = [...snap.pool];
    state.props = structuredClone(snap.props || {});
    state.crops = structuredClone(snap.crops || {});
    state.slides = structuredClone(snap.slides || {});
    for (const id of idsIn(snap)) {
        if (state.images[id] || !trash[id]) continue;
        state.images[id] = trash[id];
        delete trash[id];
        if (db) run('images', 'readwrite', s => s.put({ id, blob: state.images[id].blob, listId: currentId })).catch(console.error);
    }
    const known = id => id in state.images;
    state.pool = state.pool.filter(known);
    state.tiers.forEach(t => { t.items = t.items.filter(known); });
    Object.keys(state.slides).forEach(pid => {
        if (!known(pid)) { delete state.slides[pid]; return; }
        state.slides[pid] = (state.slides[pid] || []).filter(known);
        if (!state.slides[pid].length) delete state.slides[pid];
    });
    afterChange();
}
function undo() { if (viewOnly || !undoStack.length) return; redoStack.push(takeSnapshot()); restore(undoStack.pop()); }
function redo() { if (viewOnly || !redoStack.length) return; undoStack.push(takeSnapshot()); restore(redoStack.pop()); }

// ---------- Helper Gambar & Zona ----------
function listOf(zone) {
    return zone === 'pool' ? state.pool : state.tiers.find(t => t.id === zone).items;
}
function removeEverywhere(id) {
    state.pool = state.pool.filter(x => x !== id);
    state.tiers.forEach(t => { t.items = t.items.filter(x => x !== id); });
}

const MAX_SIDE = 400;
const KEEP_BYTES = 300 * 1024;

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
        if (file.type === 'image/svg+xml' || await isAnimated(file)) return file;
        const bmp = await createImageBitmap(file);
        const longest = Math.max(bmp.width, bmp.height);
        if (longest <= MAX_SIDE && file.size <= KEEP_BYTES) { bmp.close(); return file; }
        const scale = Math.min(1, MAX_SIDE / longest);
        const w = Math.max(1, Math.round(bmp.width * scale));
        const h = Math.max(1, Math.round(bmp.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
        bmp.close();
        const out = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.85));
        return out && out.size < file.size ? out : file;
    } catch (err) {
        console.error('Gagal mengecilkan, pakai file asli:', err);
        return file;
    }
}

async function storeFilesAsImages(files) {
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
    return newIds;
}

async function addFiles(files, zone, index) {
    if (viewOnly) return;
    if (db && !currentId) { statusEl.textContent = 'Database masih memuat, coba lagi sebentar'; return; }
    const newIds = await storeFilesAsImages(files);
    const target = listOf(zone);
    const at = (index == null || index > target.length) ? target.length : index;
    target.splice(at, 0, ...newIds);
    if (newIds.length) lastDroppedId = newIds[newIds.length - 1];
}

// Gabungkan gambar lain (atau file baru) ke dalam slideshow item targetId
function mergeItemIntoSlideshow(targetId, sourceId) {
    if (!targetId || !sourceId || targetId === sourceId) return;
    removeEverywhere(sourceId);
    const sourceFrames = getFrames(sourceId);
    delete state.slides[sourceId];
    if (!state.slides[targetId]) state.slides[targetId] = [];
    sourceFrames.forEach(fid => {
        if (fid !== targetId && !state.slides[targetId].includes(fid)) {
            state.slides[targetId].push(fid);
        }
    });
    // Jika target belum punya properti tapi source punya, wariskan propertinya
    if (!hasProps(targetId) && hasProps(sourceId)) {
        state.props[targetId] = state.props[sourceId];
    }
    delete state.props[sourceId];
    lastDroppedId = targetId;
}

// ---------- Palet Warna Siap Pakai (24 Pilihan) & Konversi HEX / RGB / HSL ----------
const SWATCHES = [
    '#e5534b', '#ff6b6b', '#e8943a', '#ffa94d', '#e5c94b', '#ffd43b', '#94d82d', '#6fbf5f',
    '#38d9a9', '#2f9e8f', '#7fc4c4', '#4dabf7', '#4f9de0', '#3b6fd4', '#748ffc', '#a07be0',
    '#da77f2', '#e07bb4', '#f783ac', '#f2b5d4', '#c9ccd6', '#8b90a0', '#5c6475', '#343a46'
];

function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
    if (!m) return { r: 229, g: 83, b: 75 };
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r, g, b) {
    const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
    return '#' + [clamp(r), clamp(g), clamp(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}
function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    s = Math.max(0, Math.min(100, s)) / 100;
    l = Math.max(0, Math.min(100, l)) / 100;
    if (s === 0) {
        const v = Math.round(l * 255);
        return { r: v, g: v, b: v };
    }
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return {
        r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
        g: Math.round(hue2rgb(p, q, h) * 255),
        b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    };
}
function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    const s = max === 0 ? 0 : d / max, v = max;
    if (max !== min) {
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            case b: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h: h * 360, s, v };
}
function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360 / 60;
    const i = Math.floor(h), f = h - i;
    const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
    let r = 0, g = 0, b = 0;
    switch (i % 6) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        case 5: r = v; g = p; b = q; break;
    }
    return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}
function parseAnyColorInput(type, str) {
    const s = (str || '').trim();
    if (type === 'hex') {
        const m3 = /^#?([0-9a-f]{3})$/i.exec(s);
        if (m3) return '#' + m3[1].split('').map(c => c + c).join('').toLowerCase();
        const m6 = /^#?([0-9a-f]{6})$/i.exec(s);
        if (m6) return '#' + m6[1].toLowerCase();
    } else if (type === 'rgb') {
        const nums = s.match(/\d+/g);
        if (nums && nums.length >= 3) return rgbToHex(+nums[0], +nums[1], +nums[2]);
    } else if (type === 'hsl') {
        const nums = s.match(/\d+(\.\d+)?/g);
        if (nums && nums.length >= 3) {
            const { r, g, b } = hslToRgb(+nums[0], +nums[1], +nums[2]);
            return rgbToHex(r, g, b);
        }
    }
    return null;
}

const PALETTE = ['#e5534b', '#e8943a', '#e5c94b', '#6fbf5f', '#4f9de0', '#a07be0', '#e07bb4', '#7fc4c4'];
function addTier(at) {
    if (viewOnly) return;
    pushUndo();
    const newTier = {
        id: 't' + crypto.randomUUID().slice(0, 8),
        name: 'Baru',
        color: PALETTE[state.tiers.length % PALETTE.length],
        items: [],
        desc: '',
    };
    state.tiers.splice(at == null ? state.tiers.length : at, 0, newTier);
    afterChange();
    setTimeout(() => {
        const row = rowEls.get(newTier.id);
        if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 30);
}
function deleteTier(id) {
    if (viewOnly) return;
    pushUndo();
    const tier = state.tiers.find(t => t.id === id);
    if (!tier) return;
    state.pool.push(...tier.items);
    state.tiers = state.tiers.filter(t => t.id !== id);
    afterChange();
}
function deleteImage(id) {
    if (viewOnly) return;
    pushUndo();
    removeEverywhere(id);
    delete state.slides[id];
    afterChange();
}
function setAllFolded(value) {
    state.tiers.forEach(t => { t.collapsed = value; });
    render();
    saveSoon();
}

// ---------- Properti Gambar & Deskripsi Tier ----------
const mk = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
};
const hasProps = id => !!(state.props[id] && state.props[id].length);
const itemCaptionText = id => {
    const ps = state.props[id];
    if (!ps || !ps.length) return '';
    return (ps[0].v || ps[0].t || '').trim().split('\n')[0];
};
const tierHasInfo = tier => !!(tier && tier.desc && tier.desc.trim());
const liveProps = () => Object.fromEntries(Object.entries(state.props).filter(([id]) => id in state.images));

function cleanProps(list) {
    return (Array.isArray(list) ? list : []).slice(0, 20)
        .map(p => ({ t: String((p && p.t) || '').slice(0, 60), v: String((p && p.v) || '').slice(0, 2000) }))
        .filter(p => p.t.trim() || p.v.trim());
}

const tip = mk('div', 'tip');
document.body.appendChild(tip);
function hideTip() { tip.style.display = 'none'; }
function moveTip(e) {
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + 16, y = e.clientY - h - 16;
    if (x + w > innerWidth - 8) x = e.clientX - w - 16;
    if (y < 8) y = e.clientY + 18;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = Math.max(8, y) + 'px';
}
function showTip(id, e) { showTipFor(state.props[id], e); }
function showTipForTier(tier, e) {
    if (!tier || !tierHasInfo(tier)) return;
    tip.replaceChildren();
    tip.appendChild(mk('div', 'tip-head', `Tier ${tier.name}`));
    const inner = mk('div', 'tip-inner');
    inner.appendChild(mk('div', 'v', tier.desc.trim()));
    tip.appendChild(inner);
    tip.style.display = 'block';
    moveTip(e);
}
function showTipFor(list, e) {
    if (!list || !list.length) return;
    tip.replaceChildren();
    const inner = mk('div', 'tip-inner');
    list.forEach(p => {
        if (p.t) inner.appendChild(mk('div', 'k', p.t));
        inner.appendChild(mk('div', 'v', p.v));
    });
    tip.appendChild(inner);
    tip.style.display = 'block';
    moveTip(e);
}

const titleList = mk('datalist');
titleList.id = 'ptitles';
document.body.appendChild(titleList);

function refreshTitleSuggestions() {
    const used = new Set(Object.values(state.props).flat().map(p => p.t).filter(Boolean));
    titleList.replaceChildren(...[...used].map(t => { const o = mk('option'); o.value = t; return o; }));
}

function buildLivePropsEditor(initialList, onChange) {
    refreshTitleSuggestions();
    const wrap = mk('div', 'live-props-wrap');
    const listEl = mk('div', 'live-props-list');

    function emitChange() {
        const cleaned = cleanProps([...listEl.children].map(r => ({
            t: r.querySelector('input').value,
            v: r.querySelector('textarea').value,
        })));
        onChange(cleaned);
    }

    function addRow(p = { t: '', v: '' }) {
        const r = mk('div', 'prow');
        const top = mk('div', 'prow-top');
        const t = mk('input');
        const x = mk('button', 'x', '×');
        const v = mk('textarea');

        t.type = 'text';
        t.value = p.t;
        t.placeholder = 'Judul (klik untuk ketik)…';
        t.setAttribute('list', 'ptitles');
        t.maxLength = 60;

        v.value = p.v;
        v.placeholder = 'Tulis isi atau catatan di sini…';
        v.rows = 2;
        v.maxLength = 2000;

        x.type = 'button';
        x.title = 'Hapus properti ini';
        x.addEventListener('click', () => {
            r.remove();
            if (!listEl.children.length) addRow({ t: '', v: '' });
            emitChange();
        });

        t.addEventListener('input', emitChange);
        v.addEventListener('input', emitChange);

        top.append(t, x);
        r.append(top, v);
        listEl.appendChild(r);
        return t;
    }

    const startItems = (initialList && initialList.length) ? initialList : [{ t: '', v: '' }];
    startItems.forEach(p => addRow(p));

    const addBtn = mk('button', 'addprop', '+ Tambah properti');
    addBtn.type = 'button';
    addBtn.addEventListener('click', () => {
        const inp = addRow({ t: '', v: '' });
        inp.focus();
    });

    wrap.append(listEl, addBtn);
    return wrap;
}

// ---------- Panel Detail Gambar (Properti Langsung Ketik + Crop Posisi/Zoom + Slideshow Multi-Gambar) ----------
function openDetail(id) {
    hideTip();
    const getOrder = () => [...state.tiers.flatMap(t => t.items), ...state.pool];
    let order = getOrder();
    let i = Math.max(0, order.indexOf(id));
    let curFrameIdx = 0;
    let cropMode = false;
    let showMergePicker = false;
    let pushedUndoForCur = false;

    const back = mk('div', 'mback');
    const box = mk('div', 'modal detail');

    // Kolom Kiri: Area Gambar / Crop Stage + Toolbar Slideshow
    const dleft = mk('div', 'dleft');
    const wrap = mk('div', 'dimg');
    const img = mk('img');
    const prev = mk('button', 'dnav prev', '‹');
    const next = mk('button', 'dnav next', '›');
    prev.type = 'button';
    next.type = 'button';
    wrap.append(img, prev, next);

    const mediaBar = mk('div', 'dmedia-bar');
    const slideFileInput = mk('input');
    slideFileInput.type = 'file';
    slideFileInput.accept = 'image/*';
    slideFileInput.multiple = true;
    slideFileInput.hidden = true;
    dleft.append(wrap, mediaBar, slideFileInput);

    // Kolom Kanan: Info Posisi Tier + Editor Properti Langsung Ketik
    const side = mk('div', 'dside');
    const head = mk('div', 'dhead');
    const where = mk('div', 'dwhere');
    const moveWrap = mk('div', 'dmove-wrap');
    const body = mk('div', 'dprops');
    const foot = mk('div', 'mbtns');

    head.append(where, moveWrap);
    side.append(head, body, foot);
    box.append(dleft, side);
    back.appendChild(box);
    document.body.appendChild(back);

    let savedPillTimer = null;

    function ensureUndoOnce() {
        if (!pushedUndoForCur) {
            pushUndo();
            pushedUndoForCur = true;
        }
    }

    function renderLeftMedia(curPrimaryId) {
        const frames = getFrames(curPrimaryId);
        if (curFrameIdx >= frames.length) curFrameIdx = 0;
        const activeFid = frames[curFrameIdx] || curPrimaryId;
        slideCursors.set(curPrimaryId, curFrameIdx);

        // Bersihkan crop stage lama kalau ada
        const oldStage = wrap.querySelector('.crop-stage');
        if (oldStage) oldStage.remove();

        if (cropMode && !viewOnly) {
            img.style.display = 'none';
            prev.hidden = true;
            next.hidden = true;

            const stage = mk('div', 'crop-stage');
            const { w: tw, h: th } = getTileDimensions(210, state.ratio);
            const frame = mk('div', 'crop-frame');
            frame.style.setProperty('--crop-w', tw + 'px');
            frame.style.setProperty('--crop-h', th + 'px');
            const cImg = mk('img');
            cImg.src = state.images[activeFid].url;
            applyImgCrop(cImg, activeFid);
            frame.append(cImg, mk('div', 'crop-grid'));

            const ctrls = mk('div', 'crop-controls');
            const zLabel = mk('span', '', 'Zoom:');
            const zSlider = mk('input');
            zSlider.type = 'range';
            zSlider.min = '1';
            zSlider.max = '3';
            zSlider.step = '0.02';
            const c0 = getCrop(activeFid);
            zSlider.value = String(c0.z);
            const zVal = mk('span', '', `${c0.z.toFixed(2)}×`);
            const resetB = mk('button', 'dm-btn', 'Reset');
            resetB.type = 'button';

            function updateCropValues(nx, ny, nz) {
                ensureUndoOnce();
                const norm = {
                    x: Math.max(0, Math.min(100, nx)),
                    y: Math.max(0, Math.min(100, ny)),
                    z: Math.max(1, Math.min(3, nz)),
                };
                if (isDefaultCrop(norm)) delete state.crops[activeFid];
                else state.crops[activeFid] = norm;
                zSlider.value = String(norm.z);
                zVal.textContent = `${norm.z.toFixed(2)}×`;
                applyImgCrop(cImg, activeFid);
                // Perbarui juga gambar di kartu tierlist di belakang modal
                const tileEl = itemEls.get(curPrimaryId);
                if (tileEl) {
                    const tImg = tileEl.querySelector('img');
                    if (tImg) {
                        tImg.src = state.images[activeFid].url;
                        applyImgCrop(tImg, activeFid);
                    }
                }
                saveSoon();
            }

            // Geser posisi gambar dengan drag mouse/touch
            frame.addEventListener('pointerdown', e => {
                e.preventDefault();
                const startX = e.clientX, startY = e.clientY;
                const startCrop = getCrop(activeFid);
                const sens = 100 / (160 * Math.sqrt(startCrop.z));
                const move = ev => {
                    const dx = (startX - ev.clientX) * sens;
                    const dy = (startY - ev.clientY) * sens;
                    updateCropValues(startCrop.x + dx, startCrop.y + dy, getCrop(activeFid).z);
                };
                const up = () => {
                    document.removeEventListener('pointermove', move);
                    document.removeEventListener('pointerup', up);
                    document.removeEventListener('pointercancel', up);
                };
                document.addEventListener('pointermove', move);
                document.addEventListener('pointerup', up);
                document.addEventListener('pointercancel', up);
            });

            // Scroll roda mouse untuk zoom
            frame.addEventListener('wheel', e => {
                e.preventDefault();
                const curC = getCrop(activeFid);
                const delta = e.deltaY < 0 ? 0.1 : -0.1;
                updateCropValues(curC.x, curC.y, curC.z + delta);
            }, { passive: false });

            zSlider.addEventListener('input', () => {
                const curC = getCrop(activeFid);
                updateCropValues(curC.x, curC.y, +zSlider.value);
            });

            resetB.addEventListener('click', () => updateCropValues(50, 50, 1));

            ctrls.append(zLabel, zSlider, zVal, resetB);
            const hint = mk('div', 'crop-hint', 'Tarik gambar di dalam kotak untuk menggeser posisi · Scroll untuk zoom');
            stage.append(frame, ctrls, hint);
            wrap.appendChild(stage);
        } else {
            img.style.display = 'block';
            prev.hidden = order.length <= 1;
            next.hidden = order.length <= 1;
            img.src = state.images[activeFid].url;
            img.style.objectPosition = '';
            img.style.transform = '';
        }

        // Render Baris Toolbar Bawah Gambar (Crop + Slideshow Multi-Gambar)
        mediaBar.replaceChildren();
        const topRow = mk('div', 'dmedia-top');
        topRow.appendChild(mk('span', 'dmedia-title',
            frames.length > 1 ? `Slideshow item ini (${frames.length} gambar · dihitung 1 item)` : 'Gambar & Slideshow'
        ));

        if (!viewOnly) {
            const btns = mk('div', 'dmedia-btns');
            const cropBtn = mk('button', 'dm-btn' + (cropMode ? ' active' : ''), cropMode ? '✓ Selesai Atur Crop' : '✥ Atur Posisi / Crop');
            cropBtn.type = 'button';
            cropBtn.addEventListener('click', () => {
                cropMode = !cropMode;
                renderLeftMedia(curPrimaryId);
            });

            const addFileBtn = mk('button', 'dm-btn', '+ Tambah Foto Slideshow');
            addFileBtn.type = 'button';
            addFileBtn.title = 'Tambahkan foto dari komputer ke dalam item ini agar jadi slideshow';
            addFileBtn.addEventListener('click', () => slideFileInput.click());

            const mergeBtn = mk('button', 'dm-btn' + (showMergePicker ? ' active' : ''), '+ Gabung dari Tier/Inventaris');
            mergeBtn.type = 'button';
            mergeBtn.title = 'Ambil gambar lain yang sudah ada di tierlist/inventaris untuk digabung ke item ini';
            mergeBtn.addEventListener('click', () => {
                showMergePicker = !showMergePicker;
                renderLeftMedia(curPrimaryId);
            });

            btns.append(cropBtn, addFileBtn, mergeBtn);
            topRow.appendChild(btns);
        }
        mediaBar.appendChild(topRow);

        // Strip Thumbnail jika ada >1 gambar di item ini (atau sedang memilih frame)
        if (frames.length > 1) {
            const strip = mk('div', 'slides-strip');
            frames.forEach((fid, idx) => {
                const th = mk('div', 'slide-thumb' + (idx === curFrameIdx ? ' active' : ''));
                const tImg = mk('img');
                tImg.src = state.images[fid].url;
                applyImgCrop(tImg, fid);
                const num = mk('span', 's-num', String(idx + 1));
                th.append(tImg, num);

                if (!viewOnly) {
                    const delB = mk('button', 's-del', '×');
                    delB.type = 'button';
                    delB.title = 'Keluarkan gambar ini dari slideshow (dikembalikan ke inventaris)';
                    delB.addEventListener('click', e => {
                        e.stopPropagation();
                        ensureUndoOnce();
                        if (idx === 0) {
                            // Jika frame utama yang dikeluarkan, promosikan slide berikutnya jadi utama
                            const nextPrimary = frames[1];
                            const restSlides = frames.slice(2);
                            const tOwner = state.tiers.find(t => t.items.includes(curPrimaryId));
                            const listArr = tOwner ? tOwner.items : state.pool;
                            const pos = listArr.indexOf(curPrimaryId);
                            if (pos !== -1) listArr[pos] = nextPrimary;
                            if (state.props[curPrimaryId]) {
                                state.props[nextPrimary] = state.props[curPrimaryId];
                                delete state.props[curPrimaryId];
                            }
                            delete state.slides[curPrimaryId];
                            if (restSlides.length) state.slides[nextPrimary] = restSlides;
                            state.pool.push(curPrimaryId);
                            order = getOrder();
                            i = Math.max(0, order.indexOf(nextPrimary));
                        } else {
                            state.slides[curPrimaryId] = (state.slides[curPrimaryId] || []).filter(x => x !== fid);
                            if (!state.slides[curPrimaryId].length) delete state.slides[curPrimaryId];
                            state.pool.push(fid);
                            order = getOrder();
                        }
                        curFrameIdx = Math.max(0, curFrameIdx - 1);
                        afterChange();
                        show(false);
                    });
                    th.appendChild(delB);
                }

                th.addEventListener('click', () => {
                    curFrameIdx = idx;
                    renderLeftMedia(curPrimaryId);
                    const tileEl = itemEls.get(curPrimaryId);
                    if (tileEl) {
                        const tileImg = tileEl.querySelector('img');
                        if (tileImg) {
                            tileImg.src = state.images[fid].url;
                            applyImgCrop(tileImg, fid);
                        }
                    }
                });
                strip.appendChild(th);
            });
            mediaBar.appendChild(strip);
        }

        // Panel pemilih gambar dari tier/inventaris untuk digabung
        if (showMergePicker && !viewOnly) {
            const candidates = getOrder().filter(oid => oid !== curPrimaryId);
            if (!candidates.length) {
                mediaBar.appendChild(mk('div', 'dempty', 'Belum ada gambar lain di tierlist atau inventaris untuk digabung.'));
            } else {
                const picker = mk('div', 'merge-picker');
                candidates.forEach(oid => {
                    const b = mk('button', 'merge-pick-item');
                    b.type = 'button';
                    b.title = 'Klik untuk gabungkan gambar ini ke slideshow';
                    const pImg = mk('img');
                    pImg.src = state.images[oid].url;
                    b.appendChild(pImg);
                    b.addEventListener('click', () => {
                        ensureUndoOnce();
                        mergeItemIntoSlideshow(curPrimaryId, oid);
                        order = getOrder();
                        i = Math.max(0, order.indexOf(curPrimaryId));
                        curFrameIdx = getFrames(curPrimaryId).length - 1;
                        afterChange();
                        show(false);
                    });
                    picker.appendChild(b);
                });
                mediaBar.appendChild(picker);
            }
        }
    }

    slideFileInput.addEventListener('change', async e => {
        const files = [...(e.target.files || [])];
        e.target.value = '';
        if (!files.length || viewOnly) return;
        const curPrimaryId = order[i];
        ensureUndoOnce();
        const newIds = await storeFilesAsImages(files);
        if (newIds.length) {
            if (!state.slides[curPrimaryId]) state.slides[curPrimaryId] = [];
            state.slides[curPrimaryId].push(...newIds);
            curFrameIdx = getFrames(curPrimaryId).length - 1;
            afterChange();
            renderLeftMedia(curPrimaryId);
        }
    });

    function show(animateImg = false) {
        order = getOrder();
        if (i >= order.length) i = Math.max(0, order.length - 1);
        pushedUndoForCur = false;
        const cur = order[i];
        const tier = state.tiers.find(t => t.items.includes(cur));

        if (animateImg && !cropMode) {
            img.classList.add('switching');
            setTimeout(() => {
                renderLeftMedia(cur);
                img.classList.remove('switching');
            }, 90);
        } else {
            renderLeftMedia(cur);
        }

        where.textContent = `${tier ? 'Tier ' + tier.name : 'Inventaris'} · ${i + 1}/${order.length}`;

        moveWrap.replaceChildren();
        if (!viewOnly) {
            const lbl = mk('span', '', 'Pindah:');
            const sel = mk('select');
            state.tiers.forEach((t, idx) => {
                const o = mk('option', '', `${idx + 1}. ${t.name}`);
                o.value = t.id;
                if (tier && tier.id === t.id) o.selected = true;
                sel.appendChild(o);
            });
            const poolOpt = mk('option', '', 'Inventaris gambar');
            poolOpt.value = 'pool';
            if (!tier) poolOpt.selected = true;
            sel.appendChild(poolOpt);

            sel.addEventListener('change', () => {
                pushUndo();
                removeEverywhere(cur);
                listOf(sel.value).push(cur);
                lastDroppedId = cur;
                afterChange();
                const newTier = state.tiers.find(t => t.id === sel.value);
                where.textContent = `${newTier ? 'Tier ' + newTier.name : 'Inventaris'} · ${i + 1}/${order.length}`;
            });
            moveWrap.append(lbl, sel);
        }

        body.replaceChildren();
        foot.replaceChildren();

        if (viewOnly) {
            const ps = state.props[cur] || [];
            if (!ps.length) {
                body.appendChild(mk('div', 'dempty', 'Belum ada properti.'));
            } else {
                ps.forEach(p => {
                    const card = mk('div', 'prow');
                    if (p.t) card.appendChild(mk('div', 'tm-label', p.t));
                    card.appendChild(mk('div', 'v', p.v));
                    body.appendChild(card);
                });
            }
        } else {
            const hintRow = mk('div', 'dhint');
            hintRow.appendChild(mk('span', '', 'Klik kolom teks untuk langsung mengisi:'));
            const savedPill = mk('span', 'saved-pill', 'Tersimpan');
            hintRow.appendChild(savedPill);
            body.appendChild(hintRow);

            const editor = buildLivePropsEditor(state.props[cur], nextProps => {
                ensureUndoOnce();
                if (nextProps.length) state.props[cur] = nextProps;
                else delete state.props[cur];
                const itemEl = itemEls.get(cur);
                if (itemEl) {
                    itemEl.classList.toggle('has-props', hasProps(cur));
                    const cap = itemEl.querySelector('.item-cap');
                    if (cap) cap.textContent = itemCaptionText(cur);
                }
                applySearch();
                saveSoon();
                savedPill.classList.add('on');
                clearTimeout(savedPillTimer);
                savedPillTimer = setTimeout(() => savedPill.classList.remove('on'), 1200);
            });
            body.appendChild(editor);
        }

        const closeBtn = mk('button', 'primary', 'Tutup');
        closeBtn.type = 'button';
        closeBtn.addEventListener('click', end);
        foot.appendChild(closeBtn);
    }

    const go = step => {
        if (order.length <= 1) return;
        curFrameIdx = 0;
        i = (i + step + order.length) % order.length;
        show(true);
    };

    let closed = false;
    function end() {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey, true);
        closeModalAnim(back);
        render();
    }
    function onKey(e) {
        const ae = document.activeElement;
        const isTyping = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && box.contains(ae);
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (isTyping) ae.blur();
            else if (cropMode) { cropMode = false; renderLeftMedia(order[i]); }
            else end();
        } else if (!isTyping && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.preventDefault();
            e.stopPropagation();
            go(e.key === 'ArrowLeft' ? -1 : 1);
        }
    }
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('mousedown', e => { if (e.target === back) end(); });
    prev.addEventListener('click', () => go(-1));
    next.addEventListener('click', () => go(1));
    show(false);
}

// ---------- Modal Pengaturan & Deskripsi Tier (Hanya Deskripsi Tanpa Properti) ----------
function openTierModal(tierId) {
    if (viewOnly) return;
    hideTip();
    const getTier = () => state.tiers.find(x => x.id === tierId);
    const t0 = getTier();
    if (!t0) return;

    let pushedUndo = false;
    function ensureUndo() {
        if (!pushedUndo) {
            pushUndo();
            pushedUndo = true;
        }
    }

    const back = mk('div', 'mback');
    const box = mk('div', 'modal tier-modal');

    const head = mk('div', 'tm-header');
    head.appendChild(mk('h3', '', `Pengaturan Tier "${t0.name}"`));
    head.appendChild(mk('p', '', 'Nama, deskripsi tier, dan pilihan warna'));

    // Kartu 1: Nama & Deskripsi Tier
    const cardInfo = mk('div', 'tm-card');
    cardInfo.appendChild(mk('span', 'tm-label', 'Nama & Pratinjau Tier'));
    const nameRow = mk('div', 'tm-field-row');
    const badgePreview = mk('div', 'tm-badge-preview', t0.name || 'Tier');
    const nameInp = mk('input');
    nameInp.type = 'text';
    nameInp.value = t0.name;
    nameInp.maxLength = 60;
    nameInp.placeholder = 'Nama tier…';
    nameRow.append(badgePreview, nameInp);

    const descLabel = mk('span', 'tm-label', 'Deskripsi tier (opsional)');
    const descArea = mk('textarea');
    descArea.rows = 3;
    descArea.maxLength = 2000;
    descArea.value = t0.desc || '';
    descArea.placeholder = 'Tulis deskripsi atau keterangan untuk tier ini…';
    descArea.addEventListener('input', () => {
        const curT = getTier();
        if (!curT) return;
        ensureUndo();
        curT.desc = descArea.value.slice(0, 2000);
        render();
        saveSoon();
    });
    cardInfo.append(nameRow, descLabel, descArea);

    // Kartu 2: Warna Siap Pakai (24 warna) & Custom Color Picker (HEX/RGB/HSL)
    const cardColor = mk('div', 'tm-card');
    cardColor.appendChild(mk('span', 'tm-label', 'Warna siap pakai'));
    const swGrid = mk('div', 'tm-swatches');
    const swatchBtns = new Map();
    SWATCHES.forEach(c => {
        const b = mk('button');
        b.type = 'button';
        b.style.background = c;
        b.title = c.toUpperCase();
        b.addEventListener('click', () => applyColorFromHex(c));
        swGrid.appendChild(b);
        swatchBtns.set(c.toLowerCase(), b);
    });
    cardColor.appendChild(swGrid);

    const cpLayout = mk('div', 'cp-layout');
    const cpLeft = mk('div', 'cp-left');
    const svWrap = mk('div', 'cp-sv-wrap');
    const svCanvas = mk('canvas', 'cp-sv-canvas');
    svCanvas.width = 220;
    svCanvas.height = 112;
    const svCursor = mk('div', 'cp-sv-cursor');
    svWrap.append(svCanvas, svCursor);

    const hueRow = mk('div', 'cp-hue-row');
    const hueSlider = mk('input', 'cp-hue');
    hueSlider.type = 'range';
    hueSlider.min = '0';
    hueSlider.max = '360';
    const nativeWrap = mk('label', 'cp-native-btn');
    nativeWrap.appendChild(mk('span', '', 'Pipet'));
    const nativeColor = mk('input');
    nativeColor.type = 'color';
    nativeColor.value = t0.color;
    nativeWrap.appendChild(nativeColor);
    hueRow.append(hueSlider, nativeWrap);
    cpLeft.append(svWrap, hueRow);

    const codesWrap = mk('div', 'cp-codes');
    function makeCodeRow(tagText, type) {
        const row = mk('div', 'cp-code-row');
        const tag = mk('span', 'cp-code-tag', tagText);
        const inp = mk('input');
        inp.type = 'text';
        inp.spellcheck = false;
        const copyBtn = mk('button', 'cp-copy-btn', 'Salin');
        copyBtn.type = 'button';

        inp.addEventListener('focus', () => inp.select());
        inp.addEventListener('input', () => {
            const parsedHex = parseAnyColorInput(type, inp.value);
            if (parsedHex) applyColorFromHex(parsedHex, type);
        });
        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(inp.value);
            } catch (e) {
                inp.select();
                document.execCommand('copy');
            }
            copyBtn.textContent = 'Tersalin';
            copyBtn.classList.add('copied');
            setTimeout(() => {
                copyBtn.textContent = 'Salin';
                copyBtn.classList.remove('copied');
            }, 1200);
        });
        row.append(tag, inp, copyBtn);
        codesWrap.appendChild(row);
        return inp;
    }
    const hexInp = makeCodeRow('HEX', 'hex');
    const rgbInp = makeCodeRow('RGB', 'rgb');
    const hslInp = makeCodeRow('HSL', 'hsl');

    cpLayout.append(cpLeft, codesWrap);
    cardColor.appendChild(cpLayout);

    const footer = mk('div', 'tm-footer');
    const leftActs = mk('div', 'tm-left-acts');
    const btnAbove = mk('button', 'tm-act-btn', '↑ Tambah di atas');
    const btnBelow = mk('button', 'tm-act-btn', '↓ Tambah di bawah');
    const btnDel = mk('button', 'tm-act-btn danger', 'Hapus tier');
    btnAbove.type = 'button';
    btnBelow.type = 'button';
    btnDel.type = 'button';

    btnAbove.addEventListener('click', () => {
        const idx = state.tiers.findIndex(x => x.id === tierId);
        end();
        if (idx !== -1) addTier(idx);
    });
    btnBelow.addEventListener('click', () => {
        const idx = state.tiers.findIndex(x => x.id === tierId);
        end();
        if (idx !== -1) addTier(idx + 1);
    });
    btnDel.addEventListener('click', () => {
        end();
        deleteTier(tierId);
    });
    leftActs.append(btnAbove, btnBelow, btnDel);

    const rightBtns = mk('div', 'mbtns');
    rightBtns.style.marginTop = '0';
    const doneBtn = mk('button', 'primary', 'Selesai');
    doneBtn.type = 'button';
    rightBtns.appendChild(doneBtn);

    footer.append(leftActs, rightBtns);
    box.append(head, cardInfo, cardColor, footer);
    back.appendChild(box);
    document.body.appendChild(back);

    const initRgb = hexToRgb(t0.color);
    let hsv = rgbToHsv(initRgb.r, initRgb.g, initRgb.b);

    function drawSvCanvas() {
        const ctx = svCanvas.getContext('2d');
        const w = svCanvas.width, h = svCanvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = `hsl(${Math.round(hsv.h)}, 100%, 50%)`;
        ctx.fillRect(0, 0, w, h);

        const gradWhite = ctx.createLinearGradient(0, 0, w, 0);
        gradWhite.addColorStop(0, 'rgba(255,255,255,1)');
        gradWhite.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradWhite;
        ctx.fillRect(0, 0, w, h);

        const gradBlack = ctx.createLinearGradient(0, 0, 0, h);
        gradBlack.addColorStop(0, 'rgba(0,0,0,0)');
        gradBlack.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = gradBlack;
        ctx.fillRect(0, 0, w, h);

        svCursor.style.left = (hsv.s * 100) + '%';
        svCursor.style.top = ((1 - hsv.v) * 100) + '%';
    }

    function syncColorUI(hex, skipInput = null) {
        const cleanHex = hex.toLowerCase();
        const { r, g, b } = hexToRgb(cleanHex);
        const { h, s, l } = rgbToHsl(r, g, b);
        const fg = textColorFor(cleanHex);

        badgePreview.style.background = cleanHex;
        badgePreview.style.color = fg;
        nativeColor.value = cleanHex;
        hueSlider.value = String(Math.round(hsv.h));
        drawSvCanvas();

        if (skipInput !== 'hex') hexInp.value = cleanHex.toUpperCase();
        if (skipInput !== 'rgb') rgbInp.value = `rgb(${r}, ${g}, ${b})`;
        if (skipInput !== 'hsl') hslInp.value = `hsl(${h}, ${s}%, ${l}%)`;

        swatchBtns.forEach((btn, swHex) => btn.classList.toggle('on', swHex === cleanHex));
    }

    function applyColorFromHex(hex, skipInput = null) {
        const curT = getTier();
        if (!curT) return;
        ensureUndo();
        curT.color = hex.toLowerCase();
        const { r, g, b } = hexToRgb(curT.color);
        const nextHsv = rgbToHsv(r, g, b);
        if (nextHsv.s > 0.01) hsv.h = nextHsv.h;
        hsv.s = nextHsv.s;
        hsv.v = nextHsv.v;
        syncColorUI(curT.color, skipInput);
        render();
        saveSoon();
    }

    function applyColorFromHsv() {
        const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v);
        const hex = rgbToHex(r, g, b);
        const curT = getTier();
        if (!curT) return;
        ensureUndo();
        curT.color = hex;
        syncColorUI(hex);
        render();
        saveSoon();
    }

    function handleSvPointer(ev) {
        const rect = svWrap.getBoundingClientRect();
        hsv.s = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        hsv.v = Math.max(0, Math.min(1, 1 - (ev.clientY - rect.top) / rect.height));
        applyColorFromHsv();
    }
    svWrap.addEventListener('pointerdown', e => {
        e.preventDefault();
        handleSvPointer(e);
        const move = ev => handleSvPointer(ev);
        const up = () => {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', up);
            document.removeEventListener('pointercancel', up);
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
        document.addEventListener('pointercancel', up);
    });

    hueSlider.addEventListener('input', () => {
        hsv.h = +hueSlider.value;
        applyColorFromHsv();
    });
    nativeColor.addEventListener('input', () => applyColorFromHex(nativeColor.value));

    nameInp.addEventListener('input', () => {
        const curT = getTier();
        if (!curT) return;
        ensureUndo();
        curT.name = nameInp.value;
        badgePreview.textContent = curT.name || 'Tier';
        head.firstChild.textContent = `Pengaturan Tier "${curT.name}"`;
        render();
        saveSoon();
    });

    syncColorUI(t0.color);

    let closed = false;
    function end() {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey, true);
        closeModalAnim(back);
    }
    function onKey(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            const ae = document.activeElement;
            if (ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && box.contains(ae)) ae.blur();
            else end();
        }
    }
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('mousedown', e => { if (e.target === back) end(); });
    doneBtn.addEventListener('click', end);
}

// ---------- Export PNG (Menghormati Rasio, Posisi Crop, Zoom, dan Frame Slideshow Aktif) ----------
const PNG_BASE = 120;
const PNG_W = 1280, PNG_LABEL = 150, PNG_GAP = 6, PNG_PAD = 8;
const PNG_MAX_H = 12000;
const PNG_MAX_ROWS = 25;
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
const pngTileSize = () => getTileDimensions(PNG_BASE, state.ratio);
const pngPerRow = () => {
    const { w } = pngTileSize();
    return Math.max(1, Math.floor((PNG_W - PNG_LABEL - PNG_PAD) / (w + PNG_GAP)));
};
const pngRowH = t => {
    const { h } = pngTileSize();
    const rows = Math.max(1, Math.ceil(t.items.length / pngPerRow()));
    return PNG_PAD * 2 + rows * h + (rows - 1) * PNG_GAP;
};
function pngHeader(ctx, part) {
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
async function drawTile(ctx, primaryId, x, y, tw, th) {
    const fid = activeFrameId(primaryId);
    const rec = state.images[fid] || state.images[primaryId];
    if (!rec) return;
    const c = getCrop(fid);
    ctx.save();
    roundRectPath(ctx, x, y, tw, th, 6);
    ctx.clip();
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(x, y, tw, th);
    try {
        const bmp = await createImageBitmap(rec.blob);
        const s0 = state.fit === 'contain' ? Math.min(tw / bmp.width, th / bmp.height) : Math.max(tw / bmp.width, th / bmp.height);
        const w0 = bmp.width * s0, h0 = bmp.height * s0;
        const dx0 = (tw - w0) * (c.x / 100);
        const dy0 = (th - h0) * (c.y / 100);
        const ox = tw * (c.x / 100);
        const oy = th * (c.y / 100);
        const dx = ox + (dx0 - ox) * c.z;
        const dy = oy + (dy0 - oy) * c.z;
        ctx.drawImage(bmp, x + dx, y + dy, w0 * c.z, h0 * c.z);
        bmp.close();
    } catch (err) { console.error('Gambar dilewati:', primaryId, err); }
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
    const { w: tw, h: th } = pngTileSize();
    const perRow = pngPerRow();
    for (const t of chunk) {
        const rh = pngRowH(t);
        ctx.fillStyle = cssVar('--panel');
        roundRectPath(ctx, 12, y, PNG_W - 24, rh, 10);
        ctx.fill();
        ctx.save();
        roundRectPath(ctx, 12, y, PNG_W - 24, rh, 10);
        ctx.clip();
        ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : '#888888';
        ctx.fillRect(12, y, PNG_LABEL - 12, rh);
        ctx.restore();
        ctx.fillStyle = textColorFor(t.color);
        ctx.font = `700 22px ${FONT}`;
        ctx.textAlign = 'center';
        const lines = wrapLines(ctx, t.name || ' ', PNG_LABEL - 36).slice(0, 4);
        lines.forEach((ln, i) => ctx.fillText(ln, 12 + (PNG_LABEL - 12) / 2, y + rh / 2 + (i - (lines.length - 1) / 2) * 26 + 8, PNG_LABEL - 28));
        ctx.textAlign = 'left';
        for (let k = 0; k < t.items.length; k++) {
            await drawTile(ctx, t.items[k], PNG_LABEL + (k % perRow) * (tw + PNG_GAP), y + PNG_PAD + Math.floor(k / perRow) * (th + PNG_GAP), tw, th);
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
    if (!viewOnly && !db) return dbNotReady();
    const chunks = planPng(), nImg = state.tiers.reduce((s, t) => s + t.items.length, 0);
    if (!nImg) { tell('Belum ada gambar di tier', 'Pindahkan gambar ke tier dulu, baru di-export jadi PNG.'); return; }
    const { w: tw, h: th } = pngTileSize();
    const info = `${state.tiers.length} tier dan ${nImg} gambar akan jadi ${chunks.length} file PNG (ukuran gambar ${tw}×${th} px). `
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

// ---------- Pengingat Backup ----------
function renderBackupInfo() {
    const el = document.getElementById('backupInfo');
    if (viewOnly) { el.textContent = ''; el.classList.remove('warn'); return; }
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

async function confirmAndExport() {
    if (!viewOnly && !db) return dbNotReady();
    if (await askConfirm('Export tierlist?', `"${curName()}" akan diunduh sebagai ${fileSafe(curName())}.json.`, 'Export')) exportJSON();
}

// ---------- Pencarian ----------
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
        row.classList.toggle('hit', n > 0 && !!tier.collapsed);
        row.querySelector('.count').textContent = `${tier.items.length} gambar` + (q ? ` · ${n} cocok` : '');
    });
    const total = q ? [...state.pool, ...state.tiers.flatMap(t => t.items)].filter(matchId).length : 0;
    document.getElementById('searchInfo').textContent = q ? (total ? `${total} cocok` : 'tidak ada yang cocok') : '';
}
function jumpNext() {
    const els = [...document.querySelectorAll('.item.hit, .tier.collapsed.hit')];
    if (!els.length) return;
    hitCursor = (hitCursor + 1) % els.length;
    els[hitCursor].scrollIntoView({ block: 'center', behavior: 'smooth' });
}

const itemEls = new Map();
const rowEls = new Map();

function makeItem(id) {
    let el = itemEls.get(id);
    if (!el) {
        el = document.createElement('div');
        el.className = 'item';
        el.innerHTML = '<img alt=""><span class="slide-badge" hidden></span><span class="item-cap"></span><button class="del" type="button" title="Hapus">×</button>';
        el.addEventListener('dragstart', e => {
            if (viewOnly) { e.preventDefault(); return; }
            dragId = id;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', id);
            setTimeout(() => el.classList.add('dragging'));
        });
        el.addEventListener('dragend', () => {
            dragId = null;
            stopAutoScroll();
            render();
        });
        el.addEventListener('dragstart', hideTip);
        el.addEventListener('mouseenter', e => showTip(id, e));
        el.addEventListener('mousemove', e => { if (tip.style.display === 'block') moveTip(e); });
        el.addEventListener('mouseleave', hideTip);
        el.addEventListener('click', e => { if (!e.target.closest('.del')) openDetail(id); });
        el.querySelector('.del').addEventListener('click', () => deleteImage(id));

        // Tahan Shift saat drag ke gambar lain = gabung jadi 1 item slideshow!
        el.addEventListener('dragover', e => {
            if (viewOnly || dragTierId || dragId === id) return;
            if (e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                el.classList.add('merge-target');
                marker.remove();
            } else {
                el.classList.remove('merge-target');
            }
        });
        el.addEventListener('dragleave', () => el.classList.remove('merge-target'));
        el.addEventListener('drop', async e => {
            el.classList.remove('merge-target');
            if (viewOnly || dragTierId || !e.shiftKey || dragId === id) return;
            e.preventDefault();
            e.stopPropagation();
            stopAutoScroll();
            pushUndo();
            if (dragId) {
                mergeItemIntoSlideshow(id, dragId);
                dragId = null;
            } else if (e.dataTransfer.files && e.dataTransfer.files.length) {
                const newIds = await storeFilesAsImages(e.dataTransfer.files);
                if (newIds.length) {
                    if (!state.slides[id]) state.slides[id] = [];
                    state.slides[id].push(...newIds);
                    lastDroppedId = id;
                }
            }
            afterChange();
        });

        itemEls.set(id, el);
    }
    el.draggable = !viewOnly;
    el.querySelector('.del').hidden = viewOnly;
    el.classList.remove('dragging', 'merge-target');

    const frames = getFrames(id);
    const fid = activeFrameId(id);
    const img = el.querySelector('img');
    if (state.images[fid] && img.getAttribute('src') !== state.images[fid].url) {
        img.src = state.images[fid].url;
    }
    applyImgCrop(img, fid);

    const badge = el.querySelector('.slide-badge');
    if (badge) {
        if (frames.length > 1) {
            const curIdx = (slideCursors.get(id) || 0) % frames.length;
            badge.hidden = false;
            badge.textContent = `${curIdx + 1}/${frames.length}`;
        } else {
            badge.hidden = true;
        }
    }

    const hp = hasProps(id);
    el.classList.toggle('has-props', hp);
    const cap = el.querySelector('.item-cap');
    if (cap) cap.textContent = hp ? itemCaptionText(id) : '';
    if (lastDroppedId === id) {
        el.classList.remove('just-dropped');
        void el.offsetWidth;
        el.classList.add('just-dropped');
        lastDroppedId = null;
    }
    return el;
}

function syncItems(zone, ids) {
    const want = ids.map(makeItem), keep = new Set(want);
    [...zone.children].forEach(ch => { if (!keep.has(ch)) ch.remove(); });
    want.forEach((el, i) => { if (zone.children[i] !== el) zone.insertBefore(el, zone.children[i] || null); });
}

function makeRow(id) {
    const T = () => state.tiers.find(t => t.id === id);
    const row = document.createElement('div');
    row.className = 'tier';
    row.innerHTML = `
    <div class="label">
      <div class="name" contenteditable="true" spellcheck="false"></div>
      <span class="count"></span>
      <button class="tgear" type="button" title="Pengaturan & deskripsi tier">⚙</button>
      <button class="tfold" type="button" title="Lipat / buka tier">▾</button>
      <div class="thandle" draggable="true" title="Seret untuk memindahkan tier">⠿</div>
    </div>
    <div class="zone"></div>`;
    const label = row.firstElementChild, nameEl = label.querySelector('.name');
    let nameEdited = false;
    nameEl.addEventListener('input', () => {
        if (viewOnly) return;
        if (!nameEdited) { pushUndo(); nameEdited = true; }
        T().name = nameEl.textContent;
        saveSoon();
    });
    nameEl.addEventListener('blur', () => { nameEdited = false; });
    nameEl.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } });

    label.addEventListener('mouseenter', e => {
        const tier = T();
        if (tier && tierHasInfo(tier)) showTipForTier(tier, e);
    });
    label.addEventListener('mousemove', e => { if (tip.style.display === 'block') moveTip(e); });
    label.addEventListener('mouseleave', hideTip);

    label.querySelector('.tgear').addEventListener('click', () => openTierModal(id));
    label.querySelector('.tfold').addEventListener('click', () => {
        const t = T();
        t.collapsed = !t.collapsed;
        render();
        saveSoon();
    });
    const handle = label.querySelector('.thandle');
    handle.addEventListener('dragstart', e => {
        if (viewOnly) { e.preventDefault(); return; }
        dragTierId = id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        e.dataTransfer.setDragImage(row, 20, 20);
        setTimeout(() => row.classList.add('moving'));
    });
    handle.addEventListener('dragend', () => {
        dragTierId = null;
        stopAutoScroll();
        tmarker.remove();
        render();
    });
    wireZone(row.lastElementChild, id);
    return row;
}

const marker = document.createElement('div');
marker.className = 'marker';

function placeMarker(zoneEl, x, y) {
    const items = [...zoneEl.querySelectorAll('.item:not(.dragging)')];
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
        if (viewOnly || dragTierId) return;
        e.preventDefault();
        zoneEl.classList.add('over');
        placeMarker(zoneEl, e.clientX, e.clientY);
    });
    zoneEl.addEventListener('dragleave', e => {
        if (!zoneEl.contains(e.relatedTarget)) { zoneEl.classList.remove('over'); marker.remove(); }
    });
    zoneEl.addEventListener('drop', async e => {
        if (viewOnly || dragTierId) return;
        e.preventDefault();
        e.stopPropagation();
        stopAutoScroll();
        zoneEl.classList.remove('over');
        const index = markerIndex(zoneEl);
        marker.remove();
        pushUndo();
        if (dragId) {
            removeEverywhere(dragId);
            listOf(zoneId).splice(index, 0, dragId);
            lastDroppedId = dragId;
        } else {
            statusEl.textContent = 'Menyimpan…';
            await addFiles(e.dataTransfer.files, zoneId, index);
        }
        dragId = null;
        afterChange();
    });
}

const tmarker = document.createElement('div');
tmarker.className = 'tmarker';
const tiersBox = document.getElementById('tiers');

tiersBox.addEventListener('dragover', e => {
    if (viewOnly || !dragTierId) return;
    e.preventDefault();
    const rows = [...tiersBox.querySelectorAll(':scope > .tier:not(.moving)')];
    const before = rows.find(r => {
        const b = r.getBoundingClientRect();
        return e.clientY < b.top + b.height / 2;
    });
    tiersBox.insertBefore(tmarker, before || null);
});
tiersBox.addEventListener('drop', e => {
    if (viewOnly || !dragTierId) return;
    e.preventDefault();
    stopAutoScroll();
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

function applyViewOnlyUI() {
    document.getElementById('viewOnlyBanner').hidden = !viewOnly;
    document.getElementById('voTitle').textContent = viewOnly ? `“${viewOnlyName}”` : '';
    document.getElementById('listsBar').hidden = viewOnly;
    document.getElementById('btnAddTierTop').hidden = viewOnly;
    document.getElementById('bottomAddRow').hidden = viewOnly;
    document.getElementById('btnUndo').hidden = viewOnly;
    document.getElementById('btnRedo').hidden = viewOnly;
    document.getElementById('btnImport').hidden = viewOnly;
    const descEl = document.getElementById('listDesc');
    descEl.readOnly = viewOnly;
    descEl.placeholder = viewOnly
        ? 'Tidak ada deskripsi untuk tierlist ini.'
        : 'Deskripsi tierlist (opsional): tulis catatan, aturan penilaian, atau apa saja…';
}

function render() {
    applyViewOnlyUI();
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
        label.style.color = textColorFor(tier.color);
        nameEl.contentEditable = viewOnly ? 'false' : 'true';
        if (nameEl.textContent !== tier.name && document.activeElement !== nameEl) nameEl.textContent = tier.name;
        row.classList.remove('moving');
        row.classList.toggle('collapsed', !!tier.collapsed);
        label.querySelector('.count').textContent = `${tier.items.length} gambar`;
        label.classList.toggle('has-info', tierHasInfo(tier));
        label.querySelector('.tgear').hidden = viewOnly;
        label.querySelector('.thandle').hidden = viewOnly;
        label.querySelector('.tfold').textContent = tier.collapsed ? '▸' : '▾';
        syncItems(row.lastElementChild, tier.collapsed ? [] : tier.items);
        if (tiersEl.children[i] !== row) tiersEl.insertBefore(row, tiersEl.children[i] || null);
    });
    syncItems(document.getElementById('pool'), state.pool);
    const activePrimaryIds = new Set([...state.pool, ...state.tiers.flatMap(t => t.items)]);
    itemEls.forEach((el, id) => { if (!activePrimaryIds.has(id) || !(id in state.images)) { el.remove(); itemEls.delete(id); } });
    document.getElementById('dockCount').textContent = state.pool.length ? `(${state.pool.length})` : '';
    applySearch();
}

// ---------- Banyak Tierlist ----------
function defaultTiers() {
    return [['S', '#e5534b'], ['A', '#e8943a'], ['B', '#e5c94b'], ['C', '#6fbf5f'], ['D', '#4f9de0']]
        .map(([name, color], i) => ({ id: 't' + (i + 1), name, color, items: [], desc: '' }));
}
async function createList(name) {
    const id = 'l' + crypto.randomUUID().slice(0, 8);
    await run('lists', 'readwrite', s => s.put({
        id, name, tiers: defaultTiers(), pool: [], fit: 'cover',
        ratio: '1:1', size: 88, showLabels: false, slideSpeed: 3700,
        props: {}, crops: {}, slides: {}, desc: '', exportedAt: 0, updatedAt: 0
    }));
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
async function loadList(id) {
    viewOnly = false;
    const rec = await run('lists', 'readonly', s => s.get(id));
    const imgs = await run('images', 'readonly', s => s.index('listId').getAll(id));
    Object.values(state.images).forEach(i => URL.revokeObjectURL(i.url));
    Object.values(trash).forEach(i => URL.revokeObjectURL(i.url));
    Object.keys(trash).forEach(k => delete trash[k]);
    undoStack.length = 0; redoStack.length = 0;
    slideCursors.clear();
    state.images = {};
    for (const i of imgs) state.images[i.id] = { url: URL.createObjectURL(i.blob), blob: i.blob };
    state.tiers = rec.tiers.map(t => ({
        id: t.id,
        name: t.name,
        color: t.color,
        items: t.items || [],
        collapsed: !!t.collapsed,
        desc: normalizeTierDesc(t),
    }));
    state.pool = rec.pool || [];
    state.props = rec.props || {};
    state.crops = cleanCrops(rec.crops);
    state.slides = rec.slides || {};
    state.desc = rec.desc || '';
    state.exportedAt = rec.exportedAt || 0;
    state.updatedAt = rec.updatedAt || 0;
    state.fit = rec.fit === 'contain' ? 'contain' : 'cover';
    state.ratio = ['1:1', '3:4', '16:9'].includes(rec.ratio) ? rec.ratio : '1:1';
    state.size = [68, 88, 112, 140].includes(Number(rec.size)) ? Number(rec.size) : 88;
    state.showLabels = !!rec.showLabels;
    state.slideSpeed = [1800, 3700, 5300].includes(Number(rec.slideSpeed)) ? Number(rec.slideSpeed) : 3700;
    restartSlideshowTimer();
    dirty = false;
    document.getElementById('listDesc').value = state.desc;
    document.getElementById('search').value = '';
    searchQ = '';
    fitDesc();
    const known = x => x in state.images;
    state.pool = state.pool.filter(known);
    state.tiers.forEach(t => { t.items = t.items.filter(known); });
    Object.keys(state.slides).forEach(pid => {
        if (!known(pid)) { delete state.slides[pid]; return; }
        state.slides[pid] = (state.slides[pid] || []).filter(known);
        if (!state.slides[pid].length) delete state.slides[pid];
    });
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
function fitDesc() {
    const ta = document.getElementById('listDesc');
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight + 2, 220) + 'px';
}
document.getElementById('listDesc').addEventListener('input', e => {
    if (viewOnly) return;
    state.desc = e.target.value.slice(0, 2000);
    fitDesc();
    saveSoon();
});
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

// ---------- Mode Lihat Saja (View-Only Showcase) ----------
async function loadViewOnlyFromData(rawData) {
    const parsed = await parseAndCleanTierlistJSON(rawData);
    viewOnly = true;
    viewOnlyName = parsed.name;
    slideCursors.clear();

    Object.values(state.images).forEach(i => URL.revokeObjectURL(i.url));
    state.images = {};
    parsed.blobs.forEach((blob, id) => {
        state.images[id] = { url: URL.createObjectURL(blob), blob };
    });
    state.tiers = parsed.tiers;
    state.pool = parsed.pool;
    state.props = parsed.props;
    state.crops = parsed.crops;
    state.slides = parsed.slides;
    state.desc = parsed.desc;
    state.fit = parsed.fit;
    state.ratio = parsed.ratio;
    state.size = parsed.size;
    state.showLabels = parsed.showLabels;
    state.slideSpeed = parsed.slideSpeed;
    restartSlideshowTimer();

    document.getElementById('listDesc').value = state.desc;
    fitDesc();
    if (!state.pool.length) setDock(false);
    applyFit();
    updateUndoButtons();
    render();
    renderBackupInfo();
    statusEl.textContent = 'Mode Lihat Saja';
}

// ---------- Mulai ----------
async function init() {
    const params = new URLSearchParams(location.search);
    const viewParam = params.get('view');

    try {
        db = await Promise.race([openDB(), new Promise((_, no) => setTimeout(() => no(new Error('database tidak merespons dalam 8 detik (apakah tab lama masih terbuka?)')), 8000))]);
        lists = (await run('lists', 'readonly', s => s.getAll())).map(l => ({ id: l.id, name: l.name }));
        if (!lists.length) await createList('Tierlist 1');
        if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
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

    if (viewParam) {
        try {
            statusEl.textContent = 'Memuat tierlist…';
            const res = await fetch(viewParam);
            if (!res.ok) throw new Error(`Gagal memuat file tierlist (${res.status})`);
            const rawData = await res.json();
            await loadViewOnlyFromData(rawData);
            return;
        } catch (err) {
            console.error(err);
            tell('Gagal membuka tierlist', err.message);
            history.replaceState(null, '', 'app.html');
        }
    }

    if (db) {
        const saved = await run('meta', 'readonly', s => s.get('current'));
        await loadList(lists.some(l => l.id === saved) ? saved : lists[0].id);
        statusEl.textContent = 'Tersimpan otomatis';
    }
    applyFit();
    render();
    showUsage();
}

renderListSelect();
render();
init();
