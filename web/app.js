// ===== FOCUS OS — APP.JS =====

// --- GLOBALS ---
const circle = document.getElementById('timer-circle');
const CIRCUMFERENCE = 80 * 2 * Math.PI; // ~502.65

let focusMode = 'timer'; // 'timer' veya 'stopwatch'
let focusInterval = null;
let totalTime = 1500; // 25 dakika (saniye)
let timeRemaining = 1500;
let elapsedTime = 0;
let isPaused = false;
let isRunning = false;
let isOvertime = false;
let selectedScheduleDay = 0;
let chart = null;

// Deadline görev zamanlayıcıları (#1, #7)
let deadlineTimers = {}; // { taskId: { interval, elapsed, paused } }

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
    timeRemaining = totalTime;
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
        timeRemaining = totalTime;
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

function setCircleProgress(percent) {
    const offset = CIRCUMFERENCE - (percent / 100) * CIRCUMFERENCE;
    circle.style.strokeDashoffset = offset;
}

function startFocus() {
    document.getElementById('focusBtn').style.display = 'none';
    document.getElementById('timer-controls').classList.add('visible');
    document.getElementById('timer-setup').style.display = 'none';
    document.querySelector('.mode-selector').style.display = 'none';
    isPaused = false;
    isRunning = true;
    isOvertime = false;
    elapsedTime = 0;
    
    circle.classList.remove('overtime');
    document.getElementById('focus-timer-text').classList.remove('overtime-text');

    if (focusMode === 'timer') {
        timeRemaining = totalTime;
        setCircleProgress(100);
        document.getElementById('focus-timer-text').innerText = formatTime(totalTime);
    } else {
        elapsedTime = 0;
        setCircleProgress(0);
        document.getElementById('focus-timer-text').innerText = '00:00';
    }

    clearInterval(focusInterval);
    focusInterval = setInterval(tickFocus, 1000);
}

function tickFocus() {
    if (isPaused) return;

    if (focusMode === 'timer') {
        if (!isOvertime) {
            timeRemaining--;
            document.getElementById('focus-timer-text').innerText = formatTime(timeRemaining);
            const pct = (timeRemaining / totalTime) * 100;
            setCircleProgress(Math.max(pct, 0));

            if (timeRemaining <= 0) {
                // Fazla mesai başlasın!
                isOvertime = true;
                elapsedTime = 0;
                circle.classList.add('overtime');
                document.getElementById('focus-timer-text').classList.add('overtime-text');
                document.getElementById('timer-mode-label').innerText = 'FAZLA MESAİ';
                setCircleProgress(100);
            }
        } else {
            elapsedTime++;
            document.getElementById('focus-timer-text').innerText = '+' + formatTime(elapsedTime);
            // Fazla mesaide çember dolsun (her 60 saniyede bir tur)
            const pct = ((elapsedTime % 60) / 60) * 100;
            setCircleProgress(pct);
        }
    } else {
        // Kronometre modu
        elapsedTime++;
        document.getElementById('focus-timer-text').innerText = formatTime(elapsedTime);
        // Çember her 60 saniyede bir tur atsın
        const pct = ((elapsedTime % 60) / 60) * 100;
        setCircleProgress(pct);
    }
}

function togglePause() {
    isPaused = !isPaused;
    document.getElementById('pauseBtn').innerText = isPaused ? 'DEVAM ET' : 'DURAKLAT';
}

async function resetTimer() {
    clearInterval(focusInterval);
    isRunning = false;

    // Çalışılan süreyi hesapla
    let workedMins = 0;
    if (focusMode === 'timer') {
        workedMins = Math.floor((totalTime - timeRemaining + (isOvertime ? elapsedTime : 0)) / 60);
    } else {
        workedMins = Math.floor(elapsedTime / 60);
    }
    if (workedMins > 0) { await eel.log_study_time(workedMins)(); }

    // UI resetle
    document.getElementById('timer-controls').classList.remove('visible');
    document.getElementById('focusBtn').style.display = 'block';
    document.querySelector('.mode-selector').style.display = 'flex';
    circle.classList.remove('overtime', 'stopwatch-mode');
    document.getElementById('focus-timer-text').classList.remove('overtime-text', 'stopwatch-text');
    isOvertime = false;
    isPaused = false;

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
    
    await eel.setup_task(name, mins)();
    document.getElementById('taskName').value = '';
    document.getElementById('taskHours').value = '';
    renderWaitingRoom();
}

async function renderWaitingRoom() {
    const tasks = await eel.get_waiting_tasks()();
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
    await eel.activate_task(taskId)();
    renderWaitingRoom();
    renderActiveDeadlines();
}

async function deleteWaitingTask(taskId) {
    await eel.delete_task(taskId)();
    renderWaitingRoom();
}

// --- AKTİF DEADLINE WIDGET'LARI ---
// Deadline görev kontrolleri (#1)
function startDeadlineTimer(taskId) {
    if (deadlineTimers[taskId]) return; // zaten çalışıyor
    deadlineTimers[taskId] = { elapsed: 0, paused: false };
    deadlineTimers[taskId].interval = setInterval(() => {
        if (!deadlineTimers[taskId].paused) {
            deadlineTimers[taskId].elapsed++;
        }
    }, 1000);
}

function toggleDeadlinePause(taskId) {
    if (!deadlineTimers[taskId]) return;
    deadlineTimers[taskId].paused = !deadlineTimers[taskId].paused;
}

async function completeDeadlineTask(taskId) {
    // Süreyi hesapla ve ana istatistiğe yaz (#7)
    if (deadlineTimers[taskId]) {
        const workedMins = Math.floor(deadlineTimers[taskId].elapsed / 60);
        if (workedMins > 0) {
            await eel.log_study_time(workedMins)();
        }
        clearInterval(deadlineTimers[taskId].interval);
        delete deadlineTimers[taskId];
    }
    await eel.complete_task(taskId)();
    renderActiveDeadlines();
    renderChart();
}

async function resetDeadlineTask(taskId) {
    // Süreyi kaydetmeden sadece durdur ve sil
    if (deadlineTimers[taskId]) {
        clearInterval(deadlineTimers[taskId].interval);
        delete deadlineTimers[taskId];
    }
    await eel.delete_task(taskId)();
    renderActiveDeadlines();
}

async function renderActiveDeadlines() {
    const tasks = await eel.get_active_deadlines()();
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
        const elapsed = deadlineTimers[t.id]?.elapsed || 0;
        const elM = Math.floor(elapsed / 60);
        return `
            <div class="deadline-widget" style="flex-wrap:wrap;">
                <span class="deadline-name">🔴 ${t.subject}</span>
                <span class="deadline-time">${h}:${m}:${s}</span>
                <div style="width:100%;display:flex;gap:4px;margin-top:6px;">
                    <button class="btn btn-ghost btn-small" onclick="toggleDeadlinePause(${t.id})" style="flex:1;font-size:9px;">${isPaused ? '▶ DEVAM' : '⏸ DURAKLAT'}</button>
                    <button class="btn btn-success btn-small" onclick="completeDeadlineTask(${t.id})" style="flex:1;font-size:9px;">✓ BİTİR (${elM}dk)</button>
                    <button class="btn btn-danger btn-small" onclick="resetDeadlineTask(${t.id})" style="width:28px;font-size:9px;padding:4px;">✕</button>
                </div>
            </div>`;
    }).join('');
}

// --- CANLI RADAR ---
async function updateLiveRadar() {
    const status = await eel.get_live_blacklist_status()();
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
    await eel.remove_blacklisted_app(name)();
    updateLiveRadar();
}

async function renameRadarApp(appName) {
    const newName = prompt('İsim değiştir:', appName);
    if (newName && newName.trim()) {
        await eel.rename_blacklisted_app(appName, newName.trim())();
        updateLiveRadar();
    }
}

// --- .EXE PICKER ---
document.getElementById('exePicker').addEventListener('change', async function() {
    if (this.files.length > 0) {
        const fileName = this.files[0].name.toLowerCase();
        await eel.add_blacklisted_app_direct(fileName)();
        updateLiveRadar();
        this.value = '';
    }
});

// --- ALERTS FROM PYTHON ---
eel.expose(show_alerts);
function show_alerts(alerts) {
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
    const all = await eel.get_full_schedule()();
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
    const existing = await eel.get_full_schedule()() || [];
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
    const result = await eel.save_schedule(allEntries)();
    
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
    
    const lessons = await eel.get_today_schedule()();
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
    const result = await eel.apply_repeat_strategy(type)();
    
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
    const tasks = await eel.get_todays_smart_tasks()();
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
    await eel.complete_smart_task(id)();
    renderSmartTasks();
}

async function addManualSmartTask() {
    const name = document.getElementById('manualTaskName').value.trim();
    const mins = parseInt(document.getElementById('manualTaskMin').value) || 45;
    if (!name) return;
    await eel.add_manual_smart_task(name, mins)();
    document.getElementById('manualTaskName').value = '';
    document.getElementById('manualTaskMin').value = '';
    renderSmartTasks();
}

// --- EKRAN SÜRESİ RAPORU ---
async function openUsageReport() {
    document.getElementById('usage-modal').classList.add('active');
    const data = await eel.get_app_usage_report()();
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
    if (isRunning) { await resetTimer(); }
    
    const result = await eel.end_day_protocol()();
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
    const rawData = await eel.get_weekly_chart_data()();
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
        colors: ['#eab308'],
        fill: {
            type: 'gradient',
            gradient: { shadeIntensity: 1, opacityFrom: 0.5, opacityTo: 0.0, stops: [0, 100] }
        },
        dataLabels: { enabled: false },
        stroke: { curve: 'smooth', width: 3 },
        xaxis: { 
            categories: dates,
            axisBorder: { show: false },
            axisTicks: { show: false },
            labels: { style: { colors: '#64748b', fontSize: '11px' } }
        },
        yaxis: { labels: { style: { colors: '#64748b' } } },
        grid: { borderColor: 'rgba(255,255,255,0.06)', strokeDashArray: 4 },
        theme: { mode: 'dark' },
        markers: { size: 5, colors: ['#0a0e1a'], strokeColors: '#eab308', strokeWidth: 2 },
        tooltip: { theme: 'dark' }
    };

    if (chart) { chart.destroy(); }
    chart = new ApexCharts(document.querySelector("#historyChart"), options);
    chart.render();
}

// --- LIVE UPDATE LOOP (Her saniye) ---
setInterval(() => {
    updateLiveRadar();
    renderActiveDeadlines();
}, 1000);

// --- SAYFA YÜKLENME ---
window.addEventListener('load', () => {
    renderChart();
    renderWaitingRoom();
    renderActiveDeadlines();
    updateLiveRadar();
});

// --- TÜM ZAMANLARIN VERİ TABLOSU (#3) ---
async function openAllTimeModal() {
    document.getElementById('alltime-modal').classList.add('active');
    const data = await eel.get_all_daily_logs()();
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
