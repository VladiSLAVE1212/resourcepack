/* Просмотрщик PDF / DOCX / TXT для официального портала ЕР */
(function () {
  'use strict';

  const modal     = document.getElementById('viewer-modal');
  const titleEl   = document.getElementById('viewer-title');
  const bodyEl    = document.getElementById('viewer-body');
  const metaEl    = document.getElementById('viewer-meta');
  const closeBtn  = document.getElementById('viewer-close');
  const dlBtn     = document.getElementById('viewer-download');
  const printBtn  = document.getElementById('viewer-print');

  function open()  { modal.classList.add('open'); document.body.style.overflow = 'hidden'; }
  function close() { modal.classList.remove('open'); document.body.style.overflow = ''; bodyEl.innerHTML = ''; }

  closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) close();
  });

  printBtn.addEventListener('click', () => {
    const w = window.open('', '_blank');
    if (!w) return;
    const html = bodyEl.innerHTML;
    w.document.write(
      '<!doctype html><html><head><meta charset="utf-8"><title>' +
      titleEl.textContent + '</title>' +
      '<style>body{font-family:"Times New Roman",serif;padding:40px;white-space:pre-wrap;}canvas{display:block;margin:0 auto 12px;max-width:100%;}</style>' +
      '</head><body>' + html + '</body></html>');
    w.document.close();
    setTimeout(() => w.print(), 400);
  });

  // Определение типа файла
  function detectType(act) {
    const explicit = (act.fileType || '').toLowerCase();
    if (explicit) return explicit;
    const path = (act.file || '').toLowerCase();
    const m = path.match(/\.([a-z0-9]+)(\?|$)/);
    return m ? m[1] : '';
  }

  async function renderPdf(url) {
    bodyEl.innerHTML = '<div class="viewer-loading">Загрузка PDF…</div>';
    if (!window.pdfjsLib) {
      bodyEl.innerHTML = '<div class="viewer-error">Библиотека PDF.js не загрузилась. Проверьте интернет-соединение.</div>';
      return;
    }
    try {
      const data = await fetch(url);
      if (!data.ok) throw new Error('HTTP ' + data.status);
      const buf = await data.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      const wrap = document.createElement('div');
      wrap.className = 'viewer-pdf-pages';
      bodyEl.innerHTML = '';
      bodyEl.appendChild(wrap);
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width  = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        wrap.appendChild(canvas);
        await page.render({ canvasContext: ctx, viewport }).promise;
      }
    } catch (err) {
      bodyEl.innerHTML = '<div class="viewer-error">Не удалось загрузить PDF: ' +
        (err && err.message ? err.message : String(err)) + '</div>';
    }
  }

  async function renderDocx(url) {
    bodyEl.innerHTML = '<div class="viewer-loading">Загрузка DOCX…</div>';
    if (!window.mammoth) {
      bodyEl.innerHTML = '<div class="viewer-error">Библиотека mammoth.js не загрузилась.</div>';
      return;
    }
    try {
      const data = await fetch(url);
      if (!data.ok) throw new Error('HTTP ' + data.status);
      const buf = await data.arrayBuffer();
      const result = await mammoth.convertToHtml({ arrayBuffer: buf });
      const wrap = document.createElement('div');
      wrap.className = 'viewer-docx';
      wrap.innerHTML = result.value || '<em>Документ пуст.</em>';
      bodyEl.innerHTML = '';
      bodyEl.appendChild(wrap);
    } catch (err) {
      bodyEl.innerHTML = '<div class="viewer-error">Не удалось загрузить DOCX: ' +
        (err && err.message ? err.message : String(err)) + '</div>';
    }
  }

  async function renderText(url) {
    bodyEl.innerHTML = '<div class="viewer-loading">Загрузка документа…</div>';
    try {
      const data = await fetch(url);
      if (!data.ok) throw new Error('HTTP ' + data.status);
      const text = await data.text();
      const pre = document.createElement('div');
      pre.className = 'viewer-text';
      pre.textContent = text;
      bodyEl.innerHTML = '';
      bodyEl.appendChild(pre);
    } catch (err) {
      bodyEl.innerHTML = '<div class="viewer-error">Не удалось загрузить документ: ' +
        (err && err.message ? err.message : String(err)) + '</div>';
    }
  }

  // Универсальный показ с возможной передачей "data:" / blob URL вместо act.file
  async function show(act, options) {
    options = options || {};
    titleEl.textContent = act.title || 'Документ';
    metaEl.textContent  = [act.number, act.publishedAt].filter(Boolean).join(' · ');

    const fileUrl = options.fileUrl || act.file;
    const type    = (options.fileType || detectType(act) || '').toLowerCase();

    dlBtn.href = fileUrl || '#';
    if (act.title) dlBtn.setAttribute('download', act.title);

    open();

    if (type === 'pdf') return renderPdf(fileUrl);
    if (type === 'docx' || type === 'doc') return renderDocx(fileUrl);
    if (type === 'txt' || type === 'text' || type === '') return renderText(fileUrl);

    // запасной вариант — попытка как текст
    return renderText(fileUrl);
  }

  // публичный API
  window.ActViewer = { show, close };
})();
