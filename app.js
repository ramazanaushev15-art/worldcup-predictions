let state = {
  matches: [], predictions: [], stats: [], currentMatch: null, currentPlayer: null,
  selections: { outcome: null, btts: null, total: null, confidence: null }
};

async function loadData() {
  try {
    const res = await fetch(API_URL);
    const data = await res.json();
    state.matches = data.matches || [];
    state.predictions = data.predictions || [];
    state.stats = data.stats || [];
    renderAll();
  } catch (err) {
    console.error('Ошибка загрузки данных:', err);
    showToast('Не удалось загрузить данные. Проверь интернет.');
  }
}

async function refreshAll() {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');
  await loadData();
  btn.classList.remove('spinning');
  showToast('Данные обновлены');
}

let logoPressTimer = null;
function startLogoPress() { logoPressTimer = setTimeout(openAdminPrompt, 800); }
function cancelLogoPress() { if (logoPressTimer) clearTimeout(logoPressTimer); }

async function openAdminPrompt() {
  const secret = prompt('Секретное слово администратора:');
  if (!secret) return;
  showToast('Запускаю реальное обновление через API...');
  try {
    const res = await fetch(API_URL + '?action=forceUpdate&secret=' + encodeURIComponent(secret));
    const data = await res.json();
    if (data.success) { showToast('Готово! Коэффициенты и результаты обновлены'); setTimeout(loadData, 1000); }
    else { showToast(data.error || 'Ошибка обновления'); }
  } catch (err) { showToast('Ошибка связи с сервером'); }
}

async function sendPrediction(payload) {
  try {
    await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(payload) });
    return true;
  } catch (err) { console.error('Ошибка отправки прогноза:', err); return false; }
}

function getStat(name) {
  const row = state.stats.find(s => s['Показатель'] === name);
  return row ? row['Значение'] : '—';
}

function oddsToPercent(odd) {
  if (!odd || isNaN(parseFloat(odd))) return null;
  return 1 / parseFloat(odd);
}

function calcImpliedProbabilities(home, draw, away) {
  const pH = oddsToPercent(home), pD = oddsToPercent(draw), pA = oddsToPercent(away);
  if (pH === null || pD === null || pA === null) return null;
  const total = pH + pD + pA;
  return { home: Math.round((pH/total)*100), draw: Math.round((pD/total)*100), away: Math.round((pA/total)*100) };
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

function normalizeTime(raw) {
  if (!raw) return '00:00';
  const str = String(raw);
  const match = str.match(/(\d{1,2}):(\d{2})/);
  if (match) return match[1].padStart(2, '0') + ':' + match[2];
  const d = new Date(raw);
  if (!isNaN(d)) {
    const h = d.getUTCHours().toString().padStart(2, '0');
    const m = d.getUTCMinutes().toString().padStart(2, '0');
    return h + ':' + m;
  }
  return '00:00';
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function isMatchLocked(m) {
  if (m['Статус'] === 'Завершён') return true;
  const dt = new Date(m['Дата'] + 'T' + normalizeTime(m['Время']) + ':00');
  if (isNaN(dt)) return false;
  return dt.getTime() <= Date.now();
}

function breakdownPoints(p, m) {
  const actualHome = Number(m['Голы_хозяев']), actualAway = Number(m['Голы_гостей']);
  const actualOutcome = actualHome > actualAway ? 'П1' : (actualHome < actualAway ? 'П2' : 'Х');
  const actualTotal = (actualHome + actualAway) > 2.5 ? 'Больше 2.5' : 'Меньше 2.5';
  const actualBtts = (actualHome > 0 && actualAway > 0) ? 'Да' : 'Нет';
  const exact = Number(p['Прогноз_счёт_хозяев']) === actualHome && Number(p['Прогноз_счёт_гостей']) === actualAway;
  return {
    outcome: p['Прогноз_П1Х2'] === actualOutcome,
    total: p['Прогноз_тотал'] === actualTotal,
    btts: p['Прогноз_ОЗ'] === actualBtts,
    exact: exact
  };
}

function renderBreakdownHtml(b) {
  const mark = (ok, label) => `<span style="color:${ok ? 'var(--win)' : 'var(--lose)'}">${ok ? '✓' : '✗'} ${label}</span>`;
  return `<div style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;margin-top:4px;">${mark(b.outcome,'исход')}${mark(b.total,'тотал')}${mark(b.btts,'обе забьют')}${mark(b.exact,'точный счёт')}</div>`;
}

function renderAll() {
  renderHome(); renderPredictPage(); renderResults(); renderBracket(); renderLeaders(); renderLastUpdated();
}

function renderLastUpdated() {
  const val = getStat('Последнее_обновление');
  const el = document.getElementById('lastUpdated');
  if (el) el.textContent = val !== '—' ? `Обновлено: ${val}` : '';
}

function renderHome() {
  const upcoming = state.matches.filter(m => m['Статус'] !== 'Завершён')
    .sort((a,b) => new Date(a['Дата']+'T'+normalizeTime(a['Время'])) - new Date(b['Дата']+'T'+normalizeTime(b['Время']))).slice(0,5);
  const container = document.getElementById('h-upcoming');
  if (upcoming.length === 0) { container.innerHTML = '<div class="empty-state">Пока нет данных о матчах</div>'; return; }
  container.innerHTML = upcoming.map(m => renderMatchCard(m, false)).join('');
}

function renderMatchCard(m, showButton) {
  const probs = calcImpliedProbabilities(m['Кф_П1'], m['Кф_Х'], m['Кф_П2']);
  const oddsHtml = probs ? `<div class="odds-row">
    <div class="odds-pill"><div class="pct">${probs.home}%</div><div class="lbl">П1</div></div>
    <div class="odds-pill"><div class="pct">${probs.draw}%</div><div class="lbl">Х</div></div>
    <div class="odds-pill"><div class="pct">${probs.away}%</div><div class="lbl">П2</div></div>
  </div>` : '';
  const locked = isMatchLocked(m);
  const myName = localStorage.getItem('wc_username');
  const existingPred = myName ? state.predictions.find(p => p['ID_матча'] === m['ID'] && p['Имя_пользователя'] === myName) : null;
  let btn = '';
  if (showButton) {
    if (locked) btn = `<button class="predict-btn" disabled>Матч уже начался</button>`;
    else if (existingPred) btn = `<button class="predict-btn" style="background:var(--bg-elev);color:var(--accent);border:1px solid var(--accent);" onclick="openModal('${m['ID']}')">Изменить прогноз (${existingPred['Прогноз_счёт_хозяев']}:${existingPred['Прогноз_счёт_гостей']})</button>`;
    else btn = `<button class="predict-btn" onclick="openModal('${m['ID']}')">Сделать прогноз</button>`;
  }
  return `<div class="match-card">
    <div class="match-meta"><span>${formatDate(m['Дата'])} · ${normalizeTime(m['Время'])}</span><span class="status-badge">${m['Статус']||'Не начался'}</span></div>
    <div class="match-teams"><span>${m['Хозяева']}</span><span class="vs">vs</span><span>${m['Гости']}</span></div>
    ${oddsHtml}${btn}</div>`;
}

function renderPredictPage() {
  const upcoming = state.matches.filter(m => m['Статус'] !== 'Завершён')
    .sort((a,b) => new Date(a['Дата']+'T'+normalizeTime(a['Время'])) - new Date(b['Дата']+'T'+normalizeTime(b['Время'])));
  const container = document.getElementById('predict-list');
  if (upcoming.length === 0) { container.innerHTML = '<div class="empty-state">Нет доступных матчей для прогноза</div>'; return; }
  container.innerHTML = upcoming.map(m => renderMatchCard(m, true)).join('');
}

function renderResults() {
  const finished = state.matches.filter(m => m['Статус'] === 'Завершён').sort((a,b) => new Date(b['Дата']) - new Date(a['Дата']));
  const container = document.getElementById('results-list');
  if (finished.length === 0) { container.innerHTML = '<div class="empty-state">Пока нет завершённых матчей</div>'; return; }
  container.innerHTML = finished.map(m => {
    const preds = state.predictions.filter(p => p['ID_матча'] === m['ID']);
    const predsHtml = preds.map(p => {
      const pts = p['Баллы'];
      const hasPts = pts !== '' && pts !== undefined && pts !== null;
      const breakdown = hasPts ? breakdownPoints(p, m) : null;
      return `<div class="result-row" style="flex-direction:column;align-items:stretch;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span onclick="openProfile('${p['Имя_пользователя']}')" style="cursor:pointer;text-decoration:underline;text-decoration-color:var(--border);">${p['Имя_пользователя']}: ${p['Прогноз_счёт_хозяев']}:${p['Прогноз_счёт_гостей']}</span>
          ${hasPts ? `<span class="points-tag">${pts} б.</span>` : '<span class="badge-no">—</span>'}
        </div>${breakdown ? renderBreakdownHtml(breakdown) : ''}</div>`;
    }).join('');
    return `<div class="result-card">
      <div class="match-meta"><span>${formatDate(m['Дата'])}</span><span class="status-badge">Завершён</span></div>
      <div class="match-teams"><span>${m['Хозяева']}</span><span class="score">${m['Голы_хозяев']} : ${m['Голы_гостей']}</span><span>${m['Гости']}</span></div>
      ${predsHtml || '<div class="result-row"><span style="color:var(--text-dim)">Никто не прогнозировал</span></div>'}</div>`;
  }).join('');
}

function renderBracket() {
  const groups = {};
  state.matches.forEach(m => { const g = m['Группа'] || 'Без группы'; if (!groups[g]) groups[g] = []; groups[g].push(m); });
  const container = document.getElementById('bracket-list');
  const groupNames = Object.keys(groups);
  if (groupNames.length === 0) { container.innerHTML = '<div class="empty-state">Нет данных о турнирной сетке</div>'; return; }
  container.innerHTML = groupNames.map(g => {
    const matches = groups[g].sort((a,b) => new Date(a['Дата']) - new Date(b['Дата']));
    const rows = matches.map(m => {
      const scoreText = m['Статус'] === 'Завершён' ? `${m['Голы_хозяев']}:${m['Голы_гостей']}` : formatDate(m['Дата']);
      return `<div class="result-row"><span>${m['Хозяева']} — ${m['Гости']}</span><span style="color:var(--text-dim)">${scoreText}</span></div>`;
    }).join('');
    return `<div class="group-card"><h4>${g}</h4>${rows}</div>`;
  }).join('');
}

function renderLeaders() {
  const totals = {};
  state.predictions.forEach(p => {
    const name = p['Имя_пользователя'], pts = parseFloat(p['Баллы']);
    if (!name) return;
    if (!totals[name]) totals[name] = 0;
    if (!isNaN(pts)) totals[name] += pts;
  });
  const ranked = Object.entries(totals).sort((a,b) => b[1]-a[1]);
  const container = document.getElementById('leaders-list');
  if (ranked.length === 0) { container.innerHTML = '<div class="empty-state">Пока никто не сделал прогнозов</div>'; return; }
  container.innerHTML = `<div class="result-card">` + ranked.map(([name,pts],i) => `
    <div class="leader-row" onclick="openProfile('${name}')" style="cursor:pointer;">
      <div style="display:flex;align-items:center;"><div class="leader-rank ${i===0?'gold':''}">${i+1}</div><span>${name}</span></div>
      <span class="points-tag">${pts} б.</span></div>`).join('') + `</div>`;
}

function openProfile(username) {
  state.currentPlayer = username;
  const myPreds = state.predictions.filter(p => p['Имя_пользователя'] === username);
  const scored = myPreds.filter(p => p['Баллы'] !== '' && p['Баллы'] !== undefined && p['Баллы'] !== null);
  const totalPoints = scored.reduce((sum,p) => sum + Number(p['Баллы']), 0);
  const avgPoints = scored.length > 0 ? (totalPoints/scored.length).toFixed(2) : '—';

  const enriched = myPreds.map(p => ({ p, match: state.matches.find(m => m['ID'] === p['ID_матча']) })).filter(x => x.match);
  const exactCount = enriched.filter(({p, match}) => isMatchLocked(match) && breakdownPoints(p, match).exact).length;

  document.getElementById('profile-name').textContent = username;
  document.getElementById('profile-stats').innerHTML = `<div class="stat-grid">
    <div class="stat-card"><div class="label">Прогнозов</div><div class="value">${myPreds.length}</div></div>
    <div class="stat-card"><div class="label">Баллов всего</div><div class="value accent">${totalPoints}</div></div>
    <div class="stat-card"><div class="label">Средний балл</div><div class="value">${avgPoints}</div></div>
    <div class="stat-card"><div class="label">Точных счетов</div><div class="value">${exactCount}</div></div></div>`;

  const active = enriched.filter(x => !isMatchLocked(x.match)).sort((a,b) => new Date(a.match['Дата']+'T'+normalizeTime(a.match['Время'])) - new Date(b.match['Дата']+'T'+normalizeTime(b.match['Время'])));
  const finished = enriched.filter(x => isMatchLocked(x.match)).sort((a,b) => new Date(b.match['Дата']) - new Date(a.match['Дата']));

  const activeHtml = active.map(({p,match}) => `<div class="result-row">
    <span>${match['Хозяева']} — ${match['Гости']}: ${p['Прогноз_счёт_хозяев']}:${p['Прогноз_счёт_гостей']}</span>
    <button class="choice-btn" style="flex:none;padding:6px 12px;" onclick="openModal('${match['ID']}')">Изменить</button></div>`).join('');

  const finishedHtml = finished.map(({p,match}) => {
    const pts = p['Баллы'];
    const hasPts = pts !== '' && pts !== undefined && pts !== null;
    const breakdown = hasPts ? breakdownPoints(p, match) : null;
    return `<div class="result-row" style="flex-direction:column;align-items:stretch;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span>${match['Хозяева']} — ${match['Гости']}: ${p['Прогноз_счёт_хозяев']}:${p['Прогноз_счёт_гостей']}</span>
        ${hasPts ? `<span class="points-tag">${pts} б.</span>` : '<span class="badge-no">Ожидание</span>'}</div>
      ${breakdown ? renderBreakdownHtml(breakdown) : ''}</div>`;
  }).join('');

  document.getElementById('profile-active').innerHTML = activeHtml || '<div class="empty-state">Нет активных прогнозов</div>';
  document.getElementById('profile-history').innerHTML = finishedHtml || '<div class="empty-state">Нет завершённых прогнозов</div>';
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-profile').classList.add('active');
}

function openMyProfile() {
  const savedName = localStorage.getItem('wc_username');
  if (!savedName) { showToast('Сначала сделай хотя бы один прогноз, чтобы открыть кабинет'); return; }
  openProfile(savedName);
}

function closeProfile() {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelector('.tab[data-page="leaders"]').classList.add('active');
  document.getElementById('page-leaders').classList.add('active');
}

function openModal(matchId) {
  const match = state.matches.find(m => m['ID'] === matchId);
  if (!match) return;
  if (isMatchLocked(match)) { showToast('Этот матч уже начался'); return; }
  state.currentMatch = match;
  state.selections = { outcome: null, btts: null, total: null, confidence: null };
  document.getElementById('modalTitle').textContent = `${match['Хозяева']} — ${match['Гости']}`;
  document.getElementById('m-out-1').textContent = match['Хозяева'];
  document.getElementById('m-out-2').textContent = match['Гости'];
  document.getElementById('m-score-home').value = '';
  document.getElementById('m-score-away').value = '';
  document.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('selected'));
  document.querySelectorAll('.conf-dot').forEach(d => d.classList.remove('selected'));
  const savedName = localStorage.getItem('wc_username');
  if (savedName) document.getElementById('m-username').value = savedName;

  const existingPred = savedName ? state.predictions.find(p => p['ID_матча'] === matchId && p['Имя_пользователя'] === savedName) : null;
  if (existingPred) {
    document.getElementById('m-score-home').value = existingPred['Прогноз_счёт_хозяев'];
    document.getElementById('m-score-away').value = existingPred['Прогноз_счёт_гостей'];
    state.selections.outcome = existingPred['Прогноз_П1Х2'];
    state.selections.btts = existingPred['Прогноз_ОЗ'];
    state.selections.total = existingPred['Прогноз_тотал'];
    state.selections.confidence = Number(existingPred['Уверенность']);
    document.querySelectorAll('#m-outcome-row .choice-btn').forEach(b => { if (b.dataset.val === state.selections.outcome) b.classList.add('selected'); });
    if (state.selections.btts === 'Да') document.getElementById('m-btts-yes').classList.add('selected');
    if (state.selections.btts === 'Нет') document.getElementById('m-btts-no').classList.add('selected');
    if (state.selections.total === 'Больше 2.5') document.getElementById('m-total-over').classList.add('selected');
    if (state.selections.total === 'Меньше 2.5') document.getElementById('m-total-under').classList.add('selected');
    document.querySelectorAll('.conf-dot').forEach(d => d.classList.toggle('selected', parseInt(d.dataset.val) <= state.selections.confidence));
  }
  document.getElementById('modalOverlay').classList.add('active');
}

function closeModal() { document.getElementById('modalOverlay').classList.remove('active'); }

document.querySelectorAll('#m-outcome-row .choice-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#m-outcome-row .choice-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    state.selections.outcome = btn.dataset.val;
  });
});

[['m-btts-yes','Да'],['m-btts-no','Нет']].forEach(([id,val]) => {
  document.getElementById(id).addEventListener('click', () => {
    document.getElementById('m-btts-yes').classList.remove('selected');
    document.getElementById('m-btts-no').classList.remove('selected');
    document.getElementById(id).classList.add('selected');
    state.selections.btts = val;
  });
});

[['m-total-over','Больше 2.5'],['m-total-under','Меньше 2.5']].forEach(([id,val]) => {
  document.getElementById(id).addEventListener('click', () => {
    document.getElementById('m-total-over').classList.remove('selected');
    document.getElementById('m-total-under').classList.remove('selected');
    document.getElementById(id).classList.add('selected');
    state.selections.total = val;
  });
});

document.querySelectorAll('.conf-dot').forEach(dot => {
  dot.addEventListener('click', () => {
    const val = parseInt(dot.dataset.val);
    document.querySelectorAll('.conf-dot').forEach(d => d.classList.toggle('selected', parseInt(d.dataset.val) <= val));
    state.selections.confidence = val;
  });
});

async function submitPrediction() {
  const username = document.getElementById('m-username').value.trim();
  const scoreHome = document.getElementById('m-score-home').value;
  const scoreAway = document.getElementById('m-score-away').value;
  if (!username) { showToast('Введи своё имя'); return; }
  if (!state.selections.outcome) { showToast('Выбери исход'); return; }
  if (scoreHome === '' || scoreAway === '') { showToast('Укажи точный счёт'); return; }
  if (!state.selections.btts) { showToast('Выбери "обе забьют"'); return; }
  if (!state.selections.total) { showToast('Выбери тотал'); return; }
  if (!state.selections.confidence) { showToast('Укажи уверенность'); return; }

  const h = Number(scoreHome), a = Number(scoreAway);
  const impliedOutcome = h > a ? 'П1' : (h < a ? 'П2' : 'Х');
  const impliedTotal = (h + a) > 2.5 ? 'Больше 2.5' : 'Меньше 2.5';
  const impliedBtts = (h > 0 && a > 0) ? 'Да' : 'Нет';

  const mismatches = [];
  if (state.selections.outcome !== impliedOutcome) mismatches.push(`счёт ${h}:${a} — это «${impliedOutcome}», а выбран «${state.selections.outcome}»`);
  if (state.selections.total !== impliedTotal) mismatches.push(`счёт ${h}:${a} даёт тотал «${impliedTotal}», а выбран «${state.selections.total}»`);
  if (state.selections.btts !== impliedBtts) mismatches.push(`счёт ${h}:${a} — обе забьют «${impliedBtts}», а выбрано «${state.selections.btts}»`);

  if (mismatches.length > 0) { showToast('Прогноз противоречит счёту: ' + mismatches[0]); return; }

  if (isMatchLocked(state.currentMatch)) { showToast('Матч уже начался, прогноз 
