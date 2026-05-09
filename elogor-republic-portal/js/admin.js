/* Админ-панель Государственной службы правовой информации Елогорской Республики */
(function () {
  'use strict';

  const CFG = window.ELOGOR_CONFIG;
  if (!CFG) {
    alert('Не загружен js/config.js — конфигурация админки отсутствует.');
    return;
  }

  const MANIFEST_URL = 'data/manifest.json';

  // ---------- состояние ----------
  let baseManifest = null;     // оригинальный manifest.json из репозитория
  let working = null;          // рабочий объект с актами (то, что админ редактирует)
  let dirty = false;           // есть ли локальные изменения
  let editingId = null;        // id редактируемого акта (null = новый)

  // overlay-данные хранят:
  //   { acts: [полный список актов], replace: true, deleted: [], pendingFiles: { id: { name, type, dataUrl } } }
  // pendingFiles — содержимое новых/перезаписанных файлов в base64, чтобы экспортировать в ZIP.

  // ---------- утилиты ----------
  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function uid() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const rand = Math.random().toString(36).slice(2, 6);
    return `act-${yyyy}-${rand}`;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function fmtDate(iso) {
    if (!iso) return '';
    return iso.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$3.$2.$1');
  }

  // ---------- сессия ----------
  function loadSession() {
    try {
      const raw = localStorage.getItem(CFG.SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !s.expires || Date.now() > s.expires) {
        localStorage.removeItem(CFG.SESSION_KEY);
        return null;
      }
      return s;
    } catch (_) { return null; }
  }

  function saveSession() {
    const s = { user: CFG.ADMIN_LOGIN, expires: Date.now() + CFG.SESSION_TTL_MS };
    localStorage.setItem(CFG.SESSION_KEY, JSON.stringify(s));
  }

  function logout() {
    localStorage.removeItem(CFG.SESSION_KEY);
    location.reload();
  }

  // ---------- загрузка манифеста и overlay ----------
  async function fetchBaseManifest() {
    try {
      const r = await fetch(MANIFEST_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (err) {
      console.warn('Не удалось загрузить manifest.json:', err);
      return { republic: {}, types: [], acts: [] };
    }
  }

  function loadOverlay() {
    try {
      const raw = localStorage.getItem(CFG.OVERLAY_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function saveOverlay() {
    const overlay = {
      acts:   working.acts,
      replace: true,
      pendingFiles: working.pendingFiles || {}
    };
    try {
      localStorage.setItem(CFG.OVERLAY_KEY, JSON.stringify(overlay));
    } catch (err) {
      alert('Не удалось сохранить локально (вероятно, превышен лимит localStorage). ' +
            'Попробуйте экспортировать архив и очистить локальные изменения.\n\n' + err.message);
    }
  }

  function discardOverlay() {
    if (!confirm('Отменить все локальные изменения, которые ещё не были экспортированы и закоммичены?')) return;
    localStorage.removeItem(CFG.OVERLAY_KEY);
    location.reload();
  }

  function setDirty(v) {
    dirty = !!v;
    document.getElementById('local-changes-indicator').style.display = dirty ? '' : 'none';
    updateExportStats();
  }

  // ---------- логика "working" ----------
  function buildInitialWorking() {
    const overlay = loadOverlay();
    const acts = overlay && Array.isArray(overlay.acts) ? overlay.acts : (baseManifest.acts || []).slice();
    const pendingFiles = overlay && overlay.pendingFiles ? overlay.pendingFiles : {};
    return { acts, pendingFiles };
  }

  function findAct(id) { return working.acts.find(a => a.id === id); }

  function persistAndRefresh() {
    saveOverlay();
    setDirty(true);
    renderTable();
  }

  // ---------- логин ----------
  function bindLogin() {
    const form    = document.getElementById('login-form');
    const errEl   = document.getElementById('login-error');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const u = document.getElementById('lf-login').value.trim();
      const p = document.getElementById('lf-password').value;
      if (u === CFG.ADMIN_LOGIN && p === CFG.ADMIN_PASSWORD) {
        saveSession();
        showApp();
      } else {
        errEl.style.display = 'block';
        errEl.textContent = 'Неверные имя пользователя или пароль.';
        document.getElementById('lf-password').value = '';
        document.getElementById('lf-password').focus();
      }
    });
  }

  // ---------- инициализация админ-приложения ----------
  async function showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('admin-app').style.display = '';
    baseManifest = await fetchBaseManifest();
    working = buildInitialWorking();

    populateTypeSelectors();
    populateAuthorSuggest();
    renderTable();
    bindTabs();
    bindForm();
    bindExport();

    document.getElementById('btn-logout').addEventListener('click', (e) => { e.preventDefault(); logout(); });
    document.getElementById('btn-new-act').addEventListener('click', () => openForm(null));
    document.getElementById('adm-search').addEventListener('input', renderTable);
    document.getElementById('adm-type-filter').addEventListener('change', renderTable);

    setDirty(!!loadOverlay());
  }

  // ---------- селекторы типов ----------
  function populateTypeSelectors() {
    const types = baseManifest.types || [];
    const groups = {};
    types.forEach(t => { (groups[t.group || 'Прочее'] = groups[t.group || 'Прочее'] || []).push(t); });

    const optHtml = Object.keys(groups).sort().map(g =>
      `<optgroup label="${escapeHtml(g)}">` +
      groups[g].map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.label)}</option>`).join('') +
      `</optgroup>`).join('');

    const fType = document.getElementById('f-type');
    fType.innerHTML = optHtml;

    const filter = document.getElementById('adm-type-filter');
    filter.innerHTML = '<option value="">— все типы —</option>' + optHtml;
  }

  function populateAuthorSuggest() {
    const dl = document.getElementById('author-suggest');
    const set = new Set();
    (working.acts || []).forEach(a => { if (a.author) set.add(a.author); });
    (baseManifest.acts || []).forEach(a => { if (a.author) set.add(a.author); });
    dl.innerHTML = Array.from(set).sort((a,b)=>a.localeCompare(b,'ru'))
      .map(a => `<option value="${escapeHtml(a)}">`).join('');
  }

  function typeLabel(id) {
    const t = (baseManifest.types || []).find(x => x.id === id);
    return t ? t.label : (id || '—');
  }

  // ---------- таблица актов ----------
  function renderTable() {
    const tbody = document.getElementById('adm-tbody');
    const q = (document.getElementById('adm-search').value || '').toLowerCase().trim();
    const tp = document.getElementById('adm-type-filter').value;

    const baseIds = new Set((baseManifest.acts || []).map(a => a.id));
    const baseMap = new Map((baseManifest.acts || []).map(a => [a.id, a]));

    const filtered = (working.acts || []).filter(a => {
      if (tp && a.type !== tp) return false;
      if (!q) return true;
      const hay = [a.title, a.number, a.author, a.summary, (a.tags || []).join(' ')]
        .join(' ').toLowerCase();
      return hay.includes(q);
    }).sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));

    document.getElementById('adm-status').textContent =
      `${filtered.length} из ${working.acts.length} актов`;

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#777;padding:20px;">Нет актов, удовлетворяющих условиям.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((a, idx) => {
      let status = '';
      if (!baseIds.has(a.id)) status = '<span class="pill pill-new">новый</span>';
      else {
        const orig = baseMap.get(a.id);
        const changed = ['title','type','number','author','publishedAt','summary','file','fileType']
          .some(k => (orig[k] || '') !== (a[k] || '')) ||
          JSON.stringify(orig.tags || []) !== JSON.stringify(a.tags || []);
        if (changed) status = '<span class="pill pill-edit">изменён</span>';
        else status = '<span class="pill">без изменений</span>';
      }
      const ext = (a.fileType || '').toUpperCase() || (a.file || '').split('.').pop().toUpperCase();

      return `
        <tr>
          <td>${idx + 1}</td>
          <td>
            <div style="font-weight:bold;color:#0a4a8a;">${escapeHtml(a.title || '—')}</div>
            <div style="font-size:11px;color:#4a607c;">${escapeHtml(a.number || '')} · ${escapeHtml(a.author || '')}</div>
          </td>
          <td>${escapeHtml(typeLabel(a.type))}</td>
          <td>${escapeHtml(fmtDate(a.publishedAt))}</td>
          <td>${escapeHtml(ext || '—')}</td>
          <td>${status}</td>
          <td class="col-actions">
            <button class="btn btn-sm" data-action="view"   data-id="${escapeHtml(a.id)}">Просмотр</button>
            <button class="btn btn-sm btn-primary" data-action="edit" data-id="${escapeHtml(a.id)}">Изменить</button>
            <button class="btn btn-sm btn-danger"  data-action="del"  data-id="${escapeHtml(a.id)}">Удалить</button>
          </td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', () => onTableAction(btn.dataset.action, btn.dataset.id));
    });
  }

  async function onTableAction(action, id) {
    const act = findAct(id);
    if (!act) return;
    if (action === 'edit') return openForm(id);
    if (action === 'del')  return deleteAct(id);
    if (action === 'view') {
      const pending = working.pendingFiles && working.pendingFiles[id];
      if (pending && pending.dataUrl) {
        if (window.ActViewer) window.ActViewer.show(act, { fileUrl: pending.dataUrl, fileType: pending.type });
        else openExternal(pending.dataUrl);
      } else {
        if (window.ActViewer) window.ActViewer.show(act);
        else openExternal(act.file);
      }
    }
  }
  function openExternal(url) { if (url) window.open(url, '_blank'); }

  // ---------- удаление ----------
  function deleteAct(id) {
    if (!confirm('Удалить акт безвозвратно (из локальной правки)? Действие можно откатить, нажав «Откатить локальные изменения».')) return;
    working.acts = working.acts.filter(a => a.id !== id);
    if (working.pendingFiles) delete working.pendingFiles[id];
    persistAndRefresh();
  }

  // ---------- форма ----------
  function bindTabs() {
    document.querySelectorAll('.admin-tabs .tab').forEach(t => {
      t.addEventListener('click', () => {
        document.querySelectorAll('.admin-tabs .tab').forEach(x => x.classList.remove('active'));
        document.querySelectorAll('.tab-page').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        document.getElementById('tab-' + t.dataset.tab).classList.add('active');
        if (t.dataset.tab === 'export') updateExportStats();
      });
    });
  }

  function activateTab(name) {
    document.querySelectorAll('.admin-tabs .tab').forEach(x => {
      x.classList.toggle('active', x.dataset.tab === name);
    });
    document.querySelectorAll('.tab-page').forEach(x => {
      x.classList.toggle('active', x.id === 'tab-' + name);
    });
  }

  function openForm(id) {
    editingId = id;
    const f = {
      id:    document.getElementById('f-id'),
      title: document.getElementById('f-title'),
      type:  document.getElementById('f-type'),
      date:  document.getElementById('f-date'),
      number:document.getElementById('f-number'),
      author:document.getElementById('f-author'),
      summary: document.getElementById('f-summary'),
      tags:  document.getElementById('f-tags'),
      drop:  document.getElementById('f-file-drop'),
      file:  document.getElementById('f-file'),
      existing:    document.getElementById('f-file-existing'),
      existingName:document.getElementById('f-file-existing-name'),
      keepFile:    document.getElementById('f-file-keep'),
      hint:  document.getElementById('f-file-hint')
    };

    f.file.value = '';
    f.drop.classList.remove('has-file');
    f.drop.querySelector('strong').textContent = 'Перетащите файл сюда';
    f.hint.textContent = 'PDF / DOCX / TXT, желательно < 5 МБ';
    f.existing.style.display = 'none';

    if (id) {
      const a = findAct(id);
      if (!a) return;
      document.getElementById('form-title').textContent = 'Редактирование акта: ' + (a.title || '');
      f.id.value = a.id;
      f.title.value = a.title || '';
      f.type.value = a.type || (baseManifest.types[0] && baseManifest.types[0].id) || '';
      f.date.value = (a.publishedAt || '').slice(0, 10);
      f.number.value = a.number || '';
      f.author.value = a.author || '';
      f.summary.value = a.summary || '';
      f.tags.value = (a.tags || []).join(', ');
      const pend = working.pendingFiles && working.pendingFiles[a.id];
      const existingName = pend ? pend.name : (a.file ? a.file.split('/').pop() : '');
      if (existingName) {
        f.existing.style.display = '';
        f.existingName.textContent = existingName + (pend ? ' (загружен в браузере, ещё не экспортирован)' : '');
      }
    } else {
      document.getElementById('form-title').textContent = 'Опубликование нового акта';
      f.id.value = '';
      f.title.value = '';
      f.type.value = (baseManifest.types[0] && baseManifest.types[0].id) || '';
      f.date.value = new Date().toISOString().slice(0, 10);
      f.number.value = '';
      f.author.value = '';
      f.summary.value = '';
      f.tags.value = '';
    }

    activateTab('form');
    f.title.focus();
  }

  function bindForm() {
    const drop = document.getElementById('f-file-drop');
    const file = document.getElementById('f-file');
    drop.addEventListener('click', () => file.click());
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('has-file'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('has-file'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        file.files = e.dataTransfer.files;
        onFilePicked(file.files[0]);
      }
    });
    file.addEventListener('change', () => {
      if (file.files && file.files[0]) onFilePicked(file.files[0]);
    });

    document.getElementById('f-cancel').addEventListener('click', () => activateTab('list'));
    document.getElementById('f-file-keep').addEventListener('click', (e) => {
      e.preventDefault();
      // ничего не меняем — оставляем как есть. Это просто для UX.
      const drop = document.getElementById('f-file-drop');
      drop.querySelector('strong').textContent = 'Файл оставлен без изменений';
    });

    document.getElementById('act-form').addEventListener('submit', onSubmitForm);
  }

  function onFilePicked(f) {
    const drop = document.getElementById('f-file-drop');
    drop.classList.add('has-file');
    drop.querySelector('strong').textContent = 'Выбран файл: ' + f.name;
    document.getElementById('f-file-hint').textContent =
      `${(f.size / 1024).toFixed(0)} КБ · ${f.type || guessExt(f.name)}`;
  }

  function guessExt(name) {
    const m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(fr.error);
      fr.onload = () => resolve(fr.result);
      fr.readAsDataURL(file);
    });
  }

  async function onSubmitForm(e) {
    e.preventDefault();

    const id = document.getElementById('f-id').value || uid();
    const isNew = !document.getElementById('f-id').value;

    const title  = document.getElementById('f-title').value.trim();
    const type   = document.getElementById('f-type').value;
    const date   = document.getElementById('f-date').value;
    const number = document.getElementById('f-number').value.trim();
    const author = document.getElementById('f-author').value.trim();
    const summary= document.getElementById('f-summary').value.trim();
    const tags   = document.getElementById('f-tags').value.split(',').map(s => s.trim()).filter(Boolean);
    const fileEl = document.getElementById('f-file');
    const fileObj = fileEl.files && fileEl.files[0];

    if (!title || !type || !date) { alert('Заполните обязательные поля.'); return; }

    let act = findAct(id);
    if (!act) act = { id };

    // Имя/путь файла:
    // - если выбран новый файл, формируем путь data/acts/<id>.<ext>
    // - иначе сохраняем существующий
    if (fileObj) {
      const ext = guessExt(fileObj.name) || 'bin';
      const newPath = `data/acts/${id}.${ext}`;
      try {
        const dataUrl = await readFileAsDataUrl(fileObj);
        working.pendingFiles = working.pendingFiles || {};
        working.pendingFiles[id] = {
          name: `${id}.${ext}`,
          type: ext,
          dataUrl: dataUrl
        };
        act.file = newPath;
        act.fileType = ext;
      } catch (err) {
        alert('Не удалось прочитать файл: ' + err.message);
        return;
      }
    } else if (isNew) {
      alert('Для нового акта необходимо приложить файл (PDF / DOCX / TXT).');
      return;
    }

    Object.assign(act, {
      title, type, number, author, summary, tags,
      publishedAt: date,
    });

    if (isNew) {
      working.acts.push(act);
    }

    persistAndRefresh();
    populateAuthorSuggest();
    activateTab('list');
  }

  // ---------- экспорт ----------
  function bindExport() {
    document.getElementById('btn-export-zip').addEventListener('click', exportZip);
    document.getElementById('btn-export-manifest').addEventListener('click', exportManifest);
    document.getElementById('btn-discard').addEventListener('click', discardOverlay);
    document.getElementById('btn-import-manifest').addEventListener('change', importManifest);
  }

  function buildExportManifest() {
    return {
      republic: baseManifest.republic || {},
      types:    baseManifest.types    || [],
      acts:     (working.acts || []).map(a => ({
        id: a.id,
        title: a.title || '',
        type: a.type || '',
        number: a.number || '',
        author: a.author || '',
        publishedAt: a.publishedAt || '',
        tags: a.tags || [],
        summary: a.summary || '',
        file: a.file || '',
        fileType: a.fileType || ''
      }))
    };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  }

  function exportManifest() {
    const m = buildExportManifest();
    const blob = new Blob([JSON.stringify(m, null, 2)], { type: 'application/json;charset=utf-8' });
    downloadBlob(blob, 'manifest.json');
  }

  async function exportZip() {
    if (!window.JSZip) { alert('JSZip не загрузился. Проверьте интернет-соединение.'); return; }
    const zip = new JSZip();
    const m = buildExportManifest();
    zip.file('data/manifest.json', JSON.stringify(m, null, 2));

    const pending = working.pendingFiles || {};
    Object.keys(pending).forEach(id => {
      const p = pending[id];
      // Берём бинарь из data URL
      const comma = p.dataUrl.indexOf(',');
      const b64 = p.dataUrl.slice(comma + 1);
      zip.file(`data/acts/${p.name}`, b64, { base64: true });
    });

    zip.file('README-DEPLOY.txt',
      'Архив сгенерирован админ-панелью Елогорской Республики.\n' +
      'Содержимое:\n' +
      '  data/manifest.json — обновлённый список актов\n' +
      '  data/acts/<...>    — новые загруженные файлы актов\n\n' +
      'Распакуйте архив в корень репозитория, заменив существующие файлы при\n' +
      'необходимости. Затем выполните в репозитории:\n' +
      '   git add data/manifest.json data/acts/\n' +
      '   git commit -m "Опубликование новых актов"\n' +
      '   git push\n' +
      'GitHub Pages автоматически обновит сайт через 1-2 минуты.\n');

    const blob = await zip.generateAsync({ type: 'blob' });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadBlob(blob, `elogor-publication-${ts}.zip`);
  }

  function importManifest(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const data = JSON.parse(fr.result);
        if (!Array.isArray(data.acts)) throw new Error('Файл не является корректным manifest.json — отсутствует acts.');
        if (!confirm(`Импортировать манифест с ${data.acts.length} актами? Текущие локальные правки будут перезаписаны.`)) return;
        working.acts = data.acts;
        // pendingFiles при импорте чистим, потому что файлов из чужого манифеста может не быть
        working.pendingFiles = working.pendingFiles || {};
        persistAndRefresh();
        populateAuthorSuggest();
        alert('Импорт завершён.');
      } catch (err) {
        alert('Не удалось импортировать: ' + err.message);
      }
    };
    fr.readAsText(file);
  }

  function updateExportStats() {
    const baseIds = new Set((baseManifest && baseManifest.acts || []).map(a => a.id));
    const baseMap = new Map((baseManifest && baseManifest.acts || []).map(a => [a.id, a]));
    let added = 0, edited = 0;
    (working && working.acts || []).forEach(a => {
      if (!baseIds.has(a.id)) added++;
      else {
        const orig = baseMap.get(a.id);
        if (['title','type','number','author','publishedAt','summary','file','fileType']
          .some(k => (orig[k] || '') !== (a[k] || '')) ||
          JSON.stringify(orig.tags || []) !== JSON.stringify(a.tags || [])) edited++;
      }
    });
    const deleted = (baseManifest && baseManifest.acts || []).filter(b => !(working.acts || []).some(a => a.id === b.id)).length;
    const pendingCount = Object.keys((working && working.pendingFiles) || {}).length;
    const el = document.getElementById('export-stats');
    if (el) el.textContent =
      `новых: ${added}, изменено: ${edited}, удалено: ${deleted}, новых файлов: ${pendingCount}.`;
  }

  // ---------- старт ----------
  function init() {
    bindLogin();
    if (loadSession()) {
      showApp();
    }
  }

  init();
})();
