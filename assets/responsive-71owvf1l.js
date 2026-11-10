/* Layout controls only. Dashboard data, filtering and calculations stay in their existing modules. */
(() => {
  'use strict';
  const sidebar = document.querySelector('.sidebar');
  const toggle = document.getElementById('navigationToggle');
  const compact = window.matchMedia('(max-width: 1024px)');
  function setMenu(open) {
    sidebar.classList.toggle('menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  }
  toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
  sidebar.addEventListener('click', event => {
    if (event.target.closest('.nav-btn, #serviceBtn, #homeBrand')) setMenu(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setMenu(false);
      toggle.focus();
    }
  });
  compact.addEventListener('change', () => setMenu(false));
  function updateCurrentNavigation() {
    document.querySelectorAll('.nav-btn').forEach(button => {
      if (button.classList.contains('active')) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    setMenu(false);
  }
  new MutationObserver(updateCurrentNavigation).observe(document.querySelector('.app'), {attributes: true, attributeFilter: ['data-view']});
  updateCurrentNavigation();

  // Phone sorting uses the same buttons and sorting logic as the desktop table.
  function addPhoneSorting(root) {
    const table = root.querySelector('.rr-rating-table');
    const panel = root.querySelector('.rr-ranking-panel');
    if (!table || !panel || panel.querySelector('.rr-ranking-mobile-sort')) return;
    const headers = [...table.querySelectorAll('[data-rr-sort]')];
    const active = headers.find(button => button.closest('th').getAttribute('aria-sort') !== 'none') || headers[0];
    const descending = active.closest('th').getAttribute('aria-sort') === 'descending';
    const toolbar = document.createElement('div');
    toolbar.className = 'rr-ranking-mobile-sort';
    const label = document.createElement('label');
    label.textContent = 'Сортировать по';
    const select = document.createElement('select');
    select.className = 'rr-ranking-sort-select';
    headers.forEach(header => {
      const option = document.createElement('option');
      option.value = header.dataset.rrSort;
      option.textContent = header.querySelector('span').textContent;
      select.append(option);
    });
    select.value = active.dataset.rrSort;
    select.addEventListener('change', () => {
      headers.find(header => header.dataset.rrSort === select.value)?.click();
      queueMicrotask(() => root.querySelector('.rr-ranking-sort-select')?.focus({preventScroll: true}));
    });
    const direction = document.createElement('button');
    direction.type = 'button';
    direction.className = 'rr-ranking-sort-direction';
    direction.textContent = descending ? '↓' : '↑';
    direction.setAttribute('aria-label', descending ? 'По убыванию. Изменить порядок' : 'По возрастанию. Изменить порядок');
    direction.addEventListener('click', () => {
      active.click();
      queueMicrotask(() => root.querySelector('.rr-ranking-sort-direction')?.focus({preventScroll: true}));
    });
    label.append(select);
    toolbar.append(label, direction);
    panel.querySelector('.rr-table-wrap').before(toolbar);
    const previousLabel = headers.find(header => header.dataset.rrSort === 'previous')?.querySelector('span').textContent || 'Предыдущий период';
    table.querySelectorAll('tbody tr').forEach(row => row.cells[5]?.setAttribute('data-label', previousLabel));
  }
  ['rankingDashboard', 'combinedRankingDashboard'].forEach(id => {
    const root = document.getElementById(id);
    new MutationObserver(() => addPhoneSorting(root)).observe(root, {childList: true});
    addPhoneSorting(root);
  });

  // Move the original controls into each rendered heading, preserving listeners.
  const dashboardTools = document.querySelector('.dashboard-tools');
  const dashboardRoots = [...document.querySelectorAll('.workspace > .view > div')];
  function placeDashboardTools() {
    const root = document.querySelector('.workspace > .view:not(.hidden) > div[id$="Dashboard"]');
    if (!root) return;
    let destination = root.querySelector('.rr-page-head, .section-head');
    if (root.id === 'mapDashboard') destination = root.querySelector('.rr-geo-wrap');
    if (root.id === 'assistantDashboard') destination = root.querySelector('.ai-hero');
    if (destination) {
      destination.classList.add('has-dashboard-tools');
      if (dashboardTools.parentElement !== destination) destination.append(dashboardTools);
    }
  }
  new MutationObserver(placeDashboardTools).observe(document.querySelector('.app'), {attributes: true, attributeFilter: ['data-view']});
  dashboardRoots.forEach(root => new MutationObserver(placeDashboardTools).observe(root, {childList: true}));
  placeDashboardTools();

  let resizeFrame = 0;
  let lastWidth = 0;
  new ResizeObserver(entries => {
    const width = Math.round(entries[0].contentRect.width);
    if (width === lastWidth) return;
    lastWidth = width;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => state.charts.forEach(chart => {
      if (!chart.isDisposed()) chart.resize();
    }));
  }).observe(document.querySelector('.main'));
})();
