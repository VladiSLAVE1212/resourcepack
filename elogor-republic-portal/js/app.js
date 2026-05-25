/* Публичный портал — список / поиск / сортировка актов Елогорской Республики */
(function () {
  'use strict';

  const LS_KEY      = 'elogor:overlay';   // изменения, внесённые админкой (overlay)
  const LS_TYPES    = 'elogor:overlayTypes'; // расширения списка типов (если админ добавлял)
  const MANIFEST_URL = 'data/manifest.json';

  // ---------- состояние ----------
  let manifest = { types: [], acts: [], republic: {} };
  let typesById = {};
  let filtered = [];
  const ui = {
    q:       document.getElementById('f-q'),
    from:    document.getElementById('f-from'),
    to:      document.getElementById('f-to'),
    author:  document.getElementById('f-author'),
    types:   document.getElementById('f-types'),
    apply:   document.getElementById('btn-apply'),
    reset:   document.getElementById('btn-reset'),
    sort:    document.getElementById('sort-by'),
    list:    document.getElementById('act-list'),
    count:   document.getElementById('count-line'),
  };

  // ---------- загрузка ----------
  async function loadManifest() {
    try {
      const r = await fetch(MANIFEST_URL, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const m = await r.json();
      m.types = Array.isArray(m.types) ? m.types : [];
      m.acts  = Array.isArray(m.acts)  ? m.acts  : [];
      return m;
    } catch (err) {
      console.warn('manifest.json не загружен:', err);
      return { republic: {}, types: [], acts: [] };
    }
  }

  function applyOverlay(base) {
    let overlay = null;
    let overlayTypes = null;
    try { overlay      = JSON.parse(localStorage.getItem(LS_KEY)   || 'null'); } catch (_) {}
    try { overlayTypes = JSON.parse(localStorage.getItem(LS_TYPES) || 'null'); } catch (_) {}

    if (overlayTypes && Array.isArray(overlayTypes)) {
      const seen = new Set(base.types.map(t => t.id));
      overlayTypes.forEach(t => { if (!seen.has(t.id)) base.types.push(t); });
    }

    if (overlay && Array.isArray(overlay.acts)) {
      // overlay.acts — полный набор. Берём его поверх (но базовые файлы остаются доступны).
      // Если overlay помечен replace=true, заменяем массив целиком, иначе мерджим по id.
      if (overlay.replace) {
        base.acts = overlay.acts;
      } else {
        const map = new Map(base.acts.map(a => [a.id, a]));
        overlay.acts.forEach(a => { map.set(a.id, a); });
        base.acts = Array.from(map.values());
      }
      if (Array.isArray(overlay.deleted)) {
        const del = new Set(overlay.deleted);
        base.acts = base.acts.filter(a => !del.has(a.id));
      }
    }

    return base;
  }

  // ---------- UI: типы / авторы ----------
  function renderTypeFilters() {
    const groups = {};
    manifest.types.forEach(t => {
      const g = t.group || 'Прочее';
      (groups[g] = groups[g] || []).push(t);
    });

    const html = Object.keys(groups).sort().map(g => {
      const items = groups[g].map(t =>
        `<label><input type="checkbox" value="${t.id}" class="f-type-cb"> ${escapeHtml(t.label)}</label>`
      ).join('');
      return `<h4>${escapeHtml(g)}</h4>${items}`;
    }).join('');

    ui.types.innerHTML = html || '<em>Нет типов в манифесте.</em>';
  }

  function renderAuthorFilter() {
    const set = new Set();
    manifest.acts.forEach(a => { if (a.author) set.add(a.author); });
    const sorted = Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'));
    ui.author.innerHTML = '<option value="">— все органы —</option>' +
      sorted.map(a => `<option value="${escapeAttr(a)}">${escapeHtml(a)}</option>`).join('');
  }

  // ---------- фильтрация ----------
  function getSelectedTypes() {
    return Array.from(document.querySelectorAll('.f-type-cb:checked')).map(cb => cb.value);
  }

  function applyFilters() {
    const q       = (ui.q.value || '').trim().toLowerCase();
    const from    = ui.from.value || '';
    const to      = ui.to.value   || '';
    const author  = ui.author.value || '';
    const types   = getSelectedTypes();
    const typeSet = new Set(types);

    filtered = manifest.acts.filter(a => {
      if (typeSet.size && !typeSet.has(a.type)) return false;
      if (author && a.author !== author) return false;
      if (from   && a.publishedAt < from) return false;
      if (to     && a.publishedAt > to)   return false;
      if (q) {
        const hay = [
          a.title, a.summary, a.number, a.author,
          (a.tags || []).join(' '),
          (typesById[a.type] && typesById[a.type].label) || ''
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    sortAndRender();
  }

  function sortAndRender() {
    const sort = ui.sort.value;
    filtered.sort((a, b) => {
      switch (sort) {
        case 'date-asc':   return cmp(a.publishedAt, b.publishedAt);
        case 'title-asc':  return (a.title || '').localeCompare(b.title || '', 'ru');
        case 'title-desc': return (b.title || '').localeCompare(a.title || '', 'ru');
        case 'type':
          return ((typesById[a.type]?.label || '').localeCompare(typesById[b.type]?.label || '', 'ru'))
              || cmp(b.publishedAt, a.publishedAt);
        case 'date-desc':
        default:           return cmp(b.publishedAt, a.publishedAt);
      }
    });
    renderList();
  }

  function cmp(a, b) { return (a || '').localeCompare(b || ''); }

  // ---------- рендер списка ----------
  function renderList() {
    if (!filtered.length) {
      ui.list.innerHTML =
        '<li class="empty"><span class="empty-icon">∅</span>Документы по заданным условиям не найдены.<br>' +
        'Попробуйте смягчить фильтры или сбросить их.</li>';
      ui.count.textContent = 'Найдено: 0 документов';
      return;
    }
    ui.count.textContent = 'Найдено документов: ' + filtered.length +
      ' из ' + manifest.acts.length;

    ui.list.innerHTML = filtered.map(a => {
      const typeLabel = (typesById[a.type] && typesById[a.type].label) || a.type || '—';
      const ext = (a.fileType || guessExt(a.file) || 'doc').toUpperCase();
      const date = formatDate(a.publishedAt);
      const tags = (a.tags || []).map(t =>
        `<span class="tag">#${escapeHtml(t)}</span>`).join(' ');
      return `
        <li class="act-item" data-id="${escapeAttr(a.id)}">
          <div class="act-icon" data-ext="${escapeHtml(ext)}">
            <div class="act-icon-label">${escapeHtml(shortType(typeLabel))}</div>
          </div>
          <div class="act-body">
            <h3><a href="#" class="act-open" data-id="${escapeAttr(a.id)}">${escapeHtml(a.title || 'Без названия')}</a></h3>
            <div class="act-meta">
              <span class="badge">${escapeHtml(typeLabel)}</span>
              <span>${escapeHtml(a.number || '—')}</span>
              <span>${escapeHtml(date)}</span>
              <span>${escapeHtml(a.author || '')}</span>
            </div>
            <div class="act-summary">${escapeHtml(a.summary || '')}</div>
            ${tags ? `<div class="tags">${tags}</div>` : ''}
          </div>
          <div class="act-actions">
            <button class="btn btn-primary btn-sm act-open" data-id="${escapeAttr(a.id)}">Открыть</button>
            <a class="btn btn-sm" href="${escapeAttr(a.file || '#')}" download>Скачать</a>
          </div>
        </li>`;
    }).join('');
  }

  // ---------- хелперы ----------
  function shortType(label) {
    if (!label) return '';
    return label.length > 24 ? label.slice(0, 22) + '…' : label;
  }
  function guessExt(path) {
    if (!path) return '';
    const m = String(path).toLowerCase().match(/\.([a-z0-9]+)(\?|$)/);
    return m ? m[1] : '';
  }
  function formatDate(iso) {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    const months = ['января','февраля','марта','апреля','мая','июня',
                    'июля','августа','сентября','октября','ноября','декабря'];
    return `${parseInt(m[3],10)} ${months[parseInt(m[2],10)-1]} ${m[1]} г.`;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // ---------- события ----------
  function bind() {
    ui.apply.addEventListener('click', applyFilters);
    ui.reset.addEventListener('click', () => {
      ui.q.value = '';
      ui.from.value = '';
      ui.to.value = '';
      ui.author.value = '';
      document.querySelectorAll('.f-type-cb').forEach(cb => cb.checked = false);
      applyFilters();
    });
    ui.sort.addEventListener('change', sortAndRender);
    ui.q.addEventListener('keydown', e => { if (e.key === 'Enter') applyFilters(); });

    ui.list.addEventListener('click', (e) => {
      const a = e.target.closest('.act-open');
      if (!a) return;
      e.preventDefault();
      const id = a.getAttribute('data-id');
      const act = manifest.acts.find(x => x.id === id);
      if (act && window.ActViewer) window.ActViewer.show(act);
    });
  }

  // ---------- старт ----------
  (async function init() {
    bind();
    const base = await loadManifest();
    manifest = applyOverlay(base);
    typesById = {};
    manifest.types.forEach(t => { typesById[t.id] = t; });
    renderTypeFilters();
    renderAuthorFilter();
    filtered = manifest.acts.slice();
    sortAndRender();
  })();
})();
