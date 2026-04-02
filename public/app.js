const GRADE_ORDER = ['PG', 'MG', 'RG', 'FM', 'HG', 'EG', 'OTHER'];
const GRADE_LABELS = {
  PG: 'Perfect Grade', MG: 'Master Grade', RG: 'Real Grade',
  FM: 'Full Mechanics', HG: 'High Grade', EG: 'Entry Grade', OTHER: 'Other Manufacturers'
};
const GRADE_COLORS = {
  PG: { bg: '#f0b429', text: '#000' }, MG: { bg: '#4f8ef7', text: '#fff' },
  RG: { bg: '#3ecf8e', text: '#fff' }, FM: { bg: '#7c5ff7', text: '#fff' },
  HG: { bg: '#f97316', text: '#fff' }, EG: { bg: '#ec4899', text: '#fff' },
  OTHER: { bg: '#4a5568', text: '#fff' }
};

let inventory = [];
let activeGrade = 'ALL';
let activeStatus = 'ALL';
let searchQuery = '';
let openModelId = null;
let statsVisible = false;

// ── Inventory ──

async function fetchInventory() {
  const res = await fetch('/api/inventory');
  inventory = await res.json();
}

// ── Header Stats ──

function renderStats() {
  const total = inventory.length;
  const complete = inventory.filter(m => m.status === 'complete').length;
  const inProgress = inventory.filter(m => m.status === 'in-progress').length;
  document.getElementById('header-stats').innerHTML = `
    <div class="stat-item"><span class="stat-value">${total}</span><span class="stat-label">Total Kits</span></div>
    <div class="stat-item"><span class="stat-value">${inProgress}</span><span class="stat-label">In Progress</span></div>
    <div class="stat-item"><span class="stat-value">${complete}</span><span class="stat-label">Complete</span></div>
  `;
}

// ── Stats Panel ──

function renderStatsPanel() {
  const total      = inventory.length;
  const complete   = inventory.filter(m => m.status === 'complete').length;
  const inProgress = inventory.filter(m => m.status === 'in-progress').length;
  const backlog    = inventory.filter(m => m.status === 'backlog').length;
  const pct        = total ? Math.round((complete / total) * 100) : 0;

  const gradeCounts = GRADE_ORDER
    .map(g => ({ grade: g, count: inventory.filter(m => m.grade === g).length }))
    .filter(g => g.count > 0)
    .sort((a, b) => b.count - a.count);
  const maxCount = Math.max(...gradeCounts.map(g => g.count));

  const seriesMap = {};
  inventory.forEach(m => { seriesMap[m.series] = (seriesMap[m.series] || 0) + 1; });
  const topSeries = Object.entries(seriesMap).sort((a, b) => b[1] - a[1]).slice(0, 7);

  const segmentBar = gradeCounts.map(g => {
    const c = GRADE_COLORS[g.grade] || GRADE_COLORS.OTHER;
    const flex = (g.count / total * 100).toFixed(1);
    return `<div class="segment-bar-item" style="flex:${flex};background:${c.bg};" title="${g.grade}: ${g.count}"></div>`;
  }).join('');

  const segmentLegend = gradeCounts.map(g => {
    const c = GRADE_COLORS[g.grade] || GRADE_COLORS.OTHER;
    return `<div class="segment-legend-item">
      <div class="segment-legend-dot" style="background:${c.bg}"></div>
      <span>${g.grade}</span>
      <span class="segment-legend-count">${g.count}</span>
    </div>`;
  }).join('');

  const gradeBars = gradeCounts.map(g => {
    const c = GRADE_COLORS[g.grade] || GRADE_COLORS.OTHER;
    const w = maxCount ? Math.round(g.count / maxCount * 100) : 0;
    return `<div class="grade-bar-row">
      <div class="grade-bar-badge" style="background:${c.bg};color:${c.text}">${g.grade}</div>
      <div class="grade-bar-track"><div class="grade-bar-fill" style="width:${w}%;background:${c.bg}"></div></div>
      <div class="grade-bar-count">${g.count}</div>
    </div>`;
  }).join('');

  const seriesRows = topSeries.map(([name, count], i) => `
    <div class="series-row">
      <span class="series-rank">#${i + 1}</span>
      <span class="series-name">${name}</span>
      <span class="series-badge">${count}</span>
    </div>`).join('');

  document.getElementById('stats-panel').innerHTML = `
    <div class="stats-hero">
      <div>
        <div class="stats-hero-num">${pct}%</div>
        <div class="stats-hero-label">Collection Complete · ${total} total kits</div>
      </div>
      <div class="stats-hero-sub">
        <div class="stats-mini"><div class="stats-mini-num" style="color:#3ecf8e">${complete}</div><div class="stats-mini-label">Complete</div></div>
        <div class="stats-mini"><div class="stats-mini-num" style="color:#f97316">${inProgress}</div><div class="stats-mini-label">Building</div></div>
        <div class="stats-mini"><div class="stats-mini-num" style="color:#4a5568">${backlog}</div><div class="stats-mini-label">Backlog</div></div>
      </div>
    </div>
    <div class="stats-grid">
      <div class="stats-card">
        <div class="stats-card-title">Grade Distribution</div>
        <div class="segment-bar">${segmentBar}</div>
        <div class="segment-legend">${segmentLegend}</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-title">Build Status</div>
        <div class="progress-row">
          <div class="progress-label-row">
            <span class="progress-label">Complete</span>
            <span class="progress-value" style="color:#3ecf8e">${complete} <span class="progress-pct">(${total ? Math.round(complete/total*100) : 0}%)</span></span>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${total ? complete/total*100 : 0}%;background:#3ecf8e"></div></div>
        </div>
        <div class="progress-row">
          <div class="progress-label-row">
            <span class="progress-label">In Progress</span>
            <span class="progress-value" style="color:#f97316">${inProgress} <span class="progress-pct">(${total ? Math.round(inProgress/total*100) : 0}%)</span></span>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${total ? inProgress/total*100 : 0}%;background:#f97316"></div></div>
        </div>
        <div class="progress-row">
          <div class="progress-label-row">
            <span class="progress-label">Backlog</span>
            <span class="progress-value" style="color:#4a5568">${backlog} <span class="progress-pct">(${total ? Math.round(backlog/total*100) : 0}%)</span></span>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${total ? backlog/total*100 : 0}%;background:#4a5568"></div></div>
        </div>
      </div>
      <div class="stats-card">
        <div class="stats-card-title">Kits by Grade</div>
        ${gradeBars}
      </div>
      <div class="stats-card">
        <div class="stats-card-title">Top Series</div>
        ${seriesRows}
      </div>
    </div>
  `;
}

function setView(view) {
  const isStats = view === 'stats';
  statsVisible = isStats;
  document.getElementById('stats-panel').classList.toggle('hidden', !isStats);
  document.getElementById('collection-view').style.display = isStats ? 'none' : '';
  document.getElementById('stats-toggle-btn')?.classList.toggle('active', isStats);

  document.querySelectorAll('.mobile-nav-btn[data-view]').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view);
  });

  if (isStats) renderStatsPanel();
}

// ── Collection ──

function getFiltered() {
  const q = searchQuery.toLowerCase();
  return inventory.filter(m => {
    const gradeMatch = activeGrade === 'ALL' || m.grade === activeGrade;
    const statusMatch = activeStatus === 'ALL' || m.status === activeStatus;
    const searchMatch = !q ||
      m.name.toLowerCase().includes(q) ||
      m.series.toLowerCase().includes(q) ||
      (m.modelNumber && m.modelNumber.toLowerCase().includes(q));
    return gradeMatch && statusMatch && searchMatch;
  });
}

function renderGrades() {
  const filtered = getFiltered();
  const container = document.getElementById('grade-sections');
  const grades = activeGrade === 'ALL'
    ? GRADE_ORDER.filter(g => filtered.some(m => m.grade === g))
    : [activeGrade];

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state"><span class="icon">🤖</span>No models match your filter.</div>`;
    return;
  }

  container.innerHTML = grades.map(grade => {
    const models = filtered.filter(m => m.grade === grade);
    if (!models.length) return '';
    return `
      <section class="grade-section">
        <div class="grade-header">
          <span class="grade-badge badge-${grade}">${grade}</span>
          <span class="grade-title">${GRADE_LABELS[grade]}</span>
          <span class="grade-count">${models.length}</span>
        </div>
        <div class="model-grid">${models.map(renderCard).join('')}</div>
      </section>`;
  }).join('');

  container.querySelectorAll('.model-card').forEach(card => {
    card.addEventListener('click', () => openModal(card.dataset.id));
  });
}

function renderCard(model) {
  const photoCount = model.buildPhotos.length;
  const thumbHtml = model.thumbnail
    ? `<img src="${model.thumbnail}" alt="${model.name}" loading="lazy" />`
    : `<div class="card-thumb-placeholder"><span class="icon">🤖</span><span>No photo</span></div>`;
  const statusClass = `status-${model.status}`;
  const statusLabel = model.status === 'in-progress' ? 'In Progress'
    : model.status.charAt(0).toUpperCase() + model.status.slice(1);
  return `
    <div class="model-card" data-id="${model.id}">
      <div class="card-thumb">
        ${thumbHtml}
        ${photoCount > 0 ? `<span class="card-photo-count">📷 ${photoCount}</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-name">${model.name}</div>
        <div class="card-series">${model.series}</div>
        <span class="card-status ${statusClass}">${statusLabel}</span>
      </div>
    </div>`;
}

// ── Modal ──

function openModal(id) {
  openModelId = id;
  const model = inventory.find(m => m.id === id);
  if (!model) return;
  renderModal(model);
  document.getElementById('modal-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.body.style.overflow = '';
  openModelId = null;
}

function renderModal(model) {
  const thumbHtml = model.thumbnail
    ? `<img src="${model.thumbnail}" alt="${model.name}" />`
    : `<div class="modal-thumb-placeholder"><span class="icon">🤖</span><small>No thumbnail</small></div>`;
  const buildPhotosHtml = model.buildPhotos.length === 0
    ? `<div class="empty-build">No build photos yet — add some below!</div>`
    : model.buildPhotos.map((p, i) => `
        <div class="build-photo-item">
          <img src="${p.path}" alt="Build photo ${i+1}" loading="lazy" data-src="${p.path}" />
          <div class="build-photo-date">${new Date(p.date).toLocaleDateString()}</div>
          <button class="build-photo-delete" data-path="${p.path}" title="Delete">✕</button>
        </div>`).join('');

  document.getElementById('modal-content').innerHTML = `
    <div class="modal-top">
      <div class="modal-thumb-area">
        <div class="modal-thumb">${thumbHtml}</div>
        <label class="upload-btn">📷 Upload thumbnail<input type="file" accept="image/*" id="thumb-upload" /></label>
        <button class="upload-btn" id="fetch-image-btn" style="margin-top:6px;">🔍 Auto-fetch from wiki</button>
      </div>
      <div class="modal-info">
        <div class="modal-grade-row">
          <select class="status-select" id="edit-grade">
            ${GRADE_ORDER.map(g => `<option value="${g}" ${model.grade===g?'selected':''}>${g} — ${GRADE_LABELS[g]}</option>`).join('')}
          </select>
        </div>
        <div class="field-group">
          <label class="field-label">Name</label>
          <input class="notes-input" style="min-height:unset;padding:8px 12px;" id="edit-name" value="${model.name}" />
        </div>
        <div class="field-group">
          <label class="field-label">Series</label>
          <input class="notes-input" style="min-height:unset;padding:8px 12px;" id="edit-series" value="${model.series}" />
        </div>
        <div class="field-group">
          <label class="field-label">Model Number</label>
          <input class="notes-input" style="min-height:unset;padding:8px 12px;" id="edit-model-number" value="${model.modelNumber || ''}" />
        </div>
        <div class="field-group">
          <label class="field-label" for="status-select">Build Status</label>
          <select class="status-select" id="status-select">
            <option value="backlog" ${model.status==='backlog'?'selected':''}>Backlog</option>
            <option value="in-progress" ${model.status==='in-progress'?'selected':''}>In Progress</option>
            <option value="complete" ${model.status==='complete'?'selected':''}>Complete</option>
          </select>
        </div>
        <div class="field-group">
          <label class="field-label" for="notes-input">Notes</label>
          <textarea class="notes-input" id="notes-input" placeholder="Build notes, tips, progress...">${model.notes || ''}</textarea>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="add-photo-btn" id="save-btn" style="flex:1;">Save Changes</button>
          <button class="delete-model-btn" id="delete-btn" title="Delete model">🗑</button>
        </div>
      </div>
    </div>
    <div class="build-section">
      <div class="build-section-header">
        <span class="build-section-title">Build Photos</span>
        <label class="add-photo-btn">+ Add Photos<input type="file" accept="image/*" multiple id="build-upload" /></label>
      </div>
      <div class="build-grid" id="build-grid">${buildPhotosHtml}</div>
    </div>`;

  document.getElementById('save-btn').addEventListener('click', saveChanges);
  document.getElementById('delete-btn').addEventListener('click', deleteModel);
  document.getElementById('thumb-upload').addEventListener('change', uploadThumbnail);
  document.getElementById('fetch-image-btn').addEventListener('click', fetchImageFromWiki);
  document.getElementById('build-upload').addEventListener('change', uploadBuildPhotos);
  document.querySelectorAll('.build-photo-delete').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deletePhoto(model.id, btn.dataset.path); });
  });
  document.querySelectorAll('.build-photo-item img').forEach(img => {
    img.addEventListener('click', () => openLightbox(img.dataset.src));
  });
}

async function fetchImageFromWiki() {
  const btn = document.getElementById('fetch-image-btn');
  btn.textContent = '⏳ Fetching...'; btn.disabled = true;
  try {
    const res = await fetch(`/api/inventory/${openModelId}/fetch-image`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    inventory[inventory.findIndex(m => m.id === openModelId)] = data;
    renderModal(data); renderGrades();
    showToast('Image fetched from wiki!');
  } catch (err) {
    showToast(`Not found: ${err.message}`);
    btn.textContent = '🔍 Auto-fetch from wiki'; btn.disabled = false;
  }
}

async function saveChanges() {
  const grade = document.getElementById('edit-grade').value;
  const status = document.getElementById('status-select').value;
  const notes = document.getElementById('notes-input').value;
  const name = document.getElementById('edit-name').value.trim();
  const series = document.getElementById('edit-series').value.trim();
  const modelNumber = document.getElementById('edit-model-number').value.trim() || null;
  if (!name || !series) return showToast('Name and series are required.');
  const res = await fetch(`/api/inventory/${openModelId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grade, status, notes, name, series, modelNumber })
  });
  const updated = await res.json();
  inventory[inventory.findIndex(m => m.id === openModelId)] = updated;
  renderGrades(); renderStats();
  if (statsVisible) renderStatsPanel();
  showToast('Saved!');
}

async function deleteModel() {
  const model = inventory.find(m => m.id === openModelId);
  if (!confirm(`Delete "${model.name}"? This cannot be undone.`)) return;
  await fetch(`/api/inventory/${openModelId}`, { method: 'DELETE' });
  inventory = inventory.filter(m => m.id !== openModelId);
  closeModal(); renderGrades(); renderStats();
  if (statsVisible) renderStatsPanel();
  showToast('Model deleted.');
}

async function uploadThumbnail(e) {
  const file = e.target.files[0]; if (!file) return;
  const form = new FormData(); form.append('photo', file);
  const res = await fetch(`/api/inventory/${openModelId}/upload/thumbnail`, { method: 'POST', body: form });
  const updated = await res.json();
  inventory[inventory.findIndex(m => m.id === openModelId)] = updated;
  renderModal(updated); renderGrades(); showToast('Thumbnail updated!');
}

async function uploadBuildPhotos(e) {
  const files = Array.from(e.target.files); if (!files.length) return;
  let updated;
  for (const file of files) {
    const form = new FormData(); form.append('photo', file);
    const res = await fetch(`/api/inventory/${openModelId}/upload/build`, { method: 'POST', body: form });
    updated = await res.json();
  }
  inventory[inventory.findIndex(m => m.id === openModelId)] = updated;
  renderModal(updated); renderGrades(); showToast(`${files.length} photo(s) added!`);
}

async function deletePhoto(modelId, photoPath) {
  if (!confirm('Delete this photo?')) return;
  const res = await fetch(`/api/inventory/${modelId}/build-photo`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoPath })
  });
  const updated = await res.json();
  inventory[inventory.findIndex(m => m.id === modelId)] = updated;
  renderModal(updated); renderGrades();
}

// ── Lightbox ──

function openLightbox(src) {
  let lb = document.getElementById('lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'lightbox'; lb.className = 'lightbox';
    lb.innerHTML = '<img />';
    lb.addEventListener('click', () => lb.classList.add('hidden'));
    document.body.appendChild(lb);
  }
  lb.querySelector('img').src = src;
  lb.classList.remove('hidden');
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
  setTimeout(() => { toast.style.opacity = '0'; }, 2000);
}

// ── Add Model ──

function openAddModal() {
  ['add-name','add-series','add-model-number','add-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('add-modal-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  document.getElementById('add-name').focus();
}

function closeAddModal() {
  document.getElementById('add-modal-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

async function submitAddModel() {
  const grade = document.getElementById('add-grade').value;
  const name = document.getElementById('add-name').value.trim();
  const series = document.getElementById('add-series').value.trim();
  const modelNumber = document.getElementById('add-model-number').value.trim() || null;
  const notes = document.getElementById('add-notes').value.trim();
  const fetchImage = document.getElementById('add-fetch-image').checked;
  if (!name || !series) return showToast('Name and series are required.');

  const btn = document.getElementById('add-submit-btn');
  btn.textContent = 'Adding...'; btn.disabled = true;

  const res = await fetch('/api/inventory', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grade, name, series, modelNumber, notes })
  });
  const model = await res.json();
  inventory.push(model);

  if (fetchImage) {
    showToast('Added! Fetching image...');
    try {
      const imgRes = await fetch(`/api/inventory/${model.id}/fetch-image`, { method: 'POST' });
      if (imgRes.ok) {
        const updated = await imgRes.json();
        inventory[inventory.findIndex(m => m.id === model.id)] = updated;
      }
    } catch {}
  }

  closeAddModal(); renderGrades(); renderStats();
  showToast(`${name} added!`);
  btn.textContent = 'Add to Inventory'; btn.disabled = false;
}

// ── Event Bindings ──

document.getElementById('add-model-btn').addEventListener('click', openAddModal);
document.getElementById('add-modal-close').addEventListener('click', closeAddModal);
document.getElementById('add-cancel-btn').addEventListener('click', closeAddModal);
document.getElementById('add-submit-btn').addEventListener('click', submitAddModel);
document.getElementById('add-modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('add-modal-overlay')) closeAddModal();
});
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeAddModal(); } });

document.getElementById('grade-tabs').addEventListener('click', e => {
  if (!e.target.matches('.tab')) return;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  e.target.classList.add('active');
  activeGrade = e.target.dataset.grade;
  renderGrades();
});

document.querySelector('.status-filters').addEventListener('click', e => {
  if (!e.target.matches('.status-btn')) return;
  document.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  activeStatus = e.target.dataset.status;
  renderGrades();
});

document.getElementById('stats-toggle-btn').addEventListener('click', () => {
  setView(statsVisible ? 'collection' : 'stats');
});

document.getElementById('mobile-add-btn').addEventListener('click', openAddModal);

document.querySelectorAll('.mobile-nav-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

// ── Search ──

document.getElementById('search-input').addEventListener('input', e => {
  searchQuery = e.target.value.trim();
  document.getElementById('search-clear').classList.toggle('hidden', !searchQuery);
  renderGrades();
});

document.getElementById('search-clear').addEventListener('click', () => {
  searchQuery = '';
  document.getElementById('search-input').value = '';
  document.getElementById('search-clear').classList.add('hidden');
  renderGrades();
});

// ── Init ──

(async () => {
  await fetchInventory();
  renderStats();
  renderGrades();
})();
