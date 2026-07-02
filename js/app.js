// ── Anaesthesia Hub — App Logic ──

const App = (() => {

  const CACHE_KEY = 'anaes_hub_v4';

  let state = {
    rotation: 'Cardiac — Ottawa Heart Institute',
    startDate: '2026-07-01',
    requirements: [],   // {_id, text, cat, due, done, notes} — cat: EPA-<name>, Block, Personal
    epas: [],           // {_id, name, target, count, done}
    cases: [],
    resources: [],
    journalEntries: [], // {date, text, savedAt}
    habitLog: [],       // {date, topics: []}
    dailyWins: { date: '', wins: ['', '', ''] },
    calMonth: new Date().getMonth(),
    calYear: new Date().getFullYear(),
    selectedRefTab: 'all',
    selectedCaseTags: ['All'],
    selectedCaseRotation: 'All',
    overlayTags: [],
  };

  // ── Init ──
  async function init() {
    const token = localStorage.getItem('notion_token');
    if (!token) { show('setup-screen'); return; }
    show('app');
    loadCache();
    bindNav();
    renderAll();
    setupOverlayDate();
    await syncAll();
  }

  function show(id) {
    document.getElementById('setup-screen').classList.add('hidden');
    document.getElementById('app').classList.add('hidden');
    document.getElementById(id).classList.remove('hidden');
  }

  async function saveToken() {
    const token = document.getElementById('token-input').value.trim();
    if (!token) return toast('Paste your Notion integration token first.');
    toast('Validating token…');
    try {
      const valid = await validateToken(token);
      if (!valid) return toast('Invalid token — check it and try again.');
      localStorage.setItem('notion_token', token);
      show('app');
      loadCache();
      bindNav();
      renderAll();
      setupOverlayDate();
      await syncAll();
    } catch (e) {
      toast('Connection failed. Check your network.');
    }
  }

  function logout() {
    localStorage.removeItem('notion_token');
    localStorage.removeItem(CACHE_KEY);
    location.reload();
  }

  // ── Cache ──
  function loadCache() {
    try {
      const d = localStorage.getItem(CACHE_KEY);
      if (d) state = { ...state, ...JSON.parse(d) };
    } catch {}
  }
  function saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch {}
  }

  // ── Notion field encoding ──
  // EPAs are stored as Requirements with cat = "EPA" and notes = JSON {target, count}
  function epaFromRequirement(r) {
    let meta = { target: 1, count: 0 };
    try { meta = { ...meta, ...JSON.parse(r.notes) }; } catch {}
    return { _id: r._id, name: r.text, target: meta.target, count: meta.count, done: r.done };
  }

  // ── Sync ──
  async function syncAll() {
    try {
      const [reqs, cases, resources] = await Promise.all([fetchRequirements(), fetchCases(), fetchResources()]);
      state.epas = reqs.filter(r => r.cat === 'EPA').map(epaFromRequirement);
      state.requirements = reqs.filter(r => r.cat !== 'EPA');
      state.cases = cases;
      // Resources of type Journal map to journal entries; everything else stays in resources
      state.journalEntries = resources.filter(r => r.type === 'Journal').map(r => ({
        _id: r._id, date: r.topic, text: r.name, savedAt: r.url || ''
      })).sort((a,b) => b.date.localeCompare(a.date));
      state.resources = resources.filter(r => r.type !== 'Journal');
      saveCache();
      renderAll();
      toast('Synced with Notion');
    } catch (e) {
      console.error('Sync error:', e);
      toast('Sync failed: ' + (e.message || 'unknown error') + ' — see console for details');
    }
  }

  // ── Navigation ──
  function bindNav() {
    document.querySelectorAll('.nav-item, .bottom-tab').forEach(btn => {
      btn.addEventListener('click', () => switchPanel(btn.dataset.panel));
    });
  }

  function switchPanel(name) {
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item, .bottom-tab').forEach(b => b.classList.remove('active'));
    document.getElementById('panel-' + name).classList.add('active');
    document.querySelectorAll(`[data-panel="${name}"]`).forEach(b => b.classList.add('active'));
    if (name === 'journal') loadTodayJournal();
  }

  // ── Render orchestration ──
  function renderAll() {
    safeRender(renderDashboard);
    safeRender(renderCalendar);
    safeRender(renderReferences);
    safeRender(renderRequirementsGoals);
    safeRender(renderCases);
    safeRender(renderJournalSidebar);
    safeRender(renderSettings);
  }

  function safeRender(fn) {
    try { fn(); } catch (e) { console.error(`Render error in ${fn.name}:`, e); }
  }

  // ════════ DASHBOARD ════════
  function dayCount() {
    const start = new Date(state.startDate || '2026-07-01');
    return Math.max(0, Math.floor((Date.now() - start) / 86400000));
  }

  function renderDashboard() {
    document.getElementById('dash-sub').textContent = `Day ${dayCount()} of residency · ${state.rotation || '—'}`;

    // EPA hero ring — use master list + epaProgress
    if (!state.epaProgress) state.epaProgress = {};
    const totalTarget = EPA_MASTER.filter(e => e.target !== null).reduce((s, e) => s + e.target, 0);
    const totalDone = EPA_MASTER.filter(e => e.target !== null).reduce((s, e) => s + Math.min(getEPAProgress(e.code).count || 0, e.target), 0);
    document.getElementById('epa-ring-frac').innerHTML = `${totalDone}<span>/${totalTarget}</span>`;
    const circumference = 351.8;
    const pct = totalTarget ? totalDone / totalTarget : 0;
    document.getElementById('epa-ring-fill').setAttribute('stroke-dashoffset', circumference - circumference * pct);

    // mini rings — show 3 priority EPAs for current rotation
    const matchKey = Object.keys(ROTATION_EPA_MAP).find(k => (state.rotation||'').toLowerCase().includes(k.toLowerCase())) || 'General';
    const priorityCodes = (ROTATION_EPA_MAP[matchKey] || []).slice(0, 3);
    const miniColors = ['#6B7FD8', '#0F6E56', '#B8860B'];
    const miniHtml = priorityCodes.map((code, i) => {
      const master = EPA_MASTER.find(e => e.code === code);
      if (!master) return '';
      const p = master.target ? Math.min(1, (getEPAProgress(code).count || 0) / master.target) : 0;
      const circ = 69.1;
      return `<div class="mini-ring-row">
        <svg class="mini-ring-svg" viewBox="0 0 28 28">
          <circle cx="14" cy="14" r="11" fill="none" stroke="#ECEAE5" stroke-width="4"/>
          <circle cx="14" cy="14" r="11" fill="none" stroke="${miniColors[i]}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${circ - circ * p}" transform="rotate(-90 14 14)"/>
        </svg>
        <span class="mini-ring-label">${esc(code)} — ${esc(master.name.slice(0, 38))}…</span>
      </div>`;
    }).join('');
    document.getElementById('mini-rings').innerHTML = miniHtml || '<div class="empty-state-mini">Set your rotation in Settings to see priority EPAs.</div>';

    renderStreak();
    renderWins();
    renderHabit();
    renderUpcoming('upcoming-list');
    renderMiniCalendar();
  }

  // ── Streak calculation (based on habitLog dates) ──
  function calcStreak(dateList) {
    const set = new Set(dateList);
    let count = 0;
    let d = new Date();
    // if today not logged, start checking from yesterday for "current" streak
    if (!set.has(fmtDate(d))) d.setDate(d.getDate() - 1);
    while (set.has(fmtDate(d))) {
      count++;
      d.setDate(d.getDate() - 1);
    }
    return count;
  }

  function calcLongestStreak(dateList) {
    if (!dateList.length) return 0;
    const dates = [...new Set(dateList)].sort();
    let longest = 1, current = 1;
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i-1]);
      const cur = new Date(dates[i]);
      const diff = Math.round((cur - prev) / 86400000);
      if (diff === 1) { current++; longest = Math.max(longest, current); }
      else current = 1;
    }
    return Math.max(longest, current);
  }

  function fmtDate(d) { return d.toISOString().slice(0, 10); }

  function renderStreak() {
    const dates = state.habitLog.map(h => h.date);
    const streak = calcStreak(dates);
    const longest = Math.max(calcLongestStreak(dates), streak);
    document.getElementById('streak-count').textContent = streak;
    document.getElementById('streak-best').textContent = `${longest} days`;

    const dotsEl = document.getElementById('streak-dots');
    const dayLabels = ['S','M','T','W','T','F','S'];
    let html = '';
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dStr = fmtDate(d);
      const isToday = i === 0;
      const done = dates.includes(dStr);
      const cls = isToday ? (done ? 'done today' : 'today') : (done ? 'done' : 'empty');
      html += `<div class="streak-dot ${cls}">${dayLabels[d.getDay()]}</div>`;
    }
    dotsEl.innerHTML = html;
  }

  // ── 3 wins ──
  function renderWins() {
    const today = fmtDate(new Date());
    if (state.dailyWins.date !== today) state.dailyWins = { date: today, wins: ['', '', ''] };
    const el = document.getElementById('wins-list');
    el.innerHTML = state.dailyWins.wins.map((w, i) => `
      <div class="win-input-row">
        <div class="win-num">${i+1}</div>
        <input type="text" class="win-text-input" value="${escAttr(w)}" placeholder="What would make today a win?" oninput="App.updateWin(${i}, this.value)">
      </div>
    `).join('');
  }

  function updateWin(i, val) {
    state.dailyWins.wins[i] = val;
    saveCache();
  }

  // ── Habit tracker ──
  function renderHabit() {
    const today = fmtDate(new Date());
    const entry = state.habitLog.find(h => h.date === today);
    const checkEl = document.getElementById('habit-check');
    const subEl = document.getElementById('habit-sub');
    const topicsEl = document.getElementById('habit-topics-display');
    if (entry) {
      checkEl.classList.add('done');
      subEl.textContent = 'Logged today';
      topicsEl.innerHTML = (entry.topics || []).map(t => `<span class="habit-topic-tag">${esc(t)}</span>`).join('');
    } else {
      checkEl.classList.remove('done');
      subEl.textContent = 'Tap to check in';
      topicsEl.innerHTML = '';
    }
  }

  function toggleHabit() {
    const today = fmtDate(new Date());
    const idx = state.habitLog.findIndex(h => h.date === today);
    if (idx >= 0) {
      state.habitLog.splice(idx, 1);
    } else {
      const topics = prompt('What did you study? (comma-separated, optional)') || '';
      state.habitLog.push({ date: today, topics: topics.split(',').map(t => t.trim()).filter(Boolean) });
    }
    saveCache();
    renderDashboard();
  }

  // ── Upcoming (shared between dashboard + calendar) ──
  function getUpcomingItems() {
    const items = [];
    state.requirements.forEach(r => {
      if (r.done || !r.due) return;
      items.push({ text: r.text, sub: r.cat === 'Block' ? 'Block requirement' : (r.cat === 'Personal' ? 'Personal goal' : r.cat), due: r.due, _id: r._id, kind: 'requirement' });
    });
    return items;
  }

  function renderUpcoming(targetId) {
    const items = getUpcomingItems();
    const el = document.getElementById(targetId);
    if (!items.length) { el.innerHTML = '<div class="empty-state-mini">Nothing due. You\'re on top of it.</div>'; return; }
    el.innerHTML = items.map(item => {
      const badge = guessUrgency(item.due);
      return `<div class="upcoming-item">
        <div class="up-check" onclick="App.completeRequirement('${item._id}')"></div>
        <div style="flex:1;">
          <div class="up-text">${esc(item.text)}</div>
          <div class="up-meta">${esc(item.sub)}</div>
        </div>
        <span class="up-badge ${badge.cls}">${esc(badge.label || item.due)}</span>
      </div>`;
    }).join('');
  }

  function guessUrgency(due) {
    // best-effort: if due contains a number + "day", treat urgency by that number
    const m = due.match(/(\d+)\s*day/i);
    if (m) {
      const n = parseInt(m[1]);
      if (n <= 5) return { cls: 'urgent', label: `Due in ${n} days` };
      return { cls: 'soon', label: `Due in ${n} days` };
    }
    return { cls: 'normal', label: due };
  }

  async function completeRequirement(id) {
    const r = state.requirements.find(x => x._id === id);
    if (!r) return;
    r.done = true;
    saveCache();
    renderAll();
    try { await updateRequirement(id, { done: true }); toast('Marked complete'); } catch { toast('Saved locally — sync to push to Notion'); }
  }

  // ── Mini calendar (dashboard) ──
  function activityForDate(dStr) {
    const acts = [];
    if (state.journalEntries.some(j => j.date === dStr)) acts.push({ key: 'journal', color: '#B8860B' });
    if (state.cases.some(c => normalizeDate(c.date) === dStr)) acts.push({ key: 'case', color: '#0F6E56' });
    if (state.habitLog.some(h => h.date === dStr)) acts.push({ key: 'habit', color: '#6B7FD8' });
    (state.calendarEvents || []).forEach(e => {
      const onDay = e.endDate ? (dStr >= e.date && dStr <= e.endDate) : e.date === dStr;
      if (onDay) acts.push({ key: e.type.toLowerCase(), color: EVENT_COLORS[e.type] || '#A3A8AE' });
    });
    // deduplicate by color
    const seen = new Set();
    return acts.filter(a => { if (seen.has(a.color)) return false; seen.add(a.color); return true; });
  }

  function normalizeDate(str) {
    // best-effort parse of free-text dates like "Jun 29" -> current-year ISO; fallback to raw string match
    if (!str) return '';
    const d = new Date(str + ' ' + new Date().getFullYear());
    if (!isNaN(d)) return fmtDate(d);
    return str;
  }

  function renderMiniCalendar() {
    const now = new Date();
    const year = now.getFullYear(), month = now.getMonth();
    document.getElementById('dash-cal-month').textContent = now.toLocaleString('default', { month: 'long' });
    const grid = document.getElementById('mini-cal-grid');
    grid.innerHTML = buildCalGrid(year, month, true);
  }

  function buildCalGrid(year, month, mini) {
    const first = new Date(year, month, 1);
    const startOffset = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = fmtDate(new Date());
    let html = '';
    const dowRow = mini ? '' : '';
    for (let i = 0; i < startOffset; i++) {
      const d = new Date(year, month, 1 - (startOffset - i));
      html += `<div class="cal-day muted">${d.getDate()}</div>`;
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month, day);
      const dStr = fmtDate(d);
      const isToday = dStr === today;
      const acts = activityForDate(dStr);
      const dots = acts.slice(0, 4).map(a => `<div class="cal-dot" style="background:${a.color}"></div>`).join('');
      html += `<div class="cal-day ${isToday ? 'today' : ''}" onclick="App.selectCalDay('${dStr}')">${day}${dots ? `<div class="cal-dots">${dots}</div>` : ''}</div>`;
    }
    const totalCells = startOffset + daysInMonth;
    const trailing = (7 - (totalCells % 7)) % 7;
    for (let i = 1; i <= trailing; i++) html += `<div class="cal-day muted">${i}</div>`;
    return html;
  }

  // ════════ CALENDAR (full page) ════════

  const EVENT_COLORS = {
    Rotation: '#0F6E56', Academic: '#6B7FD8', Call: '#B8860B',
    Deadline: '#C75450', OR: '#9B7FD8', Note: '#A3A8AE',
  };

  function renderCalendar() {
    const label = new Date(state.calYear, state.calMonth, 1)
      .toLocaleString('default', { month: 'long', year: 'numeric' });
    document.getElementById('cal-month-label').textContent = label;
    document.getElementById('cal-grid-full').innerHTML = buildCalGrid(state.calYear, state.calMonth, false);
    renderCalUpcoming();
  }

  function renderCalUpcoming() {
    const el = document.getElementById('cal-upcoming-mini');
    if (!el) return;
    const items = getUpcomingItems();
    const dlEvents = (state.calendarEvents || [])
      .filter(e => e.type === 'Deadline')
      .map(e => ({ text: e.title, sub: e.subtitle || 'Deadline', due: e.date, _id: e.id, kind: 'event' }));
    const all = [...items, ...dlEvents].slice(0, 5);
    if (!all.length) { el.innerHTML = '<div class="empty-state-mini">Nothing due.</div>'; return; }
    el.innerHTML = all.map(item => {
      const badge = guessUrgency(item.due);
      return `<div class="upcoming-mini-item">
        <div class="up-check-mini"></div>
        <span class="up-text-mini">${esc(item.text)}</span>
        <span class="up-badge-mini ${badge.cls === 'urgent' ? 'urgent' : 'soon'}">${esc(badge.label)}</span>
      </div>`;
    }).join('');
  }

  function calPrevMonth() {
    state.calMonth--;
    if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
    renderCalendar();
  }
  function calNextMonth() {
    state.calMonth++;
    if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
    renderCalendar();
  }
  function calGoToday() {
    const now = new Date();
    state.calMonth = now.getMonth();
    state.calYear = now.getFullYear();
    renderCalendar();
  }

  let currentEventType = 'Rotation';

  function openCalEventForm(prefillDate) {
    currentEventType = 'Rotation';
    document.querySelectorAll('.event-type-chip').forEach(c => c.classList.remove('active'));
    const rotChip = document.querySelector('[data-type="Rotation"]');
    if (rotChip) rotChip.classList.add('active');
    document.querySelectorAll('.event-fields').forEach(f => f.classList.add('hidden'));
    const rotFields = document.getElementById('fields-Rotation');
    if (rotFields) rotFields.classList.remove('hidden');
    const d = prefillDate || fmtDate(new Date());
    ['rot-start','rot-end','acad-date','call-date','dl-date','or-date','note-date'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = d;
    });
    document.getElementById('cal-event-overlay').classList.remove('hidden');
  }

  function closeCalEventForm() {
    document.getElementById('cal-event-overlay').classList.add('hidden');
  }

  function selectEventType(type, chip) {
    currentEventType = type;
    document.querySelectorAll('.event-type-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    document.querySelectorAll('.event-fields').forEach(f => f.classList.add('hidden'));
    document.getElementById('fields-' + type).classList.remove('hidden');
  }

  function saveCalEvent() {
    if (!state.calendarEvents) state.calendarEvents = [];
    let event = { id: Date.now().toString(), type: currentEventType, color: EVENT_COLORS[currentEventType] };
    switch (currentEventType) {
      case 'Rotation':
        event.title = document.getElementById('rot-name').value.trim();
        event.date = document.getElementById('rot-start').value;
        event.endDate = document.getElementById('rot-end').value;
        event.subtitle = `${event.date} → ${event.endDate}`;
        break;
      case 'Academic':
        event.title = document.getElementById('acad-title').value.trim();
        event.date = document.getElementById('acad-date').value;
        event.subtitle = [document.getElementById('acad-time').value, document.getElementById('acad-location').value].filter(Boolean).join(' · ');
        break;
      case 'Call':
        event.title = document.getElementById('call-type').value;
        event.date = document.getElementById('call-date').value;
        event.subtitle = document.getElementById('call-notes').value.trim();
        break;
      case 'Deadline':
        event.title = document.getElementById('dl-title').value.trim();
        event.date = document.getElementById('dl-date').value;
        event.subtitle = document.getElementById('dl-cat').value;
        break;
      case 'OR':
        const room = document.getElementById('or-room').value.trim();
        const attending = document.getElementById('or-attending').value.trim();
        const caseType = document.getElementById('or-case').value.trim();
        event.date = document.getElementById('or-date').value;
        event.title = [room, attending].filter(Boolean).join(' · ');
        event.subtitle = caseType;
        break;
      case 'Note':
        event.title = document.getElementById('note-text').value.trim();
        event.date = document.getElementById('note-date').value;
        event.subtitle = 'Personal note';
        break;
    }
    if (!event.title || !event.date) return toast('Please fill in the required fields.');
    state.calendarEvents.push(event);
    closeCalEventForm();
    saveCache();
    renderCalendar();
    toast('Event saved');
  }

  function selectCalDay(dStr) {
    document.getElementById('day-detail-date').textContent =
      new Date(dStr + 'T12:00:00').toLocaleDateString('default', { weekday: 'long', month: 'short', day: 'numeric' });
    const body = document.getElementById('day-detail-body');
    let html = '';
    const dayEvents = (state.calendarEvents || []).filter(e => {
      if (e.endDate) return dStr >= e.date && dStr <= e.endDate;
      return e.date === dStr;
    });
    dayEvents.forEach(e => {
      html += `<div class="detail-event-row">
        <div class="detail-event-dot" style="background:${e.color}"></div>
        <div><div class="detail-event-title">${esc(e.title)}</div>${e.subtitle ? `<div class="detail-event-sub">${esc(e.subtitle)}</div>` : ''}</div>
      </div>`;
    });
    const journal = state.journalEntries.find(j => j.date === dStr);
    if (journal) html += `<div class="detail-event-row"><div class="detail-event-dot" style="background:#B8860B"></div><div><div class="detail-event-title">Journal entry</div><div class="detail-event-sub">${esc(journal.text.slice(0,60))}…</div></div></div>`;
    const dayCases = state.cases.filter(c => normalizeDate(c.date) === dStr);
    dayCases.forEach(c => {
      html += `<div class="detail-event-row"><div class="detail-event-dot" style="background:#0F6E56"></div><div><div class="detail-event-title">${esc(c.title)}</div><div class="detail-event-sub">${esc(c.rotation || '')}</div></div></div>`;
    });
    const habit = state.habitLog.find(h => h.date === dStr);
    if (habit) html += `<div class="detail-event-row"><div class="detail-event-dot" style="background:#6B7FD8"></div><div><div class="detail-event-title">Studied</div><div class="detail-event-sub">${esc((habit.topics||[]).join(', ') || 'No topics logged')}</div></div></div>`;
    if (!html) html = '<div class="empty-state-mini">Nothing on this day.</div>';
    body.innerHTML = html;
  }

  // ════════ REFERENCES ════════
  function setRefTab(tab) {
    state.selectedRefTab = tab;
    document.querySelectorAll('.page-tab').forEach(t => t.classList.toggle('active', t.dataset.reftab === tab || (tab === 'all' && t.dataset.reftab === 'all')));
    renderReferences();
  }

  function openResourceForm() {
    document.getElementById('resource-form').classList.toggle('hidden');
  }

  async function addResource() {
    const name = document.getElementById('res-name').value.trim();
    if (!name) return;
    const res = {
      name,
      type: document.getElementById('res-type').value,
      url: document.getElementById('res-url').value.trim(),
      topic: document.getElementById('res-topic').value.trim(),
    };
    state.resources.unshift(res);
    document.getElementById('res-name').value = '';
    document.getElementById('res-url').value = '';
    document.getElementById('res-topic').value = '';
    document.getElementById('resource-form').classList.add('hidden');
    renderReferences();
    saveCache();
    try { res._id = await createResource(res); saveCache(); toast('Saved to Notion'); }
    catch { toast('Saved locally — sync to push to Notion'); }
  }

  async function deleteResource(i) {
    const r = state.resources[i];
    state.resources.splice(i, 1);
    renderReferences();
    saveCache();
    if (r._id) { try { await deleteNotionPage(r._id); } catch {} }
  }

  function renderReferences() {
    document.getElementById('qr-drug-count').textContent = `${state.resources.filter(r => r.type === 'Drug').length} entries`;
    document.getElementById('qr-mnem-count').textContent = `${state.resources.filter(r => r.type === 'Mnemonic').length} entries`;

    const topics = ['All', ...new Set(state.resources.map(r => r.topic).filter(Boolean))];
    document.getElementById('res-topic-filters').innerHTML = topics.map(t =>
      `<button class="chip ${t === 'All' ? 'active' : ''}" onclick="App.filterResTopic('${escAttr(t)}', this)">${esc(t)}</button>`
    ).join('');

    let filtered = state.resources;
    if (state.selectedRefTab !== 'all') filtered = filtered.filter(r => r.type === state.selectedRefTab);

    const list = document.getElementById('resource-list');
    if (!filtered.length) { list.innerHTML = '<div class="empty-state">No resources yet. Add one above.</div>'; return; }

    const icons = { PDF: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6', Video: 'M23 7l-7 5 7 5V7z M16 5H1v14h15V5z', Link: 'M10 13a5 5 0 007.07 0l2.83-2.83a5 5 0 10-7.07-7.07l-1 1 M14 11a5 5 0 00-7.07 0L4.1 13.83a5 5 0 107.07 7.07l1-1', Note: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7 M18.5 2.5a2.12 2.12 0 113 3L12 15l-4 1 1-4z', Drug: 'M10.5 20.5L3.5 13.5a5 5 0 117.07-7.07l7 7a5 5 0 11-7.07 7.07z M8.5 8.5l7 7', Mnemonic: 'M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z' };
    const typeClass = { PDF: 'pdf', Video: 'video', Link: 'link', Note: 'note', Drug: 'drug', Mnemonic: 'mnemonic' };

    list.innerHTML = filtered.map((r) => {
      const cls = typeClass[r.type] || 'link';
      const path = icons[r.type] || icons.Link;
      return `<div class="resource-row">
        <div class="res-icon ${cls}"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path.split(' M').map((p,i)=>`<path d="${i===0?p:'M'+p}"/>`).join('')}</svg></div>
        <div class="res-info">
          ${r.url ? `<a href="${escAttr(r.url)}" target="_blank" class="res-name">${esc(r.name)}</a>` : `<div class="res-name">${esc(r.name)}</div>`}
          <div class="res-meta">${esc(r.topic || 'General')}</div>
        </div>
        <span class="res-type-pill ${cls}">${esc(r.type)}</span>
        <button class="del-btn" onclick="App.deleteResource(${state.resources.indexOf(r)})">×</button>
      </div>`;
    }).join('');
  }

  function filterResTopic(topic, btn) {
    document.querySelectorAll('#res-topic-filters .chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    let filtered = topic === 'All' ? state.resources : state.resources.filter(r => r.topic === topic);
    if (state.selectedRefTab !== 'all') filtered = filtered.filter(r => r.type === state.selectedRefTab);
    // quick re-render with filtered set by temporarily swapping
    const original = state.resources;
    state.resources = filtered;
    renderReferences();
    state.resources = original;
  }

  // bind ref tab clicks
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.page-tab').forEach(tab => {
      tab.addEventListener('click', () => setRefTab(tab.dataset.reftab));
    });
  });

  // ════════ REQUIREMENTS & GOALS ════════
  function openGoalForm() { document.getElementById('goal-form').classList.toggle('hidden'); }
  function openEPAForm() { /* EPAs now use master list */ }
  function openBlockGoalForm() { document.getElementById('block-goal-form').classList.toggle('hidden'); }
  function openPersonalGoalForm() { document.getElementById('personal-goal-form').classList.toggle('hidden'); }

  async function addBlockGoal() {
    const text = document.getElementById('block-goal-text').value.trim();
    if (!text) return;
    const goal = { text, cat: 'Block', due: document.getElementById('block-goal-due').value.trim(), done: false, notes: '' };
    state.requirements.push(goal);
    document.getElementById('block-goal-text').value = '';
    document.getElementById('block-goal-due').value = '';
    document.getElementById('block-goal-form').classList.add('hidden');
    renderAll(); saveCache();
    try { goal._id = await createRequirement(goal); saveCache(); toast('Saved to Notion'); }
    catch { toast('Saved locally — sync to push to Notion'); }
  }

  async function addPersonalGoal() {
    const text = document.getElementById('personal-goal-text').value.trim();
    if (!text) return;
    const goal = { text, cat: 'Personal', due: '', done: false, notes: '' };
    state.requirements.push(goal);
    document.getElementById('personal-goal-text').value = '';
    document.getElementById('personal-goal-form').classList.add('hidden');
    renderAll(); saveCache();
    try { goal._id = await createRequirement(goal); saveCache(); toast('Saved to Notion'); }
    catch { toast('Saved locally — sync to push to Notion'); }
  }

  async function addGoal() {
    const text = document.getElementById('goal-text').value.trim();
    if (!text) return;
    const goal = { text, cat: document.getElementById('goal-type').value, due: document.getElementById('goal-due').value.trim(), done: false, notes: '' };
    state.requirements.push(goal);
    document.getElementById('goal-text').value = '';
    document.getElementById('goal-due').value = '';
    document.getElementById('goal-form').classList.add('hidden');
    renderRequirementsGoals(); saveCache();
    try { goal._id = await createRequirement(goal); saveCache(); toast('Saved to Notion'); }
    catch { toast('Saved locally — sync to push to Notion'); }
  }

  async function toggleGoal(id) {
    const g = state.requirements.find(r => r._id === id);
    if (!g) return;
    g.done = !g.done;
    renderAll(); saveCache();
    if (g._id) { try { await updateRequirement(g._id, { done: g.done }); } catch {} }
  }

  // ── EPA Master List system ──
  function getEPAProgress(code) {
    if (!state.epaProgress) state.epaProgress = {};
    return state.epaProgress[code] || { count: 0, notionId: null };
  }

  let currentEPAView = 'rotation';
  let currentEPAStageFilter = 'All';

  function setEPAView(view) {
    currentEPAView = view;
    document.getElementById('pill-rotation').classList.toggle('active', view === 'rotation');
    document.getElementById('pill-all').classList.toggle('active', view === 'all');
    document.getElementById('epa-view-rotation').style.display = view === 'rotation' ? '' : 'none';
    document.getElementById('epa-view-all').style.display = view === 'all' ? '' : 'none';
    if (view === 'all') renderEPAAll();
  }

  async function logEPAByCode(code) {
    if (!state.epaProgress) state.epaProgress = {};
    if (!state.epaProgress[code]) state.epaProgress[code] = { count: 0, notionId: null };
    state.epaProgress[code].count++;
    const master = EPA_MASTER.find(e => e.code === code);
    const count = state.epaProgress[code].count;
    const target = master ? master.target : 1;
    const done = target !== null && count >= target;
    saveCache();
    renderRequirementsGoals();
    toast(done ? code + ' complete! ' + count + '/' + target : code + ' logged — ' + count + '/' + (target || '?'));
    try {
      const prog = state.epaProgress[code];
      if (prog.notionId) {
        await updateRequirement(prog.notionId, { done, notes: JSON.stringify({ count, target, code }) });
      } else {
        const id = await createRequirement({
          text: master ? master.name : code,
          cat: 'EPA', due: '', done,
          notes: JSON.stringify({ count, target, code })
        });
        state.epaProgress[code].notionId = id;
        saveCache();
      }
    } catch { /* saved locally */ }
  }

  function renderRequirementsGoals() {
    renderEPARotationView();
    renderEPAOverallBadge();
    const blockGoals = state.requirements.filter(r => r.cat === 'Block');
    const blockEl = document.getElementById('block-goal-list');
    if (blockEl) blockEl.innerHTML = blockGoals.length
      ? blockGoals.map(g => goalRowHTML(g, 'mandatory')).join('')
      : '<div class="empty-state">No block requirements yet.</div>';
    const personalGoals = state.requirements.filter(r => r.cat === 'Personal');
    const active = personalGoals.filter(g => !g.done && !g.deferred);
    const deferred = personalGoals.filter(g => !g.done && g.deferred);
    const accomplished = personalGoals.filter(g => g.done);
    const persEl = document.getElementById('personal-goal-list');
    if (!persEl) return;
    let html = '';
    if (!personalGoals.length) {
      html = '<div class="empty-state">No personal goals yet.</div>';
    } else {
      html += active.map(g => personalGoalRowHTML(g)).join('');
      if (!active.length && !deferred.length) html += '<div class="empty-state" style="padding:12px 0;">No active goals.</div>';
      if (deferred.length) { html += '<div class="goal-sub-heading"><span>Deferred</span></div>'; html += deferred.map(g => personalGoalRowHTML(g)).join(''); }
      if (accomplished.length) { html += '<div class="goal-sub-heading accomplished"><span>Accomplished</span><span class="goal-sub-count">' + accomplished.length + '</span></div>'; html += accomplished.map(g => personalGoalRowHTML(g)).join(''); }
    }
    persEl.innerHTML = html;
  }

  function renderEPAOverallBadge() {
    const total = EPA_MASTER.filter(e => e.target !== null).length;
    const done = EPA_MASTER.filter(e => e.target !== null && (getEPAProgress(e.code).count || 0) >= e.target).length;
    const el = document.getElementById('epa-overall-badge');
    if (el) el.textContent = done + ' / ' + total + ' complete';
  }

  function renderEPARotationView() {
    const rotation = state.rotation || '';
    const matchKey = Object.keys(ROTATION_EPA_MAP).find(k => rotation.toLowerCase().includes(k.toLowerCase())) || 'General';
    const priorityCodes = ROTATION_EPA_MAP[matchKey] || [];
    const banner = document.getElementById('epa-rotation-banner');
    if (banner) banner.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg> Priority EPAs for <strong style="margin-left:4px;">' + esc(rotation || 'your current rotation') + '</strong>';
    const priorityEPAs = EPA_MASTER.filter(e => priorityCodes.includes(e.code));
    const list = document.getElementById('epa-list-rotation');
    if (!list) return;
    if (!priorityEPAs.length) { list.innerHTML = '<div class="empty-state">No rotation matched. Update your rotation in Settings, or tap "All EPAs" to access the full list.</div>'; return; }
    list.innerHTML = priorityEPAs.map(e => epaRowHTML(e, true)).join('');
  }

  function renderEPAAll() {
    const stages = ['All', 'Transition to Discipline', 'Foundations of Discipline', 'Core Discipline', 'Transition to Practice'];
    const filterEl = document.getElementById('epa-stage-filters');
    if (filterEl) filterEl.innerHTML = stages.map(s => '<button class="chip ' + (currentEPAStageFilter === s ? 'active' : '') + '" onclick="App.filterEPAStage(\'' + escAttr(s) + '\')">' + (s === 'All' ? 'All stages' : esc(s)) + '</button>').join('');
    const grouped = {};
    EPA_MASTER.forEach(e => {
      if (currentEPAStageFilter !== 'All' && e.stage !== currentEPAStageFilter) return;
      if (!grouped[e.stage]) grouped[e.stage] = [];
      grouped[e.stage].push(e);
    });
    const list = document.getElementById('epa-list-all');
    if (!list) return;
    let html = '';
    Object.entries(grouped).forEach(function([stage, epas]) {
      const color = STAGE_COLORS[stage] || '#A3A8AE';
      const doneCount = epas.filter(e => e.target !== null && (getEPAProgress(e.code).count || 0) >= e.target).length;
      html += '<div class="epa-stage-group"><div class="epa-stage-heading"><div class="epa-stage-dot" style="background:' + color + '"></div><span>' + esc(stage) + '</span><span class="epa-stage-count">' + doneCount + '/' + epas.length + ' complete</span></div>' + epas.map(e => epaRowHTML(e, false)).join('') + '</div>';
    });
    list.innerHTML = html;
  }

  function filterEPAStage(stage) {
    currentEPAStageFilter = stage;
    renderEPAAll();
  }

  function epaRowHTML(e, isPriority) {
    const prog = getEPAProgress(e.code);
    const count = prog.count || 0;
    const target = e.target;
    const done = target !== null && count >= target;
    const pct = target ? Math.min(100, Math.round((count / target) * 100)) : 0;
    const stageColor = STAGE_COLORS[e.stage] || '#A3A8AE';
    if (done) {
      return '<div class="epa-counter-row complete' + (isPriority ? ' priority' : '') + '"><div class="epa-status-icon complete"><svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div><div class="epa-row-info"><div class="epa-row-name complete"><span style="color:' + stageColor + ';font-weight:700;margin-right:6px;">' + esc(e.code) + '</span>' + esc(e.name) + '</div><div class="epa-mini-progress"><div class="epa-mini-bar"><div class="epa-mini-bar-fill complete" style="width:100%;"></div></div><span class="epa-count-text complete">' + count + ' / ' + target + '</span></div></div><div class="epa-done-badge"><svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Done</div></div>';
    }
    return '<div class="epa-counter-row' + (isPriority ? ' priority' : '') + '"><div class="epa-status-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg></div><div class="epa-row-info"><div class="epa-row-name"><span style="color:' + stageColor + ';font-weight:700;margin-right:6px;">' + esc(e.code) + '</span>' + esc(e.name) + '</div><div class="epa-mini-progress"><div class="epa-mini-bar"><div class="epa-mini-bar-fill" style="width:' + pct + '%;background:' + stageColor + ';"></div></div><span class="epa-count-text">' + count + ' / ' + (target !== null ? target : 'N/A') + '</span></div></div>' + (isPriority ? '<span class="epa-priority-badge">Priority</span>' : '') + '<div class="epa-increment-btn" onclick="App.logEPAByCode(\'' + escAttr(e.code) + '\')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>Log one</div></div>';
  }

  function personalGoalRowHTML(g) {
    const isDeferred = g.deferred && !g.done;
    const isDone = g.done;
    const id = g._id || '';
    return '<div class="goal-row personal ' + (isDeferred ? 'deferred' : '') + ' ' + (isDone ? 'accomplished-row' : '') + '"><div class="goal-check ' + (isDone ? 'done' : '') + '" onclick="App.togglePersonalGoal(\'' + id + '\')"></div><div style="flex:1;"><div class="goal-text ' + (isDone ? 'done' : '') + ' ' + (isDeferred ? 'deferred-text' : '') + '">' + esc(g.text) + '</div></div>' + (isDone ? '<span class="goal-state-badge accomplished">\u2713 Done</span>' : isDeferred ? '<span class="goal-state-badge deferred-badge" onclick="App.undefer(\'' + id + '\')">Deferred · undo</span>' : '<span class="goal-state-badge defer-btn" onclick="App.deferGoal(\'' + id + '\')">Defer</span>') + '</div>';
  }

  function goalRowHTML(g, kind) {
    const tagLabel = kind === 'mandatory' ? 'Block goal' : 'Personal';
    const id = g._id || '';
    return '<div class="goal-row ' + kind + '"><div class="goal-check ' + (g.done ? 'done' : '') + '" onclick="App.toggleGoal(\'' + id + '\')"></div><div style="flex:1;"><div class="goal-text ' + (g.done ? 'done' : '') + '">' + esc(g.text) + '</div></div><span class="goal-tag ' + kind + '">' + tagLabel + '</span>' + (g.due ? '<span class="goal-due ' + (guessUrgency(g.due).cls === 'urgent' ? 'urgent' : 'normal') + '">' + esc(g.due) + '</span>' : '') + '</div>';
  }

  async function togglePersonalGoal(id) {
    const g = state.requirements.find(r => r._id === id);
    if (!g) return;
    g.done = !g.done;
    if (g.done) g.deferred = false;
    renderAll(); saveCache();
    if (g._id) { try { await updateRequirement(g._id, { done: g.done }); } catch {} }
  }

  async function deferGoal(id) {
    const g = state.requirements.find(r => r._id === id);
    if (!g) return;
    g.deferred = true;
    renderAll(); saveCache();
    toast('Goal deferred');
  }

  async function undefer(id) {
    const g = state.requirements.find(r => r._id === id);
    if (!g) return;
    g.deferred = false;
    renderAll(); saveCache();
    toast('Goal moved back to active');
  }

    function renderCases() {
    document.getElementById('case-count-sub').textContent = `${state.cases.length} cases logged`;

    const rotations = ['All', ...new Set(state.cases.map(c => c.rotation).filter(Boolean))];
    const tags = ['All', ...new Set(state.cases.flatMap(c => c.tags || []))];

    let filtered = state.cases;
    if (state.selectedCaseRotation !== 'All') filtered = filtered.filter(c => c.rotation === state.selectedCaseRotation);
    if (!state.selectedCaseTags.includes('All')) filtered = filtered.filter(c => (c.tags||[]).some(t => state.selectedCaseTags.includes(t)));

    document.getElementById('case-filters').innerHTML = `
      <select class="dropdown-filter" onchange="App.filterCaseRotation(this.value)" style="border:1px solid var(--border); border-radius:20px; padding:6px 12px; font-size:12.5px;">
        ${rotations.map(r => `<option value="${escAttr(r)}" ${r===state.selectedCaseRotation?'selected':''}>${r==='All'?'All rotations':esc(r)}</option>`).join('')}
      </select>
      <div class="filter-divider"></div>
      ${tags.map(t => `<div class="chip ${state.selectedCaseTags.includes(t) ? 'active' : ''}" onclick="App.toggleCaseTag('${escAttr(t)}')">${t === 'All' ? 'All tags' : esc(t)}</div>`).join('')}
    `;

    document.getElementById('case-results-count').textContent = `Showing ${filtered.length} of ${state.cases.length} cases`;

    const list = document.getElementById('case-list');
    if (!filtered.length) { list.innerHTML = '<div class="empty-state">No cases match these filters.</div>'; return; }

    list.innerHTML = filtered.map((c) => {
      const idx = state.cases.indexOf(c);
      return `<div class="case-row" id="case-row-${idx}">
        <div class="case-row-head" onclick="App.toggleCaseRow(${idx})">
          <svg class="case-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          <span class="case-row-title">${esc(c.title)}</span>
          ${c.rotation ? `<span class="case-row-rotation">${esc(c.rotation)}</span>` : ''}
          <span class="case-row-date">${esc(c.date || '')}</span>
        </div>
        <div class="case-row-body">
          ${c.tags && c.tags.length ? `<div class="case-tags-row">${c.tags.map(t => `<span class="case-tag">${esc(t)}</span>`).join('')}</div>` : ''}
          ${c.pearl ? `<div class="case-detail-label">What I wanted to learn</div><div class="case-detail-text">${esc(c.pearl)}</div>` : ''}
          ${c.drugs ? `<div class="case-detail-label drugs">Drugs / doses</div><div class="case-detail-text">${esc(c.drugs)}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  function toggleCaseRow(idx) {
    document.getElementById(`case-row-${idx}`).classList.toggle('expanded');
  }

  function filterCaseRotation(val) { state.selectedCaseRotation = val; renderCases(); }
  function toggleCaseTag(tag) {
    if (tag === 'All') state.selectedCaseTags = ['All'];
    else {
      state.selectedCaseTags = state.selectedCaseTags.filter(t => t !== 'All');
      if (state.selectedCaseTags.includes(tag)) state.selectedCaseTags = state.selectedCaseTags.filter(t => t !== tag);
      else state.selectedCaseTags.push(tag);
      if (!state.selectedCaseTags.length) state.selectedCaseTags = ['All'];
    }
    renderCases();
  }

  // ── Full screen case overlay ──
  function setupOverlayDate() {
    const dateField = document.getElementById('ov-case-date');
    if (dateField) dateField.value = new Date().toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function openCaseOverlay() {
    state.overlayTags = [];
    document.getElementById('ov-case-title').value = '';
    document.getElementById('ov-case-rotation').value = state.rotation || '';
    document.getElementById('ov-case-pearl').value = '';
    document.getElementById('ov-case-drugs').value = '';
    document.getElementById('ov-case-link').value = '';
    document.querySelectorAll('#ov-tag-picker .tag-pick-chip').forEach(c => c.classList.remove('selected'));
    document.getElementById('case-overlay').classList.remove('hidden');
  }

  function closeCaseOverlay() {
    document.getElementById('case-overlay').classList.add('hidden');
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('#ov-tag-picker .tag-pick-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('selected');
        const tag = chip.dataset.tag;
        if (chip.classList.contains('selected')) state.overlayTags.push(tag);
        else state.overlayTags = state.overlayTags.filter(t => t !== tag);
      });
    });
  });

  async function saveCaseFromOverlay() {
    const title = document.getElementById('ov-case-title').value.trim();
    if (!title) return toast('Give the case a title first.');
    const link = document.getElementById('ov-case-link').value.trim();
    const pearl = document.getElementById('ov-case-pearl').value.trim();
    const c = {
      title,
      rotation: document.getElementById('ov-case-rotation').value.trim(),
      date: document.getElementById('ov-case-date').value.trim(),
      tags: [...state.overlayTags],
      pearl: link ? `${pearl}${pearl ? ' ' : ''}[Link: ${link}]` : pearl,
      drugs: document.getElementById('ov-case-drugs').value.trim(),
    };
    state.cases.unshift(c);
    closeCaseOverlay();
    renderAll();
    saveCache();
    toast('Case saved — pushing to Notion…');
    try { c._id = await createCase(c); saveCache(); toast('Case logged in Notion'); }
    catch { toast('Saved locally — sync to push to Notion'); }
  }

  // ════════ JOURNAL ════════
  function loadTodayJournal() {
    const today = fmtDate(new Date());
    document.getElementById('journal-date').textContent = new Date().toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' });
    const existing = state.journalEntries.find(j => j.date === today);
    document.getElementById('journal-textarea').value = existing ? existing.text : '';
    document.getElementById('journal-save-status').textContent = existing ? `Saved` : 'Not saved yet';
    renderJournalSidebar();
  }

  async function saveJournalEntry() {
    const today = fmtDate(new Date());
    const text = document.getElementById('journal-textarea').value.trim();
    if (!text) return toast('Write something before saving.');
    let entry = state.journalEntries.find(j => j.date === today);
    if (entry) entry.text = text;
    else { entry = { date: today, text }; state.journalEntries.unshift(entry); }
    document.getElementById('journal-save-status').textContent = 'Saved just now';
    renderAll();
    saveCache();
    if (!entry._id) {
      try {
        entry._id = await createResource({ name: text.slice(0, 200), type: 'Journal', url: '', topic: today });
        saveCache();
        toast('Journal entry saved to Notion');
      } catch { toast('Saved locally — sync to push to Notion'); }
    } else {
      toast('Saved locally — full edits sync on next Notion update');
    }
  }

  function renderJournalSidebar() {
    const dates = state.journalEntries.map(j => j.date);
    const streak = calcStreak(dates);
    const longest = Math.max(calcLongestStreak(dates), streak);
    const countEl = document.getElementById('journal-streak-count');
    const bestEl = document.getElementById('journal-streak-best');
    if (countEl) countEl.textContent = streak;
    if (bestEl) bestEl.textContent = `${longest} days`;

    const listEl = document.getElementById('past-entries-list');
    if (!listEl) return;
    if (!state.journalEntries.length) { listEl.innerHTML = '<div class="empty-state">No entries yet.</div>'; return; }
    listEl.innerHTML = state.journalEntries.slice(0, 10).map(j => `
      <div class="past-entry-item" onclick="App.viewPastEntry('${j.date}')">
        <div class="past-entry-date">${new Date(j.date).toLocaleDateString('default', { weekday: 'long', month: 'short', day: 'numeric' })}</div>
        <div class="past-entry-preview">${esc(j.text)}</div>
      </div>
    `).join('');
  }

  function viewPastEntry(date) {
    const entry = state.journalEntries.find(j => j.date === date);
    if (!entry) return;
    document.getElementById('journal-date').textContent = new Date(date).toLocaleDateString('default', { weekday: 'long', month: 'long', day: 'numeric' });
    document.getElementById('journal-textarea').value = entry.text;
    document.getElementById('journal-save-status').textContent = 'Viewing past entry';
  }

  // ════════ SETTINGS ════════
  function renderSettings() {
    const rotEl = document.getElementById('set-rotation');
    const dateEl = document.getElementById('set-startdate');
    if (rotEl && !rotEl.value) rotEl.value = state.rotation || '';
    if (dateEl && !dateEl.value) dateEl.value = state.startDate || '';
  }

  function saveSettings() {
    state.rotation = document.getElementById('set-rotation').value.trim() || state.rotation;
    state.startDate = document.getElementById('set-startdate').value || state.startDate;
    saveCache();
    renderDashboard();
    toast('Settings saved');
  }

  // ── Helpers ──
  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
  }

  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escAttr(str) { return esc(str).replace(/'/g, '&#39;'); }

  // ── Public API ──
  return {
    init, saveToken, logout, syncAll,
    switchPanel, selectCalDay, calPrevMonth, calNextMonth, calGoToday,
    openCalEventForm, closeCalEventForm, selectEventType, saveCalEvent,
    setRefTab, openResourceForm, addResource, deleteResource, filterResTopic,
    openGoalForm, openEPAForm, addGoal, toggleGoal,
    openBlockGoalForm, addBlockGoal, openPersonalGoalForm, addPersonalGoal,
    togglePersonalGoal, deferGoal, undefer,
    setEPAView, logEPAByCode, filterEPAStage,
    toggleCaseRow, filterCaseRotation, toggleCaseTag,
    openCaseOverlay, closeCaseOverlay, saveCaseFromOverlay,
    saveJournalEntry, viewPastEntry,
    saveSettings, toggleHabit, updateWin, completeRequirement,
  };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
