// ===== FOCUS OS — APP.JS =====
// Timestamp-based timer engine: immune to setInterval drift & background throttling

// --- GLOBALS ---
const circle = document.getElementById('timer-circle');
const CIRCUMFERENCE = 80 * 2 * Math.PI; // ~502.65

let focusMode = 'timer'; // 'timer' veya 'stopwatch'
let focusRAF = null;      // requestAnimationFrame ID
let totalTime = 1500;     // 25 dakika (saniye)
let selectedScheduleDay = 0;
let chart = null;

function hasPywebviewApi() {
    return Boolean(window.pywebview && window.pywebview.api);
}

// --- TIMESTAMP-BASED TIMER STATE ---
let timerState = {
    isRunning: false,
    isPaused: false,
    isOvertime: false,
    startTimestamp: 0,        // Date.now() when started
    pauseTimestamp: 0,        // Date.now() when last paused
    totalPausedMs: 0,         // total ms spent paused
    overtimeStartTimestamp: 0 // Date.now() when overtime began
};

// Deadline görev zamanlayıcıları (#1, #7) — also timestamp-based
let deadlineTimers = {}; // { taskId: { startTs, pauseTs, totalPausedMs, paused } }

// --- HELPER: get net elapsed seconds from timestamps ---
function getElapsedSeconds() {
    if (!timerState.isRunning) return 0;
    const now = Date.now();
    let currentPausedMs = timerState.totalPausedMs;
    if (timerState.isPaused) {
        currentPausedMs += (now - timerState.pauseTimestamp);
    }
    return Math.floor((now - timerState.startTimestamp - currentPausedMs) / 1000);
}

function getOvertimeSeconds() {
    if (!timerState.isOvertime) return 0;
    const now = Date.now();
    // Overtime pause tracking uses same totalPausedMs but offset from overtimeStart
    let currentPausedMs = timerState.totalPausedMs;
    if (timerState.isPaused) {
        currentPausedMs += (now - timerState.pauseTimestamp);
    }
    // Total elapsed since absolute start, minus paused
    const totalElapsed = Math.floor((now - timerState.startTimestamp - currentPausedMs) / 1000);
    // Overtime = totalElapsed - totalTime (the countdown portion)
    return Math.max(0, totalElapsed - totalTime);
}

// --- MODE SWITCH ---
function switchMode(mode) {
    focusMode = mode;
    document.getElementById('mode-timer').classList.toggle('active', mode === 'timer');
    document.getElementById('mode-stopwatch').classList.toggle('active', mode === 'stopwatch');
    document.getElementById('timer-setup').style.display = mode === 'timer' ? 'block' : 'none';

    if (mode === 'timer') {
        document.getElementById('timer-mode-label').innerText = 'ZAMANLAYICI';
        document.getElementById('focus-timer-text').innerText = formatTime(totalTime);
        circle.classList.remove('stopwatch-mode');
        document.getElementById('focus-timer-text').classList.remove('stopwatch-text');
        setCircleProgress(100);
    } else {
        document.getElementById('timer-mode-label').innerText = 'KRONOMETRE';
        document.getElementById('focus-timer-text').innerText = '00:00';
        circle.classList.add('stopwatch-mode');
        document.getElementById('focus-timer-text').classList.add('stopwatch-text');
        setCircleProgress(0);
    }
}

// --- PRESETS ---
function setPreset(min) {
    totalTime = min * 60;
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById('customMinutes').value = '';
    document.getElementById('focus-timer-text').innerText = formatTime(totalTime);
    setCircleProgress(100);
}

function setCustomTime() {
    const val = parseInt(document.getElementById('customMinutes').value);
    if (val > 0) {
        totalTime = val * 60;
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('focus-timer-text').innerText = formatTime(totalTime);
        setCircleProgress(100);
    }
}

// --- TIMER CORE (TIMESTAMP-BASED) ---
function formatTime(sec) {
    const m = Math.floor(Math.abs(sec) / 60).toString().padStart(2, '0');
    const s = (Math.abs(sec) % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function setCircleProgress(percent) {
    const offset = CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE;
    circle.style.strokeDashoffset = offset;
}

function startFocus() {
    document.getElementById('focusBtn').style.display = 'none';
    document.getElementById('timer-controls').classList.add('visible');
    document.getElementById('timer-setup').style.display = 'none';
    document.querySelector('.mode-selector').style.display = 'none';

    circle.classList.remove('overtime');
    document.getElementById('focus-timer-text').classList.remove('overtime-text');

    // Reset timer state with fresh timestamps
    timerState = {
        isRunning: true,
        isPaused: false,
        isOvertime: false,
        startTimestamp: Date.now(),
        pauseTimestamp: 0,
        totalPausedMs: 0,
        overtimeStartTimestamp: 0
    };

    if (focusMode === 'timer') {
        setCircleProgress(100);
        document.getElementById('focus-timer-text').innerText = formatTime(totalTime);
    } else {
        setCircleProgress(0);
        document.getElementById('focus-timer-text').innerText = '00:00';
    }

    // Cancel any existing animation frame and start render loop
    if (focusRAF) cancelAnimationFrame(focusRAF);
    renderLoop();
}

function renderLoop() {
    if (!timerState.isRunning) return;

    if (!timerState.isPaused) {
        updateDisplay();
    }

    focusRAF = requestAnimationFrame(renderLoop);
}

function updateDisplay() {
    const elapsed = getElapsedSeconds();

    if (focusMode === 'timer') {
        const remaining = totalTime - elapsed;

        if (remaining > 0) {
            // Normal countdown
            if (timerState.isOvertime) {
                // Edge case: shouldn't happen, but reset
                timerState.isOvertime = false;
                circle.classList.remove('overtime');
                document.getElementById('focus-timer-text').classList.remove('overtime-text');
                document.getElementById('timer-mode-label').innerText = 'ZAMANLAYICI';
            }
            document.getElementById('focus-timer-text').innerText = formatTime(remaining);
            const pct = (remaining / totalTime) * 100;
            setCircleProgress(Math.max(pct, 0));
        } else {
            // Overtime mode
            if (!timerState.isOvertime) {
                timerState.isOvertime = true;
                circle.classList.add('overtime');
                document.getElementById('focus-timer-text').classList.add('overtime-text');
                document.getElementById('timer-mode-label').innerText = 'FAZLA MESAİ';
                setCircleProgress(100);
            }
            const overtimeSec = elapsed - totalTime;
            document.getElementById('focus-timer-text').innerText = '+' + formatTime(overtimeSec);
            const pct = ((overtimeSec % 60) / 60) * 100;
            setCircleProgress(pct);
        }
    } else {
        // Stopwatch mode
        document.getElementById('focus-timer-text').innerText = formatTime(elapsed);
        const pct = ((elapsed % 60) / 60) * 100;
        setCircleProgress(pct);
    }
}

function togglePause() {
    if (!timerState.isRunning) return;

    if (timerState.isPaused) {
        // Resume: accumulate paused duration
        timerState.totalPausedMs += (Date.now() - timerState.pauseTimestamp);
        timerState.isPaused = false;
        document.getElementById('pauseBtn').innerText = 'DURAKLAT';
        // Restart render loop
        renderLoop();
    } else {
        // Pause: record when we paused
        timerState.pauseTimestamp = Date.now();
        timerState.isPaused = true;
        document.getElementById('pauseBtn').innerText = 'DEVAM ET';
        // renderLoop will stop calling updateDisplay
    }
}

async function resetTimer() {
    // Stop render loop
    if (focusRAF) { cancelAnimationFrame(focusRAF); focusRAF = null; }

    // Calculate worked time from timestamps (accurate to the second)
    const elapsed = getElapsedSeconds();
    let workedMins = 0;
    if (focusMode === 'timer') {
        // Total worked = min(elapsed, totalTime) + overtime
        workedMins = Math.floor(elapsed / 60);
    } else {
        workedMins = Math.floor(elapsed / 60);
    }

    timerState.isRunning = false;

    if (workedMins > 0) { await window.pywebview.api.log_study_time(workedMins); }

    // UI reset
    document.getElementById('timer-controls').classList.remove('visible');
    document.getElementById('focusBtn').style.display = 'block';
    document.querySelector('.mode-selector').style.display = 'flex';
    circle.classList.remove('overtime', 'stopwatch-mode');
    document.getElementById('focus-timer-text').classList.remove('overtime-text', 'stopwatch-text');
    document.getElementById('pauseBtn').innerText = 'DURAKLAT';

    if (focusMode === 'timer') {
        document.getElementById('timer-setup').style.display = 'block';
        document.getElementById('focus-timer-text').innerText = formatTime(totalTime);
        document.getElementById('timer-mode-label').innerText = 'ZAMANLAYICI';
        setCircleProgress(100);
    } else {
        document.getElementById('focus-timer-text').innerText = '00:00';
        document.getElementById('timer-mode-label').innerText = 'KRONOMETRE';
        setCircleProgress(0);
    }
    renderChart();
}

// --- BEKLEME ODASI ---
async function addTaskToWaitingRoom() {
    const name = document.getElementById('taskName').value.trim();
    const mins = document.getElementById('taskHours').value.trim();
    if (!name || !mins || parseInt(mins) <= 0) return;
    
    await window.pywebview.api.setup_task(name, mins);
    document.getElementById('taskName').value = '';
    document.getElementById('taskHours').value = '';
    renderWaitingRoom();
}

async function renderWaitingRoom() {
    const tasks = await window.pywebview.api.get_waiting_tasks();
    const container = document.getElementById('waiting-room');
    if (!tasks || tasks.length === 0) {
        container.innerHTML = '<p style="font-size:11px;color:var(--text-dim);text-align:center;padding:8px;">Henüz bekleyen görev yok</p>';
        return;
    }
    container.innerHTML = tasks.map(t => `
        <div class="waiting-item">
            <div class="waiting-info">
                <span class="waiting-name">${t.subject}</span>
                <span class="waiting-duration">${t.minutes} dakika</span>
            </div>
            <div class="waiting-actions">
                <button class="btn btn-success btn-icon" onclick="activateDeadline(${t.id})" title="Başlat">▶</button>
                <button class="btn btn-danger btn-icon" onclick="deleteWaitingTask(${t.id})" title="Sil" style="font-size:11px;">✕</button>
            </div>
        </div>
    `).join('');
}

async function activateDeadline(taskId) {
    await window.pywebview.api.activate_task(taskId);
    renderWaitingRoom();
    renderActiveDeadlines();
}

async function deleteWaitingTask(taskId) {
    await window.pywebview.api.delete_task(taskId);
    renderWaitingRoom();
}

// --- AKTİF DEADLINE WIDGET'LARI ---
// Deadline görev kontrolleri (#1) — timestamp-based, no setInterval
function startDeadlineTimer(taskId) {
    if (deadlineTimers[taskId]) return; // zaten çalışıyor
    deadlineTimers[taskId] = { startTs: Date.now(), pauseTs: 0, totalPausedMs: 0, paused: false };
}

function getDeadlineElapsed(taskId) {
    const t = deadlineTimers[taskId];
    if (!t) return 0;
    const now = Date.now();
    let pausedMs = t.totalPausedMs;
    if (t.paused) pausedMs += (now - t.pauseTs);
    return Math.floor((now - t.startTs - pausedMs) / 1000);
}

function toggleDeadlinePause(taskId) {
    const t = deadlineTimers[taskId];
    if (!t) return;
    if (t.paused) {
        t.totalPausedMs += (Date.now() - t.pauseTs);
        t.paused = false;
    } else {
        t.pauseTs = Date.now();
        t.paused = true;
    }
}

async function completeDeadlineTask(taskId) {
    // Süreyi hesapla ve ana istatistiğe yaz (#7)
    if (deadlineTimers[taskId]) {
        const workedMins = Math.floor(getDeadlineElapsed(taskId) / 60);
        if (workedMins > 0) {
            await window.pywebview.api.log_study_time(workedMins);
        }
        delete deadlineTimers[taskId];
    }
    await window.pywebview.api.complete_task(taskId);
    renderActiveDeadlines();
    renderChart();
}

async function resetDeadlineTask(taskId) {
    // Süreyi kaydetmeden sadece durdur ve sil
    if (deadlineTimers[taskId]) {
        delete deadlineTimers[taskId];
    }
    await window.pywebview.api.delete_task(taskId);
    renderActiveDeadlines();
}

async function renderActiveDeadlines() {
    const tasks = await window.pywebview.api.get_active_deadlines();
    const container = document.getElementById('active-deadlines');
    if (!tasks || tasks.length === 0) {
        container.innerHTML = '<p style="font-size:11px;color:var(--text-dim);text-align:center;padding:4px;">Aktif deadline yok</p>';
        return;
    }
    const now = Date.now();
    container.innerHTML = tasks.map(t => {
        // Deadline timer'ları otomatik başlat
        if (!deadlineTimers[t.id]) startDeadlineTimer(t.id);
        
        const diff = Math.max(0, Math.floor((t.deadline_ts - now) / 1000));
        const h = Math.floor(diff / 3600).toString().padStart(2, '0');
        const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
        const s = (diff % 60).toString().padStart(2, '0');
        const isPaused = deadlineTimers[t.id]?.paused;
        const elapsed = getDeadlineElapsed(t.id);
        const elM = Math.floor(elapsed / 60);
        return `
            <div class="deadline-widget" style="flex-wrap:wrap;">
                <span class="deadline-name">${t.subject}</span>
                <span class="deadline-time">${h}:${m}:${s}</span>
                <div style="width:100%;display:flex;gap:4px;margin-top:6px;">
                    <button class="btn btn-ghost btn-small" onclick="toggleDeadlinePause(${t.id})" style="flex:1;font-size:10px;">${isPaused ? 'Devam' : 'Duraklat'}</button>
                    <button class="btn btn-success btn-small" onclick="completeDeadlineTask(${t.id})" style="flex:1;font-size:10px;">Bitir (${elM}dk)</button>
                    <button class="btn btn-danger btn-small" onclick="resetDeadlineTask(${t.id})" style="width:32px;font-size:10px;padding:4px;">×</button>
                </div>
            </div>`;
    }).join('');
}

// --- CANLI RADAR ---
async function updateLiveRadar() {
    const status = await window.pywebview.api.get_live_blacklist_status();
    const container = document.getElementById('blacklist-ul');
    if (!status || status.length === 0) {
        container.innerHTML = '<p style="font-size:11px;color:var(--text-dim);text-align:center;padding:8px;">Kara liste boş</p>';
        return;
    }
    container.innerHTML = status.map(s => {
        const isOpen = s.status === 'Açık';
        return `
            <div class="radar-item">
                <div class="radar-dot ${isOpen ? 'active' : ''}"></div>
                <span class="radar-app" id="radar-name-${s.app}" title="${s.app}">${s.display}</span>
                <span class="radar-status ${isOpen ? 'open' : 'closed'}">${s.status}</span>
                ${isOpen ? `<span class="radar-countdown">${s.time_left}s</span>` : ''}
                <button class="btn btn-ghost btn-icon" onclick="renameRadarApp('${s.app}')" title="İsim Değiştir" style="font-size:9px;width:24px;height:24px;">✏</button>
                <button class="btn btn-danger btn-icon" onclick="removeApp('${s.app}')" style="font-size:9px;width:24px;height:24px;">✕</button>
            </div>`;
    }).join('');
}

async function removeApp(name) {
    await window.pywebview.api.remove_blacklisted_app(name);
    updateLiveRadar();
}

async function renameRadarApp(appName) {
    const newName = prompt('İsim değiştir:', appName);
    if (newName && newName.trim()) {
        await window.pywebview.api.rename_blacklisted_app(appName, newName.trim());
        updateLiveRadar();
    }
}

// --- .EXE PICKER ---
document.getElementById('exePicker').addEventListener('change', async function() {
    if (this.files.length > 0) {
        const fileName = this.files[0].name.toLowerCase();
        await window.pywebview.api.add_blacklisted_app_direct(fileName);
        updateLiveRadar();
        this.value = '';
    }
});

// --- ALERTS FROM PYTHON ---
function showAlertsFromPython(alerts) {
    const box = document.getElementById('alert-box');
    const text = document.getElementById('alert-text');
    for (const a of alerts) {
        if (a.type === 'kill') {
            box.classList.add('warning');
            text.classList.add('danger');
            text.innerText = `⚡ ${a.app} ZORLA KAPATILDI!`;
            setTimeout(() => { box.classList.remove('warning'); text.classList.remove('danger'); text.innerText = 'ANOMALİ YOK'; }, 5000);
        } else if (a.type === 'countdown') {
            text.innerText = `⚠️ ${a.app} — ${a.time}s KALDI!`;
            text.classList.add('danger');
        } else if (a.type === 'warning') {
            box.classList.add('warning');
            text.classList.add('danger');
            text.innerText = `🚨 ${a.app} TESPİT EDİLDİ!`;
            setTimeout(() => { box.classList.remove('warning'); }, 3000);
        }
    }
}

// --- DERS PROGRAMI MODAL ---
const DAY_NAMES = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];

function openScheduleModal() {
    document.getElementById('schedule-modal').classList.add('active');
    renderScheduleTabs();
    loadScheduleForDay(selectedScheduleDay);
}

function renderScheduleTabs() {
    const container = document.getElementById('schedule-tabs');
    container.innerHTML = DAY_NAMES.map((name, i) => 
        `<button class="schedule-tab ${i === selectedScheduleDay ? 'active' : ''}" onclick="selectScheduleDay(${i})">${name}</button>`
    ).join('');
}

function selectScheduleDay(day) {
    selectedScheduleDay = day;
    renderScheduleTabs();
    loadScheduleForDay(day);
}

async function loadScheduleForDay(day) {
    const all = await window.pywebview.api.get_full_schedule();
    const entries = (all || []).filter(e => e.day === day);
    const container = document.getElementById('schedule-entries');
    
    if (entries.length === 0) {
        container.innerHTML = '<p style="font-size:11px;color:var(--text-dim);text-align:center;padding:12px;">Bu gün için ders eklenmemiş</p>';
    } else {
        container.innerHTML = entries.map((e, i) => `
            <div class="schedule-entry" data-id="${e.id}">
                <input type="text" class="input-field sch-name" value="${e.name}" placeholder="Ders adı" style="flex:2;">
                <input type="number" class="input-field sch-hours" value="${e.hours || 0}" placeholder="Saat" min="0" style="width:60px;flex:none;text-align:center;">
                <span style="color:var(--text-muted);font-size:11px;padding:0 2px;">sa</span>
                <input type="number" class="input-field sch-mins" value="${e.minutes || 0}" placeholder="Dk" min="0" max="59" style="width:60px;flex:none;text-align:center;">
                <span style="color:var(--text-muted);font-size:11px;padding:0 2px;">dk</span>
                <button class="btn btn-danger btn-icon" onclick="this.parentElement.remove()" style="font-size:11px;">✕</button>
            </div>
        `).join('');
    }
}

function addScheduleRow() {
    const container = document.getElementById('schedule-entries');
    const placeholder = container.querySelector('p');
    if (placeholder) placeholder.remove();
    
    const div = document.createElement('div');
    div.className = 'schedule-entry';
    div.innerHTML = `
        <input type="text" class="input-field sch-name" placeholder="Ders adı" style="flex:2;">
        <input type="number" class="input-field sch-hours" value="1" placeholder="Saat" min="0" style="width:60px;flex:none;text-align:center;">
        <span style="color:var(--text-muted);font-size:11px;padding:0 2px;">sa</span>
        <input type="number" class="input-field sch-mins" value="0" placeholder="Dk" min="0" max="59" style="width:60px;flex:none;text-align:center;">
        <span style="color:var(--text-muted);font-size:11px;padding:0 2px;">dk</span>
        <button class="btn btn-danger btn-icon" onclick="this.parentElement.remove()" style="font-size:11px;">✕</button>
    `;
    container.appendChild(div);
}

async function saveSchedule() {
    // Önce mevcut tüm programı çek
    const existing = await window.pywebview.api.get_full_schedule() || [];
    const otherDays = existing.filter(e => e.day !== selectedScheduleDay);
    
    // Bu günün yeni girişlerini topla (süre bazlı #5)
    const rows = document.querySelectorAll('#schedule-entries .schedule-entry');
    const todayEntries = [];
    rows.forEach(row => {
        const name = row.querySelector('.sch-name').value.trim();
        const hours = parseInt(row.querySelector('.sch-hours')?.value) || 0;
        const mins = parseInt(row.querySelector('.sch-mins')?.value) || 0;
        if (name && (hours > 0 || mins > 0)) {
            todayEntries.push({ day: selectedScheduleDay, name, hours, minutes: mins });
        }
    });

    const allEntries = otherDays.map(e => ({ day: e.day, name: e.name, hours: e.hours || 0, minutes: e.minutes || 0 })).concat(todayEntries);
    const result = await window.pywebview.api.save_schedule(allEntries);
    
    // Bekleme odasını güncelle (#6)
    renderWaitingRoom();
    
    // Onay efekti
    const btn = document.getElementById('schedSaveBtn');
    const taskCount = result?.created_tasks?.length || 0;
    btn.innerText = `✓ ${taskCount} GÖREV OLUŞTURULDU`;
    btn.classList.remove('btn-success');
    btn.classList.add('btn-primary');
    setTimeout(() => { btn.innerText = 'KAYDET & GÖREV OLUŞTUR'; btn.classList.remove('btn-primary'); btn.classList.add('btn-success'); }, 2000);
}

// --- AKILLI TEKRAR MODAL ---
async function openSmartRepeatModal() {
    document.getElementById('smart-modal').classList.add('active');
    
    const lessons = await window.pywebview.api.get_today_schedule();
    const info = document.getElementById('today-lessons-info');
    if (lessons && lessons.length > 0) {
        info.innerHTML = `<div class="section-label">Bugünkü Dersler</div>` + 
            lessons.map(l => {
                const durStr = (l.hours > 0 ? `${l.hours}sa ` : '') + `${l.minutes}dk`;
                return `<div style="font-size:12px;color:var(--text-primary);padding:4px 0;">📚 ${l.name} (${durStr})</div>`;
            }).join('');
    } else {
        info.innerHTML = '<p style="font-size:12px;color:var(--text-dim);padding:8px 0;">Bugün için ders programı girilmemiş.</p>';
    }
    
    renderSmartTasks();
}

async function applyStrategy(type) {
    const result = await window.pywebview.api.apply_repeat_strategy(type);
    
    // Kartları highlight et
    document.querySelectorAll('.strategy-card').forEach(c => c.classList.remove('selected'));
    event.target.closest('.strategy-card').classList.add('selected');
    
    if (result && result.message) {
        const info = document.getElementById('today-lessons-info');
        info.innerHTML += `<div style="font-size:12px;color:var(--neon-green);padding:8px 0;font-weight:600;">✓ ${result.message}</div>`;
    }
    renderSmartTasks();
}

async function renderSmartTasks() {
    const tasks = await window.pywebview.api.get_todays_smart_tasks();
    const container = document.getElementById('smart-tasks-list');
    if (!tasks || tasks.length === 0) {
        container.innerHTML = '<p style="font-size:11px;color:var(--text-dim);text-align:center;padding:8px;">Bugün için tekrar görevi yok</p>';
        return;
    }
    container.innerHTML = tasks.map(t => `
        <div class="waiting-item" style="${t.completed ? 'opacity:0.4;' : ''}">
            <div class="waiting-info">
                <span class="waiting-name">${t.completed ? '✓ ' : ''}${t.lesson}</span>
                <span class="waiting-duration">${t.minutes} dk — ${t.source === 'daily_repeat' ? 'Günlük' : t.source === 'spaced_rep' ? 'Eğri' : 'Manuel'}</span>
            </div>
            ${!t.completed ? `<button class="btn btn-success btn-icon" onclick="completeSmartTask(${t.id})" title="Tamamla">✓</button>` : ''}
        </div>
    `).join('');
}

async function completeSmartTask(id) {
    await window.pywebview.api.complete_smart_task(id);
    renderSmartTasks();
}

async function addManualSmartTask() {
    const name = document.getElementById('manualTaskName').value.trim();
    const mins = parseInt(document.getElementById('manualTaskMin').value) || 45;
    if (!name) return;
    await window.pywebview.api.add_manual_smart_task(name, mins);
    document.getElementById('manualTaskName').value = '';
    document.getElementById('manualTaskMin').value = '';
    renderSmartTasks();
}

// --- EKRAN SÜRESİ RAPORU ---
async function openUsageReport() {
    document.getElementById('usage-modal').classList.add('active');
    const data = await window.pywebview.api.get_app_usage_report();
    const tbody = document.getElementById('usage-table-body');
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="2" style="text-align:center;color:var(--text-dim);">Bugün veri yok</td></tr>';
        return;
    }
    tbody.innerHTML = data.map(d => {
        const h = Math.floor(d.seconds / 3600);
        const m = Math.floor((d.seconds % 3600) / 60);
        const s = d.seconds % 60;
        const timeStr = h > 0 ? `${h}s ${m}dk ${s}sn` : m > 0 ? `${m}dk ${s}sn` : `${s}sn`;
        return `<tr><td>${d.app}</td><td>${timeStr}</td></tr>`;
    }).join('');
}

// --- GÜNÜ KAPAT ---
async function endDayProtocol() {
    // Çalışan zamanlayıcıyı durdur ve kaydet
    if (timerState.isRunning) { await resetTimer(); }
    
    const result = await window.pywebview.api.end_day_protocol();
    document.getElementById('endday-stat').innerText = result.total_minutes || 0;
    
    const mins = result.total_minutes || 0;
    let msg = '';
    if (mins >= 120) msg = '🔥 Muhteşem bir gün! Harika iş çıkardın!';
    else if (mins >= 60) msg = '💪 İyi bir gün geçirdin, devam et!';
    else if (mins > 0) msg = '👍 Her dakika önemli, yarın daha da iyi olacak!';
    else msg = '🌱 Yarın yeni bir başlangıç!';
    document.getElementById('endday-message').innerText = msg;
    
    document.getElementById('endday-modal').classList.add('active');
}

// --- MODAL UTILS ---
function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

// Modal dışına tıklayınca kapat
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', function(e) {
        if (e.target === this) this.classList.remove('active');
    });
});

// --- APEXCHARTS GRAFİĞİ ---
async function renderChart() {
    const rawData = await window.pywebview.api.get_weekly_chart_data();
    let dates = [];
    let minutes = [];
    
    if (rawData && rawData.length > 0) {
        const TR_DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
        rawData.reverse().forEach(row => {
            const dateObj = new Date(row[0]);
            const dayName = TR_DAYS[dateObj.getDay()];
            dates.push(dayName);
            minutes.push(row[1]);
        });
    } else {
        dates = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
        minutes = [0, 0, 0, 0, 0, 0, 0];
    }

    const options = {
        series: [{ name: 'Çalışılan Dakika', data: minutes }],
        chart: { 
            type: 'area', 
            height: '100%', 
            toolbar: { show: false },
            fontFamily: 'Inter, sans-serif',
            background: 'transparent'
        },
        colors: ['#26796d'],
        fill: {
            type: 'gradient',
            gradient: { shadeIntensity: 0.8, opacityFrom: 0.32, opacityTo: 0.0, stops: [0, 100] }
        },
        dataLabels: { enabled: false },
        stroke: { curve: 'smooth', width: 3 },
        xaxis: { 
            categories: dates,
            axisBorder: { show: false },
            axisTicks: { show: false },
            labels: { style: { colors: '#6f7d78', fontSize: '11px' } }
        },
        yaxis: { labels: { style: { colors: '#6f7d78' } } },
        grid: { borderColor: 'rgba(28,35,31,0.08)', strokeDashArray: 4 },
        theme: { mode: 'light' },
        markers: { size: 5, colors: ['#ffffff'], strokeColors: '#26796d', strokeWidth: 2 },
        tooltip: { theme: 'light' }
    };

    if (chart) { chart.destroy(); }
    chart = new ApexCharts(document.querySelector("#historyChart"), options);
    chart.render();
}

// --- LIVE UPDATE LOOP (Her saniye) ---
setInterval(() => {
    if (hasPywebviewApi()) {
        updateLiveRadar();
        renderActiveDeadlines();
    }
}, 1000);

// --- SAYFA YÜKLENME (pywebview uyumlu) ---
window.addEventListener('pywebviewready', () => {
    renderChart();
    renderWaitingRoom();
    renderActiveDeadlines();
    updateLiveRadar();
});

// Fallback: pywebview zaten yüklüyse
window.addEventListener('load', () => {
    if (hasPywebviewApi()) {
        renderChart();
        renderWaitingRoom();
        renderActiveDeadlines();
        updateLiveRadar();
    }
});

// =============================================
// ÖZELLİK 1: PYTHON'DAN TETİKLENEN DURAKLAT/DEVAM
// (Kilit ekranı, uyku modu algılama)
// =============================================

function pauseFromBackend(reason) {
    // Python tarafından çağrılır: session lock, sleep, checkin timeout
    console.log(`[FocusOS] Backend PAUSE tetiklendi: ${reason}`);
    
    const badge = document.getElementById('session-status');
    
    if (reason === 'lock' || reason === 'sleep') {
        badge.style.display = 'inline-block';
        badge.innerText = reason === 'lock' ? 'Kilitli' : 'Uyku';
    }
    
    // Aktif zamanlayıcı çalışıyorsa ve duraklatılmamışsa duraklat
    if (timerState.isRunning && !timerState.isPaused) {
        togglePause(); // Mevcut duraklat fonksiyonunu kullan
    }
    
    // Aktif deadline timer'larını da duraklat
    Object.keys(deadlineTimers).forEach(taskId => {
        const t = deadlineTimers[taskId];
        if (t && !t.paused) {
            toggleDeadlinePause(parseInt(taskId));
        }
    });
}

function resumeFromBackend(reason) {
    // Python tarafından çağrılır: session unlock, wake
    console.log(`[FocusOS] Backend RESUME tetiklendi: ${reason}`);
    
    const badge = document.getElementById('session-status');
    badge.style.display = 'none';
    
    // NOT: Sayacı otomatik devam ettirmiyoruz — kullanıcı manuel devam etsin
    // Sadece kilit/uyku badge'ini kaldırıyoruz
}

// =============================================
// ÖZELLİK 2: EL SALLAMA (CHECK-IN) MODU
// =============================================

let checkinCountdownInterval = null;

async function toggleCheckinMode() {
    const result = await window.pywebview.api.toggle_checkin_mode();
    const btn = document.getElementById('checkinToggleBtn');
    if (result.active) {
        btn.innerText = 'El sallama modu: aktif';
        btn.classList.remove('btn-ghost');
        btn.classList.add('btn-success');
    } else {
        btn.innerText = 'El sallama modu: kapalı';
        btn.classList.remove('btn-success');
        btn.classList.add('btn-ghost');
        hideCheckinPrompt();
    }
}

function showCheckinPrompt() {
    // Python tarafından çağrılır — 10 saniyelik geri sayım overlay'i göster
    const overlay = document.getElementById('checkin-overlay');
    const countdown = document.getElementById('checkin-countdown');
    overlay.classList.add('active');
    
    let remaining = 10;
    countdown.innerText = remaining;
    
    if (checkinCountdownInterval) clearInterval(checkinCountdownInterval);
    checkinCountdownInterval = setInterval(() => {
        remaining--;
        countdown.innerText = remaining;
        if (remaining <= 0) {
            clearInterval(checkinCountdownInterval);
            checkinCountdownInterval = null;
            // Süre doldu — overlay otomatik kapanacak (Python timeout callback zaten tetikleyecek)
            hideCheckinPrompt();
        }
    }, 1000);
}

function hideCheckinPrompt() {
    const overlay = document.getElementById('checkin-overlay');
    overlay.classList.remove('active');
    if (checkinCountdownInterval) {
        clearInterval(checkinCountdownInterval);
        checkinCountdownInterval = null;
    }
}

async function checkinYes() {
    hideCheckinPrompt();
    await window.pywebview.api.checkin_confirm();
}

async function checkinNo() {
    hideCheckinPrompt();
    await window.pywebview.api.checkin_decline();
}

// --- TÜM ZAMANLARIN VERİ TABLOSU (#3) ---
async function openAllTimeModal() {
    document.getElementById('alltime-modal').classList.add('active');
    const data = await window.pywebview.api.get_all_daily_logs();
    const tbody = document.getElementById('alltime-table-body');
    const TR_DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
    
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-dim);">Henüz veri yok</td></tr>';
        return;
    }
    tbody.innerHTML = data.map(d => {
        const dateObj = new Date(d.date);
        const dayName = TR_DAYS[dateObj.getDay()];
        return `<tr><td>${d.date}</td><td>${dayName}</td><td>${d.minutes}</td></tr>`;
    }).join('');
}
