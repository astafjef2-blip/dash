/* Management analytics v4. */
(() => {
  'use strict';
  const CFG = Object.freeze({
    eps: .05,
    weakDirection: .90,
    rankFall: 10,
    scoreFall: -3,
    attentionWeak: 4,
    systemShare: .25,
    indicatorRedShare: .20,
    ppkImpact: 1
  });
  const statusMeta = {
    stable: {label: 'Стабильно', short: 'Стабильно'},
    watch: {label: 'Наблюдение', short: 'Наблюдение'},
    attention: {label: 'Требует внимания', short: 'Внимание'}
  };
  const rankingSorts = {to: {key: 'rank', direction: 'asc'}, combined: {key: 'rank', direction: 'asc'}};
  const normalize = value => String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[^а-яa-z0-9]+/g, ' ').trim();
  const previousMap = () => new Map((state.previousData || []).map(x => [normalize(x.n), x]));
  const prevValue = x => state.metric === 'to' ? x?.v : x?.cv;
  const prevRank = x => state.metric === 'to' ? x?.r : x?.cr;
  const medianOf = values => {
    const a = values.filter(num).slice().sort((a, b) => a - b);
    if (!a.length) return null;
    const i = Math.floor(a.length / 2);
    return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
  };
  const pp = value => num(value) ? `${value > 0 ? '+' : ''}${value.toFixed(1).replace('.', ',')} п.п.` : '—';
  const deltaClass = value => num(value) && value !== 0 ? value > 0 ? 'rr-change-positive' : 'rr-change-negative' : '';
  const signed = value => num(value) ? `${value > 0 ? '+' : ''}${Math.round(value)}` : '—';
  const sourceDate = () => {
    const m = String(state.meta?.source || '').match(/(\d{2})\.(\d{2})\.(\d{4})/);
    return m ? `${m[1]}.${m[2]}.${m[3]}` : 'дата не указана';
  };
  const percentile = (values, p) => {
    const a = values.filter(num).slice().sort((x, y) => x - y);
    if (!a.length) return null;
    return a[Math.min(a.length - 1, Math.max(0, Math.ceil(a.length * p) - 1))];
  };
  const directionComparable = (x, p, i) => num(x?.d?.[i]?.[1]) && num(p?.d?.[i]?.[1]) && num(x?.d?.[i]?.[3]) && num(p?.d?.[i]?.[3]) && Math.abs(x.d[i][3] - p.d[i][3]) < 1e-9;
  const comparability = (x, p) => {
    if (!p || !num(getVal(x)) || !num(prevValue(p))) return {level: 'low', label: 'Низкая', text: 'Нет полного предыдущего периода'};
    const sameTotal = num(x.m) && num(p.m) && Math.abs(x.m - p.m) < 1e-9;
    const comparableDirs = DIRECTIONS.filter((_, i) => directionComparable(x, p, i)).length;
    if (sameTotal && comparableDirs === DIRECTIONS.length) return {level: 'high', label: 'Высокая', text: 'Структура оценки сопоставима'};
    return {level: 'medium', label: 'Средняя', text: `Нормированная оценка сопоставима; одинаковый максимум у ${comparableDirs} из 12 направлений`};
  };
  function networkRows(data = state.data) {
    const pm = previousMap();
    const rfAverage = mean(state.data.map(getVal));
    return data.map(x => {
      const p = pm.get(normalize(x.n));
      const value = getVal(x), rankNow = getRank(x), valuePrev = prevValue(p), rankPrev = prevRank(p);
      const deltaScore = num(value) && num(valuePrev) ? (value - valuePrev) * 100 : null;
      const deltaRank = num(rankNow) && num(rankPrev) ? rankPrev - rankNow : null;
      const weak = (x.d || []).map((d, i) => ({i, value: d?.[1]})).filter(d => num(d.value) && d.value < CFG.weakDirection);
      const repeatWeak = weak.filter(d => num(p?.d?.[d.i]?.[1]) && p.d[d.i][1] < CFG.weakDirection);
      const ppkImpact = num(x.cv) && num(x.v) ? (x.cv - x.v) * 100 : null;
      const attentionReasons = [];
      if (getScale(x) === 'Низкая') attentionReasons.push('низкая рейтинговая шкала');
      if (num(deltaRank) && deltaRank <= -CFG.rankFall) attentionReasons.push(`снижение на ${Math.abs(deltaRank)} мест`);
      if (num(deltaScore) && deltaScore <= CFG.scoreFall) attentionReasons.push(`оценка снизилась на ${Math.abs(deltaScore).toFixed(1).replace('.', ',')} п.п.`);
      if (weak.length >= CFG.attentionWeak) attentionReasons.push(`${weak.length} слабых направлений`);
      if (weak.length >= 3 && ((num(deltaScore) && deltaScore < -CFG.eps) || (num(deltaRank) && deltaRank < 0))) attentionReasons.push('слабость усиливается отрицательной динамикой');
      let status = attentionReasons.length ? 'attention' : 'stable';
      const watchReasons = [];
      if (status === 'stable') {
        if (num(value) && num(rfAverage) && value < rfAverage) watchReasons.push('ниже среднего РФ');
        if (num(deltaRank) && deltaRank < 0) watchReasons.push('место снизилось');
        if (weak.length >= 2) watchReasons.push(`${weak.length} слабых направления`);
        if (num(ppkImpact) && Math.abs(ppkImpact) >= CFG.ppkImpact) watchReasons.push(`влияние ППК ${pp(ppkImpact)}`);
        if (watchReasons.length) status = 'watch';
      }
      return {x, p, value, rank: rankNow, previousValue: valuePrev, previousRank: rankPrev, deltaScore, deltaRank, weak, weakCount: weak.length, repeatWeak, ppkImpact, status, reasons: attentionReasons.length ? attentionReasons : watchReasons, comparable: comparability(x, p)};
    });
  }
  function systemDirections(data = state.data) {
    const pm = previousMap();
    return DIRECTIONS.map((name, i) => {
      const applicableRows = data.filter(x => num(x.d?.[i]?.[1]));
      const values = applicableRows.map(x => x.d[i][1]);
      const below = values.filter(v => v < CFG.weakDirection).length;
      const avg = mean(values);
      const comparablePairs = applicableRows.map(x => {
        const p = pm.get(normalize(x.n));
        return directionComparable(x, p, i) ? [x.d[i][1], p.d[i][1]] : null;
      }).filter(Boolean);
      const prevAvg = mean(comparablePairs.map(z => z[1]));
      const currentAvg = mean(comparablePairs.map(z => z[0]));
      const delta = num(currentAvg) && num(prevAvg) ? (currentAvg - prevAvg) * 100 : null;
      const share = applicableRows.length ? below / applicableRows.length : 0;
      return {i, name, avg, applicable: applicableRows.length, below, share, delta, comparableCount: comparablePairs.length, system: applicableRows.length >= 10 && (avg < CFG.weakDirection || share >= CFG.systemShare)};
    }).filter(x => num(x.avg)).sort((a, b) => Number(b.system) - Number(a.system) || b.share - a.share || a.avg - b.avg);
  }
  function systemIndicators(data = state.data) {
    return state.indicatorMeta.map(meta => {
      const rows = data.map(x => ({x, a: state.indicatorData[x.n]?.[meta.id - 1]})).filter(z => z.a && num(z.a[3]) && num(meta.maxScore) && meta.maxScore > 0);
      const red = rows.filter(z => z.a[3] / meta.maxScore <= .25).length;
      return {meta, applicable: rows.length, red, share: rows.length ? red / rows.length : 0, system: rows.length >= 10 && red / rows.length >= CFG.indicatorRedShare};
    }).filter(x => x.system).sort((a, b) => b.share - a.share || b.red - a.red);
  }
  function anomalyRows(rows) {
    const scoreMagnitude = rows.map(r => Math.abs(r.deltaScore)).filter(num);
    const rankMagnitude = rows.map(r => Math.abs(r.deltaRank)).filter(num);
    const scoreLimit = Math.max(3, percentile(scoreMagnitude, .95) || 0);
    const rankLimit = Math.max(10, percentile(rankMagnitude, .95) || 0);
    const result = [];
    rows.forEach(r => {
      if (num(r.deltaScore) && num(r.deltaRank) && r.deltaScore > CFG.eps && r.deltaRank < 0) result.push({...r, anomaly: 'Оценка ↑, место ↓', importance: 'Высокая', explanation: 'Другие ТО росли быстрее'});
      if (num(r.deltaScore) && num(r.deltaRank) && r.deltaScore < -CFG.eps && r.deltaRank > 0) result.push({...r, anomaly: 'Оценка ↓, место ↑', importance: 'Средняя', explanation: 'Система снижалась быстрее'});
      if (num(r.deltaRank) && Math.abs(r.deltaRank) >= rankLimit) result.push({...r, anomaly: 'Резкое изменение места', importance: 'Высокая', explanation: `Порог периода: ${Math.round(rankLimit)} мест`});
      if (num(r.deltaScore) && Math.abs(r.deltaScore) >= scoreLimit) result.push({...r, anomaly: 'Резкое изменение оценки', importance: 'Высокая', explanation: `Порог периода: ${scoreLimit.toFixed(1).replace('.', ',')} п.п.`});
      if (r.comparable.level === 'medium') result.push({...r, anomaly: 'Изменение структуры оценки', importance: 'Информация', explanation: r.comparable.text});
    });
    const importanceOrder = {Высокая: 0, Средняя: 1, Информация: 2};
    return result.sort((a, b) => (importanceOrder[a.importance] ?? 9) - (importanceOrder[b.importance] ?? 9) || Math.abs(b.deltaRank || 0) - Math.abs(a.deltaRank || 0));
  }
  function scenarioRank(value) {
    if (!num(value)) return null;
    const thresholds = state.data.filter(x => num(getRank(x)) && num(getVal(x))).map(x => ({rank: getRank(x), value: getVal(x)})).sort((a, b) => a.rank - b.rank || b.value - a.value);
    const hit = thresholds.find(t => value + 1e-12 >= t.value);
    return hit?.rank ?? thresholds[thresholds.length - 1]?.rank ?? null;
  }
  function reserveFor(x) {
    const peers = state.data.filter(z => z.fo === x.fo && z.n !== x.n);
    const details = state.indicatorMeta.map(meta => {
      const a = state.indicatorData[x.n]?.[meta.id - 1];
      if (!a || !num(a[3]) || !num(meta.maxScore)) return null;
      const peerScores = peers.map(z => state.indicatorData[z.n]?.[meta.id - 1]?.[3]).filter(num);
      const rfScores = state.data.map(z => state.indicatorData[z.n]?.[meta.id - 1]?.[3]).filter(num);
      const target = medianOf(peerScores.length >= 5 ? peerScores : rfScores);
      if (!num(target)) return null;
      const reserve = Math.max(0, Math.min(meta.maxScore - a[3], target - a[3]));
      return {meta, current: a[3], max: meta.maxScore, target, reserve};
    }).filter(Boolean).sort((a, b) => b.reserve - a.reserve);
    const total = details.reduce((s, d) => s + d.reserve, 0);
    const potential = num(x.s) && num(x.m) ? Math.min(1, (x.s + total) / x.m) : null;
    return {details, total, potential, rank: scenarioRank(potential)};
  }
  function benchmarkFor(x) {
    const candidates = state.data.filter(z => z.n !== x.n && num(z.r) && num(x.r) && z.r < x.r && num(z.v));
    return candidates.map(z => {
      const common = DIRECTIONS.filter((_, i) => num(x.d?.[i]?.[1]) && num(z.d?.[i]?.[1])).length;
      const applicable = DIRECTIONS.filter((_, i) => num(x.d?.[i]?.[1]) || num(z.d?.[i]?.[1])).length;
      const similarity = applicable ? common / applicable : 0;
      if (common < 8 || similarity < .8) return null;
      const rankDistance = num(x.pr) && num(z.pr) ? Math.min(1, Math.abs(z.pr - x.pr) / 82) : 1;
      const maxDistance = num(x.m) && num(z.m) ? Math.min(1, Math.abs(z.m - x.m) / Math.max(x.m, z.m, 1)) : 1;
      const distance = .35 * rankDistance + .30 * (1 - similarity) + .20 * maxDistance + .15 * (z.fo === x.fo ? 0 : 1);
      return {x: z, common, similarity, distance};
    }).filter(Boolean).sort((a, b) => a.distance - b.distance)[0] || null;
  }
  function overtakersFor(row, allRows) {
    if (!num(row.previousRank) || !num(row.rank)) return [];
    return allRows.filter(z => z.x.n !== row.x.n && num(z.previousRank) && num(z.rank) && z.previousRank > row.previousRank && z.rank < row.rank).sort((a, b) => (b.deltaScore || 0) - (a.deltaScore || 0));
  }
  function contextHtml(rows) {
    const levels = rows.map(r => r.comparable.level);
    const level = levels.includes('low') ? 'low' : levels.includes('medium') ? 'medium' : 'high';
    const label = level === 'high' ? 'Высокая' : level === 'medium' ? 'Средняя' : 'Низкая';
    const filterBits = [];
    if ($('#foFilter')?.value !== 'all') filterBits.push($('#foFilter').value);
    if ($('#scaleFilter')?.value !== 'all') filterBits.push($('#scaleFilter').value);
    const search = $('#searchInput')?.value?.trim();
    if (search) filterBits.push(`поиск: ${search}`);
    return `<div class="rr-context"><span><b>Период</b>${esc(shortPeriod(state.meta?.period))}</span><span><b>Режим</b>${esc(metricLabel())}</span><span><b>Дата данных</b>${sourceDate()}</span><span><b>Выборка</b>${filterBits.length ? esc(filterBits.join(' · ')) : `все ТО · ${rows.length}`}</span><span class="rr-quality ${level}"><b>Сопоставимость</b>${label}<i title="Изменение максимальных баллов учитывается отдельно">i</i></span></div>`;
  }
  function statusBadge(status) { return `<span class="rr-status ${status}">${statusMeta[status].label}</span>`; }
  const focusTitles = {mean: 'Средняя оценка по РФ', scoreUp: 'ТО с ростом оценки', scoreDown: 'ТО со снижением оценки', rankUp: 'ТО с ростом места', rankDown: 'ТО со снижением места', anomalies: 'Все аномалии периода', paradox: 'Оценка выросла, место снизилось', stable: 'Стабильные ТО', watch: 'ТО в наблюдении', attention: 'ТО, требующие внимания', systems: 'Системные направления'};
  function focusBanner(focus, count) {
    return focus ? `<div class="rr-focus-banner"><span><b>Фокус:</b> ${esc(focusTitles[focus] || focus)} · ${count} записей</span><button data-rr-clear-focus type="button">Показать всё</button></div>` : '';
  }
  function bindCommon(root) {
    if (root.id === 'comparisonDashboard' || root.id === 'analyticsDashboard') root.querySelectorAll('.rr-analytics-summary article').forEach((card, i) => { const comparison = root.id === 'comparisonDashboard'; const focusByCard = comparison ? ['scoreUp', 'scoreDown', 'rankUp', 'anomalies'] : ['stable', 'watch', 'attention', 'paradox']; card.dataset.rrView = comparison ? 'comparison' : (i === 3 ? 'analytics' : 'risk'); card.dataset.rrFocus = focusByCard[i]; card.classList.add('rr-summary-link'); });
    root.querySelectorAll('[data-rr-view]').forEach(b => b.onclick = () => { state.rrFocus = b.dataset.rrFocus || null; if (b.dataset.rrRegion) state.region = b.dataset.rrRegion; setView(b.dataset.rrView); });
    root.querySelectorAll('[data-rr-region]:not([data-rr-view])').forEach(b => b.onclick = () => { state.rrFocus = null; state.region = b.dataset.rrRegion; setView('region'); });
    root.querySelectorAll('[data-rr-dir]').forEach(b => b.onclick = () => { state.rrFocus = null; state.direction = +b.dataset.rrDir; state.indicator = state.indicatorMeta.find(m => m.d === state.direction)?.id || null; setView('directions'); });
    root.querySelectorAll('[data-rr-clear-focus]').forEach(b => b.onclick = () => { state.rrFocus = null; setView(state.view); });
  }
  function renderUnifiedOverview(data) {
    const root = $('#overviewDashboard');
    const rows = networkRows(data), allRows = networkRows(state.data), systems = systemDirections(data);
    const values = rows.map(r => r.value).filter(num), previousValues = rows.map(r => r.previousValue).filter(num);
    const avg = mean(values), previousAvg = mean(previousValues), averageDelta = num(avg) && num(previousAvg) ? (avg - previousAvg) * 100 : null;
    const improvedRank = rows.filter(r => num(r.deltaRank) && r.deltaRank > 0), fallenRank = rows.filter(r => num(r.deltaRank) && r.deltaRank < 0);
    const paradox = rows.filter(r => num(r.deltaScore) && r.deltaScore > CFG.eps && num(r.deltaRank) && r.deltaRank < 0);
    const counts = {stable: rows.filter(r => r.status === 'stable').length, watch: rows.filter(r => r.status === 'watch').length, attention: rows.filter(r => r.status === 'attention').length};
    const attention = rows.filter(r => r.status === 'attention').sort((a, b) => b.weakCount - a.weakCount || a.value - b.value).slice(0, 8);
    const biggestRankFall = rows.filter(r => num(r.deltaRank)).sort((a, b) => a.deltaRank - b.deltaRank)[0];
    const biggestRankRise = rows.filter(r => num(r.deltaRank) && r.deltaRank > 0).sort((a, b) => b.deltaRank - a.deltaRank)[0];
    const rfCurrent = mean(allRows.map(r => r.value)), rfPrevious = mean(allRows.map(r => r.previousValue));
    const rfDelta = num(rfCurrent) && num(rfPrevious) ? (rfCurrent - rfPrevious) * 100 : null;
    const comparableRows = rows.filter(r => num(r.deltaScore));
    const fastest = comparableRows.filter(r => num(rfDelta) && r.deltaScore > rfDelta + CFG.eps).length;
    const achievementLevels = [
      {key: 'high', label: 'Высокая степень достижения', scale: 'Высокая', description: 'Соответствуют целевым показателям в полной мере'},
      {key: 'medium', label: 'Средняя степень достижения', scale: 'Средняя', description: 'Требуют дальнейшего развития по отдельным показателям'},
      {key: 'low', label: 'Низкая степень достижения', scale: 'Низкая', description: 'Имеют существенные резервы для повышения эффективности'}
    ].map(level => ({...level, regions: data.filter(x => num(getRank(x)) && getScale(x) === level.scale).map(x => x.n).sort((a, b) => a.localeCompare(b, 'ru'))})).map(level => ({...level, count: level.regions.length}));
    const leaders = rows.filter(r => num(r.rank)).slice().sort((a, b) => {
      if (num(a.rank) && num(b.rank) && a.rank !== b.rank) return a.rank - b.rank;
      if (num(a.rank) !== num(b.rank)) return num(a.rank) ? -1 : 1;
      return (b.value ?? -1) - (a.value ?? -1);
    }).slice(0, 5).map((leader, index, list) => ({
      ...leader,
      // Use the official source rank; rounded percentages must not create false ties.
      displayRank: leader.rank
    }));
    const scoreValues = rows.map(r => r.value * 100).filter(num);
    const scoreMedian = medianOf(scoreValues);
    const scoreMin = scoreValues.length ? Math.min(...scoreValues) : null;
    const scoreMax = scoreValues.length ? Math.max(...scoreValues) : null;
    const scoreBins = [
      {label: 'до 85%', min: -Infinity, max: 85},
      {label: '85–90%', min: 85, max: 90},
      {label: '90–95%', min: 90, max: 95},
      {label: '95–98%', min: 95, max: 98},
      {label: '98–100%', min: 98, max: 100},
      {label: '100%+', min: 100, max: Infinity}
    ].map((bin, index, bins) => ({...bin, count: scoreValues.filter(value => index === bins.length - 1 ? value >= bin.min : value >= bin.min && value < bin.max).length}));
    const matrixZones = [
      {key: 'high-rise', title: 'Высокий результат + рост', description: 'Лидеры, которые продолжают усиливаться.', rows: rows.filter(r => num(r.value) && r.value >= avg && num(r.deltaRank) && r.deltaRank > 0), tone: 'positive'},
      {key: 'high-fall', title: 'Высокий результат + снижение', description: 'Формально сильные, но требуют внимания к устойчивости результата.', rows: rows.filter(r => num(r.value) && r.value >= avg && (!num(r.deltaRank) || r.deltaRank <= 0)), tone: 'watch'},
      {key: 'low-rise', title: 'Низкий результат + рост', description: 'Есть потенциал и положительная динамика.', rows: rows.filter(r => num(r.value) && r.value < avg && num(r.deltaRank) && r.deltaRank > 0), tone: 'watch'},
      {key: 'low-fall', title: 'Низкий результат + снижение', description: 'Основная зона управленческого внимания.', rows: rows.filter(r => num(r.value) && r.value < avg && (!num(r.deltaRank) || r.deltaRank <= 0)), tone: 'attention'}
    ];
    const fo = [...new Set(data.map(x => x.fo))].map(name => {
      const group = data.filter(x => x.fo === name);
      return {name, avg: mean(group.map(getVal)), ppkAvg: mean(group.map(x => x.ppv)), combinedAvg: mean(group.map(x => x.cv)), count: group.length};
    }).sort((a, b) => b.avg - a.avg);
    const ppkRows = data.filter(x => num(x.v) && num(x.ppv));
    const toAverage = mean(ppkRows.map(x => x.v)), ppkAverage = mean(ppkRows.map(x => x.ppv));
    const ppkZones = [
      {key: 'to-high-ppk-high', title: 'Оба сильные', description: 'И ТО, и ППК выше среднего. Это наиболее устойчивая группа.', rows: ppkRows.filter(x => x.v >= toAverage && x.ppv >= ppkAverage), tone: 'positive'},
      {key: 'to-high-ppk-low', title: 'ППК тянет вниз', description: 'ТО выше среднего, но ППК ниже среднего и тянет комплексный результат вниз.', rows: ppkRows.filter(x => x.v >= toAverage && x.ppv < ppkAverage), tone: 'watch'},
      {key: 'to-low-ppk-high', title: 'ТО тянет вниз', description: 'ППК выше среднего, а сам результат ТО слабее среднего.', rows: ppkRows.filter(x => x.v < toAverage && x.ppv >= ppkAverage), tone: 'watch'},
      {key: 'to-low-ppk-low', title: 'Оба требуют внимания', description: 'Оба компонента ниже среднего. Это приоритетная зона управленческого внимания.', rows: ppkRows.filter(x => x.v < toAverage && x.ppv < ppkAverage), tone: 'attention'}
    ];
    const directionSummary = systems.slice().sort((a, b) => b.avg - a.avg);
    const directionAxisMax = Math.max(10, Math.ceil(Math.max(...directionSummary.map(x => x.below), 0) * 1.15 / 5) * 5);
    const heatRows = rows.slice().sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
    root.innerHTML = `<div class="rr-page-head"><div><h2>Лидеры рейтинга</h2></div></div>
      <div class="rr-leaders-row">${leaders.map(leader => `<button class="rr-top-leader" data-rr-region="${esc(leader.x.n)}"><span class="rr-leader-medal" data-place="${leader.displayRank}"><b>${rank(leader.displayRank)}</b><small>место</small></span><span class="rr-leader-copy"><strong>${esc(leader.x.n)}</strong><span>${esc(leader.x.fo)}</span></span><strong class="rr-top-score">${pct(leader.value)}</strong><span class="rr-top-delta ${deltaClass(leader.deltaScore)}">${pp(leader.deltaScore)} за квартал</span></button>`).join('')}</div>
      <section class="rr-achievement"><div class="rr-achievement-heading"><span class="rr-kicker">УРОВЕНЬ ДОСТИЖЕНИЯ</span></div><div class="rr-achievement-grid">${achievementLevels.map(level => `<button class="rr-achievement-card is-${level.key}" data-rr-level="${level.scale}" aria-expanded="false"><span class="rr-achievement-icon" aria-hidden="true"><i></i><i></i><i></i></span><span class="rr-achievement-copy"><strong>${level.label}</strong><span><b>${level.count}</b><em>ТО</em></span><small>${level.description}</small></span><span class="rr-achievement-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="rr-achievement-open">Показать регионы ↓</span></button>`).join('')}</div><div id="rrAchievementRegions" class="rr-achievement-regions" hidden></div></section>
      <section class="rr-panel rr-signals rr-signals-top"><div class="rr-panel-head"><div><span class="rr-kicker">КЛЮЧЕВЫЕ СИГНАЛЫ</span><h3>Изменения, требующие внимания</h3></div></div><div class="rr-signal-grid">
        <button class="rr-signal-card rr-paradox-kpi" data-rr-view="${paradox.length === 1 ? 'region' : 'analytics'}" data-rr-focus="paradox" ${paradox.length === 1 ? `data-rr-region="${esc(paradox[0].x.n)}"` : ''}><span class="rr-viz-title">Аномалии</span><strong class="rr-big-number">${paradox.length}</strong><span>ТО с ростом оценки и снижением места</span><small>Из ${rows.length} ТО в выборке · открыть разбор →</small></button>
        <button class="rr-signal-card rr-decline-card" ${biggestRankFall ? `data-rr-region="${esc(biggestRankFall.x.n)}"` : ''}><span class="rr-viz-title">Максимальное снижение места</span><strong class="rr-big-number rr-change-negative">${biggestRankFall ? `${Math.round(biggestRankFall.deltaRank)}` : 'Нет'}</strong><span class="rr-kpi-unit">мест</span><span>${biggestRankFall ? esc(biggestRankFall.x.n) : 'Снижение не выявлено'}</span><small class="rr-change-negative">${biggestRankFall ? `${rank(biggestRankFall.previousRank)} → ${rank(biggestRankFall.rank)} место` : 'Нет сопоставимых данных'}</small></button>
        <button class="rr-signal-card rr-rank-rise-card" ${biggestRankRise ? `data-rr-region="${esc(biggestRankRise.x.n)}"` : ''}><span class="rr-viz-title">Максимальный рост места</span><strong class="rr-big-number rr-change-positive">${biggestRankRise ? `+${Math.round(biggestRankRise.deltaRank)}` : 'Нет'}</strong><span class="rr-kpi-unit">мест</span><span>${biggestRankRise ? esc(biggestRankRise.x.n) : 'Рост не выявлен'}</span><small class="rr-change-positive">${biggestRankRise ? `${rank(biggestRankRise.previousRank)} → ${rank(biggestRankRise.rank)} место` : 'Нет сопоставимых данных'}</small></button>
        <div class="rr-signal-card rr-fast-card"><span class="rr-viz-title">Растут быстрее РФ</span><strong class="rr-fast-number">${fastest}</strong><span class="rr-fast-summary">из ${rows.length} ТО</span><small>${fastest} ТО показали рост оценки выше среднего РФ (${pp(rfDelta)}); порог сравнения ${CFG.eps.toFixed(2).replace('.', ',')} п.п.</small></div>
      </div></section>
      <section class="rr-kpi-visual">
        <button class="rr-score-gauge rr-score-circle" data-rr-view="comparison" data-rr-focus="mean"><span class="rr-viz-title">Средняя оценка</span><span id="rrScoreBar" class="rr-score-bar" role="img" aria-label="Средняя оценка ${pct(avg)}, предыдущий квартал ${pct(previousAvg)}"></span><span class="rr-quarter-move"><b>${shortPeriod(state.previousMeta?.period) || 'Прошлый квартал'} <strong>${pct(previousAvg)}</strong></b><i>→</i><b>${shortPeriod(state.meta?.period)} <strong>${pct(avg)}</strong></b></span><b class="${deltaClass(averageDelta)}">${pp(averageDelta)} за квартал</b></button>
        <div class="rr-progress-viz"><span class="rr-viz-title">Как изменились места ТО</span><p class="rr-movement-note">Сравнение с ${shortPeriod(state.previousMeta?.period) || 'прошлым кварталом'}: сколько территориальных органов поднялись и опустились в рейтинге.</p><div class="rr-movement-kpis">${[
          ['rankUp', 'Поднялись в рейтинге', improvedRank.length, '↑'],
          ['rankDown', 'Опустились в рейтинге', fallenRank.length, '↓']
        ].map(([focus, label, count, icon]) => `<button class="rr-movement-kpi ${focus === 'rankDown' ? 'down' : ''}" data-rr-view="comparison" data-rr-focus="${focus}"><i class="rr-movement-icon" aria-hidden="true">${icon}</i><span>${label}</span><strong>${count}</strong><small>ТО</small></button>`).join('')}</div></div>
      </section>
      <section class="rr-panel rr-rank-distribution"><div class="rr-panel-head"><div><span class="rr-kicker">РАСПРЕДЕЛЕНИЕ РЕЗУЛЬТАТОВ</span><h3>Распределение результатов</h3><p>Нажмите на столбец, чтобы открыть список регионов в диапазоне.</p></div><div class="rr-distribution-stats"><span tabindex="0" title="Медиана — центральная оценка в текущей выборке. Оценки сортируются по возрастанию; при нечётном количестве берётся средняя по порядку, при чётном — среднее двух центральных оценок. Учитываются выбранный режим оценки и фильтры.">Медиана <b>${num(scoreMedian) ? `${scoreMedian.toFixed(2).replace('.', ',')}%` : '—'}</b></span><span tabindex="0" title="Разброс — разница между максимальной и минимальной оценками ТО в текущей выборке: максимум − минимум. Измеряется в процентных пунктах (п.п.). Учитываются выбранный режим оценки и фильтры.">Разброс <b>${num(scoreMin) && num(scoreMax) ? `${(scoreMax - scoreMin).toFixed(1).replace('.', ',')} п.п.` : '—'}</b></span><span tabindex="0" title="Количество ТО, у которых выбранная оценка строго ниже 90%. Оценка ровно 90% не включается. Учитываются текущие фильтры.">Ниже 90% <b>${scoreValues.filter(value => value < 90).length}</b></span></div></div><div id="rrRankDistribution" class="rr-chart rr-rank-chart"></div><div id="rrDistributionRegionList" class="rr-matrix-region-list" hidden></div></section>
      <div class="rr-state-grid"><section class="rr-panel rr-network"><div class="rr-panel-head"><div><span class="rr-kicker">СОСТОЯНИЕ СЕТИ</span><h3>Единая классификация ТО</h3><p>Распределение территориальных органов по текущему статусу</p></div></div><div class="rr-network-visual"><div class="rr-network-donut" role="img" aria-label="Стабильно: ${counts.stable}; наблюдение: ${counts.watch}; требуют внимания: ${counts.attention}" style="--rr-stable-end:${rows.length ? counts.stable / rows.length * 100 : 0}%;--rr-watch-end:${rows.length ? (counts.stable + counts.watch) / rows.length * 100 : 0}%"><div><strong>${rows.length}</strong></div></div><div class="rr-network-legend"><button data-rr-view="ranking" class="stable"><i></i><span>Стабильно<small>${rows.length ? Math.round(counts.stable / rows.length * 100) : 0}% выборки</small></span><b>${counts.stable}</b></button><button data-rr-view="risk" class="watch"><i></i><span>Наблюдение<small>${rows.length ? Math.round(counts.watch / rows.length * 100) : 0}% выборки</small></span><b>${counts.watch}</b></button><button data-rr-view="risk" class="attention"><i></i><span>Требуют внимания<small>${rows.length ? Math.round(counts.attention / rows.length * 100) : 0}% выборки</small></span><b>${counts.attention}</b></button></div></div></section></div>
      <section class="rr-panel rr-matrix"><div class="rr-panel-head"><div><span class="rr-kicker">МАТРИЦА «РЕЗУЛЬТАТ × ДИНАМИКА»</span><h3>Высокий/низкий результат и изменение места</h3><p>Нажмите на кнопку, чтобы раскрыть четыре зоны и список территориальных органов.</p></div></div><div class="rr-collapsible-control"><button type="button" class="rr-toggle-button" data-rr-toggle-target="rrMatrixZonesWrap" data-rr-closed-label="Показать зоны матрицы" data-rr-open-label="Скрыть зоны матрицы" aria-expanded="false">Показать зоны матрицы ↓</button></div><div id="rrMatrixZonesWrap" class="rr-collapsible-content" hidden><div class="rr-zone-matrix">${matrixZones.map(zone => `<button class="rr-zone-card ${zone.tone}" data-rr-matrix-zone="${zone.key}" aria-expanded="false"><strong>${zone.rows.length}</strong><h4>${zone.title}</h4><p>${zone.description}</p><span>Нажмите, чтобы открыть список ТО →</span></button>`).join('')}</div><div id="rrMatrixRegionList" class="rr-matrix-region-list" hidden></div></div><div class="rr-matrix-secondary"><h4>Точечная схема ТО</h4><p>По горизонтали — текущий результат, по вертикали — изменение оценки к прошлому кварталу.</p><div id="rrScatter" class="rr-chart rr-chart-scatter"></div></div><details class="rr-matrix-guide"><summary>Как читать матрицу</summary><p>Порог результата — средняя оценка текущей выборки (${pct(avg)}). Рост означает улучшение места: предыдущее место больше текущего.</p><p>Зона «снижение» включает ТО без сопоставимого прошлого места, чтобы четыре зоны покрывали всю выборку из ${rows.length} ТО.</p></details></section>
      <div class="rr-bottom-grid rr-chart-grid"><section class="rr-panel"><div class="rr-panel-head"><div><span class="rr-kicker">ПРИОРИТЕТ ВМЕШАТЕЛЬСТВА</span><h3>Слабые направления по ТО</h3><p>Чем длиннее полоса, тем больше направлений требуют работы</p></div></div><div id="rrPriorityChart" class="rr-chart rr-chart-bars"></div></section><section class="rr-panel"><div class="rr-panel-head"><div><span class="rr-kicker">МАССОВЫЕ ОТКЛОНЕНИЯ</span><h3>ТО ниже 90% по направлениям</h3><p>Количество территориальных органов ниже целевого уровня</p></div></div><div id="rrSystemsChart" class="rr-chart rr-chart-bars"></div></section></div>
      <section class="rr-panel rr-ppk-zones"><div class="rr-panel-head"><div><span class="rr-kicker">ТО И ППК: ЧЕТЫРЕ ЗОНЫ</span><h3>Влияние двух компонентов</h3><p>Ось X — оценка ТО, ось Y — оценка ППК. Пунктирные линии показывают средние значения выборки.</p></div></div><div id="rrOverviewPpkScatter" class="rr-chart rr-ppk-scatter"></div><div class="rr-collapsible-control"><button type="button" class="rr-toggle-button" data-rr-toggle-target="rrOverviewPpkZonesWrap" data-rr-closed-label="Показать зоны ТО и ППК" data-rr-open-label="Скрыть зоны ТО и ППК" aria-expanded="false">Показать зоны ТО и ППК ↓</button></div><div id="rrOverviewPpkZonesWrap" class="rr-collapsible-content" hidden><div class="rr-zone-card-grid">${ppkZones.map(zone => `<button class="rr-ppk-zone-card ${zone.tone}" data-rr-ppk-zone-overview="${zone.key}" aria-expanded="false"><strong>${zone.rows.length}</strong><h4>${zone.title}</h4><p>${zone.description}</p><span>Нажмите, чтобы открыть список ТО →</span></button>`).join('')}</div><div id="rrOverviewPpkRegionList" class="rr-matrix-region-list" hidden></div></div></section>
      <div class="rr-bottom-grid"><section class="rr-panel"><div class="rr-panel-head"><div><span class="rr-kicker">ФЕДЕРАЛЬНЫЕ ОКРУГА</span><h3>Средний результат по ФО</h3><p>ТО, ППК и комплексная оценка по каждому округу.</p></div></div><div id="rrOverviewFoChart" class="rr-chart"></div></section><section class="rr-panel rr-directions-zones"><div class="rr-panel-head"><div><span class="rr-kicker">НАПРАВЛЕНИЯ — ЗОНЫ ВНИМАНИЯ</span><h3>Среднее и количество ТО ниже 90%</h3><p>Столбцы показывают среднее направление, линия — число ТО ниже порога.</p></div></div><div id="rrOverviewDirectionZones" class="rr-chart"></div><div class="rr-direction-legend" aria-label="Легенда графика направлений"><span><i class="bar"></i>Среднее</span><span><i class="line"></i>ТО ниже 90%</span></div></section></div>
      <section class="rr-panel rr-heatmap-panel"><div class="rr-panel-head"><div><span class="rr-kicker">ТЕПЛОВАЯ КАРТА «ТО × НАПРАВЛЕНИЯ»</span><h3>Распределение сильных и слабых мест</h3></div></div><div class="rr-heatmap-wrap"><table class="rr-heatmap"><thead><tr><th>Регион</th>${DIRECTIONS.map((name, i) => `<th title="${esc(name)}">${esc(SHORT[i])}</th>`).join('')}</tr></thead><tbody>${heatRows.map(row => `<tr data-rr-region="${esc(row.x.n)}"><th><strong>${esc(row.x.n)}</strong><small>${rank(row.rank)} место</small></th>${DIRECTIONS.map((_, i) => { const value = row.x.d?.[i]?.[1]; const cls = num(value) ? value >= .97 ? 'good' : value >= .90 ? 'mid' : 'low' : 'na'; return `<td><span class="rr-heat-cell ${cls}">${num(value) ? `${(value * 100).toFixed(2)}%` : '—'}</span></td>`; }).join('')}</tr>`).join('')}</tbody></table></div><div class="rr-heatmap-legend"><span><i class="good"></i>97% и выше</span><span><i class="mid"></i>90–96%</span><span><i class="low"></i>ниже 90%</span></div></section>
      `;
    const overviewAnomalies = anomalyRows(rows).filter(a => a.anomaly !== 'Изменение структуры оценки');
    const anomalyCard = root.querySelector('.rr-paradox-kpi');
    if (anomalyCard) {
      anomalyCard.dataset.rrView = 'comparison';
      anomalyCard.dataset.rrFocus = 'anomalies';
      anomalyCard.removeAttribute('data-rr-region');
      const anomalyNumber = anomalyCard.querySelector('.rr-big-number');
      if (anomalyNumber) anomalyNumber.textContent = overviewAnomalies.length;
      const anomalyDescription = anomalyCard.querySelectorAll(':scope > span')[1];
      if (anomalyDescription) anomalyDescription.textContent = 'Нетипичные изменения периода';
      const anomalyNote = anomalyCard.querySelector('small');
      if (anomalyNote) anomalyNote.textContent = `${overviewAnomalies.length} событий · открыть динамику →`;
      anomalyCard.title = 'Открыть динамику и показать все аномалии периода';
    }
    root.querySelectorAll('.rr-network-legend button').forEach((b, i) => { b.dataset.rrView = 'risk'; b.dataset.rrFocus = ['stable', 'watch', 'attention'][i] || 'all'; });
    bindCommon(root);
    root.querySelectorAll('[data-rr-toggle-target]').forEach(toggle => {
      const target = root.querySelector(`#${toggle.dataset.rrToggleTarget}`);
      if (!target) return;
      toggle.onclick = () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!open));
        target.hidden = open;
        toggle.textContent = open ? `${toggle.dataset.rrClosedLabel || 'Показать'} ↓` : `${toggle.dataset.rrOpenLabel || 'Скрыть'} ↑`;
        if (open) {
          target.querySelectorAll('[aria-expanded="true"]').forEach(item => item.setAttribute('aria-expanded', 'false'));
          target.querySelectorAll('.rr-matrix-region-list').forEach(list => { list.hidden = true; list.innerHTML = ''; });
        }
      };
    });
    const achievementPanel = $('#rrAchievementRegions');
    root.querySelectorAll('.rr-achievement-card').forEach(card => {
      card.onclick = () => {
        const level = achievementLevels.find(item => item.scale === card.dataset.rrLevel);
        const alreadyOpen = card.getAttribute('aria-expanded') === 'true';
        root.querySelectorAll('.rr-achievement-card').forEach(item => { item.setAttribute('aria-expanded', 'false'); const label = item.querySelector('.rr-achievement-open'); if (label) label.textContent = 'Показать регионы ↓'; });
        if (alreadyOpen || !level) {
          achievementPanel.hidden = true;
          achievementPanel.innerHTML = '';
          return;
        }
        card.setAttribute('aria-expanded', 'true');
        const openLabel = card.querySelector('.rr-achievement-open');
        if (openLabel) openLabel.textContent = 'Скрыть регионы ↑';
        achievementPanel.hidden = false;
        achievementPanel.innerHTML = `<div class="rr-achievement-regions-heading"><strong>${esc(level.label)}</strong><small>${level.count} ТО · по алфавиту</small></div><div class="rr-achievement-region-list">${level.regions.map(name => `<button type="button" data-region="${esc(name)}">${esc(name)}</button>`).join('')}</div>`;
        const regionButtons = achievementPanel.querySelectorAll('[data-region]');
        regionButtons.forEach(button => button.addEventListener('click', () => { state.region = button.dataset.region; setView('region'); }));
      };
    });
    const matrixList = $('#rrMatrixRegionList');
    root.querySelectorAll('[data-rr-matrix-zone]').forEach(card => {
      card.onclick = () => {
        const zone = matrixZones.find(item => item.key === card.dataset.rrMatrixZone);
        const alreadyOpen = card.getAttribute('aria-expanded') === 'true';
        root.querySelectorAll('[data-rr-matrix-zone]').forEach(item => item.setAttribute('aria-expanded', 'false'));
        if (alreadyOpen || !zone) { if (matrixList) { matrixList.hidden = true; matrixList.innerHTML = ''; } return; }
        card.setAttribute('aria-expanded', 'true');
        if (!matrixList) return;
        matrixList.hidden = false;
        matrixList.innerHTML = `<div><strong>${esc(zone.title)}</strong><small>${zone.rows.length} ТО · средняя оценка ${pct(avg)}</small></div><div class="rr-matrix-region-buttons">${zone.rows.slice().sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999)).map(row => `<button data-region="${esc(row.x.n)}"><strong>${esc(row.x.n)}</strong><span>${rank(row.rank)} место · ${pct(row.value)}</span></button>`).join('') || '<span class="rr-empty">Нет сопоставимых записей</span>'}</div>`;
        matrixList.querySelectorAll('[data-region]').forEach(button => button.onclick = () => { state.region = button.dataset.region; setView('region'); });
      };
    });
    const statusHelp = {
      stable: 'Нет критериев внимания или наблюдения: оценка не ниже средней РФ, место не снизилось, менее 2 слабых направлений, влияние ППК менее 1 п.п.',
      watch: 'Нет критериев внимания, но есть хотя бы один признак: оценка ниже средней РФ, снижение места, 2+ направлений ниже 90% или влияние ППК от 1 п.п.',
      attention: 'Любой признак: низкая оценка; падение на 10+ мест; снижение от 3 п.п.; 4+ направлений ниже 90%; либо 3+ таких направлений вместе со снижением оценки более 0,05 п.п. или места.'
    };
    root.querySelectorAll('.rr-matrix-legend span, .rr-network-legend button').forEach(el => {
      const key = Object.keys(statusHelp).find(k => el.classList.contains(k));
      if (!key) return;
      el.tabIndex = 0;
      el.setAttribute('aria-label', el.textContent.trim() + '. ' + statusHelp[key]);
      const tip = document.createElement('span');
      tip.className = 'rr-status-help'; tip.setAttribute('role', 'tooltip'); tip.textContent = statusHelp[key];
      el.append(tip);
    });
    const scoreTrend = [num(previousAvg)?+(previousAvg*100).toFixed(2):0,num(avg)?+(avg*100).toFixed(2):0];
    chart($('#rrScoreBar'), {...chartBase(),grid:{left:8,right:18,top:24,bottom:10,containLabel:true},tooltip:{trigger:'axis',formatter:p=>`${p[0].axisValue}<br><b>${p[0].value.toFixed(2).replace('.', ',')}%</b>`},xAxis:{type:'category',data:[shortPeriod(state.previousMeta?.period) || 'Прошлый',shortPeriod(state.meta?.period) || 'Текущий'],axisTick:{show:false},axisLabel:{fontSize:10}},yAxis:{type:'value',min:v=>Math.floor(Math.min(v.min,90)),max:100,axisLabel:{fontSize:10,formatter:'{value}%'}},series:[{name:'Средняя оценка',type:'bar',barMaxWidth:46,barGap:'35%',z:2,label:{show:true,position:'top',fontWeight:850,formatter:p=>`${p.value.toFixed(2).replace('.', ',')}%`},data:scoreTrend.map((value,index)=>({value,itemStyle:{color:index===0?'#9bc8ef':'#087cf0',borderRadius:[8,8,0,0]}}))},{name:'Динамика',type:'line',data:scoreTrend,z:4,symbol:'circle',symbolSize:9,silent:true,lineStyle:{width:3,color:'#00bd91'},itemStyle:{color:'#fff',borderColor:'#00bd91',borderWidth:3}}]});
    const distributionChart = chart($('#rrRankDistribution'), {...chartBase(),grid:{left:52,right:28,top:30,bottom:44},tooltip:{trigger:'axis',axisPointer:{type:'shadow'},formatter:p=>`${p[0].axisValue}<br><b>${p[0].value} ТО</b><br><small>Нажмите, чтобы открыть список</small>`},xAxis:{type:'category',data:scoreBins.map(bin=>bin.label),axisTick:{alignWithLabel:true}},yAxis:{type:'value',minInterval:1,name:'Количество ТО'},series:[{type:'bar',barMaxWidth:52,label:{show:true,position:'top',fontWeight:800},data:scoreBins.map((bin,index)=>({value:bin.count,itemStyle:{color:index<2?'#ff9950':index<4?'#ffca62':'#18b89a',borderRadius:[9,9,0,0]}}))}]});
    distributionChart?.on('click', params => {
      const bin = scoreBins[params.dataIndex];
      const regionList = $('#rrDistributionRegionList');
      if (!bin || !regionList) return;
      const matched = rows.filter(r => num(r.value) && (params.dataIndex === scoreBins.length - 1 ? r.value * 100 >= bin.min : r.value * 100 >= bin.min && r.value * 100 < bin.max)).sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
      regionList.hidden = false;
      regionList.innerHTML = `<div><strong>${esc(bin.label)}</strong><small>${matched.length} ТО · нажмите на регион для открытия карточки</small></div><div class="rr-matrix-region-buttons">${matched.map(row => `<button data-region="${esc(row.x.n)}"><strong>${esc(row.x.n)}</strong><span>${rank(row.rank)} место · ${pct(row.value)}</span></button>`).join('') || '<span class="rr-empty">Нет записей</span>'}</div>`;
      regionList.querySelectorAll('[data-region]').forEach(button => button.onclick = () => { state.region = button.dataset.region; setView('region'); });
    });
    const scatterRows = rows.filter(r => num(r.value) && num(r.deltaScore));
    const scatterScores = scatterRows.map(r => r.value * 100);
    const averageScore = num(avg) ? avg * 100 : null;
    let scatterMin = Math.max(0, Math.floor(Math.min(...scatterScores, averageScore ?? 100) - 2));
    let scatterMax = Math.min(100, Math.ceil(Math.max(...scatterScores, averageScore ?? 0) + 1));
    if (scatterMax - scatterMin < 10) {
      const center = (scatterMin + scatterMax) / 2;
      scatterMin = Math.max(0, Math.floor(center - 5));
      scatterMax = Math.min(100, Math.ceil(center + 5));
    }
    chart($('#rrScatter'), {...chartBase(), grid: {left: 86, right: 38, top: 42, bottom: 64}, tooltip: {trigger: 'item', formatter: p => `<strong>${esc(p.data.name)}</strong><br>Оценка: ${p.data.value[0].toFixed(2)}%<br>Δ оценки: ${pp(p.data.value[1])}<br>${statusMeta[p.data.status].label}`}, xAxis: {type: 'value', min: scatterMin, max: scatterMax, splitNumber: 5, name: 'Текущая оценка', nameLocation: 'middle', nameGap: 42, axisLabel: {fontSize: 15, formatter: '{value}%'}}, yAxis: {type: 'value', name: 'Δ оценки', nameLocation: 'middle', nameGap: 46, nameRotate: 90, axisLabel: {fontSize: 15, formatter: '{value} п.п.'}}, series: [{type: 'scatter', symbolSize: 17, emphasis: {scale: 1.4}, data: scatterRows.map(r => ({name: r.x.n, status: r.status, value: [+(r.value * 100).toFixed(2), +r.deltaScore.toFixed(2), r.status === 'attention' ? 2 : 1], itemStyle: {color: r.status === 'attention' ? '#FF7900' : r.status === 'watch' ? '#2D93FF' : '#00CC99', opacity: .84}})), markLine: {silent: true, symbol: 'none', label: {show: false}, data: [{xAxis: num(averageScore) ? +averageScore.toFixed(2) : 0}, {yAxis: 0}], lineStyle: {color: '#71869a', type: 'dashed', width: 1.4}}}]});
    const priorityElement = $('#rrPriorityChart');
    priorityElement.style.height = `${Math.max(310, attention.length * 44 + 38)}px`;
    const priorityChart = chart(priorityElement, {...chartBase(), grid: {left: 8, right: 36, top: 10, bottom: 28, containLabel: true}, tooltip: {trigger: 'item', formatter: p => `<strong>${esc(p.data.fullName)}</strong><br>Слабых направлений: ${p.value}<br>${esc(p.data.reason || '')}`}, xAxis: {type: 'value', minInterval: 1, axisLabel: {formatter: '{value}'}}, yAxis: {type: 'category', inverse: true, data: attention.map(r => r.x.n), axisLabel: {width: 160, overflow: 'break', lineHeight: 16, margin: 10}}, series: [{type: 'bar', barWidth: 15, data: attention.map(r => ({value: r.weakCount, fullName: r.x.n, region: r.x.n, reason: r.reasons.slice(0, 2).join(' · '), itemStyle: {color: '#ff7900', borderRadius: [0, 8, 8, 0]}})), label: {show: true, position: 'right', formatter: '{c}', fontWeight: 800}}]});
    priorityChart?.on('click', p => { if (!p.data?.region) return; state.region = p.data.region; setView('region'); });
    const systemTop = systems.filter(x => x.system).slice(0, 6);
    const systemsChart = chart($('#rrSystemsChart'), {...chartBase(), grid: {left: 98, right: 36, top: 10, bottom: 28}, tooltip: {trigger: 'item', formatter: p => `<strong>${esc(p.data.fullName)}</strong><br>Ниже 90%: ${p.value} ТО<br>Среднее: ${pct(p.data.average)}`}, xAxis: {type: 'value', minInterval: 1, axisLabel: {formatter: '{value}'}}, yAxis: {type: 'category', inverse: true, data: systemTop.map(s => SHORT[s.i]), axisLabel: {fontWeight: 800}}, series: [{type: 'bar', barWidth: 15, data: systemTop.map(s => ({value: s.below, fullName: DIRECTIONS[s.i], average: s.avg, dir: s.i, itemStyle: {color: '#2d93ff', borderRadius: [0, 8, 8, 0]}})), label: {show: true, position: 'right', formatter: '{c}', fontWeight: 800}}]});
    systemsChart?.on('click', p => { if (!Number.isInteger(p.data?.dir)) return; state.direction = p.data.dir; state.indicator = state.indicatorMeta.find(m => m.d === state.direction)?.id || null; setView('directions'); });
    const ppkZoneForOverview = x => ppkZones.find(zone => zone.rows.some(row => row.n === x.n));
    const ppkChartOverview = chart($('#rrOverviewPpkScatter'), {...chartBase(), grid:{left:72,right:36,top:28,bottom:58}, tooltip:{trigger:'item',formatter:p=>`<strong>${esc(p.data.name)}</strong><br>ТО: ${p.value[0].toFixed(2)}%<br>ППК: ${p.value[1].toFixed(2)}%<br>${esc(p.data.zoneTitle || '')}`}, xAxis:{type:'value',name:'Оценка ТО',nameLocation:'middle',nameGap:38,min:Math.max(50,Math.floor(Math.min(...ppkRows.map(x=>x.v*100),90)-2)),max:100,axisLabel:{formatter:'{value}%',fontSize:14}}, yAxis:{type:'value',name:'Оценка ППК',nameGap:28,min:bounds=>Math.max(0,Math.floor((bounds.min-5)/5)*5),axisLabel:{formatter:'{value}%',fontSize:14}}, series:[{type:'scatter',data:ppkRows.map(x=>{const zone=ppkZoneForOverview(x);return {name:x.n,region:x.n,zoneTitle:zone?.title,value:[+(x.v*100).toFixed(2),+(x.ppv*100).toFixed(2)],itemStyle:{color:zone?.tone==='positive'?'#1fb38f':zone?.tone==='attention'?'#db7b72':zone?.key?.includes('to-high')?'#e4ad4b':'#7198d8',opacity:.82}};}),symbolSize:14,emphasis:{scale:1.4},markLine:{silent:true,symbol:'none',label:{show:false},data:[{xAxis:+(toAverage*100).toFixed(2)},{yAxis:+(ppkAverage*100).toFixed(2)}],lineStyle:{type:'dashed',color:'#91a9bc',width:1.4}}}]});
    ppkChartOverview?.on('click', p => { if (!p.data?.region) return; state.region = p.data.region; setView('region'); });
    const ppkOverviewList = $('#rrOverviewPpkRegionList');
    root.querySelectorAll('[data-rr-ppk-zone-overview]').forEach(card => { card.onclick = () => { const zone = ppkZones.find(item => item.key === card.dataset.rrPpkZoneOverview); const open = card.getAttribute('aria-expanded') === 'true'; root.querySelectorAll('[data-rr-ppk-zone-overview]').forEach(item => item.setAttribute('aria-expanded','false')); if (open || !zone || !ppkOverviewList) { if (ppkOverviewList) { ppkOverviewList.hidden=true; ppkOverviewList.innerHTML=''; } return; } card.setAttribute('aria-expanded','true'); ppkOverviewList.hidden=false; ppkOverviewList.innerHTML=`<div><strong>${esc(zone.title)}</strong><small>${zone.rows.length} ТО · нажмите на регион для открытия карточки</small></div><div class="rr-matrix-region-buttons">${zone.rows.slice().sort((a,b)=>(a.r??999)-(b.r??999)).map(x=>`<button data-region="${esc(x.n)}"><strong>${esc(x.n)}</strong><span>${rank(x.r)} место · ${pct(getVal(x))}</span></button>`).join('') || '<span class="rr-empty">Нет записей</span>'}</div>`; ppkOverviewList.querySelectorAll('[data-region]').forEach(button=>button.onclick=()=>{state.region=button.dataset.region;setView('region');}); }; });
    const foChartOverview = chart($('#rrOverviewFoChart'), {...chartBase(),grid:{left:55,right:24,top:18,bottom:48},legend:{show:true,bottom:0},tooltip:{trigger:'axis',valueFormatter:value=>pct(value/100)},xAxis:{type:'category',data:fo.map(x=>x.name),axisLabel:{fontSize:10}},yAxis:{type:'value',min:0,max:100,axisLabel:{formatter:'{value}%'}},series:[{name:'ТО',type:'bar',data:fo.map(x=>+(x.avg*100).toFixed(2)),barMaxWidth:20,itemStyle:{color:'#087cf0',borderRadius:[5,5,0,0]}},{name:'ППК',type:'bar',data:fo.map(x=>num(x.ppkAvg)?+(x.ppkAvg*100).toFixed(2):null),barMaxWidth:20,itemStyle:{color:'#00bd91',borderRadius:[5,5,0,0]}},{name:'Комплексная',type:'bar',data:fo.map(x=>num(x.combinedAvg)?+(x.combinedAvg*100).toFixed(2):null),barMaxWidth:20,itemStyle:{color:'#18bde5',borderRadius:[5,5,0,0]}}]});
    foChartOverview?.on('click', p => { const item = fo[p.dataIndex]; if (!item) return; state.view = 'analytics'; const filter = $('#foFilter'); if (filter) filter.value = item.name; render(); });
    const directionChartOverview = chart($('#rrOverviewDirectionZones'), {...chartBase(),grid:{left:40,right:32,top:34,bottom:66},legend:{show:false},tooltip:{trigger:'axis',axisPointer:{type:'shadow'},formatter:items=>{const index=items?.[0]?.dataIndex;const item=directionSummary[index];return item?`<strong>${esc(item.name)}</strong><br>Среднее: <b>${pct(item.avg)}</b><br>Ниже 90%: <b>${item.below} из ${item.applicable} ТО</b> (${(item.share*100).toFixed(1)}%)`:''}},xAxis:{type:'category',data:directionSummary.map(x=>SHORT[x.i]),axisLabel:{rotate:32,fontSize:10,interval:0}},yAxis:[{type:'value',min:0,max:100,axisLabel:{formatter:'{value}%',fontSize:11}},{type:'value',min:0,max:directionAxisMax,name:'ТО',nameTextStyle:{fontSize:11},axisLabel:{formatter:'{value}',fontSize:11},splitLine:{show:false}}],series:[{name:'Среднее',type:'bar',data:directionSummary.map(x=>({value:+(x.avg*100).toFixed(2),dir:x.i,itemStyle:{color:'#087cf0',borderRadius:[6,6,0,0]}})),barMaxWidth:30,label:{show:true,position:'top',fontSize:9,distance:4,formatter:p=>`${Math.round(p.value)}%` }},{name:'ТО ниже 90%',type:'line',yAxisIndex:1,smooth:true,symbolSize:9,data:directionSummary.map(x=>({value:x.below,dir:x.i,itemStyle:{color:'#00bd91'}})),lineStyle:{width:3,color:'#00bd91'},label:{show:true,position:'top',fontSize:10,formatter:p=>p.value}}]});
    directionChartOverview?.on('click', p => { const dir = p.data?.dir; if (!Number.isInteger(dir)) return; state.direction = dir; state.indicator = state.indicatorMeta.find(m => m.d === dir)?.id || null; setView('directions'); });
  }
  function renderUnifiedAnalytics(data) {
    const root = $('#analyticsDashboard'), focus = state.rrFocus;
    let rows = networkRows(data);
    if (focus === 'paradox') rows = rows.filter(r => r.deltaScore > CFG.eps && r.deltaRank < 0);
    const systems = systemDirections(data), indicators = systemIndicators(data), anomalies = anomalyRows(rows).filter(a => a.anomaly !== 'Изменение структуры оценки').slice(0, 15);
    const fo = [...new Set(data.map(x => x.fo))].map(name => { const group = data.filter(x => x.fo === name); return {name, avg: mean(group.map(getVal)), ppkAvg: mean(group.map(x => x.ppv)), combinedAvg: mean(group.map(x => x.cv)), median: medianOf(group.map(getVal)), count: group.length}; }).sort((a, b) => b.avg - a.avg);
    const ppkRows = data.filter(x => num(x.v) && num(x.ppv));
    const toAverage = mean(ppkRows.map(x => x.v)), ppkAverage = mean(ppkRows.map(x => x.ppv));
    const ppkZones = [
      {key: 'to-high-ppk-high', title: 'Оба сильные', description: 'И ТО, и ППК выше среднего. Это наиболее устойчивая группа.', rows: ppkRows.filter(x => x.v >= toAverage && x.ppv >= ppkAverage), tone: 'positive'},
      {key: 'to-high-ppk-low', title: 'ППК тянет вниз', description: 'ТО выше среднего, но ППК ниже среднего и тянет комплексный результат вниз.', rows: ppkRows.filter(x => x.v >= toAverage && x.ppv < ppkAverage), tone: 'watch'},
      {key: 'to-low-ppk-high', title: 'ТО тянет вниз', description: 'ППК выше среднего, а сам результат ТО слабее среднего.', rows: ppkRows.filter(x => x.v < toAverage && x.ppv >= ppkAverage), tone: 'watch'},
      {key: 'to-low-ppk-low', title: 'Оба требуют внимания', description: 'Оба компонента ниже среднего. Это приоритетная зона управленческого внимания.', rows: ppkRows.filter(x => x.v < toAverage && x.ppv < ppkAverage), tone: 'attention'}
    ];
    const directionSummary = systems.slice().sort((a, b) => a.avg - b.avg);
    const directionAxisMax = Math.max(10, Math.ceil(Math.max(...directionSummary.map(x => x.below), 0) * 1.15 / 5) * 5);
    const heatRows = rows.slice().sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
    root.innerHTML = `${contextHtml(rows)}${focusBanner(focus, focus === 'paradox' ? rows.length : (focus === 'systems' ? systems.filter(x => x.system).length : rows.length))}<div class="rr-page-head"><div><span class="rr-kicker">УПРАВЛЕНЧЕСКАЯ АНАЛИТИКА</span><h2>Сигналы, системность и контрасты</h2><p>Второй уровень: объясняет, почему возник сигнал на главной странице.</p></div></div>
      <div class="rr-analytics-summary"><article><span>Стабильно</span><strong>${rows.filter(r => r.status === 'stable').length}</strong></article><article><span>Наблюдение</span><strong>${rows.filter(r => r.status === 'watch').length}</strong></article><article class="attention"><span>Требуют внимания</span><strong>${rows.filter(r => r.status === 'attention').length}</strong></article><article><span>Аномалии</span><strong>${anomalies.length}</strong></article></div>
      <section class="rr-panel"><div class="rr-panel-head"><div><span class="rr-kicker">АНОМАЛИИ ПЕРИОДА</span><h3>Нетипичные изменения</h3><p>Порог = максимум бизнес-правила и 95-го перцентиля выборки.</p></div></div><div class="rr-table-wrap"><table class="rr-table"><thead><tr><th>ТО</th><th>Тип</th><th>Важность</th><th>Δ оценки</th><th>Δ места</th><th>Объяснение</th></tr></thead><tbody>${anomalies.map(a => `<tr data-rr-region="${esc(a.x.n)}"><td><strong>${esc(a.x.n)}</strong></td><td>${a.anomaly}</td><td><span class="rr-importance">${a.importance}</span></td><td class="${deltaClass(a.deltaScore)}">${pp(a.deltaScore)}</td><td class="${deltaClass(a.deltaRank)}">${signed(a.deltaRank)}</td><td>${esc(a.explanation)}</td></tr>`).join('') || '<tr><td colspan="6">Аномалии не выявлены</td></tr>'}</tbody></table></div></section>
      <div class="rr-bottom-grid"><section class="rr-panel"><div class="rr-panel-head"><div><span class="rr-kicker">СИСТЕМНЫЕ НАПРАВЛЕНИЯ</span><h3>Массовые отклонения</h3></div></div><div class="rr-system-list">${systems.map(s => `<button data-rr-dir="${s.i}" class="${s.system ? 'is-system' : ''}"><span><strong>${esc(s.name)}</strong><small>${s.system ? 'Системная проблема' : 'Локальный уровень'} · среднее ${pct(s.avg)}</small></span><b>${(s.share * 100).toFixed(1)}%<small> ниже 90%</small></b></button>`).join('')}</div></section><section class="rr-panel"><div class="rr-panel-head"><div><span class="rr-kicker">СИСТЕМНЫЕ ПОКАЗАТЕЛИ</span><h3>Красная зона баллов</h3><p>Не менее 20% применимых ТО набрали ≤25% максимума.</p></div></div><div class="rr-system-list">${indicators.slice(0, 12).map(s => `<button data-rr-dir="${s.meta.d}"><span><strong>п. ${s.meta.id}. ${esc(s.meta.name)}</strong><small>Применимо у ${s.applicable} ТО</small></span><b>${s.red}<small> красных</small></b></button>`).join('') || '<div class="rr-empty">Системные показатели по правилу не выявлены</div>'}</div></section></div>
      <section class="rr-panel rr-ppk-zones"><div class="rr-panel-head"><div><span class="rr-kicker">ТО И ППК: ЧЕТЫРЕ ЗОНЫ</span><h3>Влияние двух компонентов</h3><p>Ось X — оценка ТО, ось Y — оценка ППК. Пунктирные линии показывают средние значения выборки.</p></div></div><div id="rrPpkScatter" class="rr-chart rr-ppk-scatter"></div><div class="rr-zone-card-grid">${ppkZones.map(zone => `<button class="rr-ppk-zone-card ${zone.tone}" data-rr-ppk-zone="${zone.key}" aria-expanded="false"><strong>${zone.rows.length}</strong><h4>${zone.title}</h4><p>${zone.description}</p><span>Нажмите, чтобы открыть список ТО →</span></button>`).join('')}</div><div id="rrPpkRegionList" class="rr-matrix-region-list" hidden></div></section>
      <div class="rr-bottom-grid"><section class="rr-panel"><div class="rr-panel-head"><div><span class="rr-kicker">ФЕДЕРАЛЬНЫЕ ОКРУГА</span><h3>Средний результат по ФО</h3><p>ТО, ППК и комплексная оценка по каждому округу.</p></div></div><div id="rrFoChart" class="rr-chart"></div></section><section class="rr-panel rr-directions-zones"><div class="rr-panel-head"><div><span class="rr-kicker">НАПРАВЛЕНИЯ — ЗОНЫ ВНИМАНИЯ</span><h3>Среднее и количество ТО ниже 90%</h3><p>Столбцы показывают среднее направление, линия — число ТО ниже порога.</p></div></div><div id="rrDirectionZones" class="rr-chart"></div><div class="rr-direction-legend" aria-label="Легенда графика направлений"><span><i class="bar"></i>Среднее</span><span><i class="line"></i>ТО ниже 90%</span></div></section></div>
      <section class="rr-panel rr-heatmap-panel"><div class="rr-panel-head"><div><span class="rr-kicker">ТЕПЛОВАЯ КАРТА «ТО × НАПРАВЛЕНИЯ»</span><h3>Распределение сильных и слабых мест</h3></div></div><div class="rr-heatmap-wrap"><table class="rr-heatmap"><thead><tr><th>Регион</th>${DIRECTIONS.map((name, i) => `<th title="${esc(name)}">${esc(SHORT[i])}</th>`).join('')}</tr></thead><tbody>${heatRows.map(row => `<tr data-rr-region="${esc(row.x.n)}"><th><strong>${esc(row.x.n)}</strong><small>${rank(row.rank)} место</small></th>${DIRECTIONS.map((_, i) => { const value = row.x.d?.[i]?.[1]; const cls = num(value) ? value >= .97 ? 'good' : value >= .90 ? 'mid' : 'low' : 'na'; return `<td><span class="rr-heat-cell ${cls}">${num(value) ? `${(value * 100).toFixed(2)}%` : '—'}</span></td>`; }).join('')}</tr>`).join('')}</tbody></table></div><div class="rr-heatmap-legend"><span><i class="good"></i>97% и выше</span><span><i class="mid"></i>90–96%</span><span><i class="low"></i>ниже 90%</span></div></section>`;
    bindCommon(root);
    root.querySelectorAll('tbody tr[data-rr-region]').forEach(r => r.onclick = () => {state.region = r.dataset.rrRegion; setView('region');});
    const ppkZoneFor = x => ppkZones.find(zone => zone.rows.some(row => row.n === x.n));
    const ppkChart = chart($('#rrPpkScatter'), {...chartBase(), grid:{left:58,right:26,top:22,bottom:46}, tooltip: {trigger: 'item', formatter: p => `<strong>${esc(p.data.name)}</strong><br>ТО: ${p.value[0].toFixed(2)}%<br>ППК: ${p.value[1].toFixed(2)}%<br>${esc(p.data.zoneTitle || '')}`}, xAxis: {type: 'value', name: 'Оценка ТО', nameLocation:'middle', nameGap:30, min: Math.max(50, Math.floor(Math.min(...ppkRows.map(x=>x.v*100), 90)-2)), max: 100, axisLabel: {formatter: '{value}%'}}, yAxis: {type: 'value', name: 'Оценка ППК', min: bounds=>Math.max(0,Math.floor((bounds.min-5)/5)*5), axisLabel: {formatter: '{value}%'}}, series: [{type: 'scatter', data: ppkRows.map(x => { const zone = ppkZoneFor(x); return {name: x.n, region: x.n, zoneTitle: zone?.title, value: [+(x.v * 100).toFixed(2), +(x.ppv * 100).toFixed(2)], itemStyle:{color: zone?.tone === 'positive' ? '#1fb38f' : zone?.tone === 'attention' ? '#db7b72' : zone?.key?.includes('to-high') ? '#e4ad4b' : '#7198d8', opacity:.82}}; }), symbolSize: 10, markLine:{silent:true,symbol:'none',label:{show:false},data:[{xAxis:+(toAverage*100).toFixed(2)},{yAxis:+(ppkAverage*100).toFixed(2)}],lineStyle:{type:'dashed',color:'#91a9bc'}}}]});
    ppkChart?.on('click', p => { if (!p.data?.region) return; state.region = p.data.region; setView('region'); });
    const foChart = chart($('#rrFoChart'), {...chartBase(), grid: {left: 55, right: 24, top: 18, bottom: 48}, legend:{show:true,bottom:0}, tooltip:{trigger:'axis',valueFormatter:value=>pct(value/100)}, xAxis: {type: 'category', data: fo.map(x => x.name), axisLabel:{fontSize:10}}, yAxis: {type: 'value', min: 0, max:100, axisLabel: {formatter: '{value}%'}}, series: [{name:'ТО',type:'bar',data: fo.map(x => +(x.avg * 100).toFixed(2)),barMaxWidth:20,itemStyle:{color:'#087cf0',borderRadius:[5,5,0,0]}},{name:'ППК',type:'bar',data: fo.map(x => num(x.ppkAvg) ? +(x.ppkAvg * 100).toFixed(2) : null),barMaxWidth:20,itemStyle:{color:'#00bd91',borderRadius:[5,5,0,0]}},{name:'Комплексная',type:'bar',data: fo.map(x => num(x.combinedAvg) ? +(x.combinedAvg * 100).toFixed(2) : null),barMaxWidth:20,itemStyle:{color:'#18bde5',borderRadius:[5,5,0,0]}}]});
    foChart?.on('click', p => { const item = fo[p.dataIndex]; if (!item) return; $('#foFilter').value = item.name; state.view = 'analytics'; render(); });
    const directionChart = chart($('#rrDirectionZones'), {...chartBase(), grid:{left:40,right:32,top:34,bottom:66}, legend:{show:false}, tooltip:{trigger:'axis',axisPointer:{type:'shadow'},formatter:items=>{const index=items?.[0]?.dataIndex;const item=directionSummary[index];return item?`<strong>${esc(item.name)}</strong><br>Среднее: <b>${pct(item.avg)}</b><br>Ниже 90%: <b>${item.below} из ${item.applicable} ТО</b> (${(item.share*100).toFixed(1)}%)`:''}}, xAxis:{type:'category',data:directionSummary.map(x=>SHORT[x.i]),axisLabel:{rotate:32,fontSize:10,interval:0}}, yAxis:[{type:'value',min:0,max:100,axisLabel:{formatter:'{value}%',fontSize:11}},{type:'value',min:0,max:directionAxisMax,name:'ТО',nameTextStyle:{fontSize:11},axisLabel:{formatter:'{value}',fontSize:11},splitLine:{show:false}}], series:[{name:'Среднее',type:'bar',data:directionSummary.map(x=>({value:+(x.avg*100).toFixed(2),dir:x.i,itemStyle:{color:'#087cf0',borderRadius:[6,6,0,0]}})),barMaxWidth:30,label:{show:true,position:'top',fontSize:9,distance:4,formatter:p=>`${Math.round(p.value)}%`}},{name:'ТО ниже 90%',type:'line',yAxisIndex:1,smooth:true,symbolSize:9,data:directionSummary.map(x=>({value:x.below,dir:x.i,itemStyle:{color:'#00bd91'}})),lineStyle:{width:3,color:'#00bd91'},label:{show:true,position:'top',fontSize:10,formatter:p=>p.value}}]});
    directionChart?.on('click', p => { const dir = p.data?.dir; if (!Number.isInteger(dir)) return; state.direction = dir; state.indicator = state.indicatorMeta.find(m => m.d === dir)?.id || null; setView('directions'); });
    const ppkList = $('#rrPpkRegionList');
    root.querySelectorAll('[data-rr-ppk-zone]').forEach(card => { card.onclick = () => { const zone = ppkZones.find(item => item.key === card.dataset.rrPpkZone); const open = card.getAttribute('aria-expanded') === 'true'; root.querySelectorAll('[data-rr-ppk-zone]').forEach(item => item.setAttribute('aria-expanded','false')); if (open || !zone || !ppkList) { if (ppkList) { ppkList.hidden=true; ppkList.innerHTML=''; } return; } card.setAttribute('aria-expanded','true'); ppkList.hidden=false; ppkList.innerHTML=`<div><strong>${esc(zone.title)}</strong><small>${zone.rows.length} ТО · нажмите на регион для открытия карточки</small></div><div class="rr-matrix-region-buttons">${zone.rows.slice().sort((a,b)=>(a.r??999)-(b.r??999)).map(x=>`<button data-region="${esc(x.n)}"><strong>${esc(x.n)}</strong><span>${rank(x.r)} место · ${pct(getVal(x))}</span></button>`).join('') || '<span class="rr-empty">Нет записей</span>'}</div>`; ppkList.querySelectorAll('[data-region]').forEach(button=>button.onclick=()=>{state.region=button.dataset.region;setView('region');}); }; });
  }
  function renderUnifiedRisk(data) {
    const statusOrder = {attention: 0, watch: 1, stable: 2};
    const focus = state.rrFocus;
    let rows = networkRows(data);
    if (['stable', 'watch', 'attention'].includes(focus)) rows = rows.filter(r => r.status === focus);
    rows = rows.sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || (a.value ?? 2) - (b.value ?? 2));
    const root = $('#riskDashboard');
    const statusGuide = `<details class="rr-panel rr-status-guide"><summary>Как определяется статус</summary><div class="rr-status-guide-body"><div class="rr-panel-head"><div><span class="rr-kicker">МЕТОДИКА СТАТУСА</span><p>Статус рассчитывается по текущей оценке, динамике места, слабым направлениям и влиянию ППК — без скрытого композитного индекса.</p></div></div><div class="rr-status-guide-grid"><article class="attention"><strong>Требуют внимания</strong><p>Срабатывает любой признак: низкая рейтинговая шкала; снижение места на 10 и более; падение оценки на 3 п.п. и более; 4 и более направлений ниже 90%; либо 3 и более слабых направления вместе с отрицательной динамикой.</p></article><article class="watch"><strong>Наблюдение</strong><p>Критерии внимания не сработали, но есть хотя бы один сигнал: оценка ниже среднего РФ, снижение места, 2 и более слабых направления или влияние ППК от 1 п.п.</p></article><article class="stable"><strong>Стабильно</strong><p>Критерии внимания и наблюдения не сработали.</p></article></div></div></details>`;
    root.innerHTML = `${focusBanner(focus, rows.length)}<div class="rr-page-head"><div><span class="rr-kicker">ЕДИНЫЙ РЕЕСТР СТАТУСОВ</span><h2>ТО, требующие внимания</h2><p>Сводка статусов территориальных органов и причин отклонений.</p></div><button id="rrExportRisk" class="rr-link">Экспорт CSV</button></div>${statusGuide}<div class="rr-status-filters"><button class="active" data-status="all">Все · ${rows.length}</button><button data-status="attention">Требуют внимания · ${rows.filter(r => r.status === 'attention').length}</button><button data-status="watch">Наблюдение · ${rows.filter(r => r.status === 'watch').length}</button><button data-status="stable">Стабильно · ${rows.filter(r => r.status === 'stable').length}</button></div><section class="rr-panel"><div class="rr-table-wrap"><table class="rr-table" id="rrRiskTable"><thead><tr><th>ТО</th><th>Статус</th><th>Место</th><th>Δ места</th><th>Оценка</th><th>Δ оценки</th><th>Слабых направлений</th><th>Повторяются</th><th>Причина</th></tr></thead><tbody>${rows.map(r => `<tr data-status="${r.status}" data-rr-region="${esc(r.x.n)}"><td><strong>${esc(r.x.n)}</strong><small>${esc(r.x.fo)}</small></td><td>${statusBadge(r.status)}</td><td>${rank(r.rank)}</td><td class="${deltaClass(r.deltaRank)}">${signed(r.deltaRank)}</td><td>${pct(r.value)}</td><td class="${deltaClass(r.deltaScore)}">${pp(r.deltaScore)}</td><td>${r.weakCount}</td><td>${r.repeatWeak.length}</td><td>${esc(r.reasons.slice(0, 3).join('; ') || 'критерии внимания не сработали')}</td></tr>`).join('')}</tbody></table></div></section>`;
    bindCommon(root);
    root.querySelectorAll('tbody tr').forEach(r => r.onclick = () => {state.region = r.dataset.rrRegion; setView('region');});
    root.querySelectorAll('[data-status]').forEach(b => { if (b.tagName !== 'BUTTON') return; b.onclick = () => {root.querySelectorAll('.rr-status-filters button').forEach(x => x.classList.toggle('active', x === b)); root.querySelectorAll('tbody tr').forEach(x => x.hidden = b.dataset.status !== 'all' && x.dataset.status !== b.dataset.status);}; });
    $('#rrExportRisk').onclick = () => downloadCsv(`statuses_${periodSlug(state.meta?.period)}.csv`, ['ТО','ФО','Статус','Место','Δ места','Оценка','Δ оценки','Слабых направлений','Причина'], rows.map(r => [r.x.n,r.x.fo,statusMeta[r.status].label,r.rank,r.deltaRank,pct(r.value),pp(r.deltaScore),r.weakCount,r.reasons.join('; ')]));
  }
  function renderUnifiedRanking(data, combined = false) {
    const mode = combined ? 'combined' : 'to';
    const rankingSort = rankingSorts[mode];
    const root = $(combined ? '#combinedRankingDashboard' : '#rankingDashboard');
    const title = combined ? 'Комплексный рейтинг ТО и ППК' : 'Рейтинг территориальных органов';
    const description = combined ? 'Комплексная оценка ТО Росреестра с учётом филиалов ППК «Роскадастр».' : 'Официальное место, достижение показателей и прозрачная динамика по каждому ТО.';
    const pm = previousMap();
    const rows = data.map(x => {
      const previous = pm.get(normalize(x.n));
      return {x, value: combined ? x.cv : x.v, rank: combined ? x.cr : x.r, previousRank: combined ? previous?.cr : previous?.r};
    });
    const currentScale = row => (combined ? row.x.cs : row.x.sc) || '—';
    const previousPeriod = shortPeriod(state.previousMeta?.period) || 'Предыдущий период';
    const scaleClass = scale => scale === 'Высокая' ? 'high' : scale === 'Низкая' ? 'low' : 'medium';
    const scaleOrder = {Высокая: 0, Средняя: 1, Низкая: 2};
    const sortValue = row => ({rank: row.rank, region: row.x.n, fo: row.x.fo, scale: scaleOrder[currentScale(row)] ?? 9, value: row.value, previous: row.previousRank}[rankingSort.key]);
    const compareRows = (a, b) => {
      const av = sortValue(a), bv = sortValue(b), aMissing = av === null || av === undefined || Number.isNaN(av), bMissing = bv === null || bv === undefined || Number.isNaN(bv);
      if (aMissing || bMissing) return aMissing === bMissing ? 0 : (aMissing ? 1 : -1);
      const base = typeof av === 'string' ? av.localeCompare(String(bv), 'ru') : av - bv;
      return (base * (rankingSort.direction === 'desc' ? -1 : 1)) || ((a.rank ?? 999) - (b.rank ?? 999)) || a.x.n.localeCompare(b.x.n, 'ru');
    };
    const sortedRows = rows.slice().sort(compareRows);
    const sortHeader = (key, label) => `<th aria-sort="${rankingSort.key === key ? (rankingSort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}"><button type="button" class="rr-sort-button" data-rr-sort="${key}"><span>${label}</span><i aria-hidden="true">${rankingSort.key === key ? (rankingSort.direction === 'asc' ? '↑' : '↓') : '↕'}</i></button></th>`;
    root.innerHTML = `<div class="rr-page-head rr-ranking-head"><div><h2>${title}</h2></div><button class="rr-link rr-export-ranking">Экспорт CSV</button></div><section class="rr-panel rr-ranking-panel"><div class="rr-table-wrap"><table class="rr-table rr-rating-table"><thead><tr>${sortHeader('rank', 'Место')}${sortHeader('region', 'Регион')}${sortHeader('fo', 'ФО')}${sortHeader('scale', 'Оценка')}${sortHeader('value', 'Достижение')}${sortHeader('previous', previousPeriod)}</tr></thead><tbody>${sortedRows.map(row => { const scale = currentScale(row); return `<tr data-rr-region="${esc(row.x.n)}"><td><span class="rr-rank">${rank(row.rank)}</span></td><td><strong>${esc(row.x.n)}</strong></td><td>${esc(row.x.fo || '—')}</td><td><span class="rr-quality-tag ${scaleClass(scale)}">${esc(scale)}</span></td><td class="rr-rating-score"><div class="rr-rating-achievement ${scaleClass(scale)}"><span>${pct(row.value)}</span><span class="rr-rating-track" aria-hidden="true"><i style="width:${num(row.value) ? Math.max(0, Math.min(100, row.value * 100)) : 0}%"></i></span></div></td><td>${rank(row.previousRank)}</td></tr>`; }).join('')}</tbody></table></div></section>`;
    bindCommon(root);
    root.querySelectorAll('[data-rr-sort]').forEach(button => button.onclick = event => { event.stopPropagation(); const key = button.dataset.rrSort; rankingSorts[mode] = rankingSort.key === key ? {key, direction: rankingSort.direction === 'asc' ? 'desc' : 'asc'} : {key, direction: 'asc'}; render(); });
    root.querySelectorAll('tbody tr[data-rr-region]').forEach(row => row.onclick = () => { state.region = row.dataset.rrRegion; setView('region'); });
    root.querySelector('.rr-export-ranking').onclick = () => downloadCsv(`rating_${combined ? 'combined_' : ''}${periodSlug(state.meta?.period)}.csv`, ['Место','Регион','ФО','Оценка','Достижение',previousPeriod], sortedRows.map(row => [row.rank,row.x.n,row.x.fo,currentScale(row),pct(row.value),row.previousRank]));
  }
  function renderUnifiedComparison(data) {
    const root = $('#comparisonDashboard'), focus = state.rrFocus;
    const baseRows = networkRows(data).filter(r => r.p);
    const allAnomalies = anomalyRows(baseRows).filter(a => a.anomaly !== 'Изменение структуры оценки');
    let rows = baseRows;
    if (focus === 'scoreUp') rows = rows.filter(r => r.deltaScore > CFG.eps);
    if (focus === 'scoreDown') rows = rows.filter(r => r.deltaScore < -CFG.eps);
    if (focus === 'rankUp') rows = rows.filter(r => r.deltaRank > 0);
    if (focus === 'rankDown') rows = rows.filter(r => r.deltaRank < 0);
    if (focus === 'anomalies') {
      const anomalyNames = new Set(allAnomalies.map(a => a.x.n));
      rows = rows.filter(r => anomalyNames.has(r.x.n));
    }
    const anomalies = allAnomalies;
    const ordered = rows.slice().sort((a, b) => Math.abs(b.deltaScore || 0) - Math.abs(a.deltaScore || 0));
    root.innerHTML = `${focusBanner(focus, rows.length)}<div class="rr-page-head"><div><h2>Главные изменения периода</h2><p>${esc(shortPeriod(state.previousMeta?.period))} → ${esc(shortPeriod(state.meta?.period))}. Динамика методически помечена по сопоставимости.</p></div></div><div class="rr-analytics-summary"><article><span>Оценка выросла</span><strong>${rows.filter(r => r.deltaScore > CFG.eps).length}</strong></article><article><span>Оценка снизилась</span><strong>${rows.filter(r => r.deltaScore < -CFG.eps).length}</strong></article><article><span>Место выросло</span><strong>${rows.filter(r => r.deltaRank > 0).length}</strong></article><article><span>Аномалии</span><strong>${anomalies.length}</strong></article></div><section class="rr-panel"><div class="rr-table-wrap"><table class="rr-table"><thead><tr><th>ТО</th><th>Место было → стало</th><th>Δ места</th><th>Оценка была → стала</th><th>Δ оценки</th><th>Ключевая причина</th><th>Сопоставимость</th></tr></thead><tbody>${ordered.map(r => `<tr data-rr-region="${esc(r.x.n)}"><td><strong>${esc(r.x.n)}</strong></td><td>${rank(r.previousRank)} → ${rank(r.rank)}</td><td class="${deltaClass(r.deltaRank)}">${signed(r.deltaRank)}</td><td>${pct(r.previousValue)} → ${pct(r.value)}</td><td class="${deltaClass(r.deltaScore)}">${pp(r.deltaScore)}</td><td>${esc(r.weak.slice(0, 2).map(d => SHORT[d.i]).join(' · ') || (r.deltaScore >= 0 ? 'рост результата' : 'относительная динамика сети'))}</td><td><span class="rr-quality-tag ${r.comparable.level}" title="${esc(r.comparable.text)}">${r.comparable.label}</span></td></tr>`).join('')}</tbody></table></div></section>`;
    const summaryRows = networkRows(data).filter(r => r.p);
    const summaryAnomalies = anomalyRows(summaryRows).filter(a => a.anomaly !== 'Изменение структуры оценки');
    const summaryCounts = [
      summaryRows.filter(r => r.deltaScore > CFG.eps).length,
      summaryRows.filter(r => r.deltaScore < -CFG.eps).length,
      summaryRows.filter(r => r.deltaRank > 0).length,
      summaryAnomalies.length
    ];
    root.querySelectorAll('.rr-analytics-summary article strong').forEach((value, index) => { value.textContent = summaryCounts[index]; });
    if (focus === 'anomalies') {
      const anomalyLabels = new Map();
      allAnomalies.forEach(a => { const list = anomalyLabels.get(a.x.n) || []; if (!list.includes(a.anomaly)) list.push(a.anomaly); anomalyLabels.set(a.x.n, list); });
      root.querySelectorAll('tbody tr[data-rr-region]').forEach(row => { const cell = row.children[5]; const labels = anomalyLabels.get(row.dataset.rrRegion); if (cell && labels?.length) cell.textContent = labels.join(' · '); });
    }
    bindCommon(root); root.querySelectorAll('tbody tr').forEach(r => r.onclick = () => {state.region = r.dataset.rrRegion; setView('region');});
  }
  function regionIndicatorRows(x) {
    const p = previousMap().get(normalize(x.n));
    const current = state.indicatorData[x.n] || [];
    const previous = p ? (state.previousIndicatorData?.[p.n] || state.previousIndicatorData?.[x.n] || []) : [];
    return state.indicatorMeta.map((meta, index) => {
      const a = current[meta.id - 1] || current[index];
      const old = previous[meta.id - 1] || previous[index];
      if (!a) return null;
      const score = num(a[3]) ? +a[3] : null, max = num(meta.maxScore) ? +meta.maxScore : null;
      const prior = num(old?.[3]) ? +old[3] : null;
      const loss = num(score) && num(max) ? Math.max(0, max - score) : null;
      const change = num(score) && num(prior) ? score - prior : null;
      const suspicious = num(a[0]) && num(a[1]) && Math.abs(a[0] - a[1]) < 1e-9 && num(score) && num(max) && score < max * .25;
      return {meta, a, old, score, max, prior, loss, change, suspicious};
    }).filter(Boolean);
  }
  function regionTargetScenario(x, targetRank) {
    const target = Math.max(1, Math.min(Math.max(1, (getRank(x) || 2) - 1), Math.round(+targetRank || 1)));
    const boundary = state.data.filter(z => num(getRank(z)) && num(getVal(z)) && getRank(z) <= target).sort((a, b) => getRank(b) - getRank(a) || getVal(a) - getVal(b))[0];
    const targetValue = boundary ? getVal(boundary) : null;
    const needed = num(targetValue) && num(x.m) && num(x.s) ? Math.max(0, targetValue * x.m - x.s + .01) : null;
    let left = needed;
    const plan = regionIndicatorRows(x).filter(z => num(z.loss) && z.loss > 0).sort((a, b) => b.loss - a.loss || a.meta.id - b.meta.id).map(z => {
      if (!num(left) || left <= 0) return null;
      const gain = Math.min(z.loss, left);
      left -= gain;
      return {...z, gain};
    }).filter(Boolean);
    const achievable = num(needed) && left <= .011;
    return {target, boundary, targetValue, needed, plan, achievable};
  }
  function renderUnifiedRegion(data) {
    const root = $('#regionDashboard'), pool = data.length ? data : state.data, x = state.data.find(z => z.n === state.region) || pool[0];
    if (!x) { root.innerHTML = '<div class="rr-panel">Нет данных</div>'; return; }
    state.region = x.n; updateSelectedRegionBar();
    $('#selectedRegionBar')?.classList.add('hidden');
    $('#regionView')?.classList.add('rr-unified-region');
    const allRows = networkRows(state.data), row = allRows.find(r => r.x.n === x.n), rfNow = mean(allRows.map(r => r.value));
    const rfPrev = mean(allRows.map(r => r.previousValue)), rfDelta = num(rfNow) && num(rfPrev) ? (rfNow - rfPrev) * 100 : null;
    const foRows = allRows.filter(r => r.x.fo === x.fo), foAvg = mean(foRows.map(r => r.value));
    const overtakers = overtakersFor(row, allRows), benchmark = benchmarkFor(x), reserve = reserveFor(x);
    const indicators = regionIndicatorRows(x), rootCauses = indicators.filter(z => num(z.loss) && z.loss > 0).sort((a, b) => b.loss - a.loss || (a.change ?? 0) - (b.change ?? 0));
    const qualityIssues = indicators.filter(z => z.suspicious).length;
    const directionRows = DIRECTIONS.map((name, i) => {
      const value = x.d?.[i]?.[1], prior = row.p?.d?.[i]?.[1], average = mean(state.data.map(z => z.d?.[i]?.[1]));
      return {i, name, value, place: x.d?.[i]?.[0], delta: num(value) && num(prior) ? (value - prior) * 100 : null, comparable: directionComparable(x, row.p, i), gap: num(value) && num(average) ? (value - average) * 100 : null, count: state.indicatorMeta.filter(m => m.d === i).length};
    });
    const drivers = directionRows.filter(z => num(z.delta)).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 4);
    const weakDirections = directionRows.filter(z => num(z.value) && z.value < CFG.weakDirection).sort((a, b) => a.value - b.value);
    const benchmarkGaps = benchmark ? directionRows.map(z => ({...z, benchmark: benchmark.x.d?.[z.i]?.[1]})).filter(z => num(z.value) && num(z.benchmark) && z.benchmark > z.value).map(z => ({...z, difference: (z.benchmark - z.value) * 100})).sort((a, b) => b.difference - a.difference).slice(0, 3) : [];
    const ppkImpact = num(x.cv) && num(x.v) ? (x.cv - x.v) * 100 : null;
    const ppkPlaceImpact = num(x.r) && num(x.cr) ? x.r - x.cr : null;
    const defaultTarget = num(row.rank) ? Math.max(1, Math.floor((row.rank - 2) / 10) * 10) : 1;
    const explanation = num(row.deltaScore)
      ? `Оценка ${row.deltaScore >= 0 ? 'выросла' : 'снизилась'} на ${Math.abs(row.deltaScore).toFixed(1).replace('.', ',')} п.п.; среднее по РФ изменилось на ${pp(rfDelta)}. Место ${num(row.deltaRank) ? row.deltaRank > 0 ? `улучшилось на ${row.deltaRank}` : row.deltaRank < 0 ? `снизилось на ${Math.abs(row.deltaRank)}` : 'не изменилось' : 'не сопоставлено'}.`
      : 'Для причинного сравнения недостаточно сопоставимых данных предыдущего периода.';
    const renderTarget = target => {
      const s = regionTargetScenario(x, target);
      return `<div class="rr-target-summary"><span><small>Сейчас</small><b>${rank(row.rank)} место</b><em>${pct(row.value)}</em></span><i>→</i><span><small>Цель</small><b>${rank(s.target)} место</b><em>${pct(s.targetValue)}</em></span><span class="accent"><small>Нужно</small><b>${num(s.needed) ? `+${fmt(s.needed)} балла` : '—'}</b><em>${s.boundary ? esc(s.boundary.n) : 'нет ориентира'}</em></span></div><div class="rr-action-list">${s.plan.slice(0, 5).map(z => `<button data-rr-ind="${z.meta.id}" data-rr-dir="${z.meta.d}"><span><strong>п. ${z.meta.id}. ${esc(z.meta.name)}</strong><small>${esc(SHORT[z.meta.d])} · ${fmt(z.score)} / ${fmt(z.max)} балла</small></span><b>+${fmt(z.gain)}</b><i>→</i></button>`).join('') || '<div class="rr-empty">Дополнительный резерв для выбранной цели не требуется.</div>'}</div>${num(s.needed) && !s.achievable ? '<p class="rr-inline-warning">Доступных балльных резервов недостаточно для выбранной позиции.</p>' : ''}`;
    };
    root.innerHTML = `<div class="rr-page-head rr-region-head"><div><span class="rr-kicker">КАРТОЧКА ТЕРРИТОРИАЛЬНОГО ОРГАНА</span><h2>${esc(x.n)}</h2><p>${esc(x.fo)} · ${esc(shortPeriod(state.meta?.period))} · данные от ${sourceDate()}</p></div><div class="rr-region-head-actions"><button id="rrRegionBack" class="rr-link" type="button">← Назад</button><select id="rrRegionSelect" aria-label="Территориальный орган">${state.data.slice().sort((a,b) => a.n.localeCompare(b.n, 'ru')).map(z => `<option ${z.n === x.n ? 'selected' : ''}>${esc(z.n)}</option>`).join('')}</select></div></div>
      <nav class="rr-region-nav" aria-label="Разделы карточки"><button data-rr-anchor="rrRegionCauses">Причины</button><button data-rr-anchor="rrRegionReserve">Резерв</button><button data-rr-anchor="rrRegionCompare">Сравнение</button><button data-rr-anchor="rrRegionPpk">ППК и история</button><button data-rr-anchor="rrRegionProfile">Направления</button><button data-rr-anchor="rrRegionIndicators">Все показатели</button></nav>
      <section class="rr-region-state"><div class="rr-hero-rank"><span>Место</span><strong>${rank(row.rank)}</strong><small class="${deltaClass(row.deltaRank)}">${num(row.deltaRank) ? `${row.deltaRank > 0 ? '▲' : row.deltaRank < 0 ? '▼' : '•'} ${Math.abs(row.deltaRank)} к периоду` : 'без сравнения'}</small></div><div class="rr-hero-score"><span>Оценка</span><strong>${pct(row.value)}</strong><small class="${deltaClass(row.deltaScore)}">${pp(row.deltaScore)}</small></div><div><span>Статус</span>${statusBadge(row.status)}<small>${esc(row.reasons.slice(0, 2).join(' · ') || 'критерии внимания не сработали')}</small></div><div><span>Отклонение от РФ</span><strong class="${deltaClass(num(row.value) && num(rfNow) ? row.value-rfNow : null)}">${pp(num(row.value) && num(rfNow) ? (row.value-rfNow)*100 : null)}</strong><small>от ${pct(rfNow)}</small></div><div><span>Отклонение от ${esc(x.fo)}</span><strong class="${deltaClass(num(row.value) && num(foAvg) ? row.value-foAvg : null)}">${pp(num(row.value) && num(foAvg) ? (row.value-foAvg)*100 : null)}</strong><small>от ${pct(foAvg)}</small></div><div class="rr-comparability-card" tabindex="0" aria-describedby="rrComparabilityHelp"><span>Сопоставимость ⓘ</span><strong>${row.comparable.label}</strong><small>${esc(row.comparable.text)}</small><span id="rrComparabilityHelp" class="rr-comparability-tooltip" role="tooltip">Сопоставимость показывает, насколько можно сравнивать текущий и предыдущий периоды. Низкая — нет записи прошлого периода или числовой оценки хотя бы в одном из периодов. Высокая — общий максимум баллов совпадает и по всем 12 направлениям есть числовые нормированные оценки и одинаковые максимумы баллов. Средняя — оценки обоих периодов есть, но эти условия выполнены не полностью. Число совпавших направлений считается по равенству максимумов с допуском менее 0,000000001. Нормированная оценка — отношение набранных баллов к максимуму, в процентах. Это характеристика сравнения периодов.</span></div></section>
      <section id="rrRegionCauses" class="rr-panel rr-region-section"><div class="rr-panel-head"><div><span class="rr-kicker">ПРИЧИНЫ</span><h3>Почему изменилось место</h3><p>${esc(explanation)}</p></div><span class="rr-quality-tag ${row.comparable.level}">${row.comparable.label} сопоставимость</span></div><div class="rr-explain-facts"><span><b class="${deltaClass(row.deltaScore)}">${pp(row.deltaScore)}</b>собственная оценка</span><span><b class="${deltaClass(rfDelta)}">${pp(rfDelta)}</b>среднее по РФ</span><span><b class="${deltaClass(num(row.deltaScore) && num(rfDelta) ? row.deltaScore-rfDelta : null)}">${num(row.deltaScore) && num(rfDelta) ? pp(row.deltaScore-rfDelta) : '—'}</b>относительная динамика</span><span><b>${overtakers.length}</b>ТО обогнали регион</span></div><div class="rr-cause-grid"><div><h4>Главные изменения направлений</h4><div class="rr-compact-list">${drivers.map(z => `<button data-rr-dir="${z.i}"><span><strong>${esc(SHORT[z.i])}</strong><small>${esc(z.name)}${z.comparable ? '' : ' · структура изменилась'}</small></span><span><b class="${deltaClass(z.delta)}">${pp(z.delta)}</b></span></button>`).join('') || '<div class="rr-empty">Нет сопоставимых направлений</div>'}</div></div><div class="rr-root-causes"><h4>Что тянет результат вниз</h4><div class="rr-compact-list">${rootCauses.slice(0, 5).map(z => `<button data-rr-ind="${z.meta.id}" data-rr-dir="${z.meta.d}"><span><strong>п. ${z.meta.id}. ${esc(z.meta.name)}</strong><small>${esc(SHORT[z.meta.d])}${num(z.change) ? ` · ${z.change >= 0 ? '+' : ''}${fmt(z.change)} балла к периоду` : ''}</small></span><span><b class="${deltaClass(-z.loss)}">−${fmt(z.loss)}</b><small>балла</small></span></button>`).join('') || '<div class="rr-empty">Потерянные баллы не выявлены</div>'}</div></div></div></section>
      <section id="rrRegionReserve" class="rr-panel rr-region-section"><div class="rr-panel-head"><div><span class="rr-kicker">КАЛЬКУЛЯТОР РОСТА</span></div><div class="rr-target-control"><label>Целевое место<input id="rrTargetRank" type="number" min="1" max="${Math.max(1, (row.rank || 2)-1)}" value="${defaultTarget}"></label><button id="rrTargetApply" type="button">Рассчитать</button></div></div><div id="rrTargetResult">${renderTarget(defaultTarget)}</div><details class="rr-reserve-details"><summary>Реалистичный резерв до медианы сопоставимых ТО</summary><div class="rr-reserve-summary"><span><b>${pct(row.value)}</b>сейчас</span><span><b>${pct(reserve.potential)}</b>потенциал</span><span><b>${rank(reserve.rank)}</b>оценочное место</span></div></details></section>
      <section id="rrRegionCompare" class="rr-region-two"><div class="rr-panel rr-region-section"><div class="rr-panel-head"><div><span class="rr-kicker">КОНКУРЕНТНАЯ ДИНАМИКА</span><h3>Кто обогнал регион</h3><p>ТО, которые были ниже, а сейчас находятся выше.</p></div><strong class="rr-panel-count">${overtakers.length}</strong></div><div class="rr-compact-list">${overtakers.slice(0, 5).map(z => `<button data-rr-region="${esc(z.x.n)}"><span><strong>${esc(z.x.n)}</strong><small>${rank(z.previousRank)} → ${rank(z.rank)} место</small></span><span><b class="${deltaClass(z.deltaScore)}">${pp(z.deltaScore)}</b></span></button>`).join('') || '<div class="rr-empty">Регион никто не обогнал</div>'}</div></div><div class="rr-panel rr-region-section"><div class="rr-panel-head"><div><span class="rr-kicker">ТО-ЭТАЛОН</span><h3>Сопоставимый образец</h3><p>Более результативный ТО с наиболее сопоставимым рейтинговым профилем.</p></div></div>${benchmark ? `<div class="rr-benchmark"><span><b>${esc(benchmark.x.n)}</b>эталон</span><span><b>${pct(benchmark.x.v)}</b>оценка</span><span><b>${rank(benchmark.x.r)}</b>место</span><span><b>${Math.round(benchmark.similarity*100)}%</b>сопоставимость данных</span></div><div class="rr-mini-list">${benchmarkGaps.map(z => `<div><span>${esc(SHORT[z.i])}</span><b>+${z.difference.toFixed(1).replace('.', ',')} п.п.</b></div>`).join('')}</div><button class="rr-text-link" data-rr-region="${esc(benchmark.x.n)}" type="button">Открыть карточку эталона →</button>` : '<div class="rr-empty">Сопоставимый эталон не найден</div>'}</div></section>
      <section id="rrRegionPpk" class="rr-region-two"><div class="rr-panel rr-region-section"><div class="rr-panel-head"><div><span class="rr-kicker">ТО × ППК</span><h3>Влияние ППК на итог</h3></div></div><div class="rr-ppk-flow"><span><small>ТО</small><b>${pct(x.v)}</b><em>${rank(x.r)} место</em></span><i>+</i><span><small>ППК</small><b>${pct(x.ppv)}</b><em>${rank(x.ppr)} место</em></span><i>→</i><span class="combined"><small>Комплексная</small><b>${pct(x.cv)}</b><em>${rank(x.cr)} место</em></span></div><div class="rr-ppk-summary"><span><b class="${deltaClass(ppkImpact)}">${pp(ppkImpact)}</b>влияние на оценку</span><span><b class="${deltaClass(ppkPlaceImpact)}">${num(ppkPlaceImpact) ? `${ppkPlaceImpact > 0 ? '▲' : ppkPlaceImpact < 0 ? '▼' : '•'} ${Math.abs(ppkPlaceImpact)} мест` : '—'}</b>влияние на место</span></div><p class="rr-method-note">Детальные причины ППК не формируются: в исходных данных нет расшифровки показателей филиала.</p></div><div class="rr-panel rr-region-section"><div class="rr-panel-head"><div><span class="rr-kicker">ИСТОРИЯ</span><h3>Два доступных периода</h3><p>Недостаточно периодов для вывода об устойчивом тренде.</p></div></div><div id="rrRegionHistory" class="rr-chart rr-chart-short"></div></div></section>
      <section id="rrRegionProfile" class="rr-panel rr-region-section"><div class="rr-panel-head"><div><span class="rr-kicker">ПРОФИЛЬ ТО</span><h3>12 направлений</h3></div><span class="rr-panel-count">${weakDirections.length} ниже 90%</span></div><div class="rr-direction-list">${directionRows.map(z => `<button data-rr-dir="${z.i}" class="${!num(z.value) ? 'na' : z.value < .9 ? 'bad' : z.value < .95 ? 'watch' : 'good'}"><span class="rr-direction-no">${String(z.i+1).padStart(2,'0')}</span><span><strong>${esc(SHORT[z.i])}</strong><small>${esc(z.name)}</small></span><b>${pct(z.value)}</b><em>${rank(z.place)} м.</em><span class="rr-direction-delta ${deltaClass(z.delta)}">${pp(z.delta)}</span><span class="rr-direction-gap ${deltaClass(z.gap)}">${pp(z.gap)} к РФ</span><i>${z.count} →</i></button>`).join('')}</div></section>
      <details id="rrRegionIndicators" class="rr-panel rr-details rr-region-section"><summary><span><b>Все показатели ТО</b><small>Факт, цель, балл, потеря и динамика · ${indicators.length} показателей${qualityIssues ? ` · ${qualityIssues} требуют проверки правила начисления` : ''}</small></span><i>Показать таблицу ↓</i></summary><div class="rr-table-wrap"><table class="rr-table rr-region-indicators"><thead><tr><th>Показатель</th><th>Факт</th><th>Цель</th><th>Баллы</th><th>Потеря</th><th>Δ балла</th><th>Контроль</th></tr></thead><tbody>${indicators.map(z => `<tr data-rr-ind="${z.meta.id}" data-rr-dir="${z.meta.d}"><td><strong>п. ${z.meta.id}. ${esc(z.meta.name)}</strong><small>${esc(SHORT[z.meta.d])}</small></td><td>${esc(ifmt(z.a[0], z.meta))}</td><td>${esc(ifmt(indicatorTarget(z.meta, z.a), z.meta))}</td><td><strong>${fmt(z.score)} / ${fmt(z.max)}</strong></td><td class="${deltaClass(-z.loss)}">${num(z.loss) && z.loss > 0 ? `−${fmt(z.loss)}` : '—'}</td><td class="${deltaClass(z.change)}">${num(z.change) ? `${z.change > 0 ? '+' : ''}${fmt(z.change)}` : '—'}</td><td>${z.suspicious ? '<span class="rr-data-warning">проверить правило</span>' : '<span class="rr-data-ok">OK</span>'}</td></tr>`).join('')}</tbody></table></div></details>`;
    const benchmarkPanel = root.querySelector('#rrRegionCompare .rr-panel:nth-child(2)');
    
    
    benchmarkPanel?.insertAdjacentHTML('beforeend', `<details class="rr-benchmark-method"><summary>Как определяется сопоставимый образец</summary><div><p><strong>Сопоставимый образец</strong> — это ТО с более высоким текущим местом, которое используется как ориентир для изучения рейтингового профиля. Это не организационный аналог: численность, нагрузка, процессы и территориальные условия в подборе не учитываются.</p><p>Сначала отбираются ТО, у которых сопоставимы не менее 8 из 12 направлений и полнота сопоставления составляет не менее 80%. Затем рассчитывается расстояние: 35% — близость места в предыдущем периоде, 30% — полнота сопоставимых направлений, 20% — близость максимальной суммы баллов, 15% — принадлежность к тому же федеральному округу. Выбирается кандидат с наименьшим расстоянием.</p><p>Показатель «сопоставимость данных» показывает долю направлений, по которым доступны данные у обоих ТО; он не означает идентичность организаций.</p></div></details>`);
    const openIndicator = element => {state.direction = +element.dataset.rrDir; state.indicator = +element.dataset.rrInd; setView('directions');};
    bindCommon(root);
    root.querySelectorAll('[data-rr-ind]').forEach(b => b.onclick = () => openIndicator(b));
    root.querySelectorAll('[data-rr-anchor]').forEach(b => b.onclick = () => document.getElementById(b.dataset.rrAnchor)?.scrollIntoView({behavior:'smooth', block:'start'}));
    $('#rrRegionSelect').onchange = e => {state.region = e.target.value; render();};
    $('#rrRegionBack').onclick = () => goBackView();
    const updateTarget = () => {const host = $('#rrTargetResult'), input = $('#rrTargetRank'); if (host && input) {host.innerHTML = renderTarget(input.value); host.querySelectorAll('[data-rr-ind]').forEach(b => b.onclick = () => openIndicator(b));}};
    $('#rrTargetApply').onclick = updateTarget;
    $('#rrTargetRank').onkeydown = e => {if (e.key === 'Enter') updateTarget();};
    chart($('#rrRegionHistory'), {...chartBase(), grid: {left: 45, right: 45, top: 26, bottom: 35}, tooltip: {trigger: 'axis', formatter: items => items.map(item => `${esc(item.seriesName)}: ${item.seriesName === 'Оценка' ? pct(item.value/100) : rank(item.value)}`).join('<br>')}, xAxis: {type: 'category', data: [shortPeriod(state.previousMeta?.period) || 'Предыдущий', shortPeriod(state.meta?.period)]}, yAxis: [{type: 'value', axisLabel: {formatter: '{value}%'}}, {type: 'value', inverse: true, min: 1, axisLabel: {formatter: '{value} м.'}}], series: [{name: 'Оценка', type: 'line', smooth: true, symbolSize: 10, data: [row.previousValue, row.value].map(v => num(v) ? +(v*100).toFixed(2) : null), label: {show: true, formatter: p => `${p.value.toFixed(2)}%`}}, {name: 'Место', type: 'line', yAxisIndex: 1, symbolSize: 9, data: [row.previousRank, row.rank], lineStyle: {type: 'dashed'}, label: {show: true, formatter: p => `${p.value} м.`}}]});
  }
  function aiUnifiedRisks() {
    const order = {attention: 0, watch: 1};
    const rows = networkRows(state.data).filter(r => r.status !== 'stable').sort((a, b) => order[a.status] - order[b.status] || (a.value ?? 2) - (b.value ?? 2)).slice(0, 7);
    return aiAnswer(`<p><strong>ТО повышенного внимания</strong> по единой классификации дашборда:</p>${aiList(rows.map(r => `<strong>${esc(r.x.n)}</strong> — ${statusMeta[r.status].label.toLowerCase()}, ${aiRank(r.rank)} место, ${aiPct(r.value)}; ${esc(r.reasons.slice(0, 2).join(', '))}`))}<p class="ai-muted">Статус рассчитан прозрачными правилами и не является официальной категорией риска.</p>`, [{label: 'Открыть единый реестр статусов', view: 'risk'}]);
  }
  function aiUnifiedSystem() {
    const rows = systemDirections(state.data).filter(x => x.system);
    return aiAnswer(`<p><strong>Системные проблемы по утверждённому правилу:</strong></p>${aiList(rows.map(r => `${esc(r.name)} — среднее ${aiPct(r.avg)}, ниже 90%: <strong>${r.below} из ${r.applicable} ТО</strong> (${(r.share * 100).toFixed(1)}%)`))}<p>Направление считается системным при среднем ниже 90% или доле слабых ТО не менее 25%, если показатель применим минимум у 10 ТО.</p>`, [{label: 'Открыть системные проблемы', view: 'analytics'}, {label: 'Открыть показатели', view: 'directions'}]);
  }
  function aiUnifiedBenchmark(x) {
    const b = benchmarkFor(x);
    if (!b) return aiAnswer('<p>Не удалось подобрать ТО-эталон, который одновременно имеет более высокий результат и требуемую сопоставимость профиля.</p>');
    const gaps = DIRECTIONS.map((name, i) => ({name, a: x.d?.[i]?.[1], b: b.x.d?.[i]?.[1]})).filter(d => num(d.a) && num(d.b) && d.b > d.a).map(d => ({...d, gap: (d.b - d.a) * 100})).sort((a, z) => z.gap - a.gap).slice(0, 4);
    return aiAnswer(`<p>Для <strong>${aiSafeRegionLabel(x.n)}</strong> эталон по профилю рейтинга — <strong>${esc(b.x.n)}</strong> (${aiRank(b.x.r)} место, ${aiPct(b.x.v)}).</p><p>Совпадает ${b.common} из 12 применимых направлений; ${b.x.fo === x.fo ? 'тот же федеральный округ' : 'федеральный округ отличается'}.</p>${gaps.length ? `<p><strong>Разрывы для изучения:</strong></p>${aiList(gaps.map(d => `${esc(d.name)}: ${aiPct(d.a)} против ${aiPct(d.b)} (${aiPp(d.gap)})`))}` : ''}<p class="ai-muted">Это эталон по рейтинговому профилю, а не организационный аналог: в данных нет нагрузки, штата и объёма операций.</p>`, [{label: `Карточка: ${b.x.n}`, view: 'region', region: b.x.n}, {label: 'Карточка выбранного ТО', view: 'region', region: x.n}]);
  }
  window.RRManagementAnalytics = {config: CFG, rows: networkRows, systemDirections, systemIndicators, anomalies: () => anomalyRows(networkRows(state.data)), scenarioRank, reserveFor, benchmarkFor};
  renderOverview = renderUnifiedOverview;
  renderAnalytics = renderUnifiedAnalytics;
  renderRisk = renderUnifiedRisk;
  renderRanking = data => renderUnifiedRanking(data);
  renderCombinedRanking = data => renderUnifiedRanking(data, true);
  renderComparison = renderUnifiedComparison;
  renderRegion = renderUnifiedRegion;
  aiAnswerRisks = aiUnifiedRisks;
  aiAnswerSystem = aiUnifiedSystem;
  aiAnswerBenchmark = aiUnifiedBenchmark;
  
  state.uiReady = true;
  render();
})();
