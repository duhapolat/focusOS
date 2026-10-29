// ===== FOCUS OS — APP.JS =====
// Timestamp-based timer engine with dark-gold premium UI controls

// --- GLOBALS ---
const circle = document.getElementById('timer-circle');
const CIRCUMFERENCE = 80 * 2 * Math.PI; // ~502.65

let focusMode = 'timer'; // 'timer' veya 'stopwatch'
let focusRAF = null;      // requestAnimationFrame ID
let totalTime = 1500;     // 25 dakika (saniye)
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
    overtimeStartTimestamp: 0,// Date.now() when overtime began
    userPauseCount: 0,
    currentUninterruptedStart: 0,
    longestUninterruptedMs: 0
};

let currentSessionId = null;
let currentRoutineId = null;
let currentTaskId = null;
let currentRoadmapTopicId = null;
let focusScoreInterval = null;
let currentFocusScore = 0;
let focusStatePersistInterval = null;

function localDateStr(date = new Date()) {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function encodedText(value) {
    return encodeURIComponent(String(value ?? ''));
}

function applyFocusPanelState() {
    const grid = document.querySelector('.main-grid');
    const left = document.getElementById('left-panel');
    const right = document.getElementById('right-panel');
    if (!grid || !left || !right) return;
    const desktop = window.innerWidth > 1180;
    const leftCollapsed = desktop && localStorage.getItem('focusos-left-panel') === 'collapsed';
    const rightCollapsed = desktop && localStorage.getItem('focusos-right-panel') === 'collapsed';
    grid.classList.toggle('left-collapsed', leftCollapsed);
    grid.classList.toggle('right-collapsed', rightCollapsed);
    left.classList.toggle('is-collapsed', leftCollapsed);
    right.classList.toggle('is-collapsed', rightCollapsed);
}

function toggleFocusPanel(side) {
    const key = `focusos-${side}-panel`;
    const currentlyCollapsed = localStorage.getItem(key) === 'collapsed';
    localStorage.setItem(key, currentlyCollapsed ? 'expanded' : 'collapsed');
    applyFocusPanelState();
}

window.addEventListener('resize', applyFocusPanelState);

// Deadline görev zamanlayıcıları — also timestamp-based
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
    let currentPausedMs = timerState.totalPausedMs;
    if (timerState.isPaused) {
        currentPausedMs += (now - timerState.pauseTimestamp);
    }
    const totalElapsed = Math.floor((now - timerState.startTimestamp - currentPausedMs) / 1000);
    return Math.max(0, totalElapsed - totalTime);
}

// --- MODE SWITCH ---
function switchMode(mode) {
    if (timerState.isRunning) return;
    
    focusMode = mode;
    document.getElementById('mode-timer').classList.toggle('active', mode === 'timer');
    document.getElementById('mode-stopwatch').classList.toggle('active', mode === 'stopwatch');
    document.getElementById('timer-setup').style.display = mode === 'timer' ? 'block' : 'none';

    const skipBtn = document.getElementById('skipBtn');
    if (mode === 'timer') {
        document.getElementById('timer-mode-label').innerText = 'ZAMANLAYICI';
        document.getElementById('focus-timer-text').innerText = formatTime(totalTime);
        circle.classList.remove('stopwatch-mode');
        document.getElementById('focus-timer-text').classList.remove('stopwatch-text');
        setCircleProgress(100);
        if (skipBtn) skipBtn.style.display = 'grid';
    } else {
        document.getElementById('timer-mode-label').innerText = 'KRONOMETRE';
        document.getElementById('focus-timer-text').innerText = '00:00';
        circle.classList.add('stopwatch-mode');
        document.getElementById('focus-timer-text').classList.add('stopwatch-text');
        setCircleProgress(0);
        if (skipBtn) skipBtn.style.display = 'none';
    }
}

// --- PRESETS ---
function setPreset(min, sourceButton = null) {
    totalTime = min * 60;
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    const target = sourceButton || (typeof event !== 'undefined' ? event.target : null);
    if (target && target.classList && target.classList.contains('preset-btn')) {
        target.classList.add('active');
    }
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

// --- TIMER CORE ---
function formatTime(sec) {
    const m = Math.floor(Math.abs(sec) / 60).toString().padStart(2, '0');
    const s = (Math.abs(sec) % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function formatMinutesToHHMM(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}:${m.toString().padStart(2, '0')}`;
}

function setCircleProgress(percent) {
    if (circle) {
        const offset = CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE;
        circle.style.strokeDashoffset = offset;
    }
}

function startFocus() {
    if (timerState.isRunning) {
        togglePause();
        return;
    }

    document.getElementById('timer-setup').style.display = 'none';
    document.querySelector('.mode-selector').style.display = 'none';
    circle.classList.remove('overtime');
    document.getElementById('focus-timer-text').classList.remove('overtime-text');

    // UI Feedback: Change button icon to Pause
    document.getElementById('main-btn-icon').innerText = '⏸';
    document.getElementById('focusBtn').title = 'Duraklat';

    timerState = {
        isRunning: true,
        isPaused: false,
        isOvertime: false,
        startTimestamp: Date.now(),
        pauseTimestamp: 0,
        totalPausedMs: 0,
        overtimeStartTimestamp: 0,
        userPauseCount: 0,
        currentUninterruptedStart: Date.now(),
        longestUninterruptedMs: 0
    };

    if (focusMode === 'timer') {
        setCircleProgress(100);
        document.getElementById('focus-timer-text').innerText = formatTime(totalTime);
    } else {
        setCircleProgress(0);
        document.getElementById('focus-timer-text').innerText = '00:00';
    }

    if (focusRAF) cancelAnimationFrame(focusRAF);
    renderLoop();
    persistFocusState();
    setFocusRuntime(true);
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
            if (timerState.isOvertime) {
                timerState.isOvertime = false;
                circle.classList.remove('overtime');
                document.getElementById('focus-timer-text').classList.remove('overtime-text');
                document.getElementById('timer-mode-label').innerText = 'ZAMANLAYICI';
            }
            document.getElementById('focus-timer-text').innerText = formatTime(remaining);
            const pct = (remaining / totalTime) * 100;
            setCircleProgress(Math.max(pct, 0));
        } else {
            if (!timerState.isOvertime) {
                timerState.isOvertime = true;
                circle.classList.add('overtime');
                document.getElementById('focus-timer-text').classList.add('overtime-text');
                document.getElementById('timer-mode-label').innerText = 'FAZLA MESAİ';
                setCircleProgress(100);
                // Uygulama fazla mesaideyken yeniden açıldıysa tekrar çalma.
                if (elapsed - totalTime < 5) startTimerAlert();
            }
            const overtimeSec = elapsed - totalTime;
            document.getElementById('focus-timer-text').innerText = '+' + formatTime(overtimeSec);
            const pct = ((overtimeSec % 60) / 60) * 100;
            setCircleProgress(pct);
        }
    } else {
        document.getElementById('focus-timer-text').innerText = formatTime(elapsed);
        const pct = ((elapsed % 60) / 60) * 100;
        setCircleProgress(pct);
    }
}

function togglePause(isSystem = false, pauseAtTimestamp = null) {
    if (!timerState.isRunning) return;

    if (timerState.isPaused) {
        timerState.totalPausedMs += (Date.now() - timerState.pauseTimestamp);
        timerState.isPaused = false;
        timerState.currentUninterruptedStart = Date.now();
        document.getElementById('main-btn-icon').innerText = '⏸';
        document.getElementById('focusBtn').title = 'Duraklat';
        renderLoop();
        setFocusRuntime(true);
    } else {
        const now = Date.now();
        const requestedPauseAt = Number(pauseAtTimestamp);
        const pauseAt = Number.isFinite(requestedPauseAt) && requestedPauseAt > 0
            ? Math.min(now, Math.max(timerState.startTimestamp, requestedPauseAt))
            : now;
        const blockMs = Math.max(0, pauseAt - timerState.currentUninterruptedStart);
        timerState.longestUninterruptedMs = Math.max(timerState.longestUninterruptedMs, blockMs);
        if (!isSystem) {
            timerState.userPauseCount++;
        }
        timerState.pauseTimestamp = pauseAt;
        timerState.isPaused = true;
        document.getElementById('main-btn-icon').innerText = '▶';
        document.getElementById('focusBtn').title = 'Devam Et';
        setFocusRuntime(false);
    }
    persistFocusState();
}

// Çalışılan süreyi dakikaya çevirir. Aşağı yuvarlama 59:40'ı 59 dk yapıp
// günlük hedefi/seriyi kaçırtıyordu; en yakın dakikaya yuvarlıyoruz.
function elapsedToMinutes(seconds) {
    return Math.max(0, Math.round(seconds / 60));
}

// Bitiş anından geriye doğru sayarak çalışılan dakikaları günlere böler.
// (Duraklamalar seansın sonunda varsayılır; gün sınırı için yeterli bir yaklaşım.)
function splitMinutesByDay(totalMinutes, endDate = new Date()) {
    const parts = [];
    let remaining = totalMinutes;
    let cursor = new Date(endDate);
    while (remaining > 0) {
        const dayStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
        const minutesThatDay = Math.max(0, Math.round((cursor - dayStart) / 60000));
        const take = Math.min(remaining, minutesThatDay);
        if (take > 0) parts.push({ date: localDateStr(cursor), minutes: take });
        remaining -= take;
        cursor = new Date(dayStart.getTime() - 1);
        if (parts.length > 7) break; // Güvenlik sınırı
    }
    return parts.length ? parts : [{ date: localDateStr(endDate), minutes: totalMinutes }];
}

async function resetTimer() {
    if (!timerState.isRunning) return;
    const elapsed = getElapsedSeconds();
    const workedMins = elapsedToMinutes(elapsed);

    if (focusMode === 'timer' && totalTime - elapsed > 0) {
        // Görev süresi henüz dolmadı.
        const resetWithoutSaving = confirm("Görev süresi henüz dolmadı. Çalışmanızı KAYDETMEDEN sıfırlamak ister misiniz?");
        if (resetWithoutSaving) {
            await finishFocusSession(false);
            return;
        }
        const saveAndFinish = confirm(`Peki, şu ana kadar çalışılan ${workedMins} dakikayı KAYDEDİP bitirmek ister misiniz?`);
        if (saveAndFinish) await finishFocusSession(true);
        return;
    }
    // Süre dolmuş (fazla mesai dahil) ya da kronometre: kaydedip bitir.
    await finishFocusSession(true);
}

// ⏭ "İleri": seansı şimdi bitirir ve o ana kadar çalışılan süreyi (fazla mesai dahil) kaydeder.
async function skipTimer() {
    if (!timerState.isRunning) return;
    const elapsed = getElapsedSeconds();
    const workedMins = elapsedToMinutes(elapsed);
    const timeIsUp = focusMode !== 'timer' || elapsed >= totalTime;
    if (!timeIsUp && workedMins > 0 &&
        !confirm(`Seansı şimdi bitirip çalışılan ${workedMins} dakikayı kaydetmek ister misiniz?`)) {
        return;
    }
    await finishFocusSession(true);
}

async function finishFocusSession(saveTime) {
    const elapsed = getElapsedSeconds();
    const workedMins = elapsedToMinutes(elapsed);
    const wasPaused = timerState.isPaused;

    // Stop render loop
    if (focusRAF) { cancelAnimationFrame(focusRAF); focusRAF = null; }

    timerState.isRunning = false;
    timerState.isPaused = false;
    stopTimerAlert();

    const subjectInput = document.getElementById('studySubjectInput');
    const subject = subjectInput ? subjectInput.value.trim() : '';

    if (saveTime && workedMins > 0 && hasPywebviewApi()) {
        try {
            if (!wasPaused) {
                const blockMs = Date.now() - timerState.currentUninterruptedStart;
                timerState.longestUninterruptedMs = Math.max(timerState.longestUninterruptedMs, blockMs);
            }
            const longestUninterruptedSecs = Math.floor(timerState.longestUninterruptedMs / 1000);
            const sessionDate = localDateStr();
            const plannedMins = focusMode === 'timer' ? Math.floor(totalTime / 60) : 0;

            // Gece yarısını geçen seans: süre çalışılan günlere bölünür.
            for (const part of splitMinutesByDay(workedMins)) {
                await window.pywebview.api.log_study_time_with_subject(part.minutes, subject, part.date);
            }

            const sessionId = await window.pywebview.api.log_session(
                sessionDate, subject, plannedMins, workedMins,
                timerState.userPauseCount, longestUninterruptedSecs, 0,
                currentRoutineId ? 'routine' : currentTaskId ? 'task' : currentRoadmapTopicId ? 'roadmap' : 'focus',
                currentTaskId, currentRoutineId, currentRoadmapTopicId,
                new Date(timerState.startTimestamp).toISOString(), new Date().toISOString()
            );

            if (currentRoutineId) {
                await window.pywebview.api.complete_routine(currentRoutineId);
            }

            if (currentTaskId) {
                await window.pywebview.api.complete_task(currentTaskId, 0);
                delete deadlineTimers[currentTaskId];
            }

            if (currentRoutineId || currentTaskId) renderUnifiedTasks();
            if (subject && typeof invalidateSubjectSuggestions === 'function') invalidateSubjectSuggestions();
            if (sessionId) openFocusScoreModal(sessionId);
        } catch (e) {
            console.error('[Focus] Seans kaydedilemedi:', e);
            alert('Seans kaydedilirken bir hata oluştu. Süre kaydedilmemiş olabilir.');
        }
    }

    currentRoutineId = null;
    currentTaskId = null;
    currentRoadmapTopicId = null;
    await clearPersistedFocusState();
    setFocusRuntime(false);
    resetTimerUi();
    renderChart();
    renderStreak();
}

function resetTimerUi() {
    document.getElementById('main-btn-icon').innerText = '▶';
    document.getElementById('focusBtn').title = 'Başlat';
    document.querySelector('.mode-selector').style.display = 'flex';
    circle.classList.remove('overtime');
    document.getElementById('focus-timer-text').classList.remove('overtime-text');

    if (focusMode === 'timer') {
        circle.classList.remove('stopwatch-mode');
        document.getElementById('focus-timer-text').classList.remove('stopwatch-text');
        document.getElementById('timer-setup').style.display = 'block';
        document.getElementById('focus-timer-text').innerText = formatTime(totalTime);
        document.getElementById('timer-mode-label').innerText = 'ZAMANLAYICI';
        setCircleProgress(100);
    } else {
        circle.classList.add('stopwatch-mode');
        document.getElementById('focus-timer-text').classList.add('stopwatch-text');
        document.getElementById('focus-timer-text').innerText = '00:00';
        document.getElementById('timer-mode-label').innerText = 'KRONOMETRE';
        setCircleProgress(0);
    }
}

// --- SÜRE DOLDU UYARISI ---
const BASE_DOCUMENT_TITLE = document.title;
let timerAlertAudioCtx = null;
let timerAlertTitleInterval = null;

function playTimerChime() {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        timerAlertAudioCtx = timerAlertAudioCtx || new Ctx();
        const ctx = timerAlertAudioCtx;
        [0, 0.35, 0.7].forEach((offset, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = i === 2 ? 1046.5 : 880;
            gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
            gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + offset + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.3);
            osc.connect(gain).connect(ctx.destination);
            osc.start(ctx.currentTime + offset);
            osc.stop(ctx.currentTime + offset + 0.32);
        });
    } catch (e) {
        console.warn('[Timer] Uyarı sesi çalınamadı:', e);
    }
}

function startTimerAlert() {
    playTimerChime();
    if (hasPywebviewApi() && window.pywebview.api.notify_timer_finished) {
        const subjectInput = document.getElementById('studySubjectInput');
        Promise.resolve(window.pywebview.api.notify_timer_finished(subjectInput ? subjectInput.value.trim() : ''))
            .catch(() => {});
    }
    clearInterval(timerAlertTitleInterval);
    let flip = false;
    timerAlertTitleInterval = setInterval(() => {
        flip = !flip;
        document.title = flip ? '⏰ Süre doldu!' : BASE_DOCUMENT_TITLE;
    }, 1000);
}

function stopTimerAlert() {
    clearInterval(timerAlertTitleInterval);
    timerAlertTitleInterval = null;
    document.title = BASE_DOCUMENT_TITLE;
}

async function setFocusRuntime(active) {
    const indicator = document.getElementById('focus-runtime-status');
    if (indicator) {
        indicator.lastChild.textContent = active ? ' Sistem Aktif: Odak Modu' : ' Odak koruması beklemede';
        indicator.classList.toggle('is-active', Boolean(active));
    }
    if (!hasPywebviewApi()) return;
    try {
        await window.pywebview.api.set_focus_runtime(Boolean(active));
    } catch (e) {
        console.error('[FocusState] Runtime durumu kaydedilemedi:', e);
    }
}

function buildFocusStatePayload() {
    const subjectInput = document.getElementById('studySubjectInput');
    return {
        mode: focusMode,
        total_seconds: totalTime,
        subject: subjectInput ? subjectInput.value.trim() : '',
        task_id: currentTaskId,
        routine_id: currentRoutineId,
        roadmap_topic_id: currentRoadmapTopicId,
        is_running: timerState.isRunning,
        is_paused: timerState.isPaused,
        start_timestamp: timerState.startTimestamp,
        pause_timestamp: timerState.pauseTimestamp,
        total_paused_ms: timerState.totalPausedMs,
        user_pause_count: timerState.userPauseCount,
        current_block_start: timerState.currentUninterruptedStart,
        longest_block_ms: timerState.longestUninterruptedMs
    };
}

async function persistFocusState() {
    if (!hasPywebviewApi() || !timerState.isRunning) return;
    try {
        await window.pywebview.api.save_focus_session_state(buildFocusStatePayload());
    } catch (e) {
        console.error('[FocusState] Oturum kaydedilemedi:', e);
    }
}

async function clearPersistedFocusState() {
    if (!hasPywebviewApi()) return;
    try {
        await window.pywebview.api.clear_focus_session_state();
    } catch (e) {
        console.error('[FocusState] Oturum temizlenemedi:', e);
    }
}

async function restoreFocusState() {
    if (!hasPywebviewApi() || timerState.isRunning) return;
    try {
        const saved = await window.pywebview.api.get_focus_session_state();
        if (!saved || !saved.is_running || !saved.start_timestamp) return;
        focusMode = saved.mode || 'timer';
        totalTime = parseInt(saved.total_seconds) || 1500;
        currentTaskId = saved.task_id || null;
        currentRoutineId = saved.routine_id || null;
        currentRoadmapTopicId = saved.roadmap_topic_id || null;
        timerState = {
            isRunning: true,
            isPaused: Boolean(saved.is_paused),
            isOvertime: false,
            startTimestamp: parseInt(saved.start_timestamp) || Date.now(),
            pauseTimestamp: parseInt(saved.pause_timestamp) || 0,
            totalPausedMs: parseInt(saved.total_paused_ms) || 0,
            overtimeStartTimestamp: 0,
            userPauseCount: parseInt(saved.user_pause_count) || 0,
            currentUninterruptedStart: parseInt(saved.current_block_start) || Date.now(),
            longestUninterruptedMs: parseInt(saved.longest_block_ms) || 0
        };
        const subjectInput = document.getElementById('studySubjectInput');
        if (subjectInput) subjectInput.value = saved.subject || '';
        document.getElementById('timer-setup').style.display = 'none';
        document.querySelector('.mode-selector').style.display = 'none';
        document.getElementById('main-btn-icon').innerText = timerState.isPaused ? '▶' : '⏸';
        document.getElementById('focusBtn').title = timerState.isPaused ? 'Devam Et' : 'Duraklat';
        updateDisplay();
        renderLoop();
        setFocusRuntime(!timerState.isPaused);
    } catch (e) {
        console.error('[FocusState] Oturum geri yüklenemedi:', e);
    }
}

focusStatePersistInterval = setInterval(() => {
    if (timerState.isRunning) persistFocusState();
}, 5000);

// --- SIDEBAR NAVIGATION & TABS ---
function toggleSidebar() {
    const sidebar = document.getElementById('app-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    sidebar.classList.toggle('active');
    overlay.classList.toggle('active');
    
    if (sidebar.classList.contains('active')) {
        openAllTimeModal();
        updateLiveRadar();
    }
}

function switchSidebarTab(tabName) {
    document.getElementById('tab-btn-alltime').classList.toggle('active', tabName === 'alltime');
    document.getElementById('tab-btn-guardian').classList.toggle('active', tabName === 'guardian');
    
    document.getElementById('sidebar-tab-alltime').classList.toggle('active', tabName === 'alltime');
    document.getElementById('sidebar-tab-guardian').classList.toggle('active', tabName === 'guardian');
    
    if (tabName === 'alltime') {
        openAllTimeModal();
    } else if (tabName === 'guardian') {
        updateLiveRadar();
    }
}

function toggleSidebarTab(tabName) {
    const sidebar = document.getElementById('app-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (!sidebar.classList.contains('active')) {
        sidebar.classList.add('active');
        overlay.classList.add('active');
    }
    switchSidebarTab(tabName);
}

// --- ADD TASK / IMPORTANT DATE MODAL ---
function openAddTaskModal() {
    document.getElementById('add-task-modal').classList.add('active');
    switchAddTab('task');
}

function switchAddTab(type) {
    document.getElementById('add-tab-task').classList.toggle('active', type === 'task');
    document.getElementById('add-tab-date').classList.toggle('active', type === 'date');
    document.getElementById('add-form-task').style.display = type === 'task' ? 'block' : 'none';
    document.getElementById('add-form-date').style.display = type === 'date' ? 'block' : 'none';
}

async function addNewFocusTask() {
    const name = document.getElementById('taskName').value.trim();
    const mins = document.getElementById('taskHours').value.trim();
    if (!name || !mins || parseInt(mins) <= 0) return;
    
    await window.pywebview.api.setup_task(name, mins);
    document.getElementById('taskName').value = '';
    document.getElementById('taskHours').value = '';
    closeModal('add-task-modal');
    renderUnifiedTasks();
}

async function addNewImportantDate() {
    const name = document.getElementById('importantDateName').value.trim();
    const date = document.getElementById('importantDatePicker').value;
    if (!name || !date) return;
    
    await window.pywebview.api.add_important_date(name, date);
    document.getElementById('importantDateName').value = '';
    document.getElementById('importantDatePicker').value = '';
    closeModal('add-task-modal');
    renderUnifiedTasks();
}

// --- UNIFIED TASKS & DATES RENDERER ---
function calculateDaysLeft(targetDate) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const target = new Date(targetDate + 'T00:00:00');
    const diff = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
    return diff;
}

async function renderUnifiedTasks() {
    const activeTasks = await window.pywebview.api.get_active_deadlines();
    const pendingTasks = await window.pywebview.api.get_waiting_tasks();
    const importantDates = await window.pywebview.api.get_important_dates();
    const routines = await window.pywebview.api.get_today_routines();
    
    const container = document.getElementById('tasks-list');
    if (!container) return;

    if ((!activeTasks || activeTasks.length === 0) && 
        (!pendingTasks || pendingTasks.length === 0) && 
        (!importantDates || importantDates.length === 0) &&
        (!routines || routines.length === 0)) {
        container.innerHTML = '<p style="font-size:12px;color:var(--text-dim);text-align:center;padding:16px;">Görev veya etkinlik bulunmamaktadır.</p>';
        return;
    }
    
    let html = '';
    
    // Group routines by period
    const routinesByPeriod = { morning: [], noon: [], evening: [] };
    if (routines) {
        routines.forEach(r => {
            if (routinesByPeriod[r.period]) {
                routinesByPeriod[r.period].push(r);
            }
        });
    }

    const periodLabels = {
        morning: '🌅 SABAH RUTİNİ',
        noon: '☀️ ÖĞLEN RUTİNİ',
        evening: '🌙 AKŞAM RUTİNİ'
    };

    const renderRoutines = (period) => {
        const periodRoutines = routinesByPeriod[period];
        if (!periodRoutines || periodRoutines.length === 0) return '';
        
        const total = periodRoutines.length;
        const completed = periodRoutines.filter(r => r.completed).length;
        const rate = Math.round((completed / total) * 100);
        
        const isEvening = period === 'evening';
        const now = new Date();
        const inactiveClass = (isEvening && now.getHours() < 17) ? 'inactive' : '';
        const completeClass = (completed === total) ? 'complete' : '';
        const collapsedClass = (completed === total && total > 0) ? 'collapsed' : '';
        
        let blockHtml = `
            <div class="routine-block ${inactiveClass} ${collapsedClass}">
                <div class="routine-header" onclick="this.parentElement.classList.toggle('collapsed')">
                    <div class="routine-header-left">${periodLabels[period]}</div>
                    <div class="routine-header-rate ${completeClass}">%${rate}</div>
                </div>
                <div class="routine-items">
        `;
        
        periodRoutines.forEach(r => {
            const itemCompleteClass = r.completed ? 'completed' : '';
            blockHtml += `
                <div class="routine-item ${itemCompleteClass}" onclick="startRoutine(${r.id}, ${r.duration_minutes}, decodeURIComponent('${encodedText(r.name)}'))">
                    <div class="routine-item-checkbox">${r.completed ? '✓' : ''}</div>
                    <div class="routine-item-icon">${r.icon}</div>
                    <div class="routine-item-name">${escapeHtml(r.name)}</div>
                    <div class="routine-item-duration">${r.duration_minutes} dk</div>
                </div>
            `;
        });
        
        blockHtml += `</div></div>`;
        return blockHtml;
    };

    // Render Morning & Noon Routines
    html += renderRoutines('morning');
    html += renderRoutines('noon');

    // Divider for Tasks
    if (activeTasks?.length > 0 || pendingTasks?.length > 0 || importantDates?.length > 0) {
        html += `<div class="tasks-section-divider"><span>BUGÜNÜN GÖREVLERİ</span></div>`;
    }

    // Render Active Tasks
    if (activeTasks && activeTasks.length > 0) {
        const now = Date.now();
        activeTasks.forEach(t => {
            startDeadlineTimer(t);
            const diff = deadlineTimers[t.id]?.paused
                ? Math.max(0, deadlineTimers[t.id].remainingSeconds || 0)
                : Math.max(0, Math.floor((deadlineTimers[t.id].deadlineTs - now) / 1000));
            const h = Math.floor(diff / 3600).toString().padStart(2, '0');
            const m = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
            const s = (diff % 60).toString().padStart(2, '0');
            const isPaused = deadlineTimers[t.id]?.paused;
            const elapsed = getDeadlineElapsed(t.id);
            const elM = Math.floor(elapsed / 60);
            
            const totalDurationSec = t.duration_minutes * 60;
            const progressPercent = Math.min(100, (elapsed / totalDurationSec) * 100);
            
            html += `
                <div class="task-card active" onclick="startTaskFocus(${t.id}, ${t.duration_minutes}, decodeURIComponent('${encodedText(t.subject)}'), ${t.roadmap_topic_id || 'null'})">
                    <div class="task-card-header">
                        <span class="task-card-status">AKTİF GÖREV</span>
                        <span class="task-card-countdown countdown-yellow">${h}:${m}:${s}</span>
                    </div>
                    <div class="task-card-title">${escapeHtml(t.subject)}</div>
                    
                    <div class="task-card-progress">
                        <div class="task-card-progress-bar" style="width: ${progressPercent}%;"></div>
                    </div>
                    
                    <div class="task-card-actions">
                        <button class="btn btn-ghost btn-small" onclick="event.stopPropagation(); toggleDeadlinePause(${t.id})">
                            ${isPaused ? 'Devam' : 'Duraklat'}
                        </button>
                        <button class="btn btn-success btn-small" onclick="event.stopPropagation(); completeDeadlineTask(${t.id})">
                            Bitir (${elM}dk)
                        </button>
                        <button class="btn btn-danger btn-small" onclick="event.stopPropagation(); resetDeadlineTask(${t.id})" style="padding: 0 8px;">
                            ✕
                        </button>
                    </div>
                </div>
            `;
        });
    }
    
    // Render Pending Tasks
    if (pendingTasks && pendingTasks.length > 0) {
        pendingTasks.forEach(t => {
            html += `
                <div class="task-card" onclick="autoFillSubject(decodeURIComponent('${encodedText(t.subject)}'))">
                    <div class="task-card-header">
                        <span class="task-card-status">BEKLEMEDE</span>
                        <span class="task-card-countdown countdown-gray">${t.minutes} dk</span>
                    </div>
                    <div class="task-card-title">${escapeHtml(t.subject)}</div>
                    <div class="task-card-actions">
                        <button class="btn btn-primary btn-small" onclick="event.stopPropagation(); activateDeadline(${t.id})">
                            Başlat
                        </button>
                        <button class="btn btn-ghost btn-small" onclick="event.stopPropagation(); deleteWaitingTask(${t.id})" style="padding: 0 8px;">
                            🗑️
                        </button>
                    </div>
                </div>
            `;
        });
    }
    
    // Render Important Dates
    if (importantDates && importantDates.length > 0) {
        importantDates.forEach(d => {
            const daysLeft = calculateDaysLeft(d.date);
            let badgeClass = 'countdown-green';
            let badgeText = `${daysLeft} gün kaldı`;
            if (daysLeft < 0) {
                badgeClass = 'countdown-gray';
                badgeText = `${Math.abs(daysLeft)} gün önce`;
            } else if (daysLeft === 0) {
                badgeClass = 'countdown-red';
                badgeText = 'BUGÜN!';
            } else if (daysLeft <= 3) {
                badgeClass = 'countdown-red';
            } else if (daysLeft <= 7) {
                badgeClass = 'countdown-yellow';
            }
            
            html += `
                <div class="task-card">
                    <div class="task-card-header">
                        <span class="task-card-status">ETKİNLİK / SINAV</span>
                        <span class="task-card-countdown ${badgeClass}">${badgeText}</span>
                    </div>
                    <div class="task-card-title">${escapeHtml(d.name)}</div>
                    <div class="task-card-header" style="margin-bottom: 0;">
                        <span style="font-size: 11px; color: var(--text-dim);">${d.date}</span>
                        <button class="btn btn-ghost btn-small" onclick="deleteImportantDate(${d.id})" style="padding: 0 8px; height: 26px;">
                            🗑️
                        </button>
                    </div>
                </div>
            `;
        });
    }

    // Render Evening Routines
    html += renderRoutines('evening');
    
    container.innerHTML = html;
}

async function deleteImportantDate(id) {
    await window.pywebview.api.delete_important_date(id);
    renderUnifiedTasks();
}

async function activateDeadline(taskId) {
    await window.pywebview.api.activate_task(taskId);
    renderUnifiedTasks();
}

async function deleteWaitingTask(taskId) {
    await window.pywebview.api.delete_task(taskId);
    renderUnifiedTasks();
}

// --- DEADLINE TIME TRACKING ---
function startDeadlineTimer(task) {
    const taskId = task.id;
    if (!deadlineTimers[taskId]) {
        deadlineTimers[taskId] = {
            deadlineTs: task.deadline_ts,
            durationSeconds: (task.duration_minutes || 0) * 60,
            remainingSeconds: task.remaining_seconds,
            paused: Boolean(task.paused),
            taskId
        };
    } else {
        deadlineTimers[taskId].deadlineTs = task.deadline_ts;
        deadlineTimers[taskId].durationSeconds = (task.duration_minutes || 0) * 60;
        deadlineTimers[taskId].remainingSeconds = task.remaining_seconds;
        deadlineTimers[taskId].paused = Boolean(task.paused);
    }
}

function getDeadlineElapsed(taskId) {
    const t = deadlineTimers[taskId];
    if (!t) return 0;
    const remaining = t.paused
        ? Math.max(0, t.remainingSeconds || 0)
        : Math.max(0, Math.floor((t.deadlineTs - Date.now()) / 1000));
    return Math.max(0, (t.durationSeconds || 0) - remaining);
}

async function toggleDeadlinePause(taskId) {
    const t = deadlineTimers[taskId];
    if (!t) return;
    const shouldPause = !t.paused;
    await window.pywebview.api.set_task_deadline_paused(taskId, shouldPause);
    t.paused = shouldPause;
    await renderUnifiedTasks();
}

async function completeDeadlineTask(taskId) {
    let finalMinutes = 0;
    let finalSubject = '';
    if (deadlineTimers[taskId]) {
        const workedMins = elapsedToMinutes(getDeadlineElapsed(taskId));
        finalMinutes = workedMins;
        if (workedMins > 0) {
            // Find task title
            const cards = document.querySelectorAll('.task-card.active');
            let taskSubject = '';
            for (const c of cards) {
                if (c.innerHTML.includes(`completeDeadlineTask(${taskId})`)) {
                    taskSubject = c.querySelector('.task-card-title').innerText;
                    break;
                }
            }
            finalSubject = taskSubject;
            if (taskSubject) {
                await window.pywebview.api.log_study_time_with_subject(workedMins, taskSubject);
            } else {
                await window.pywebview.api.log_study_time(workedMins);
            }
            await window.pywebview.api.log_session(
                localDateStr(), taskSubject, deadlineTimers[taskId].durationSeconds / 60,
                workedMins, 0, workedMins * 60, 0, 'task', taskId, null, null,
                null, new Date().toISOString()
            );
        }
        delete deadlineTimers[taskId];
    }
    await window.pywebview.api.complete_task(taskId, 0);
    renderUnifiedTasks();
    renderChart();
}

async function resetDeadlineTask(taskId) {
    if (deadlineTimers[taskId]) {
        delete deadlineTimers[taskId];
    }
    await window.pywebview.api.delete_task(taskId);
    renderUnifiedTasks();
}

// --- CANLI RADAR & ODAK GÜCÜ ---
async function updateLiveRadar() {
    const status = await window.pywebview.api.get_live_blacklist_status();
    
    // 1. Sidebar Blacklist Rendering
    const container = document.getElementById('blacklist-ul');
    if (container) {
        if (!status || status.length === 0) {
            container.innerHTML = '<p style="font-size:11px;color:var(--text-dim);text-align:center;padding:8px;">Karaliste boş</p>';
        } else {
            container.innerHTML = status.map(s => {
                const isOpen = s.status === 'Açık';
                const appArg = encodedText(s.app);
                return `
                    <div class="radar-item">
                        <div class="radar-dot ${isOpen ? 'active' : ''}"></div>
                        <span class="radar-app" title="${escapeHtml(s.app)}">${escapeHtml(s.display)}</span>
                        <span class="radar-status ${isOpen ? 'open' : 'closed'}">${escapeHtml(s.status)}</span>
                        ${isOpen ? `<span class="radar-countdown">${s.time_left}s</span>` : ''}
                        <button class="btn btn-ghost" onclick="renameRadarApp(decodeURIComponent('${appArg}'))" title="İsim Değiştir" style="font-size:10px;width:26px;height:26px;padding:0;display:grid;place-items:center;">✏</button>
                        <button class="btn btn-danger" onclick="removeApp(decodeURIComponent('${appArg}'))" style="font-size:10px;width:26px;height:26px;padding:0;display:grid;place-items:center;">✕</button>
                    </div>`;
            }).join('');
        }
    }
    
    // 2. Right Panel Alert & Focus Power
    const warningBox = document.getElementById('active-threat-warning-box');
    const warningDetails = document.getElementById('active-threat-details');
    const powerValue = document.getElementById('focus-power-value');
    const powerFill = document.getElementById('focus-power-fill');
    
    if (status && status.length > 0) {
        const activeThreats = status.filter(s => s.status === 'Açık');
        if (activeThreats.length > 0) {
            if (warningDetails) {
                warningDetails.innerHTML = activeThreats.map(t => 
                    `<strong>${escapeHtml(t.display)}</strong> uygulaması açık! Kapatılmasına <span>${t.time_left} saniye</span> kaldı.`
                ).join('<br>');
            }
            if (warningBox) warningBox.style.display = 'block';
            
            // Calculate Focus Power based on the min remaining time of active apps
            const minTimeLeft = Math.min(...activeThreats.map(t => t.time_left));
            const focusPower = Math.round((minTimeLeft / 120) * 100);
            
            if (powerValue) powerValue.innerText = `%${focusPower}`;
            if (powerFill) powerFill.style.width = `${focusPower}%`;
        } else {
            if (warningBox) warningBox.style.display = 'none';
            if (powerValue) powerValue.innerText = '%100';
            if (powerFill) powerFill.style.width = '100%';
        }
    } else {
        if (warningBox) warningBox.style.display = 'none';
        if (powerValue) powerValue.innerText = '%100';
        if (powerFill) powerFill.style.width = '100%';
    }
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
    }
});

// --- AKILLI TEKRAR MODAL ---
async function openSmartRepeatModal() {
    document.getElementById('smart-modal').classList.add('active');
    
    const lessons = await window.pywebview.api.get_today_schedule();
    const info = document.getElementById('today-lessons-info');
    if (lessons && lessons.length > 0) {
        info.innerHTML = `<div class="section-label">Bugünkü Dersler</div>` + 
            lessons.map(l => {
                const durStr = (l.hours > 0 ? `${l.hours}sa ` : '') + `${l.minutes}dk`;
                return `<div style="font-size:12px;color:var(--text-primary);padding:4px 0;">📚 ${escapeHtml(l.name)} (${durStr})</div>`;
            }).join('');
    } else {
        info.innerHTML = '<p style="font-size:12px;color:var(--text-dim);padding:8px 0;">Bugün için ders programı girilmemiş.</p>';
    }
    
    renderSmartTasks();
}

async function applyStrategy(type) {
    const result = await window.pywebview.api.apply_repeat_strategy(type);
    
    if (result && result.message) {
        const info = document.getElementById('today-lessons-info');
        info.innerHTML += `<div style="font-size:12px;color:var(--accent);padding:8px 0;font-weight:600;">✓ ${escapeHtml(result.message)}</div>`;
    }
    renderSmartTasks();
}

async function renderSmartTasks() {
    const tasks = await window.pywebview.api.get_todays_smart_tasks();
    const container = document.getElementById('smart-tasks-list');
    if (!container) return;

    if (!tasks || tasks.length === 0) {
        container.innerHTML = '<p style="font-size:11px;color:var(--text-dim);text-align:center;padding:8px;">Bugün için tekrar görevi yok</p>';
        return;
    }
    container.innerHTML = tasks.map(t => `
        <div class="radar-item" style="${t.completed ? 'opacity:0.4;' : ''}">
            <div class="radar-app">
                <span>${t.completed ? '✓ ' : ''}${escapeHtml(t.lesson)}</span>
                <div style="font-size:10px;color:var(--text-dim);margin-top:2px;">${t.minutes} dk — ${t.source === 'daily_repeat' ? 'Günlük' : t.source === 'spaced_rep' ? 'Eğri' : 'Manuel'}</div>
            </div>
            ${!t.completed ? `<button class="btn btn-success btn-small" onclick="completeSmartTask(${t.id})" title="Tamamla">✓</button>` : ''}
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
    if (!tbody) return;

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
    renderStreak();
}

// --- MODAL UTILS ---
function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

// Modal dışına tıklayınca kapat
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', function(e) {
        if (e.target === this) {
            if (this.id === 'journal-modal') {
                closeJournal();
            } else if (this.id === 'focus-score-modal') {
                closeFocusScoreModal();
            } else {
                this.classList.remove('active');
            }
        }
    });
});

// --- ÇEVRİMDIŞI HAFTALIK RİTİM GRAFİĞİ ---
async function renderChart() {
    const rawData = await window.pywebview.api.get_weekly_chart_data();
    let dates = [];
    let minutes = [];
    
    const todayStr = localDateStr();
    const TR_DAYS_SHORT = ['PAZ', 'PZT', 'SAL', 'ÇAR', 'PER', 'CUM', 'CTS'];
    
    if (rawData && rawData.length > 0) {
        // Reverse array to render chronologically (oldest to newest)
        rawData.reverse().forEach(row => {
            const dateObj = new Date(row[0] + 'T00:00:00');
            const rowDateStr = row[0];
            
            let label = TR_DAYS_SHORT[dateObj.getDay()];
            if (rowDateStr === todayStr) {
                label = 'BUG';
            }
            dates.push(label);
            minutes.push(row[1]);
        });
    } else {
        dates = ['PZT', 'SAL', 'ÇAR', 'PER', 'CUM', 'CTS', 'PAZ'];
        minutes = [0, 0, 0, 0, 0, 0, 0];
    }

    const container = document.querySelector('#historyChart');
    if (!container) return;
    const maxMinutes = Math.max(60, ...minutes);
    container.innerHTML = `<div class="native-week-chart">${dates.map((date, index) => {
        const height = minutes[index] > 0 ? Math.max(5, Math.round((minutes[index] / maxMinutes) * 100)) : 2;
        const todayClass = date === 'BUG' ? 'today' : '';
        return `<div class="native-chart-column" title="${date}: ${formatMinutesToHHMM(minutes[index])}">
            <div class="native-chart-track"><div class="native-chart-bar ${todayClass}" style="height:${height}%"></div></div>
            <span>${date}</span>
        </div>`;
    }).join('')}</div>`;
}

// --- LIVE RADAR & TASK REFRESH LOOP ---
setInterval(() => {
    if (hasPywebviewApi()) {
        updateLiveRadar();
        renderUnifiedTasks();
    }
}, 1000);

// --- SAYFA YÜKLENME ---
window.addEventListener('pywebviewready', () => {
    renderChart();
    renderUnifiedTasks();
    updateLiveRadar();
    syncCheckinSettings();
});

window.addEventListener('load', () => {
    if (hasPywebviewApi()) {
        renderChart();
        renderUnifiedTasks();
        updateLiveRadar();
        syncCheckinSettings();
    }
});

async function syncCheckinSettings() {
    const status = await window.pywebview.api.get_checkin_status();
    const btn = document.getElementById('checkinToggleBtn');
    const intervalInput = document.getElementById('checkinIntervalInput');
    
    if (status.active) {
        btn.innerText = `El sallama: Aktif`;
        btn.classList.remove('btn-ghost');
        btn.classList.add('btn-success');
    } else {
        btn.innerText = 'El sallama modu: kapalı';
        btn.classList.remove('btn-success');
        btn.classList.add('btn-ghost');
    }
}

// =============================================
// BACKEND TRIGGERS (Lock, Sleep, Checkin alert)
// =============================================
function pauseFromBackend(reason, eventTimestamp = null) {
    console.log(`[FocusOS] Backend PAUSE: ${reason}`);
    if (timerState.isRunning && !timerState.isPaused) {
        togglePause(true, eventTimestamp);
    }
    Object.keys(deadlineTimers).forEach(taskId => {
        const t = deadlineTimers[taskId];
        if (t && !t.paused) {
            toggleDeadlinePause(parseInt(taskId));
        }
    });
}

function resumeFromBackend(reason) {
    console.log(`[FocusOS] Backend RESUME: ${reason}`);
}

// =============================================
// CHECK-IN CALLBACKS
// =============================================
let checkinCountdownInterval = null;

async function toggleCheckinMode() {
    const intervalInput = document.getElementById('checkinIntervalInput');
    const intervalMin = parseInt(intervalInput?.value) || 10;
    await window.pywebview.api.set_checkin_interval(intervalMin);

    const result = await window.pywebview.api.toggle_checkin_mode();
    const btn = document.getElementById('checkinToggleBtn');
    if (result.active) {
        btn.innerText = `El sallama: Aktif`;
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

// --- TÜM ZAMANLAR TABLOSU ---
async function openAllTimeModal() {
    const data = await window.pywebview.api.get_all_time_stats();
    
    // Update summary metrics
    const summary = data.summary || {};
    const elScore = document.getElementById('qm-avg-score');
    if (elScore) elScore.innerText = summary.avg_score ? summary.avg_score.toFixed(1) : '-';
    
    const elLongest = document.getElementById('qm-longest-block');
    if (elLongest) elLongest.innerText = summary.longest_block_min || '0';
    
    const elPauses = document.getElementById('qm-total-pauses');
    if (elPauses) elPauses.innerText = summary.total_pauses || '0';
    
    const elRoutines = document.getElementById('qm-routines');
    if (elRoutines) elRoutines.innerText = summary.routines_completed || '0';

    const tbody = document.getElementById('alltime-table-body');
    const TR_DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
    
    if (!tbody) return;

    if (!data.daily_logs || data.daily_logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-dim);">Henüz veri yok</td></tr>';
        return;
    }
    
    tbody.innerHTML = data.daily_logs.map(d => {
        const dateObj = new Date(d.date + 'T00:00:00');
        const dayName = TR_DAYS[dateObj.getDay()];
        const hhmmStr = formatMinutesToHHMM(d.minutes);
        const scoreStr = d.avg_score > 0 ? `⭐ ${d.avg_score.toFixed(1)}` : '-';
        return `<tr class="alltime-row-clickable" onclick="toggleSubjectDetail(this, '${d.date}')">
            <td>${d.date}</td>
            <td>${dayName}</td>
            <td>
                <span class="editable-time" onclick="event.stopPropagation(); makeTimeEditable(this, '${d.date}', ${d.minutes})">${hhmmStr}</span> <span style="font-size:10px;color:var(--text-dim)">(${d.minutes}dk)</span>
            </td>
            <td>${scoreStr}</td>
            <td style="color:var(--accent); font-size:10px;">GÖSTER ▼</td>
        </tr>
        <tr class="subject-detail-row" id="detail-${d.date}" style="display:none;">
            <td colspan="5" class="subject-detail-cell">Yükleniyor...</td>
        </tr>`;
    }).join('');
}

function makeTimeEditable(el, date, currentMinutes) {
    const currentHHMM = formatMinutesToHHMM(currentMinutes);
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'edit-time-input';
    input.value = currentHHMM;
    input.placeholder = 'S:DD';
    
    el.replaceWith(input);
    input.focus();
    input.select();
    
    async function saveEdit() {
        const val = input.value.trim();
        let newMinutes = currentMinutes;
        if (val.includes(':')) {
            const parts = val.split(':');
            const h = parseInt(parts[0]) || 0;
            const m = parseInt(parts[1]) || 0;
            newMinutes = h * 60 + m;
        } else {
            newMinutes = parseInt(val) || currentMinutes;
        }
        
        await window.pywebview.api.update_daily_log(date, newMinutes);
        
        const span = document.createElement('span');
        span.className = 'editable-time';
        span.innerText = formatMinutesToHHMM(newMinutes);
        span.onclick = function(e) { e.stopPropagation(); makeTimeEditable(span, date, newMinutes); };
        input.replaceWith(span);
        
        renderChart();
    }
    
    input.addEventListener('blur', saveEdit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { input.blur(); }
        if (e.key === 'Escape') {
            const span = document.createElement('span');
            span.className = 'editable-time';
            span.innerText = currentHHMM;
            span.onclick = function(ev) { ev.stopPropagation(); makeTimeEditable(span, date, currentMinutes); };
            input.replaceWith(span);
        }
    });
}

async function toggleSubjectDetail(row, date) {
    const nextRow = row.nextElementSibling;
    if (nextRow && nextRow.classList.contains('subject-detail-row')) {
        nextRow.remove();
        return;
    }
    
    const subjects = await window.pywebview.api.get_subject_logs_for_date(date);
    const detailRow = document.createElement('tr');
    detailRow.className = 'subject-detail-row';
    
    if (!subjects || subjects.length === 0) {
        detailRow.innerHTML = `<td colspan="3"><div class="subject-detail-container"><span style="font-size:11px;color:var(--text-dim);">Bu gün için konu detayı yok</span></div></td>`;
    } else {
        const tags = subjects.map(s => 
            `<span class="subject-tag">${escapeHtml(s.subject)} <span class="subject-tag-time">${formatMinutesToHHMM(s.minutes)}</span></span>`
        ).join('');
        detailRow.innerHTML = `<td colspan="3"><div class="subject-detail-container">${tags}</div></td>`;
    }
    
    row.after(detailRow);
}

// ===== ÇALIŞMA SERİSİ (STREAK) =====
async function renderStreak() {
    if (!hasPywebviewApi()) return;
    
    try {
        const data = await window.pywebview.api.get_study_streak();
        const streak = data.streak || 0;
        const todayMin = data.today_minutes || 0;
        const qualified = data.today_qualified || false;
        const target = data.target_minutes || 60;
        
        // Streak number
        const streakNum = document.getElementById('streak-number');
        if (streakNum) streakNum.innerText = streak;
        
        // Flame animation
        const flame = document.getElementById('streak-flame');
        if (flame) {
            if (streak > 0 || qualified) {
                flame.classList.remove('inactive');
            } else {
                flame.classList.add('inactive');
            }
        }
        
        // Progress bar (target: 60 min)
        const pct = Math.min(100, (todayMin / target) * 100);
        const fill = document.getElementById('streak-progress-fill');
        if (fill) {
            fill.style.width = pct + '%';
            if (qualified) {
                fill.classList.add('complete');
            } else {
                fill.classList.remove('complete');
            }
        }
        
        // Progress text
        const progText = document.getElementById('streak-progress-text');
        if (progText) progText.innerText = `${todayMin} / ${target} dk`;
        
        // Motivation message
        const motiv = document.getElementById('streak-motivation');
        if (motiv) {
            if (qualified) {
                motiv.innerText = '✅ Bugünkü hedef tamamlandı! Seri devam ediyor.';
                motiv.style.color = 'var(--success)';
            } else if (streak > 0 && data.grace_available === false) {
                const remaining = target - todayMin;
                motiv.innerText = `⚠️ Bu hafta bir gün kaçırdın. Seriyi korumak için bugün ${remaining} dk daha çalış!`;
                motiv.style.color = 'var(--danger)';
            } else if (todayMin > 0) {
                const remaining = target - todayMin;
                motiv.innerText = `⏳ Seriyi uzatmak için ${remaining} dk daha çalış!`;
                motiv.style.color = 'var(--accent)';
            } else {
                motiv.innerText = `Bugün ${target} dakika çalışarak seriyi uzat!`;
                motiv.style.color = 'var(--text-dim)';
            }
            motiv.title = 'Hedefe ulaşmadığın tek bir gün seriyi bozmaz; 7 gün içinde ikinci kez kaçırırsan seri sıfırlanır. OFF DAY günleri kaçırma sayılmaz.';
        }
    } catch (e) {
        console.error('[Streak] Render hatası:', e);
    }
}

// ===== GÜNLÜK NOT DEFTERİ =====
let journalCurrentDate = new Date();

const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
                   'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const TR_DAYS_LONG = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

function formatJournalDate(date) {
    const d = new Date(date);
    return `${d.getDate()} ${TR_MONTHS[d.getMonth()]} ${d.getFullYear()}, ${TR_DAYS_LONG[d.getDay()]}`;
}

function getDateStr(date) {
    return localDateStr(date);
}

async function openJournal() {
    journalCurrentDate = new Date();
    const modal = document.getElementById('journal-modal');
    const wrapper = modal.querySelector('.journal-book-wrapper');
    
    // Reset animation
    wrapper.classList.remove('closing');
    wrapper.style.animation = 'none';
    wrapper.offsetHeight; // trigger reflow
    wrapper.style.animation = '';
    
    modal.classList.add('active');
    await loadJournalNote(journalCurrentDate);
    await renderRecentNotes();
}

function closeJournal() {
    const modal = document.getElementById('journal-modal');
    const wrapper = modal.querySelector('.journal-book-wrapper');
    
    wrapper.classList.add('closing');
    setTimeout(() => {
        modal.classList.remove('active');
        wrapper.classList.remove('closing');
    }, 350);
}

async function loadJournalNote(date) {
    const dateStr = getDateStr(date);
    const display = document.getElementById('journal-date-display');
    if (display) display.innerText = formatJournalDate(date);
    
    const textarea = document.getElementById('journal-textarea');
    if (textarea && hasPywebviewApi()) {
        try {
            const content = await window.pywebview.api.get_daily_note(dateStr);
            textarea.value = content || '';
        } catch (e) {
            textarea.value = '';
        }
    }
}

async function saveJournalNote() {
    const dateStr = getDateStr(journalCurrentDate);
    const textarea = document.getElementById('journal-textarea');
    if (!textarea || !hasPywebviewApi()) return;
    
    try {
        await window.pywebview.api.save_daily_note(dateStr, textarea.value);
        await renderRecentNotes();
        
        // Show brief save confirmation
        const btn = event.target;
        const origText = btn.innerHTML;
        btn.innerHTML = '✅ Kaydedildi!';
        btn.style.background = 'var(--success)';
        setTimeout(() => {
            btn.innerHTML = origText;
            btn.style.background = '';
        }, 1500);
    } catch (e) {
        console.error('[Journal] Kaydetme hatası:', e);
    }
}

function journalPrevDay() {
    journalCurrentDate.setDate(journalCurrentDate.getDate() - 1);
    loadJournalNote(journalCurrentDate);
}

function journalNextDay() {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const next = new Date(journalCurrentDate);
    next.setDate(next.getDate() + 1);
    // Don't go past today
    if (next <= today) {
        journalCurrentDate.setDate(journalCurrentDate.getDate() + 1);
        loadJournalNote(journalCurrentDate);
    }
}

async function renderRecentNotes() {
    const container = document.getElementById('journal-history');
    if (!container || !hasPywebviewApi()) return;
    
    try {
        const notes = await window.pywebview.api.get_recent_notes();
        if (!notes || notes.length === 0) {
            container.innerHTML = '<p style="font-size:11px;color:var(--text-dim);text-align:center;padding:12px;">Henüz geçmiş not bulunmuyor.</p>';
            return;
        }
        
        container.innerHTML = notes.map(n => {
            const d = new Date(n.date + 'T00:00:00');
            const dateLabel = formatJournalDate(d);
            const preview = n.content.length > 100 ? n.content.substring(0, 100) + '...' : n.content;
            return `
                <div class="journal-entry" onclick="jumpToJournalDate('${n.date}')">
                    <div class="journal-entry-date">${dateLabel}</div>
                    <div class="journal-entry-preview">${preview}</div>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error('[Journal] Geçmiş notlar yüklenemedi:', e);
    }
}

function jumpToJournalDate(dateStr) {
    journalCurrentDate = new Date(dateStr + 'T00:00:00');
    loadJournalNote(journalCurrentDate);
}

// --- INIT: Sayfa yüklenince streak'i render et ---
window.addEventListener('pywebviewready', function() {
    renderStreak();
    checkWeeklyReview();
});

// Fallback: Eğer pywebviewready zaten oluşmuşsa
setTimeout(() => {
    if (hasPywebviewApi()) {
        renderStreak();
        checkWeeklyReview();
    }
}, 1000);

// =============================================
// NEW FEATURES IMPLEMENTATION
// =============================================

function autoFillSubject(subject) {
    const input = document.getElementById('studySubjectInput');
    if (input) {
        input.value = subject;
    }
}

// --- OFF DAY ---
const OFF_DAY_LOOKBACK_DAYS = 6;

function populateOffDayDates() {
    const select = document.getElementById('off-day-date');
    if (!select) return;
    const previous = select.value;
    const options = [];
    for (let i = 0; i <= OFF_DAY_LOOKBACK_DAYS; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const label = i === 0 ? 'Bugün' : i === 1 ? 'Dün'
            : `${d.getDate()} ${TR_MONTHS[d.getMonth()].slice(0, 3)} ${TR_DAYS_LONG[d.getDay()].slice(0, 3)}`;
        options.push(`<option value="${localDateStr(d)}">${label}</option>`);
    }
    select.innerHTML = options.join('');
    if (previous && [...select.options].some(o => o.value === previous)) select.value = previous;
}

async function useOffDay() {
    const select = document.getElementById('off-day-date');
    const dateStr = select && select.value ? select.value : localDateStr();
    const label = select && select.selectedOptions[0] ? select.selectedOptions[0].text : 'Bugün';
    if (!confirm(`${label} OFF DAY olarak işaretlensin mi? Her hafta için 1 hak vardır.`)) return;
    const res = await window.pywebview.api.use_off_day(dateStr);
    if (res && res.success) {
        renderStreak();
    } else {
        alert((res && res.message) || 'Off Day kullanılamadı.');
    }
}

async function checkOffDayStatus() {
    populateOffDayDates();
    const status = await window.pywebview.api.get_off_day_status();
    const btn = document.getElementById('off-day-btn');
    const statusText = document.getElementById('off-day-status');
    // Önceki haftaya ait günler için hâlâ hak olabileceğinden buton kapatılmaz;
    // yalnızca bu haftanın durumu gösterilir, kural ihlalini sunucu reddeder.
    btn.disabled = false;
    statusText.innerText = status.used
        ? `Bu hafta: kullanıldı (${status.used_date.slice(8, 10)}.${status.used_date.slice(5, 7)})`
        : 'Bu hafta: mevcut';
}

// Ensure checkOffDayStatus runs when streak renders
const originalRenderStreak = renderStreak;
renderStreak = async function() {
    await originalRenderStreak();
    await checkOffDayStatus();
}

// --- ROUTINES UI ---
let selectedRoutinePeriod = 'morning';
let selectedRoutineEmoji = '💧';
let editingRoutineId = null;

const ROUTINE_PERIOD_LABELS = {
    morning: 'Sabah',
    noon: 'Öğlen',
    evening: 'Akşam'
};

const ROUTINE_DAY_LABELS = {
    '1': 'Pzt', '2': 'Sal', '3': 'Çar', '4': 'Per', '5': 'Cum', '6': 'Cts', '7': 'Paz'
};

function selectRoutinePeriod(period) {
    selectedRoutinePeriod = period;
    document.querySelectorAll('.period-tab').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-period') === period);
    });
}

function selectRoutineEmoji(btn, emoji) {
    selectedRoutineEmoji = emoji;
    document.querySelectorAll('#emoji-picker .emoji-btn').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
}

function toggleRoutineDay(btn) {
    btn.classList.toggle('active');
}

async function saveNewRoutine() {
    const name = document.getElementById('routineName').value.trim();
    const duration = parseInt(document.getElementById('routineDuration').value) || 5;
    
    let activeDays = [];
    document.querySelectorAll('.day-toggle.active').forEach(el => {
        activeDays.push(el.getAttribute('data-day'));
    });
    
    if (!name || activeDays.length === 0) {
        alert("Lütfen rutin adı girin ve en az bir gün seçin.");
        return;
    }
    
    const activeDaysStr = activeDays.join(',');
    if (editingRoutineId) {
        await window.pywebview.api.update_routine(editingRoutineId, name, selectedRoutinePeriod, selectedRoutineEmoji, duration, activeDaysStr);
    } else {
        await window.pywebview.api.add_routine(name, selectedRoutinePeriod, selectedRoutineEmoji, duration, activeDaysStr);
    }
    
    resetRoutineEditor();
    if (document.getElementById('add-task-modal').classList.contains('active')) closeModal('add-task-modal');
    await Promise.all([renderUnifiedTasks(), renderRoutineManager()]);
}

async function openRoutines() {
    document.getElementById('roadmap-view').classList.remove('active');
    const view = document.getElementById('routines-view');
    const form = document.getElementById('add-form-routine');
    const host = document.getElementById('routine-form-host');
    if (form && host && form.parentElement !== host) host.appendChild(form);
    if (form) form.style.display = 'block';
    view.classList.add('active');
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    document.getElementById('nav-routines')?.classList.add('active');
    await renderRoutineManager();
}

function closeRoutines() {
    document.getElementById('routines-view').classList.remove('active');
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    document.getElementById('nav-focus')?.classList.add('active');
    renderUnifiedTasks();
}

async function renderRoutineManager() {
    if (!hasPywebviewApi()) return;
    const routines = await window.pywebview.api.get_all_routines();
    const list = document.getElementById('routine-manager-list');
    document.getElementById('routine-manager-count').innerText = `${routines.length} rutin`;
    if (!routines.length) {
        list.innerHTML = '<div class="routine-manager-empty">Henüz rutin yok. Soldaki formdan ilk rutinini oluştur.</div>';
        return;
    }
    list.innerHTML = routines.map(routine => {
        const days = String(routine.active_days || '').split(',').filter(Boolean).map(day => ROUTINE_DAY_LABELS[day] || day).join(' · ');
        return `
            <div class="routine-manager-row">
                <div class="routine-manager-icon">${escapeHtml(routine.icon || '✓')}</div>
                <div>
                    <div class="routine-manager-name">${escapeHtml(routine.name)}</div>
                    <div class="routine-manager-meta">${ROUTINE_PERIOD_LABELS[routine.period] || routine.period} · ${routine.duration_minutes} dk · ${escapeHtml(days)}</div>
                </div>
                <button class="btn btn-ghost btn-small" onclick="editRoutine(${routine.id})">Düzenle</button>
                <button class="btn btn-danger btn-small" onclick="deleteRoutineFromManager(${routine.id}, decodeURIComponent('${encodedText(routine.name)}'))">Sil</button>
            </div>`;
    }).join('');
}

async function editRoutine(routineId) {
    const routines = await window.pywebview.api.get_all_routines();
    const routine = routines.find(item => item.id === routineId);
    if (!routine) return;
    editingRoutineId = routine.id;
    document.getElementById('routineName').value = routine.name;
    document.getElementById('routineDuration').value = routine.duration_minutes;
    selectRoutinePeriod(routine.period);
    selectedRoutineEmoji = routine.icon || '💧';
    document.querySelectorAll('#emoji-picker .emoji-btn').forEach(btn => btn.classList.toggle('active', btn.textContent.trim() === selectedRoutineEmoji));
    const activeDays = new Set(String(routine.active_days || '').split(','));
    document.querySelectorAll('#add-form-routine .day-toggle').forEach(btn => btn.classList.toggle('active', activeDays.has(btn.dataset.day)));
    document.getElementById('routine-editor-title').innerText = 'Rutini düzenle';
    document.getElementById('routine-edit-cancel').style.display = 'block';
    const saveButton = document.querySelector('#add-form-routine .btn-primary');
    if (saveButton) saveButton.innerText = 'DEĞİŞİKLİKLERİ KAYDET';
    document.querySelector('.routine-editor-card')?.scrollIntoView({behavior: 'smooth', block: 'start'});
}

function resetRoutineEditor() {
    editingRoutineId = null;
    const name = document.getElementById('routineName');
    if (!name) return;
    name.value = '';
    document.getElementById('routineDuration').value = 5;
    selectRoutinePeriod('morning');
    document.querySelectorAll('#add-form-routine .day-toggle').forEach(btn => btn.classList.add('active'));
    document.getElementById('routine-editor-title').innerText = 'Yeni rutin oluştur';
    document.getElementById('routine-edit-cancel').style.display = 'none';
    const saveButton = document.querySelector('#add-form-routine .btn-primary');
    if (saveButton) saveButton.innerText = 'RUTİNİ LİSTEYE EKLE';
}

async function deleteRoutineFromManager(routineId, name) {
    if (!confirm(`“${name}” rutini kalıcı olarak silinsin mi?`)) return;
    await window.pywebview.api.delete_routine(routineId);
    if (editingRoutineId === routineId) resetRoutineEditor();
    await Promise.all([renderRoutineManager(), renderUnifiedTasks()]);
}

function startRoutine(id, durationMins, name) {
    autoFillSubject(name);
    currentRoutineId = id;
    currentTaskId = null;
    currentRoadmapTopicId = null;
    focusMode = 'timer';
    setPreset(durationMins, null);
    startFocus();
}

function startTaskFocus(id, durationMins, name, roadmapTopicId = null) {
    if (timerState.isRunning) {
        autoFillSubject(name);
        return;
    }
    autoFillSubject(name);
    currentTaskId = id;
    currentRoutineId = null;
    currentRoadmapTopicId = roadmapTopicId || null;
    focusMode = 'timer';
    setPreset(durationMins, null);
    startFocus();
}

// Replace switchAddTab to include routine
const originalSwitchAddTab = switchAddTab;
switchAddTab = function(type) {
    originalSwitchAddTab(type);
    const routineTab = document.getElementById('add-tab-routine');
    const routineForm = document.getElementById('add-form-routine');
    if (routineTab && routineForm) {
        routineTab.classList.toggle('active', type === 'routine');
        routineForm.style.display = type === 'routine' ? 'block' : 'none';
        
        if (type === 'routine') {
            document.getElementById('add-form-task').style.display = 'none';
            document.getElementById('add-form-date').style.display = 'none';
            document.getElementById('add-tab-task').classList.remove('active');
            document.getElementById('add-tab-date').classList.remove('active');
        }
    }
}

// --- FOCUS SCORE MODAL ---
function openFocusScoreModal(sessionId) {
    currentSessionId = sessionId;
    currentFocusScore = 0;
    
    document.querySelectorAll('.star-rating .star').forEach(el => el.classList.remove('active'));
    document.getElementById('focus-score-modal').classList.add('active');
    
    let timeLeft = 10;
    const timerEl = document.getElementById('focus-score-timer');
    timerEl.innerText = timeLeft;
    
    if (focusScoreInterval) clearInterval(focusScoreInterval);
    focusScoreInterval = setInterval(() => {
        timeLeft--;
        timerEl.innerText = timeLeft;
        if (timeLeft <= 0) {
            closeFocusScoreModal();
        }
    }, 1000);
}

function selectFocusScore(score) {
    currentFocusScore = score;
    document.querySelectorAll('.star-rating .star').forEach(el => {
        if (parseInt(el.getAttribute('data-score')) <= score) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });
}

async function saveFocusScore() {
    if (currentSessionId && currentFocusScore > 0) {
        await window.pywebview.api.update_session_score(currentSessionId, currentFocusScore);
    }
    closeFocusScoreModal();
}

function closeFocusScoreModal() {
    if (focusScoreInterval) clearInterval(focusScoreInterval);
    document.getElementById('focus-score-modal').classList.remove('active');
    openAllTimeModal(); // Refresh table to show new score if modal is open
}

// --- WEEKLY REVIEW MODAL ---
async function checkWeeklyReview() {
    const res = await window.pywebview.api.check_weekly_review();
    if (res.should_show) {
        renderWeeklyReviewData(res.week_data, res.priorities);
        document.getElementById('weekly-review-modal').classList.add('active');
    }
    renderWeeklyPrioritiesBar(res.priorities);
}

async function openWeeklyReviewManual() {
    const res = await window.pywebview.api.get_weekly_review_data();
    renderWeeklyReviewData(res.week_data, res.priorities);
    document.getElementById('weekly-review-modal').classList.add('active');
}

function renderWeeklyReviewData(weekData, priorities) {
    const grid = document.getElementById('weekly-stats-grid');
    if (grid && weekData) {
        const hours = (weekData.total_minutes / 60).toFixed(1);
        const longestMins = Math.round(weekData.longest_uninterrupted_seconds / 60);
        grid.innerHTML = `
            <div class="weekly-stat-card">
                <div class="weekly-stat-value">${hours}s</div>
                <div class="weekly-stat-label">Toplam Çalışma</div>
            </div>
            <div class="weekly-stat-card">
                <div class="weekly-stat-value">${weekData.routines_completed}</div>
                <div class="weekly-stat-label">Rutin Adımı</div>
            </div>
            <div class="weekly-stat-card">
                <div class="weekly-stat-value">${longestMins}dk</div>
                <div class="weekly-stat-label">En Uzun Odak</div>
            </div>
            <div class="weekly-stat-card">
                <div class="weekly-stat-value">⭐ ${weekData.avg_focus_score}</div>
                <div class="weekly-stat-label">Odak Skoru</div>
            </div>
        `;
    }
    
    if (priorities) {
        priorities.forEach((p, i) => {
            const input = document.getElementById('priority-' + (i + 1));
            if (input) input.value = p.text;
        });
    }
}

async function startWeek() {
    const p1 = document.getElementById('priority-1').value.trim();
    const p2 = document.getElementById('priority-2').value.trim();
    const p3 = document.getElementById('priority-3').value.trim();
    const plist = [p1, p2, p3].filter(p => p.length > 0);
    
    await window.pywebview.api.save_weekly_priorities(plist);
    await window.pywebview.api.dismiss_weekly_review();
    
    renderWeeklyPrioritiesBar(plist.map((text, order) => ({text, order})));
    closeWeeklyReview();
}

function closeWeeklyReview() {
    document.getElementById('weekly-review-modal').classList.remove('active');
    window.pywebview.api.dismiss_weekly_review();
}

function renderWeeklyPrioritiesBar(priorities) {
    const bar = document.getElementById('weekly-priorities-bar');
    if (!bar) return;
    
    if (!priorities || priorities.length === 0) {
        bar.style.display = 'none';
        return;
    }
    
    bar.style.display = 'flex';
    bar.innerHTML = '🎯 ' + priorities.map(p => `<span class="priority-tag">${escapeHtml(p.text)}</span>`).join('');
}

// =============================================
// YOL HARİTASI (ROADMAP) MODÜLÜ
// =============================================

let roadmapSelectedEmoji = '📚';
let roadmapSelectedSubEmoji = '📂';
let roadmapActiveProgram = null; // currently expanded program id
let roadmapDraggedProgramId = null;

function openRoadmap() {
    const view = document.getElementById('roadmap-view');
    document.getElementById('routines-view')?.classList.remove('active');
    view.classList.add('active');
    // Update nav
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    const navRoadmap = document.getElementById('nav-roadmap');
    if (navRoadmap) navRoadmap.classList.add('active');
    renderRoadmap();
}

function closeRoadmap() {
    const view = document.getElementById('roadmap-view');
    view.classList.remove('active');
    document.getElementById('routines-view')?.classList.remove('active');
    // Update nav
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
    const navFocus = document.getElementById('nav-focus');
    if (navFocus) navFocus.classList.add('active');
}

// --- EMOJI PICKERS ---
function selectRoadmapEmoji(btn, emoji) {
    roadmapSelectedEmoji = emoji;
    document.querySelectorAll('#roadmap-program-emoji-picker .emoji-btn').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
}

function selectRoadmapSubEmoji(btn, emoji) {
    roadmapSelectedSubEmoji = emoji;
    document.querySelectorAll('#roadmap-sub-emoji-picker .emoji-btn').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
}

// --- ANA RENDER ---
async function renderRoadmap() {
    if (!hasPywebviewApi()) return;
    
    try {
        const programs = await window.pywebview.api.get_roadmap_programs();
        const emptyState = document.getElementById('roadmap-empty');
        const listEl = document.getElementById('roadmap-programs-list');
        
        if (!programs || programs.length === 0) {
            emptyState.style.display = 'flex';
            listEl.innerHTML = '';
            return;
        }
        
        emptyState.style.display = 'none';
        
        // Save expanded accordion states before re-render
        const expandedProgs = new Set();
        const expandedSubs = new Set();
        const expandedPhases = new Set();
        
        document.querySelectorAll('.roadmap-program-body.expanded').forEach(el => {
            const id = el.id.replace('body-prog-', '');
            if (id) expandedProgs.add(id);
        });
        document.querySelectorAll('.roadmap-sub-body.expanded').forEach(el => {
            const id = el.id.replace('body-sub-', '');
            if (id) expandedSubs.add(id);
        });
        document.querySelectorAll('.roadmap-phase-body.expanded').forEach(el => {
            const id = el.id.replace('body-phase-', '');
            if (id) expandedPhases.add(id);
        });
        
        // Render each program — fetch full tree for each
        let html = '';
        for (const prog of programs) {
            const fullTree = await window.pywebview.api.get_full_roadmap(prog.id);
            if (!fullTree) continue;
            html += renderProgramCard(fullTree);
        }
        html += '<button class="roadmap-add-program-btn" type="button" onclick="openAddProgramModal()">+ Yeni Yol Haritası Ekle</button>';
        
        listEl.innerHTML = html;
        
        // Restore expanded accordion states after re-render
        expandedProgs.forEach(id => {
            const body = document.getElementById('body-prog-' + id);
            const chevron = document.getElementById('chevron-prog-' + id);
            if (body) body.classList.add('expanded');
            if (chevron) chevron.classList.add('expanded');
        });
        expandedSubs.forEach(id => {
            const body = document.getElementById('body-sub-' + id);
            const chevron = document.getElementById('chevron-sub-' + id);
            if (body) body.classList.add('expanded');
            if (chevron) chevron.classList.add('expanded');
        });
        expandedPhases.forEach(id => {
            const body = document.getElementById('body-phase-' + id);
            const chevron = document.getElementById('chevron-phase-' + id);
            if (body) body.classList.add('expanded');
            if (chevron) chevron.classList.add('expanded');
        });
    } catch (e) {
        console.error('[Roadmap] Render hatası:', e);
    }
}

function renderProgramCard(program) {
    const pct = program.progress_pct || 0;
    const isComplete = pct === 100 && program.total_topics > 0;
    const pctClass = isComplete ? 'complete' : '';
    const fillClass = isComplete ? 'complete' : '';
    
    let subsHtml = '';
    if (program.subprograms && program.subprograms.length > 0) {
        subsHtml = program.subprograms.map(sub => renderSubprogramCard(sub, program.id)).join('');
    }
    
    return `
        <div class="roadmap-program-card" data-program-id="${program.id}"
             ondragover="dragOverRoadmapProgram(event, ${program.id})"
             ondragleave="leaveRoadmapProgram(event)"
             ondrop="dropRoadmapProgram(event, ${program.id})">
            <div class="roadmap-program-header" onclick="toggleProgramAccordion(${program.id})">
                <div class="roadmap-program-header-left">
                    <button class="roadmap-drag-handle" type="button" draggable="true"
                            ondragstart="startRoadmapProgramDrag(event, ${program.id})"
                            ondragend="endRoadmapProgramDrag()" onclick="event.stopPropagation()"
                            title="Sıralamak için sürükle" aria-label="${escapeHtml(program.name)} yol haritasını sırala">⠿</button>
                    <div class="roadmap-program-icon">${program.icon}</div>
                    <div class="roadmap-program-info">
                        <div class="roadmap-program-name">${escapeHtml(program.name)}</div>
                        <div class="roadmap-program-meta">${program.completed_topics} / ${program.total_topics} konu · ${program.actual_minutes || 0}/${program.estimated_minutes || 0} dk${program.projected_days ? ` · tahmini ${program.projected_days} gün` : ''}</div>
                    </div>
                </div>
                <div class="roadmap-progress-container">
                    <div class="roadmap-progress-bar">
                        <div class="roadmap-progress-fill ${fillClass}" style="width: ${pct}%"></div>
                    </div>
                    <span class="roadmap-progress-pct ${pctClass}">${pct}%</span>
                </div>
                <div class="roadmap-program-actions" onclick="event.stopPropagation()">
                    <button class="roadmap-action-btn" onclick="editRoadmapProgram(${program.id}, decodeURIComponent('${encodedText(program.name)}'), '${program.icon}')" title="Düzenle">✏️</button>
                    <button class="roadmap-action-btn danger" onclick="deleteRoadmapProgram(${program.id}, decodeURIComponent('${encodedText(program.name)}'))" title="Sil">🗑️</button>
                </div>
                <span class="roadmap-chevron" id="chevron-prog-${program.id}">▶</span>
            </div>
            <div class="roadmap-program-body" id="body-prog-${program.id}">
                <div class="roadmap-program-body-inner">
                    ${subsHtml}
                    <button class="roadmap-add-sub-btn" onclick="openAddSubprogramModal(${program.id})">+ Alt Program Ekle</button>
                </div>
            </div>
        </div>
    `;
}

function clearRoadmapProgramDragState() {
    document.querySelectorAll('.roadmap-program-card').forEach(card => {
        card.classList.remove('is-dragging', 'drag-over-before', 'drag-over-after');
    });
}

function startRoadmapProgramDrag(event, programId) {
    roadmapDraggedProgramId = programId;
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(programId));
    const card = event.currentTarget.closest('.roadmap-program-card');
    requestAnimationFrame(() => card?.classList.add('is-dragging'));
}

function dragOverRoadmapProgram(event, targetProgramId) {
    if (!roadmapDraggedProgramId || roadmapDraggedProgramId === targetProgramId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    const targetCard = event.currentTarget;
    document.querySelectorAll('.roadmap-program-card').forEach(card => {
        card.classList.remove('drag-over-before', 'drag-over-after');
    });
    const rect = targetCard.getBoundingClientRect();
    const placeAfter = event.clientY > rect.top + rect.height / 2;
    targetCard.classList.add(placeAfter ? 'drag-over-after' : 'drag-over-before');
}

function leaveRoadmapProgram(event) {
    if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return;
    event.currentTarget.classList.remove('drag-over-before', 'drag-over-after');
}

async function dropRoadmapProgram(event, targetProgramId) {
    event.preventDefault();
    const draggedId = roadmapDraggedProgramId || Number(event.dataTransfer.getData('text/plain'));
    const list = document.getElementById('roadmap-programs-list');
    const draggedCard = list?.querySelector(`[data-program-id="${draggedId}"]`);
    const targetCard = event.currentTarget;

    if (!draggedCard || !targetCard || draggedId === targetProgramId) {
        endRoadmapProgramDrag();
        return;
    }

    const placeAfter = targetCard.classList.contains('drag-over-after');
    list.insertBefore(draggedCard, placeAfter ? targetCard.nextSibling : targetCard);
    const orderedIds = Array.from(list.querySelectorAll('.roadmap-program-card'))
        .map(card => Number(card.dataset.programId));

    try {
        const saved = await window.pywebview.api.reorder_roadmap_programs(orderedIds);
        if (!saved) throw new Error('Sıralama kaydedilemedi.');
        await renderRoadmap();
    } catch (error) {
        console.error('[Roadmap] Sıralama hatası:', error);
        alert('Yol haritası sırası kaydedilemedi. Lütfen tekrar deneyin.');
        await renderRoadmap();
    } finally {
        endRoadmapProgramDrag();
    }
}

function endRoadmapProgramDrag() {
    roadmapDraggedProgramId = null;
    clearRoadmapProgramDragState();
}

function renderSubprogramCard(sub, programId) {
    const pct = sub.progress_pct || 0;
    const isComplete = pct === 100 && sub.total_topics > 0;
    const fillClass = isComplete ? 'complete' : '';
    const pctClass = isComplete ? 'complete' : '';
    
    let phasesHtml = '';
    if (sub.phases && sub.phases.length > 0) {
        phasesHtml = sub.phases.map(phase => renderPhaseCard(phase, sub.id)).join('');
    }
    
    return `
        <div class="roadmap-subprogram" data-sub-id="${sub.id}">
            <div class="roadmap-sub-header" onclick="toggleSubAccordion(${sub.id})">
                <div class="roadmap-sub-header-left">
                    <div class="roadmap-sub-icon">${sub.icon}</div>
                    <div>
                        <div class="roadmap-sub-name">${escapeHtml(sub.name)}</div>
                        <div class="roadmap-sub-meta">${sub.completed_topics} / ${sub.total_topics} konu</div>
                    </div>
                </div>
                <div class="roadmap-sub-progress">
                    <div class="roadmap-progress-bar">
                        <div class="roadmap-progress-fill ${fillClass}" style="width: ${pct}%"></div>
                    </div>
                    <span class="roadmap-sub-pct ${pctClass}">${pct}%</span>
                </div>
                <div class="roadmap-program-actions" onclick="event.stopPropagation()">
                    <button class="roadmap-action-btn" onclick="editRoadmapSubprogram(${sub.id}, decodeURIComponent('${encodedText(sub.name)}'), '${sub.icon}', ${programId})" title="Düzenle">✏️</button>
                    <button class="roadmap-action-btn danger" onclick="deleteRoadmapSubprogram(${sub.id}, decodeURIComponent('${encodedText(sub.name)}'))" title="Sil">🗑️</button>
                </div>
                <span class="roadmap-chevron" id="chevron-sub-${sub.id}">▶</span>
            </div>
            <div class="roadmap-sub-body" id="body-sub-${sub.id}">
                <div class="roadmap-sub-body-inner">
                    ${phasesHtml}
                    <button class="roadmap-add-phase-btn" onclick="openAddPhaseModal(${sub.id})">+ Faz Ekle</button>
                </div>
            </div>
        </div>
    `;
}

function renderPhaseCard(phase, subId) {
    const pct = phase.progress_pct || 0;
    const isComplete = pct === 100 && phase.total_topics > 0;
    const fillClass = isComplete ? 'complete' : '';
    const indicatorClass = isComplete ? 'complete' : (pct > 0 ? 'active' : '');
    
    let topicsHtml = '';
    if (phase.topics && phase.topics.length > 0) {
        topicsHtml = phase.topics.map(t => renderTopicRow(t)).join('');
    }
    
    return `
        <div class="roadmap-phase" data-phase-id="${phase.id}">
            <div class="roadmap-phase-header" onclick="togglePhaseAccordion(${phase.id})">
                <div class="roadmap-phase-header-left">
                    <div class="roadmap-phase-indicator ${indicatorClass}"></div>
                    <span class="roadmap-phase-name">${escapeHtml(phase.name)}</span>
                    <span class="roadmap-phase-count">(${phase.completed_topics}/${phase.total_topics})</span>
                </div>
                <div class="roadmap-phase-progress-mini">
                    <div class="roadmap-progress-bar">
                        <div class="roadmap-progress-fill ${fillClass}" style="width: ${pct}%"></div>
                    </div>
                    <span class="roadmap-phase-pct">${pct}%</span>
                </div>
                <div class="roadmap-program-actions" onclick="event.stopPropagation()">
                    <button class="roadmap-action-btn" onclick="editRoadmapPhase(${phase.id}, decodeURIComponent('${encodedText(phase.name)}'), ${subId})" title="Düzenle">✏️</button>
                    <button class="roadmap-action-btn danger" onclick="deleteRoadmapPhase(${phase.id}, decodeURIComponent('${encodedText(phase.name)}'))" title="Sil">🗑️</button>
                </div>
                <span class="roadmap-chevron" id="chevron-phase-${phase.id}">▶</span>
            </div>
            <div class="roadmap-phase-body" id="body-phase-${phase.id}">
                <div class="roadmap-phase-body-inner">
                    ${topicsHtml}
                    <button class="roadmap-add-topic-btn" onclick="openAddTopicModal(${phase.id})">+ Konu Ekle</button>
                </div>
            </div>
        </div>
    `;
}

function renderTopicRow(topic) {
    const completedClass = topic.completed ? 'completed' : '';
    const desc = topic.description ? `<div class="roadmap-topic-desc">${escapeHtml(topic.description)}</div>` : '';
    const meta = `<div class="roadmap-topic-meta">⏱ ${topic.actual_minutes || 0}/${topic.estimated_minutes || 60} dk · P${topic.priority || 2}${topic.due_date ? ` · 📅 ${escapeHtml(topic.due_date)}` : ''}</div>`;
    
    return `
        <div class="roadmap-topic ${completedClass}" data-topic-id="${topic.id}" id="topic-row-${topic.id}">
            <div class="roadmap-checkbox" onclick="toggleRoadmapTopic(${topic.id}, event)"></div>
            <div class="roadmap-topic-content" onclick="toggleRoadmapTopic(${topic.id}, event)">
                <div class="roadmap-topic-title">${escapeHtml(topic.title)}</div>
                ${desc}
                ${meta}
            </div>
            <div class="roadmap-topic-actions">
                <button class="roadmap-topic-focus-btn" onclick="assignTopicToFocus(decodeURIComponent('${encodedText(topic.title)}'), ${topic.id}, ${topic.estimated_minutes || 60}); event.stopPropagation();" title="Aktif Odak'a Ata">🎯 Odaklan</button>
                <button class="roadmap-topic-action-btn" onclick="openScheduleTopicModal(${topic.id}, decodeURIComponent('${encodedText(topic.title)}'), ${topic.estimated_minutes || 60}, ${topic.priority || 2}); event.stopPropagation();" title="Haftaya Planla">📅</button>
                <button class="roadmap-topic-action-btn" onclick="editRoadmapTopic(${topic.id}, decodeURIComponent('${encodedText(topic.title)}'), decodeURIComponent('${encodedText(topic.description || '')}'), ${topic.phase_id || 0}, ${topic.estimated_minutes || 60}, '${topic.due_date || ''}', ${topic.priority || 2}, ${topic.difficulty || 3}); event.stopPropagation();" title="Düzenle">✏️</button>
                <button class="roadmap-topic-action-btn danger" onclick="deleteRoadmapTopic(${topic.id}, decodeURIComponent('${encodedText(topic.title)}')); event.stopPropagation();" title="Sil">🗑️</button>
            </div>
        </div>
    `;
}

// --- HTML ESCAPE ---
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// --- ACCORDION TOGGLE ---
function toggleProgramAccordion(progId) {
    const body = document.getElementById('body-prog-' + progId);
    const chevron = document.getElementById('chevron-prog-' + progId);
    if (body) body.classList.toggle('expanded');
    if (chevron) chevron.classList.toggle('expanded');
}

function toggleSubAccordion(subId) {
    const body = document.getElementById('body-sub-' + subId);
    const chevron = document.getElementById('chevron-sub-' + subId);
    if (body) body.classList.toggle('expanded');
    if (chevron) chevron.classList.toggle('expanded');
}

function togglePhaseAccordion(phaseId) {
    const body = document.getElementById('body-phase-' + phaseId);
    const chevron = document.getElementById('chevron-phase-' + phaseId);
    if (body) body.classList.toggle('expanded');
    if (chevron) chevron.classList.toggle('expanded');
}

// --- KONU TOGGLE (CHECKBOX) ---
async function toggleRoadmapTopic(topicId, event) {
    if (event) event.stopPropagation();
    if (!hasPywebviewApi()) return;
    
    try {
        const result = await window.pywebview.api.toggle_roadmap_topic(topicId);
        if (result && result.success) {
            // Animate
            const row = document.getElementById('topic-row-' + topicId);
            if (row) {
                row.classList.toggle('completed', result.completed);
                if (result.completed) {
                    row.classList.add('just-completed');
                    setTimeout(() => row.classList.remove('just-completed'), 500);
                }
            }
            // Re-render to update all percentages
            await renderRoadmap();
            // Update streak in main view
            await renderStreak();
        }
    } catch (e) {
        console.error('[Roadmap] Toggle hatası:', e);
    }
}

// --- AKTİF ODAK'A ATA ---
function assignTopicToFocus(topicTitle, topicId = null, estimatedMinutes = 60) {
    // Close roadmap and go to focus view
    closeRoadmap();
    // Set the study subject input
    const input = document.getElementById('studySubjectInput');
    if (input) {
        input.value = topicTitle;
        input.style.animation = 'none';
        input.offsetHeight; // trigger reflow
        input.style.animation = 'topicComplete 0.4s ease';
    }
    currentRoadmapTopicId = topicId || null;
    currentTaskId = null;
    currentRoutineId = null;
    focusMode = 'timer';
    setPreset(estimatedMinutes || 60, null);
}

// --- METİNDEN HIZLI YOL HARİTASI ---
let quickRoadmapParsedOutline = null;

function openQuickRoadmapModal() {
    document.getElementById('quickRoadmapName').value = '';
    document.getElementById('quickRoadmapText').value = '';
    document.getElementById('quickRoadmapName').placeholder = 'Boş bırakırsan metinden tahmin edilir';
    document.getElementById('quick-roadmap-counts').innerHTML = '';
    document.getElementById('quick-roadmap-preview').className = 'quick-roadmap-preview-empty';
    document.getElementById('quick-roadmap-preview').innerText = 'Metni yapıştırdığında hiyerarşi burada görünür.';
    document.getElementById('quick-roadmap-status').innerText = '';
    document.getElementById('quick-roadmap-status').className = 'quick-roadmap-status';
    document.getElementById('quick-roadmap-create-btn').disabled = true;
    quickRoadmapParsedOutline = null;
    document.getElementById('quick-roadmap-modal').classList.add('active');
    setTimeout(() => document.getElementById('quickRoadmapText').focus(), 50);
}

function renderQuickRoadmapTree(parsed) {
    let renderedTopics = 0;
    const topicLimit = 250;
    const treeHtml = parsed.subprograms.map(subprogram => `
        <div class="quick-roadmap-tree-sub">
            <div class="quick-roadmap-tree-sub-title">${escapeHtml(subprogram.icon || '📂')} ${escapeHtml(subprogram.name)}</div>
            ${subprogram.phases.map(phase => `
                <div class="quick-roadmap-tree-phase">
                    <div class="quick-roadmap-tree-phase-title">${escapeHtml(phase.name)}</div>
                    ${phase.topics.map(topic => {
                        renderedTopics++;
                        if (renderedTopics > topicLimit) return '';
                        return `<div class="quick-roadmap-tree-topic">• ${escapeHtml(topic.title)}${topic.description
                            ? `<span class="quick-roadmap-tree-note">${escapeHtml(topic.description)}</span>`
                            : ''}</div>`;
                    }).join('')}
                </div>`).join('')}
        </div>`).join('');
    const remaining = Math.max(0, parsed.counts.topics - topicLimit);
    return `<div class="quick-roadmap-tree">${treeHtml}${remaining
        ? `<div class="modal-desc">… ve ${remaining} konu daha</div>`
        : ''}</div>`;
}

function updateQuickRoadmapPreview() {
    const rawText = document.getElementById('quickRoadmapText').value;
    const requestedName = document.getElementById('quickRoadmapName').value.trim();
    const preview = document.getElementById('quick-roadmap-preview');
    const counts = document.getElementById('quick-roadmap-counts');
    const status = document.getElementById('quick-roadmap-status');
    const createButton = document.getElementById('quick-roadmap-create-btn');

    if (!rawText.trim()) {
        quickRoadmapParsedOutline = null;
        preview.className = 'quick-roadmap-preview-empty';
        preview.innerText = 'Metni yapıştırdığında hiyerarşi burada görünür.';
        counts.innerHTML = '';
        status.innerText = '';
        createButton.disabled = true;
        return;
    }

    try {
        const parsed = parseQuickRoadmapOutline(rawText, requestedName);
        quickRoadmapParsedOutline = parsed.valid ? parsed : null;
        document.getElementById('quickRoadmapName').placeholder = parsed.name || 'Yol Haritası Adı';
        counts.innerHTML = parsed.valid ? `
            <span class="quick-roadmap-count-badge">${parsed.counts.subprograms} alt program</span>
            <span class="quick-roadmap-count-badge">${parsed.counts.phases} faz</span>
            <span class="quick-roadmap-count-badge">${parsed.counts.topics} konu</span>` : '';

        if (!parsed.valid) {
            preview.className = 'quick-roadmap-preview-error';
            preview.innerText = parsed.error;
            status.innerText = '';
            createButton.disabled = true;
            return;
        }

        preview.className = 'quick-roadmap-tree';
        preview.innerHTML = renderQuickRoadmapTree(parsed);
        const notices = [];
        if (parsed.duplicateCount) notices.push(`${parsed.duplicateCount} tekrarlı başlık birleştirildi`);
        if (parsed.ignoredCount) notices.push(`${parsed.ignoredCount} başlıksız giriş satırı yok sayıldı`);
        status.className = 'quick-roadmap-status success';
        status.innerText = notices.length
            ? `Hazır · ${notices.join(' · ')}`
            : 'Hiyerarşi hazır. Oluşturduğunda tamamı tek seferde kaydedilecek.';
        createButton.disabled = false;
    } catch (error) {
        console.error('[Roadmap] Hızlı ayrıştırma hatası:', error);
        quickRoadmapParsedOutline = null;
        preview.className = 'quick-roadmap-preview-error';
        preview.innerText = 'Metin analiz edilirken bir hata oluştu.';
        counts.innerHTML = '';
        status.innerText = '';
        createButton.disabled = true;
    }
}

async function createQuickRoadmap() {
    if (!quickRoadmapParsedOutline || !hasPywebviewApi()) return;
    const button = document.getElementById('quick-roadmap-create-btn');
    const status = document.getElementById('quick-roadmap-status');
    const name = document.getElementById('quickRoadmapName').value.trim() || quickRoadmapParsedOutline.name;
    button.disabled = true;
    button.innerText = 'Oluşturuluyor…';
    status.className = 'quick-roadmap-status';
    status.innerText = 'Yol haritası kaydediliyor…';

    try {
        const result = await window.pywebview.api.import_roadmap_outline(
            name,
            quickRoadmapParsedOutline.subprograms,
            '⚡'
        );
        closeModal('quick-roadmap-modal');
        await renderRoadmap();
        const body = document.getElementById('body-prog-' + result.program_id);
        const chevron = document.getElementById('chevron-prog-' + result.program_id);
        body?.classList.add('expanded');
        chevron?.classList.add('expanded');
        document.querySelector(`[data-program-id="${result.program_id}"]`)?.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    } catch (error) {
        console.error('[Roadmap] Hızlı içe aktarma hatası:', error);
        status.className = 'quick-roadmap-status error';
        status.innerText = 'Yol haritası oluşturulamadı. Metni kontrol edip tekrar deneyin.';
        button.disabled = false;
    } finally {
        button.innerText = 'Analiz Et ve Yol Haritasını Oluştur';
    }
}

// --- PROGRAM CRUD ---
function openAddProgramModal() {
    document.getElementById('roadmapProgramName').value = '';
    document.getElementById('roadmapProgramEditId').value = '';
    document.getElementById('roadmap-program-modal-title').innerText = 'Yeni Yol Haritası Ekle';
    roadmapSelectedEmoji = '📚';
    // Reset emoji picker
    document.querySelectorAll('#roadmap-program-emoji-picker .emoji-btn').forEach(el => el.classList.remove('active'));
    document.querySelector('#roadmap-program-emoji-picker .emoji-btn').classList.add('active');
    document.getElementById('roadmap-program-modal').classList.add('active');
}

function editRoadmapProgram(id, name, icon) {
    document.getElementById('roadmapProgramName').value = name;
    document.getElementById('roadmapProgramEditId').value = id;
    document.getElementById('roadmap-program-modal-title').innerText = 'Programı Düzenle';
    roadmapSelectedEmoji = icon;
    // Activate correct emoji
    document.querySelectorAll('#roadmap-program-emoji-picker .emoji-btn').forEach(el => {
        el.classList.toggle('active', el.innerText.trim() === icon);
    });
    document.getElementById('roadmap-program-modal').classList.add('active');
}

async function saveRoadmapProgram() {
    const name = document.getElementById('roadmapProgramName').value.trim();
    if (!name) { alert('Program adı boş olamaz.'); return; }
    
    const editId = document.getElementById('roadmapProgramEditId').value;
    
    if (editId) {
        await window.pywebview.api.update_roadmap_program(parseInt(editId), name, roadmapSelectedEmoji);
    } else {
        await window.pywebview.api.add_roadmap_program(name, roadmapSelectedEmoji);
    }
    
    closeModal('roadmap-program-modal');
    await renderRoadmap();
}

async function deleteRoadmapProgram(id, name) {
    if (!confirm(`"${name}" programını ve tüm alt öğelerini silmek istediğinize emin misiniz?`)) return;
    await window.pywebview.api.delete_roadmap_program(id);
    await renderRoadmap();
}

// --- ALT PROGRAM CRUD ---
function openAddSubprogramModal(programId) {
    document.getElementById('roadmapSubName').value = '';
    document.getElementById('roadmapSubEditId').value = '';
    document.getElementById('roadmapSubParentId').value = programId;
    document.getElementById('roadmap-sub-modal-title').innerText = 'Alt Program Ekle';
    roadmapSelectedSubEmoji = '📂';
    document.querySelectorAll('#roadmap-sub-emoji-picker .emoji-btn').forEach(el => el.classList.remove('active'));
    document.querySelector('#roadmap-sub-emoji-picker .emoji-btn').classList.add('active');
    document.getElementById('roadmap-sub-modal').classList.add('active');
}

function editRoadmapSubprogram(id, name, icon, programId) {
    document.getElementById('roadmapSubName').value = name;
    document.getElementById('roadmapSubEditId').value = id;
    document.getElementById('roadmapSubParentId').value = programId;
    document.getElementById('roadmap-sub-modal-title').innerText = 'Alt Programı Düzenle';
    roadmapSelectedSubEmoji = icon;
    document.querySelectorAll('#roadmap-sub-emoji-picker .emoji-btn').forEach(el => {
        el.classList.toggle('active', el.innerText.trim() === icon);
    });
    document.getElementById('roadmap-sub-modal').classList.add('active');
}

async function saveRoadmapSubprogram() {
    const name = document.getElementById('roadmapSubName').value.trim();
    if (!name) { alert('Alt program adı boş olamaz.'); return; }
    
    const editId = document.getElementById('roadmapSubEditId').value;
    const parentId = parseInt(document.getElementById('roadmapSubParentId').value);
    
    if (editId) {
        await window.pywebview.api.update_roadmap_subprogram(parseInt(editId), name, roadmapSelectedSubEmoji);
    } else {
        await window.pywebview.api.add_roadmap_subprogram(parentId, name, roadmapSelectedSubEmoji);
    }
    
    closeModal('roadmap-sub-modal');
    await renderRoadmap();
}

async function deleteRoadmapSubprogram(id, name) {
    if (!confirm(`"${name}" alt programını ve altındaki tüm fazları silmek istediğinize emin misiniz?`)) return;
    await window.pywebview.api.delete_roadmap_subprogram(id);
    await renderRoadmap();
}

// --- FAZ CRUD ---
function openAddPhaseModal(subId) {
    document.getElementById('roadmapPhaseName').value = '';
    document.getElementById('roadmapPhaseEditId').value = '';
    document.getElementById('roadmapPhaseParentId').value = subId;
    document.getElementById('roadmap-phase-modal-title').innerText = 'Yeni Faz Ekle';
    document.getElementById('roadmap-phase-modal').classList.add('active');
}

function editRoadmapPhase(id, name, subId) {
    document.getElementById('roadmapPhaseName').value = name;
    document.getElementById('roadmapPhaseEditId').value = id;
    document.getElementById('roadmapPhaseParentId').value = subId;
    document.getElementById('roadmap-phase-modal-title').innerText = 'Fazı Düzenle';
    document.getElementById('roadmap-phase-modal').classList.add('active');
}

async function saveRoadmapPhase() {
    const name = document.getElementById('roadmapPhaseName').value.trim();
    if (!name) { alert('Faz adı boş olamaz.'); return; }
    
    const editId = document.getElementById('roadmapPhaseEditId').value;
    const parentId = parseInt(document.getElementById('roadmapPhaseParentId').value);
    
    if (editId) {
        await window.pywebview.api.update_roadmap_phase(parseInt(editId), name);
    } else {
        await window.pywebview.api.add_roadmap_phase(parentId, name);
    }
    
    closeModal('roadmap-phase-modal');
    await renderRoadmap();
}

async function deleteRoadmapPhase(id, name) {
    if (!confirm(`"${name}" fazını ve tüm konularını silmek istediğinize emin misiniz?`)) return;
    await window.pywebview.api.delete_roadmap_phase(id);
    await renderRoadmap();
}

// --- KONU CRUD ---
function openAddTopicModal(phaseId) {
    document.getElementById('roadmapTopicTitle').value = '';
    document.getElementById('roadmapTopicDesc').value = '';
    document.getElementById('roadmapTopicEditId').value = '';
    document.getElementById('roadmapTopicParentId').value = phaseId;
    document.getElementById('roadmapTopicEstimate').value = 60;
    document.getElementById('roadmapTopicDueDate').value = '';
    document.getElementById('roadmapTopicPriority').value = '2';
    document.getElementById('roadmapTopicDifficulty').value = '3';
    document.getElementById('roadmap-topic-modal-title').innerText = 'Yeni Konu Ekle';
    document.getElementById('roadmap-topic-modal').classList.add('active');
}

function editRoadmapTopic(id, title, desc, phaseId, estimatedMinutes = 60, dueDate = '', priority = 2, difficulty = 3) {
    document.getElementById('roadmapTopicTitle').value = title;
    document.getElementById('roadmapTopicDesc').value = desc;
    document.getElementById('roadmapTopicEditId').value = id;
    document.getElementById('roadmapTopicParentId').value = phaseId;
    document.getElementById('roadmapTopicEstimate').value = estimatedMinutes || 60;
    document.getElementById('roadmapTopicDueDate').value = dueDate || '';
    document.getElementById('roadmapTopicPriority').value = String(priority || 2);
    document.getElementById('roadmapTopicDifficulty').value = String(difficulty || 3);
    document.getElementById('roadmap-topic-modal-title').innerText = 'Konuyu Düzenle';
    document.getElementById('roadmap-topic-modal').classList.add('active');
}

async function saveRoadmapTopic() {
    const title = document.getElementById('roadmapTopicTitle').value.trim();
    if (!title) { alert('Konu başlığı boş olamaz.'); return; }
    
    const desc = document.getElementById('roadmapTopicDesc').value.trim();
    const editId = document.getElementById('roadmapTopicEditId').value;
    const parentId = parseInt(document.getElementById('roadmapTopicParentId').value);
    const estimate = parseInt(document.getElementById('roadmapTopicEstimate').value) || 60;
    const dueDate = document.getElementById('roadmapTopicDueDate').value || null;
    const priority = parseInt(document.getElementById('roadmapTopicPriority').value) || 2;
    const difficulty = parseInt(document.getElementById('roadmapTopicDifficulty').value) || 3;
    
    if (editId) {
        await window.pywebview.api.update_roadmap_topic(parseInt(editId), title, desc, estimate, dueDate, priority, difficulty);
    } else {
        await window.pywebview.api.add_roadmap_topic(parentId, title, desc, estimate, dueDate, priority, difficulty);
    }
    
    closeModal('roadmap-topic-modal');
    await renderRoadmap();
}

async function deleteRoadmapTopic(id, title) {
    if (!confirm(`"${title}" konusunu silmek istediğinize emin misiniz?`)) return;
    await window.pywebview.api.delete_roadmap_topic(id);
    await renderRoadmap();
}

// =============================================
// HAFTALIK PLANLAYICI
// =============================================

const PLANNER_DAY_NAMES = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cts', 'Paz'];
let plannerWeekStart = null;

function getMonday(date = new Date()) {
    const d = new Date(date);
    d.setHours(12, 0, 0, 0);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d;
}

async function openPlanner() {
    plannerWeekStart = getMonday();
    document.getElementById('planner-date').value = localDateStr();
    document.getElementById('planner-modal').classList.add('active');
    await Promise.all([renderPlanner(), loadWeeklySchedule()]);
}

async function renderPlanner() {
    if (!hasPywebviewApi()) return;
    const start = plannerWeekStart || getMonday();
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const items = await window.pywebview.api.get_planner_items(localDateStr(start), localDateStr(end));
    const board = document.getElementById('planner-board');
    document.getElementById('planner-week-label').innerText = `${localDateStr(start)} — ${localDateStr(end)}`;
    board.innerHTML = '';
    for (let i = 0; i < 7; i++) {
        const day = new Date(start);
        day.setDate(day.getDate() + i);
        const dateStr = localDateStr(day);
        const dayItems = (items || []).filter(item => item.planned_date === dateStr);
        const column = document.createElement('section');
        column.className = `planner-day ${dateStr === localDateStr() ? 'today' : ''}`;
        column.innerHTML = `<div class="planner-day-title">${PLANNER_DAY_NAMES[i]} · ${day.getDate()}</div>` +
            (dayItems.length ? dayItems.map(item => `
                <div class="planner-item" data-id="${item.id}">
                    <div class="planner-item-title">${escapeHtml(item.title)}</div>
                    <div>${item.duration_minutes} dk · P${item.priority} · ${item.status === 'done' ? '✓ Tamamlandı' : 'Planlandı'}</div>
                    <div class="planner-item-actions">
                        <button class="btn btn-ghost btn-small" onclick="movePlannerItem(${item.id}, '${dateStr}', -1)">←</button>
                        <button class="btn btn-success btn-small" onclick="togglePlannerDone(${item.id}, '${item.status}')">✓</button>
                        <button class="btn btn-ghost btn-small" onclick="movePlannerItem(${item.id}, '${dateStr}', 1)">→</button>
                        <button class="btn btn-danger btn-small" onclick="deletePlannerItem(${item.id})">×</button>
                    </div>
                </div>`).join('') : '<div class="modal-desc">Boş</div>');
        board.appendChild(column);
    }
}

async function addPlannerItem() {
    const title = document.getElementById('planner-title').value.trim();
    const date = document.getElementById('planner-date').value;
    const duration = parseInt(document.getElementById('planner-duration').value) || 45;
    const priority = parseInt(document.getElementById('planner-priority').value) || 2;
    if (!title || !date) return;
    await window.pywebview.api.add_planner_item(title, date, duration, priority);
    document.getElementById('planner-title').value = '';
    await renderPlanner();
    await renderUnifiedTasks();
}

async function movePlannerItem(id, currentDate, delta) {
    const date = new Date(`${currentDate}T12:00:00`);
    date.setDate(date.getDate() + delta);
    await window.pywebview.api.update_planner_item(id, localDateStr(date), null, null);
    await renderPlanner();
}

async function togglePlannerDone(id, currentStatus) {
    await window.pywebview.api.update_planner_item(id, null, currentStatus === 'done' ? 'planned' : 'done', null);
    await renderPlanner();
}

async function deletePlannerItem(id) {
    await window.pywebview.api.delete_planner_item(id);
    await renderPlanner();
}

function addScheduleRow(entry = {}) {
    const container = document.getElementById('schedule-entries');
    const row = document.createElement('div');
    row.className = 'schedule-row';
    const day = Number.isInteger(entry.day) ? entry.day : new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
    row.innerHTML = `
        <select class="input-field schedule-day">${PLANNER_DAY_NAMES.map((name, i) => `<option value="${i}" ${i === day ? 'selected' : ''}>${name}</option>`).join('')}</select>
        <input class="input-field schedule-name" value="${escapeHtml(entry.name || '')}" placeholder="Ders / çalışma bloğu">
        <input class="input-field schedule-hours" type="number" min="0" value="${entry.hours || 0}" title="Saat">
        <input class="input-field schedule-minutes" type="number" min="0" max="59" value="${entry.minutes || 0}" title="Dakika">
        <button class="btn btn-danger btn-small" onclick="this.parentElement.remove()">×</button>`;
    container.appendChild(row);
}

async function loadWeeklySchedule() {
    const entries = hasPywebviewApi() ? await window.pywebview.api.get_full_schedule() : [];
    const container = document.getElementById('schedule-entries');
    container.innerHTML = '';
    if (entries && entries.length) entries.forEach(addScheduleRow);
    else addScheduleRow();
}

async function saveWeeklySchedule() {
    const entries = [];
    document.querySelectorAll('#schedule-entries .schedule-row').forEach(row => {
        const name = row.querySelector('.schedule-name').value.trim();
        const hours = parseInt(row.querySelector('.schedule-hours').value) || 0;
        const minutes = parseInt(row.querySelector('.schedule-minutes').value) || 0;
        if (name && (hours > 0 || minutes > 0)) {
            entries.push({day: parseInt(row.querySelector('.schedule-day').value), name, hours, minutes});
        }
    });
    await window.pywebview.api.save_schedule(entries);
    await renderUnifiedTasks();
    await loadWeeklySchedule();
}

function openScheduleTopicModal(topicId, title, estimate, priority) {
    document.getElementById('schedule-topic-id').value = topicId;
    document.getElementById('schedule-topic-name').innerText = title;
    document.getElementById('schedule-topic-date').value = localDateStr();
    document.getElementById('schedule-topic-duration').value = estimate || 60;
    document.getElementById('schedule-topic-priority').value = String(priority || 2);
    document.getElementById('schedule-topic-modal').classList.add('active');
}

async function scheduleRoadmapTopic() {
    const topicId = parseInt(document.getElementById('schedule-topic-id').value);
    const date = document.getElementById('schedule-topic-date').value;
    const duration = parseInt(document.getElementById('schedule-topic-duration').value) || 60;
    const priority = parseInt(document.getElementById('schedule-topic-priority').value) || 2;
    if (!topicId || !date) return;
    await window.pywebview.api.schedule_roadmap_topic(topicId, date, duration, priority);
    closeModal('schedule-topic-modal');
    await renderRoadmap();
    await renderUnifiedTasks();
}

// =============================================
// GÜN SONU VE DİSİPLİN PANELİ
// =============================================

async function openDisciplineDashboard() {
    if (!hasPywebviewApi()) return;
    const data = await window.pywebview.api.get_discipline_dashboard();
    const metrics = [
        [`%${data.plan_adherence_pct}`, 'Plan Uyumu'],
        [`${data.actual_minutes} dk`, 'Gerçek Odak'],
        [`${data.pause_per_session}`, 'Seans Başına Duraklama'],
        [`⭐ ${data.avg_focus_score}`, 'Odak Kalitesi'],
        [data.completed_tasks, 'Tamamlanan Görev'],
        [data.routines_completed, 'Rutin Adımı'],
        [data.roadmap_topics_completed, 'Yol Haritası Konusu'],
        [data.sessions, 'Odak Seansı']
    ];
    document.getElementById('discipline-metrics').innerHTML = metrics.map(([value, label]) =>
        `<div class="discipline-card"><div class="discipline-value">${escapeHtml(String(value))}</div><div class="discipline-label">${label}</div></div>`
    ).join('');
    let insight = 'Bu hafta için yeterli veri oluşuyor.';
    if (data.planned_tasks === 0) insight = 'Ölçülebilir disiplin için önce haftana en az üç somut görev planla.';
    else if (data.plan_adherence_pct < 50) insight = 'Plan kapasiten yüksek görünüyor. Daha az görev seçip bitirme oranını yükselt.';
    else if (data.pause_per_session > 2) insight = 'Odak blokların sık bölünüyor. Daha kısa blok veya daha sert bir dikkat profili dene.';
    else if (data.plan_adherence_pct >= 80) insight = 'Plan–uygulama uyumun güçlü. Bir sonraki adım tahmin sürelerini gerçek sürelerle kalibre etmek.';
    document.getElementById('discipline-insight').innerText = insight;
    document.getElementById('discipline-modal').classList.add('active');
}

async function endDayProtocol() {
    if (timerState.isRunning) {
        await resetTimer();
        if (timerState.isRunning) return;
    }
    const context = await window.pywebview.api.get_day_close_context();
    const mins = context.total_minutes || 0;
    document.getElementById('endday-stat').innerText = mins;
    document.getElementById('endday-message').innerText = mins >= 120 ? 'Güçlü bir gün. Şimdi yarının başlangıç sürtünmesini azalt.' : mins >= 60 ? 'Günlük hedef tamamlandı. Kazanımı netleştir ve yarını hazırla.' : 'Bugün kısa kaldı; cezalandırmak yerine engeli tanımla ve yarının ilk adımını küçült.';
    const review = context.review || {};
    document.getElementById('endday-wins').value = review.wins || '';
    document.getElementById('endday-blockers').value = review.blockers || '';
    document.getElementById('endday-first-task').value = review.tomorrow_first_task || '';
    const carry = document.getElementById('endday-carry-list');
    carry.innerHTML = (context.unfinished_tasks || []).length ? context.unfinished_tasks.map(task => `
        <label class="selection-item"><span>${escapeHtml(task.subject)} · ${task.minutes} dk</span>
        <input type="checkbox" class="carry-task-checkbox" value="${task.id}" checked></label>`).join('') :
        '<div class="modal-desc">Taşınacak görev yok.</div>';
    document.getElementById('endday-modal').classList.add('active');
}

async function finalizeDayReview() {
    const carryIds = Array.from(document.querySelectorAll('.carry-task-checkbox:checked')).map(el => parseInt(el.value));
    const result = await window.pywebview.api.close_day_review(
        document.getElementById('endday-wins').value.trim(),
        document.getElementById('endday-blockers').value.trim(),
        document.getElementById('endday-first-task').value.trim(),
        carryIds
    );
    closeModal('endday-modal');
    await renderUnifiedTasks();
    alert(`${result.carried} görev ${result.tomorrow} tarihine taşındı. Gün başarıyla kapatıldı.`);
}

// =============================================
// PROFİL, DİKKAT PROFİLLERİ VE VERİ
// =============================================

let activeFocusProfileId = null;
let cachedFocusProfiles = [];
let avatarProfilesLoading = false;

async function openPreferences() {
    document.getElementById('preferences-modal').classList.add('active');
    await Promise.all([loadPreferences(), loadFocusProfiles(), loadBackups()]);
}

async function loadPreferences() {
    if (!hasPywebviewApi()) return;
    const settings = await window.pywebview.api.get_app_settings();
    document.getElementById('pref-user-name').value = settings.user_name || '';
    document.getElementById('pref-daily-target').value = settings.daily_target_minutes || 60;
    const initials = (settings.user_name || 'Kullanıcı').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
    document.getElementById('user-avatar').innerText = initials || 'KU';
}

async function savePreferences() {
    await window.pywebview.api.save_app_settings({
        user_name: document.getElementById('pref-user-name').value,
        daily_target_minutes: parseInt(document.getElementById('pref-daily-target').value) || 60
    });
    await loadPreferences();
    await renderStreak();
}

async function loadFocusProfiles() {
    if (!hasPywebviewApi()) return;
    cachedFocusProfiles = await window.pywebview.api.get_focus_profiles();
    const active = cachedFocusProfiles.find(p => p.active) || cachedFocusProfiles[0];
    activeFocusProfileId = active ? active.id : null;
    const list = document.getElementById('focus-profile-list');
    list.innerHTML = cachedFocusProfiles.map(profile => `
        <button class="profile-item ${profile.active ? 'active' : ''}" onclick="selectFocusProfile(${profile.id})">
            <span>${escapeHtml(profile.name)}</span><span>${profile.app_count} uygulama · ${profile.grace_seconds} sn</span>
        </button>`).join('');
    renderAvatarFocusProfiles();
    if (active) fillProfileConfig(active);
}

function renderAvatarFocusProfiles() {
    const list = document.getElementById('avatar-profile-list');
    if (!list) return;
    if (!cachedFocusProfiles.length) {
        list.innerHTML = '<div class="profile-quick-empty">Henüz dikkat profili yok.</div>';
        return;
    }
    list.innerHTML = cachedFocusProfiles.map(profile => `
        <button class="avatar-profile-option ${profile.active ? 'active' : ''}" role="menuitem" onclick="event.stopPropagation(); activateFocusProfileFromAvatar(${profile.id})">
            <span>${profile.active ? '● ' : ''}${escapeHtml(profile.name)}</span>
            <span>${profile.app_count} uygulama</span>
        </button>`).join('');
    const active = cachedFocusProfiles.find(profile => profile.active);
    if (active) document.getElementById('user-avatar').title = `Aktif dikkat profili: ${active.name}`;
}

async function ensureAvatarProfiles() {
    if (!hasPywebviewApi() || cachedFocusProfiles.length || avatarProfilesLoading) return;
    avatarProfilesLoading = true;
    try {
        await loadFocusProfiles();
    } finally {
        avatarProfilesLoading = false;
    }
}

async function activateFocusProfileFromAvatar(profileId) {
    if (!hasPywebviewApi()) return;
    await window.pywebview.api.activate_focus_profile(profileId);
    activeFocusProfileId = profileId;
    await loadFocusProfiles();
    await updateLiveRadar();
}

function fillProfileConfig(profile) {
    document.getElementById('profile-grace').value = profile.grace_seconds || 0;
    document.getElementById('profile-checkin').value = profile.checkin_interval_minutes || 0;
    document.getElementById('profile-focus-only').checked = Boolean(profile.enforce_only_during_focus);
    document.getElementById('profile-pause-on-lock').checked = profile.pause_on_windows_lock !== false;
}

async function selectFocusProfile(profileId) {
    await window.pywebview.api.activate_focus_profile(profileId);
    activeFocusProfileId = profileId;
    await loadFocusProfiles();
    await updateLiveRadar();
}

async function createFocusProfile() {
    const name = document.getElementById('new-profile-name').value.trim();
    if (!name) return;
    await window.pywebview.api.add_focus_profile(name, 120, true, 10, true);
    document.getElementById('new-profile-name').value = '';
    await loadFocusProfiles();
}

async function saveActiveProfileConfig() {
    if (!activeFocusProfileId) return;
    await window.pywebview.api.update_focus_profile(
        activeFocusProfileId,
        parseInt(document.getElementById('profile-grace').value) || 0,
        document.getElementById('profile-focus-only').checked,
        parseInt(document.getElementById('profile-checkin').value) || 0,
        document.getElementById('profile-pause-on-lock').checked
    );
    await loadFocusProfiles();
}

async function createBackup() {
    const result = await window.pywebview.api.create_backup('manual');
    document.getElementById('backup-status').innerText = result.success ? `Yedek oluşturuldu: ${result.name}` : 'Yedek oluşturulamadı.';
    await loadBackups();
}

async function loadBackups() {
    if (!hasPywebviewApi()) return;
    const backups = await window.pywebview.api.list_backups();
    document.getElementById('backup-list').innerHTML = backups.length ? backups.map(item => `
        <div class="backup-item"><span>${escapeHtml(item.name)}<br><small>${escapeHtml(item.modified)}</small></span>
        <button class="btn btn-ghost btn-small" onclick="restoreBackup(decodeURIComponent('${encodedText(item.name)}'))">Geri Yükle</button></div>`).join('') :
        '<div class="modal-desc">Henüz yedek yok.</div>';
}

async function restoreBackup(name) {
    if (!confirm(`${name} yedeği geri yüklensin mi? Mevcut veri önce otomatik yedeklenecek.`)) return;
    const result = await window.pywebview.api.restore_backup(name);
    document.getElementById('backup-status').innerText = result.message || '';
    if (result.success) location.reload();
}

async function exportAllData() {
    const result = await window.pywebview.api.export_all_data();
    document.getElementById('backup-status').innerText = result.success
        ? `Dışa aktarıldı: ${result.json_path} ve ${result.csv_path}` : 'Dışa aktarma başarısız.';
}

window.addEventListener('pywebviewready', async () => {
    await restoreFocusState();
    await loadPreferences();
    await loadFocusProfiles();
});

applyFocusPanelState();
