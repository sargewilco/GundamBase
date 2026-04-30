const GRADE_COLORS = {
  PG: { bg: '#f0b429', text: '#000' }, MG: { bg: '#4f8ef7', text: '#fff' },
  RG: { bg: '#3ecf8e', text: '#fff' }, FM: { bg: '#7c5ff7', text: '#fff' },
  HG: { bg: '#f97316', text: '#fff' }, EG: { bg: '#ec4899', text: '#fff' },
  OTHER: { bg: '#4a5568', text: '#fff' }
};

const PRIORITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low' };
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

let wishlist = [];
let activePriority = 'ALL';

// ── Data ──

async function fetchWishlist() {
  const res = await fetch('/api/wishlist');
  wishlist = await res.json();
}

// ── Header Stats ──

function renderHeaderStats() {
  const total = wishlist.length;
  const high = wishlist.filter(w => w.priority === 'high').length;
  const medium = wishlist.filter(w => w.priority === 'medium').length;
  document.getElementById('header-stats').innerHTML = `
    <div class="stat-item"><span class="stat-value">${total}</span><span class="stat-label">On Wishlist</span></div>
    <div class="stat-item"><span class="stat-value">${high}</span><span class="stat-label">High Priority</span></div>
    <div class="stat-item"><span class="stat-value">${medium}</span><span class="stat-label">Medium</span></div>
  `;
}

// ── Grid ──

function renderWishlist() {
  const filtered = activePriority === 'ALL'
    ? wishlist
    : wishlist.filter(w => w.priority === activePriority);

  const grid = document.getElementById('wishlist-grid');
  const empty = document.getElementById('wishlist-empty');

  if (filtered.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const sorted = [...filtered].sort((a, b) => {
    const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    return pd !== 0 ? pd : new Date(b.addedAt) - new Date(a.addedAt);
  });

  grid.innerHTML = sorted.map(renderCard).join('');
  grid.querySelectorAll('.wishlist-card').forEach(card => {
    card.addEventListener('click', () => openItemModal(card.dataset.id));
  });
}

function renderCard(item) {
  const gc = GRADE_COLORS[item.grade] || GRADE_COLORS.OTHER;
  const thumb = item.thumbnail
    ? `<img src="${item.thumbnail}" alt="" />`
    : `<div class="card-thumb-placeholder"><span class="icon">♡</span></div>`;

  return `
    <div class="wishlist-card model-card" data-id="${item.id}">
      <div class="card-thumb">
        ${thumb}
        <div class="wish-grade-badge" style="background:${gc.bg};color:${gc.text}">${item.grade}</div>
        <div class="priority-pip priority-${item.priority}"></div>
      </div>
      <div class="card-body">
        <div class="card-name">${item.name}</div>
        <div class="card-series">${item.series}</div>
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-top:4px;">
          <span class="priority-badge priority-${item.priority}">${PRIORITY_LABELS[item.priority] || item.priority}</span>
          ${item.source ? `<span class="card-source">📍 ${item.source}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

// ── Item Detail Modal ──

function openItemModal(id) {
  const item = wishlist.find(w => w.id === id);
  if (!item) return;

  const gc = GRADE_COLORS[item.grade] || GRADE_COLORS.OTHER;
  const addedDate = new Date(item.addedAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  const content = document.getElementById('item-modal-content');
  content.innerHTML = `
    <div class="item-modal-body">
      ${item.thumbnail
        ? `<div class="item-modal-thumb"><img src="${item.thumbnail}" alt="${item.name}" /></div>`
        : `<div class="item-modal-thumb item-modal-thumb-empty"><span>♡</span></div>`}
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:0.75rem;">
        <span class="grade-badge badge-${item.grade}">${item.grade}</span>
        <span class="priority-badge priority-${item.priority}">${PRIORITY_LABELS[item.priority] || item.priority} Priority</span>
      </div>
      <h2 class="item-modal-name">${item.name}</h2>
      <p class="item-modal-meta">${item.series}${item.modelNumber ? ` · ${item.modelNumber}` : ''}</p>
      ${item.source ? `<p class="item-modal-source">📍 ${item.source}</p>` : ''}
      ${item.notes ? `<div class="item-modal-notes">${item.notes}</div>` : ''}
      <p class="item-modal-date">Added ${addedDate}</p>
      <div class="item-modal-actions">
        <button class="add-photo-btn item-promote-btn" id="promote-btn">
          Promote to Inventory →
        </button>
        <div id="promote-confirm" class="promote-confirm hidden">
          <p>Remove from wishlist and open the Add modal pre-filled?</p>
          <div style="display:flex;gap:8px;margin-top:8px;">
            <button class="add-photo-btn" id="promote-confirm-btn" style="flex:1;">Confirm</button>
            <button class="upload-btn" id="promote-cancel-btn" style="flex:1;display:block;">Cancel</button>
          </div>
        </div>
        <button class="item-delete-btn" id="delete-item-btn">Remove from Wishlist</button>
      </div>
    </div>
  `;

  document.getElementById('promote-btn').addEventListener('click', () => {
    document.getElementById('promote-btn').style.display = 'none';
    document.getElementById('promote-confirm').classList.remove('hidden');
  });
  document.getElementById('promote-confirm-btn').addEventListener('click', () => promoteItem(item));
  document.getElementById('promote-cancel-btn').addEventListener('click', () => {
    document.getElementById('promote-btn').style.display = '';
    document.getElementById('promote-confirm').classList.add('hidden');
  });
  document.getElementById('delete-item-btn').addEventListener('click', () => deleteItem(item.id));

  document.getElementById('item-modal-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeItemModal() {
  document.getElementById('item-modal-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

async function promoteItem(item) {
  try {
    const res = await fetch(`/api/wishlist/${item.id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to remove from wishlist');
    sessionStorage.setItem('promoteKit', JSON.stringify({
      grade: item.grade,
      name: item.name,
      series: item.series,
      modelNumber: item.modelNumber,
      notes: item.notes
    }));
    window.location.href = '/';
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteItem(id) {
  try {
    const res = await fetch(`/api/wishlist/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete');
    wishlist = wishlist.filter(w => w.id !== id);
    closeItemModal();
    renderWishlist();
    renderHeaderStats();
    showToast('Removed from wishlist');
  } catch (err) {
    showToast(err.message);
  }
}

// ── Add Modal ──

function openAddModal() {
  ['add-name', 'add-series', 'add-model-number', 'add-source', 'add-notes'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('add-priority').value = 'medium';
  document.getElementById('add-grade').value = 'HG';
  setAddMode('manual');
  document.getElementById('add-modal-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('add-name').focus();
}

function setAddMode(mode) {
  const isScan = mode === 'scan';
  document.getElementById('scan-section').style.display = isScan ? 'block' : 'none';
  document.getElementById('mode-manual-btn').className = isScan ? 'upload-btn' : 'add-photo-btn';
  document.getElementById('mode-scan-btn').className = isScan ? 'add-photo-btn' : 'upload-btn';
  document.getElementById('mode-manual-btn').style.cssText = 'flex:1;font-size:0.85rem;';
  document.getElementById('mode-scan-btn').style.cssText = 'flex:1;font-size:0.85rem;';
  resetScanSection();
}

function resetScanSection() {
  document.getElementById('scan-photo-input').value = '';
  const status = document.getElementById('scan-status');
  status.style.display = 'none';
  status.style.color = 'var(--text2)';
  status.innerHTML = '';
  document.getElementById('scan-retry-btn').style.display = 'none';
  if (window._scanInterval) { clearInterval(window._scanInterval); window._scanInterval = null; }
}

const SCAN_MESSAGES = [
  'Uploading image to Claude Vision...',
  'Analyzing image...',
  'Identifying kit grade...',
  'Reading model number...',
  'Extracting series info...',
  'Detecting retailer...',
  'Finalizing results...',
];

function startScanConsole() {
  const status = document.getElementById('scan-status');
  status.style.display = 'block';
  status.style.color = '';
  status.innerHTML = '<div class="scan-console" id="scan-console-box"></div>';
  const box = document.getElementById('scan-console-box');
  let i = 0;
  function addLine() {
    if (i >= SCAN_MESSAGES.length) return;
    const line = document.createElement('div');
    line.className = 'scan-console-line';
    line.textContent = SCAN_MESSAGES[i++];
    box.appendChild(line);
  }
  addLine();
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  window._scanInterval = setInterval(addLine, 900);
}

function stopScanConsole(success, message) {
  if (window._scanInterval) { clearInterval(window._scanInterval); window._scanInterval = null; }
  const status = document.getElementById('scan-status');
  status.innerHTML = '';
  status.textContent = message;
  status.style.color = success ? 'var(--green)' : 'var(--red)';
}

async function scanWishlistPhoto(file) {
  startScanConsole();
  try {
    const form = new FormData();
    form.append('photo', file);
    const res = await fetch('/api/scan-wishlist', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Scan failed');

    if (data.name) document.getElementById('add-name').value = data.name;
    if (data.series) document.getElementById('add-series').value = data.series;
    if (data.modelNumber) document.getElementById('add-model-number').value = data.modelNumber;
    if (data.source) document.getElementById('add-source').value = data.source;
    if (data.grade && document.querySelector(`#add-grade option[value="${data.grade}"]`)) {
      document.getElementById('add-grade').value = data.grade;
    }
    stopScanConsole(true, 'Scan complete — review the fields below and adjust if needed.');
  } catch (err) {
    stopScanConsole(false, `Scan failed: ${err.message}`);
  }
  document.getElementById('scan-retry-btn').style.display = 'inline';
}

function closeAddModal() {
  document.getElementById('add-modal-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

async function submitAddItem() {
  const grade = document.getElementById('add-grade').value;
  const name = document.getElementById('add-name').value.trim();
  const series = document.getElementById('add-series').value.trim();
  const modelNumber = document.getElementById('add-model-number').value.trim() || null;
  const source = document.getElementById('add-source').value.trim();
  const priority = document.getElementById('add-priority').value;
  const notes = document.getElementById('add-notes').value.trim();
  const fetchImage = document.getElementById('add-fetch-image').checked;

  if (!name || !series) return showToast('Name and series are required.');

  const btn = document.getElementById('add-submit-btn');
  btn.textContent = 'Adding...'; btn.disabled = true;

  const res = await fetch('/api/wishlist', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grade, name, series, modelNumber, source, priority, notes })
  });
  const item = await res.json();
  wishlist.push(item);

  if (fetchImage) {
    showToast('Added! Fetching image...');
    try {
      const imgRes = await fetch(`/api/wishlist/${item.id}/fetch-image`, { method: 'POST' });
      if (imgRes.ok) {
        const updated = await imgRes.json();
        wishlist[wishlist.findIndex(w => w.id === item.id)] = updated;
      }
    } catch {}
  }

  closeAddModal();
  renderWishlist();
  renderHeaderStats();
  showToast(`${name} added to wishlist!`);
  btn.textContent = 'Add to Wishlist'; btn.disabled = false;
}

// ── Toast ──

function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div'); toast.id = 'toast';
    toast.style.cssText = `position:fixed;bottom:5rem;right:1.5rem;background:#3ecf8e;color:#0d0f14;
      padding:10px 18px;border-radius:8px;font-size:0.85rem;font-weight:600;
      z-index:999;opacity:0;transition:opacity 0.2s;`;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  setTimeout(() => { toast.style.opacity = '0'; }, 2500);
}

// ── Event Bindings ──

document.getElementById('add-wish-btn').addEventListener('click', openAddModal);
document.getElementById('mobile-add-btn').addEventListener('click', openAddModal);
document.getElementById('add-modal-close').addEventListener('click', closeAddModal);
document.getElementById('add-cancel-btn').addEventListener('click', closeAddModal);
document.getElementById('add-submit-btn').addEventListener('click', submitAddItem);
document.getElementById('add-modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('add-modal-overlay')) closeAddModal();
});
document.getElementById('item-modal-close').addEventListener('click', closeItemModal);
document.getElementById('item-modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('item-modal-overlay')) closeItemModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeItemModal(); closeAddModal(); } });

document.getElementById('mode-manual-btn').addEventListener('click', () => setAddMode('manual'));
document.getElementById('mode-scan-btn').addEventListener('click', () => setAddMode('scan'));
document.getElementById('scan-photo-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) scanWishlistPhoto(file);
});
document.getElementById('scan-retry-btn').addEventListener('click', () => resetScanSection());

document.getElementById('priority-tabs').addEventListener('click', e => {
  if (!e.target.matches('.tab')) return;
  document.querySelectorAll('#priority-tabs .tab').forEach(t => t.classList.remove('active'));
  e.target.classList.add('active');
  activePriority = e.target.dataset.priority;
  renderWishlist();
});

// ── Init ──

(async () => {
  await fetchWishlist();
  renderHeaderStats();
  renderWishlist();
})();
