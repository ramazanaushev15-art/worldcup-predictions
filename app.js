let state = {
  matches: [],
  predictions: [],
  stats: [],
  currentMatch: null,
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

async function sendPrediction(payload) {
  try {
    await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    });
    return true;
  } catch (err) {
    console.error('Ошибка отправки прогноза:', err);
    return false;
  }
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
  const pH = oddsToPercent(home);
  const pD = oddsToPercent(draw);
  const pA = oddsToPercent(away);
  if (pH === null || pD === null || pA === null) return null;
  const total = pH + pD + pA;
  return {
    home: Math.round((pH / total) * 100),
    draw: Math.round((pD / total) * 100),
    away: Math.round((pA / total) * 100)
  };
}

function predictedScoreline(probs) {
  if (!probs) return '—:—';
  const scaleGoals = (p) => p > 55 ? 2 : p > 35 ? 1 : p > 20 ? 1 : 0;
  return `${scaleGoals(probs.home)}:${scaleGoals(probs.away)}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function hasUserPredicted(matchId, username) {
  return state.predictions.some(p => p['ID_матча'] === matchId && p['Имя_пользователя'] === username);
}

function renderAll() {
  renderHome();
  renderPredictPage();
  renderResults();
  renderBracket();
  renderLeaders();
}

function renderHome() {
  document.getElementById('h-total').textContent = getStat('Всего_прогнозов');
  document.getElementById('h-accuracy').textContent = getStat('Общая_точность_%');
  document.getElementById('h-played').textContent = getStat('Сыграно_матчей');
  document.getElementById('h-avgpts').textContent = getStat('Средний_балл_за_матч');

  const upcoming = state.matches
    .filter(m => m['Статус'] !== 'Завершён')
    .sort((a, b) => new Date(a['Дата'] + ' ' + a['Время']) - new Date(b['Дата'] + ' ' + b['Время']))
    .slice(0, 5);

  const container = document.getElementById('h-upcoming');
  if (upcoming.length === 0) {
    container.innerHTML = '<div class="empty-state">Пока нет данных о матчах</div>';
    return;
  }
  container.innerHTML = upcoming.map(m => renderMatchCard(m, false)).join('');
}

function renderMatchCard(m, showButton) {
  const probs = calcImpliedProbabilities(m['Кф_П1'], m['Кф_Х'], m['Кф_П2']);
  const oddsHtml = probs
    ? `<div class="odds-row">
        <div class="odds-pill"><div class="pct">${probs.home}%</div><div class="lbl">П1</div></div>
        <div class="odds-pill"><div class="pct">${probs.draw}%</div><div class="lbl">Х</div></div>
        <div class="odds-pill"><div class="pct">${probs.away}%</div><div class="lbl">П2</div></div>
      </div>`
    : '';
  const btn = showButton
    ? `<button class="predict-btn" onclick="openModal('${m['ID']}')">Сделать прогноз</button>`
    : '';
  return `
    <div class="match-card">
      <div class="match-meta">
        <span>${formatDate(m['Дата'])} · ${m['Время']}</span>
        <span class="status-badge">${m['Статус'] || 'Не начался'}</span>
      </div>
      <div class="match-teams">
        <span>${m['Хозяева']}</span>
        <span class="vs">vs</span>
        <span>${m['Гости']}</span>
      </div>
      ${oddsHtml}
      ${btn}
    </div>`;
}

function renderPredictPage() {
  const upcoming = state.matches
    .filter(m => m['Статус'] !== 'Завершён')
    .sort((a, b) => new Date(a['Дата'] + ' ' + a['Время']) - new Date(b['Дата'] + ' ' + b['Время']));

  const container = document.getElementById('predict-list');
  if (upcoming.length === 0) {
    container.innerHTML = '<div class="empty-state">Нет доступных матчей для прогноза</div>';
    return;
  }
  container.innerHTML = upcoming.map(m => renderMatchCard(m, true)).join('');
}

function renderResults() {
  const finished = state.matches
    .filter(m => m['Статус'] === 'Завершён')
    .sort((a, b) => new Date(b['Дата']) - new Date(a['Дата']));

  const container = document.getElementById('results-list');
  if (finished.length === 0) {
    container.innerHTML = '<div class="empty-state">Пока нет завершённых матчей</div>';
    return;
  }

  container.innerHTML = finished.map(m => {
    const preds = state.predictions.filter(p => p['ID_матча'] === m['ID']);
    const predsHtml = preds.map(p => {
      const pts = p['Баллы'];
      return `
        <div class="result-row">
          <span>${p['Имя_пользователя']}: ${p['Прогноз_счёт_хозяев']}:${p['Прогноз_счёт_гостей']}</span>
          ${pts !== '' && pts !== undefined ? `<span class="points-tag">${pts} б.</span>` : '<span class="badge-no">—</span>'}
        </div>`;
    }).join('');

    return `
      <div class="result-card">
        <div class="match-meta">
          <span>${formatDate(m['Дата'])}</span>
          <span class="status-badge">Завершён</span>
        </div>
        <div class="match-teams">
          <span>${m['Хозяева']}</span>
          <span class="score">${m['Голы_хозяев']} : ${m['Голы_гостей']}</span>
          <span>${m['Гости']}</span>
        </div>
        ${predsHtml || '<div class="result-row"><span style="color:var(--text-dim)">Никто не прогнозировал</span></div>'}
      </div>`;
  }).join('');
}

function renderBracket() {
  const groups = {};
  state.matches.forEach(m => {
    const g = m['Группа'] || 'Без группы';
    if (!groups[g]) groups[g] = [];
    groups[g].push(m);
  });

  const container = document.getElementById('bracket-list');
  const groupNames = Object.keys(groups);
  if (groupNames.length === 0) {
    container.innerHTML = '<div class="empty-state">Нет данных о турнирной сетке</div>';
    return;
  }

  container.innerHTML = groupNames.map(g => {
    const matches = groups[g].sort((a, b) => new Date(a['Дата']) - new Date(b['Дата']));
    const rows = matches.map(m => {
      const scoreText = m['Статус'] === 'Завершён'
        ? `${m['Голы_хозяев']}:${m['Голы_гостей']}`
        : formatDate(m['Дата']);
      return `<div class="result-row"><span>${m['Хозяева']} — ${m['Гости']}</span><span style="color:var(--text-dim)">${scoreText}</span></div>`;
    }).join('');
    return `<div class="group-card"><h4>${g}</h4>${rows}</div>`;
  }).join('');
}

function renderLeaders() {
  const totals = {};
  state.predictions.forEach(p => {
    const name = p['Имя_пользователя'];
    const pts = parseFloat(p['Баллы']);
    if (!name) return;
    if (!totals[name]) totals[name] = 0;
    if (!isNaN(pts)) totals[name] += pts;
  });

  const ranked = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const container = document.getElementById('leaders-list');
  if (ranked.length === 0) {
    container.innerHTML = '<div class="empty-state">Пока никто не сделал прогнозов</div>';
    return;
  }

  container.innerHTML = `<div class="result-card">` + ranked.map(([name, pts], i) => `
    <div class="leader-row">
      <div style="display:flex;align-items:center;">
        <div class="leader-rank ${i === 0 ? 'gold' : ''}">${i + 1}</div>
        <span>${name}</span>
      </div>
      <span class="points-tag">${pts} б.</span>
    </div>`).join('') + `</div>`;
}

function openModal(matchId) {
  const match = state.matches.find(m => m['ID'] === matchId);
  if (!match) return;
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

  document.getElementById('modalOverlay').classList.add('active');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
}

document.querySelectorAll('#m-outcome-row .choice-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#m-outcome-row .choice-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    state.selections.outcome = btn.dataset.val;
  });
});

[['m-btts-yes', 'Да'], ['m-btts-no', 'Нет']].forEach(([id, val]) => {
  document.getElementById(id).addEventListener('click', () => {
    document.getElementById('m-btts-yes').classList.remove('selected');
    document.getElementById('m-btts-no').classList.remove('selected');
    document.getElementById(id).classList.add('selected');
    state.selections.btts = val;
  });
});

[['m-total-over', 'Больше 2.5'], ['m-total-under', 'Меньше 2.5']].forEach(([id, val]) => {
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
    document.querySelectorAll('.conf-dot').forEach(d => {
      d.classList.toggle('selected', parseInt(d.dataset.val) <= val);
    });
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

  localStorage.setItem('wc_username', username);

  const payload = {
    matchId: state.currentMatch['ID'],
    username: username,
    outcome: state.selections.outcome,
    scoreHome: scoreHome,
    scoreAway: scoreAway,
    btts: state.selections.btts,
    total: state.selections.total,
    confidence: state.selections.confidence
  };

  const ok = await sendPrediction(payload);
  if (ok) {
    showToast('Прогноз сохранён!');
    closeModal();
    setTimeout(loadData, 800);
  } else {
    showToast('Ошибка отправки, попробуй снова');
  }
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('page-' + tab.dataset.page).classList.add('active');
  });
});

setInterval(loadData, 6 * 60 * 60 * 1000);

loadData();
