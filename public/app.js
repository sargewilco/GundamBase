const GRADE_ORDER = ['PG', 'MG', 'RG', 'FM', 'HG', 'EG', 'OTHER'];
const GRADE_LABELS = {
  PG: 'Perfect Grade',
  MG: 'Master Grade',
  RG: 'Real Grade',
  FM: 'Full Mechanics',
  HG: 'High Grade',
  EG: 'Entry Grade',
  OTHER: 'Other Manufacturers'
};

let inventory = [];
let activeGrade = 'ALL';
let activeStatus = 'ALL';
let openModelId = null;

async function fetchInventory() {
  const res = await fetch('/api/inventory');
  inventory = await res.json();
}

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

function getFiltered() {
  return inventory.filter(m => {
    const gradeMatch = activeGrade === 'ALL' || m.grade === activeGrade;
    const statusMatch = activeStatus === 'ALL' || m.status === activeStatus;
    return gradeMatch && statusMatch;
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
        <div class="model-grid">
          ${models.map(renderCard).join('')}
        </div>
      </section>
    `;
  }).join('');

  // Attach card click handlers
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
    </div>
  `;
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
        </div>
      `).join('');

  document.getElementById('modal-content').innerHTML = `
    <div class="modal-top">
      <div class="modal-thumb-area">
        <div class="modal-thumb">${thumbHtml}</div>
        <label class="upload-btn">
          📷 Upload thumbnail
          <input type="file" accept="image/*" id="thumb-upload" />
        </label>
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
        <label class="add-photo-btn">
          + Add Photos
          <input type="file" accept="image/*" multiple id="build-upload" />
        </label>
      </div>
      <div class="build-grid" id="build-grid">${buildPhotosHtml}</div>
    </div>
  `;

  // Bind events
  document.getElementById('save-btn').addEventListener('click', saveChanges);
  document.getElementById('delete-btn').addEventListener('click', deleteModel);
  document.getElementById('thumb-upload').addEventListener('change', uploadThumbnail);
  document.getElementById('fetch-image-btn').addEventListener('click', fetchImageFromWiki);
  document.getElementById('build-upload').addEventListener('change', uploadBuildPhotos);

  document.querySelectorAll('.build-photo-delete').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      deletePhoto(model.id, btn.dataset.path);
    });
  });

  document.querySelectorAll('.build-photo-item img').forEach(img => {
    img.addEventListener('click', () => openLightbox(img.dataset.src));
  });
}

async function fetchImageFromWiki() {
  const btn = document.getElementById('fetch-image-btn');
  btn.textContent = '⏳ Fetching...';
  btn.disabled = true;
  try {
    const res = await fetch(`/api/inventory/${openModelId}/fetch-image`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const idx = inventory.findIndex(m => m.id === openModelId);
    inventory[idx] = data;
    renderModal(data);
    renderGrades();
    showToast('Image fetched from wiki!');
  } catch (err) {
    showToast(`Not found: ${err.message}`);
    btn.textContent = '🔍 Auto-fetch from wiki';
    btn.disabled = false;
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
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grade, status, notes, name, series, modelNumber })
  });
  const updated = await res.json();
  const idx = inventory.findIndex(m => m.id === openModelId);
  inventory[idx] = updated;
  renderGrades();
  renderStats();
  showToast('Saved!');
}

async function deleteModel() {
  const model = inventory.find(m => m.id === openModelId);
  if (!confirm(`Delete "${model.name}"? This cannot be undone.`)) return;
  await fetch(`/api/inventory/${openModelId}`, { method: 'DELETE' });
  inventory = inventory.filter(m => m.id !== openModelId);
  closeModal();
  renderGrades();
  renderStats();
  showToast('Model deleted.');
}

async function uploadThumbnail(e) {
  const file = e.target.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('photo', file);
  const res = await fetch(`/api/inventory/${openModelId}/upload/thumbnail`, { method: 'POST', body: form });
  const updated = await res.json();
  const idx = inventory.findIndex(m => m.id === openModelId);
  inventory[idx] = updated;
  renderModal(updated);
  renderGrades();
  showToast('Thumbnail updated!');
}

async function uploadBuildPhotos(e) {
  const files = Array.from(e.target.files);
  if (!files.length) return;
  let updated;
  for (const file of files) {
    const form = new FormData();
    form.append('photo', file);
    const res = await fetch(`/api/inventory/${openModelId}/upload/build`, { method: 'POST', body: form });
    updated = await res.json();
  }
  const idx = inventory.findIndex(m => m.id === openModelId);
  inventory[idx] = updated;
  renderModal(updated);
  renderGrades();
  showToast(`${files.length} photo(s) added!`);
}

async function deletePhoto(modelId, photoPath) {
  if (!confirm('Delete this photo?')) return;
  const res = await fetch(`/api/inventory/${modelId}/build-photo`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photoPath })
  });
  const updated = await res.json();
  const idx = inventory.findIndex(m => m.id === modelId);
  inventory[idx] = updated;
  renderModal(updated);
  renderGrades();
}

// ── Lightbox ──

function openLightbox(src) {
  let lb = document.getElementById('lightbox');
  if (!lb) {
    lb = document.createElement('div');
    lb.id = 'lightbox';
    lb.className = 'lightbox';
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
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.style.cssText = `
      position:fixed;bottom:2rem;right:2rem;background:#3ecf8e;color:#0d0f14;
      padding:10px 18px;border-radius:8px;font-size:0.85rem;font-weight:600;
      z-index:999;opacity:0;transition:opacity 0.2s;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  setTimeout(() => { toast.style.opacity = '0'; }, 2000);
}

// ── Add Model ──

function openAddModal() {
  document.getElementById('add-name').value = '';
  document.getElementById('add-series').value = '';
  document.getElementById('add-model-number').value = '';
  document.getElementById('add-notes').value = '';
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
  btn.textContent = 'Adding...';
  btn.disabled = true;

  const res = await fetch('/api/inventory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

  closeAddModal();
  renderGrades();
  renderStats();
  showToast(`${name} added!`);
  btn.textContent = 'Add to Inventory';
  btn.disabled = false;
}

// ── Event bindings ──

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
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

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

// ── Init ──

(async () => {
  await fetchInventory();
  renderStats();
  renderGrades();
})();
