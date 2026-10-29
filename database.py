import os
import sqlite3
import csv
import json
import shutil
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path

APP_NAME = "FocusOS"


def _default_data_dir():
    """Return a per-user writable data directory for DB files."""
    override = os.environ.get("FOCUSOS_DATA_DIR")
    if override:
        return Path(override).expanduser()

    if os.name == "nt":
        base = os.environ.get("APPDATA") or os.environ.get("LOCALAPPDATA")
        if base:
            return Path(base) / APP_NAME

    xdg_data_home = os.environ.get("XDG_DATA_HOME")
    if xdg_data_home:
        return Path(xdg_data_home) / APP_NAME
    return Path.home() / ".local" / "share" / APP_NAME


DATA_DIR = _default_data_dir()
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_NAME = str(DATA_DIR / "guardian.db")


def get_db_path():
    return DB_NAME


@contextmanager
def _connect(path=None):
    """sqlite3 bağlantısı açar; başarıda commit, hatada rollback yapar ve her durumda kapatır.
    (sqlite3'ün kendi `with` bloğu bağlantıyı kapatmaz, Windows'ta dosya kilidi bırakır.)"""
    conn = sqlite3.connect(path or DB_NAME, timeout=10)
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def _ensure_column(cursor, table_name, column_name, definition):
    """Var olan kullanıcı veritabanlarını veri kaybetmeden günceller."""
    cursor.execute(f"PRAGMA table_info({table_name})")
    existing = {row[1] for row in cursor.fetchall()}
    if column_name not in existing:
        cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")

def init_db():
    """Veritabanını ve tabloları güvenli bir şekilde oluşturur."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('PRAGMA foreign_keys = ON')
        
        # Görevler (Sahte Deadline + Bekleme Odası)
        cursor.execute('''CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject TEXT NOT NULL,
            duration_minutes INTEGER NOT NULL,
            fake_deadline DATETIME,
            status TEXT DEFAULT 'waiting',
            is_completed BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )''')
        
        # Kara Liste (display_name: kullanıcının özelleştirebileceği takma ad)
        cursor.execute('''CREATE TABLE IF NOT EXISTS blacklist (
            app_name TEXT UNIQUE NOT NULL,
            display_name TEXT
        )''')
        
        # Günlük Çalışma Logları
        cursor.execute('''CREATE TABLE IF NOT EXISTS daily_logs (
            log_date DATE PRIMARY KEY,
            total_minutes INTEGER DEFAULT 0
        )''')
        
        # Uygulama Kullanım Süreleri
        cursor.execute('''CREATE TABLE IF NOT EXISTS app_usage (
            log_date DATE,
            app_name TEXT,
            total_seconds INTEGER DEFAULT 0,
            PRIMARY KEY (log_date, app_name)
        )''')
        
        # Haftalık Ders Programı (süre bazlı: saat + dakika)
        cursor.execute('''CREATE TABLE IF NOT EXISTS weekly_schedule (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            day_of_week INTEGER NOT NULL,
            lesson_name TEXT NOT NULL,
            duration_hours INTEGER DEFAULT 0,
            duration_minutes INTEGER DEFAULT 0
        )''')
        
        # Akıllı Tekrar Görevleri
        cursor.execute('''CREATE TABLE IF NOT EXISTS smart_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lesson_name TEXT NOT NULL,
            scheduled_date DATE NOT NULL,
            duration_minutes INTEGER DEFAULT 45,
            is_completed BOOLEAN DEFAULT 0,
            source TEXT DEFAULT 'manual'
        )''')
        
        # Önemli Tarihler (geri sayım ile)
        cursor.execute('''CREATE TABLE IF NOT EXISTS important_dates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_name TEXT NOT NULL,
            event_date DATE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )''')
        
        # Konu Bazlı Çalışma Logları
        cursor.execute('''CREATE TABLE IF NOT EXISTS subject_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            log_date DATE NOT NULL,
            subject_name TEXT NOT NULL,
            duration_minutes INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )''')
        
        # Günlük Not Defteri
        cursor.execute('''CREATE TABLE IF NOT EXISTS daily_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            note_date DATE NOT NULL UNIQUE,
            content TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )''')
        
        # Rutinler
        cursor.execute('''CREATE TABLE IF NOT EXISTS routines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            period TEXT NOT NULL,
            icon TEXT DEFAULT '🎯',
            duration_minutes INTEGER DEFAULT 5,
            active_days TEXT DEFAULT '1,2,3,4,5,6,7',
            sort_order INTEGER DEFAULT 0,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )''')
        
        # Rutin Tamamlanma Kayıtları
        cursor.execute('''CREATE TABLE IF NOT EXISTS routine_completions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            routine_id INTEGER NOT NULL,
            completion_date DATE NOT NULL,
            completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(routine_id, completion_date),
            FOREIGN KEY (routine_id) REFERENCES routines(id) ON DELETE CASCADE
        )''')
        
        # Seans Bazlı Detaylı Kayıtlar
        cursor.execute('''CREATE TABLE IF NOT EXISTS session_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_date DATE NOT NULL,
            subject TEXT DEFAULT '',
            planned_minutes INTEGER DEFAULT 0,
            actual_minutes INTEGER NOT NULL,
            pause_count INTEGER DEFAULT 0,
            longest_uninterrupted_seconds INTEGER DEFAULT 0,
            focus_score INTEGER DEFAULT 0,
            session_type TEXT DEFAULT 'focus',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )''')
        
        # OFF DAY Kayıtları
        cursor.execute('''CREATE TABLE IF NOT EXISTS off_days (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            off_date DATE NOT NULL UNIQUE,
            week_start_date DATE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )''')
        
        # Haftalık Öncelikler
        cursor.execute('''CREATE TABLE IF NOT EXISTS weekly_priorities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            week_start_date DATE NOT NULL,
            priority_text TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0
        )''')
        
        # Haftalık Değerlendirme Gösterim Kaydı
        cursor.execute('''CREATE TABLE IF NOT EXISTS weekly_review_shown (
            week_start_date DATE PRIMARY KEY,
            shown_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )''')
        
        # =============================================
        # YOL HARİTASI (ROADMAP) TABLOLARI
        # =============================================
        
        # Ana Programlar (Bilgisayar Öğrenmek, Müzik vb.)
        cursor.execute('''CREATE TABLE IF NOT EXISTS roadmap_programs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            icon TEXT DEFAULT '📚',
            sort_order INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )''')
        
        # Alt Programlar (Donanım, Yazılım vb.)
        cursor.execute('''CREATE TABLE IF NOT EXISTS roadmap_subprograms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            program_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            icon TEXT DEFAULT '📂',
            sort_order INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (program_id) REFERENCES roadmap_programs(id) ON DELETE CASCADE
        )''')
        
        # Fazlar (Faz 1, Faz 2 vb.)
        cursor.execute('''CREATE TABLE IF NOT EXISTS roadmap_phases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subprogram_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (subprogram_id) REFERENCES roadmap_subprograms(id) ON DELETE CASCADE
        )''')
        
        # Konular (checkbox'lı öğeler)
        cursor.execute('''CREATE TABLE IF NOT EXISTS roadmap_topics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            phase_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            is_completed BOOLEAN DEFAULT 0,
            sort_order INTEGER DEFAULT 0,
            completed_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (phase_id) REFERENCES roadmap_phases(id) ON DELETE CASCADE
        )''')
        
        # Konu Tamamlanma Logu (streak bağlantısı)
        cursor.execute('''CREATE TABLE IF NOT EXISTS roadmap_completions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            topic_id INTEGER NOT NULL,
            completion_date DATE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (topic_id) REFERENCES roadmap_topics(id) ON DELETE CASCADE
        )''')

        # Eski kurulumlar için geriye uyumlu şema göçleri.
        _ensure_column(cursor, 'tasks', 'priority', 'INTEGER DEFAULT 2')
        _ensure_column(cursor, 'tasks', 'planned_date', 'DATE')
        _ensure_column(cursor, 'tasks', 'due_date', 'DATE')
        _ensure_column(cursor, 'tasks', 'roadmap_topic_id', 'INTEGER')
        _ensure_column(cursor, 'tasks', 'planner_item_id', 'INTEGER')
        _ensure_column(cursor, 'tasks', 'actual_minutes', 'INTEGER DEFAULT 0')
        _ensure_column(cursor, 'tasks', 'deadline_paused_at', 'DATETIME')
        _ensure_column(cursor, 'tasks', 'deadline_remaining_seconds', 'INTEGER')
        _ensure_column(cursor, 'roadmap_topics', 'estimated_minutes', 'INTEGER DEFAULT 60')
        _ensure_column(cursor, 'roadmap_topics', 'due_date', 'DATE')
        _ensure_column(cursor, 'roadmap_topics', 'priority', 'INTEGER DEFAULT 2')
        _ensure_column(cursor, 'roadmap_topics', 'difficulty', 'INTEGER DEFAULT 3')
        _ensure_column(cursor, 'session_logs', 'task_id', 'INTEGER')
        _ensure_column(cursor, 'session_logs', 'routine_id', 'INTEGER')
        _ensure_column(cursor, 'session_logs', 'roadmap_topic_id', 'INTEGER')
        _ensure_column(cursor, 'session_logs', 'started_at', 'DATETIME')
        _ensure_column(cursor, 'session_logs', 'ended_at', 'DATETIME')

        cursor.execute('''CREATE TABLE IF NOT EXISTS focus_session_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            mode TEXT NOT NULL DEFAULT 'timer',
            total_seconds INTEGER NOT NULL DEFAULT 1500,
            subject TEXT DEFAULT '',
            task_id INTEGER,
            routine_id INTEGER,
            roadmap_topic_id INTEGER,
            is_running BOOLEAN DEFAULT 0,
            is_paused BOOLEAN DEFAULT 0,
            start_timestamp INTEGER DEFAULT 0,
            pause_timestamp INTEGER DEFAULT 0,
            total_paused_ms INTEGER DEFAULT 0,
            user_pause_count INTEGER DEFAULT 0,
            current_block_start INTEGER DEFAULT 0,
            longest_block_ms INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )''')

        cursor.execute('''CREATE TABLE IF NOT EXISTS day_reviews (
            review_date DATE PRIMARY KEY,
            wins TEXT DEFAULT '',
            blockers TEXT DEFAULT '',
            tomorrow_first_task TEXT DEFAULT '',
            carried_task_ids TEXT DEFAULT '[]',
            total_minutes INTEGER DEFAULT 0,
            closed_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )''')

        cursor.execute('''CREATE TABLE IF NOT EXISTS focus_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            grace_seconds INTEGER DEFAULT 120,
            enforce_only_during_focus BOOLEAN DEFAULT 1,
            checkin_interval_minutes INTEGER DEFAULT 10,
            pause_on_windows_lock BOOLEAN DEFAULT 1,
            is_active BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )''')

        # Eski profillerde de kilitte duraklatma varsayılan olarak açık gelsin.
        _ensure_column(cursor, 'focus_profiles', 'pause_on_windows_lock', 'BOOLEAN DEFAULT 1')

        cursor.execute('''CREATE TABLE IF NOT EXISTS focus_profile_apps (
            profile_id INTEGER NOT NULL,
            app_name TEXT NOT NULL,
            display_name TEXT,
            PRIMARY KEY(profile_id, app_name),
            FOREIGN KEY(profile_id) REFERENCES focus_profiles(id) ON DELETE CASCADE
        )''')

        cursor.execute('''CREATE TABLE IF NOT EXISTS app_settings (
            setting_key TEXT PRIMARY KEY,
            setting_value TEXT NOT NULL
        )''')

        cursor.execute('''CREATE TABLE IF NOT EXISTS planner_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            planned_date DATE NOT NULL,
            duration_minutes INTEGER DEFAULT 45,
            priority INTEGER DEFAULT 2,
            source_type TEXT DEFAULT 'manual',
            source_id INTEGER,
            status TEXT DEFAULT 'planned',
            sort_order INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )''')

        cursor.execute('''CREATE TABLE IF NOT EXISTS roadmap_topic_progress (
            topic_id INTEGER PRIMARY KEY,
            actual_minutes INTEGER DEFAULT 0,
            last_session_date DATE,
            FOREIGN KEY(topic_id) REFERENCES roadmap_topics(id) ON DELETE CASCADE
        )''')

        cursor.execute("INSERT OR IGNORE INTO focus_profiles (id, name, grace_seconds, enforce_only_during_focus, checkin_interval_minutes, is_active) VALUES (1, 'Derin Çalışma', 120, 1, 10, 1)")
        cursor.execute("INSERT OR IGNORE INTO focus_profiles (id, name, grace_seconds, enforce_only_during_focus, checkin_interval_minutes, is_active) VALUES (2, 'Hafif Çalışma', 300, 1, 20, 0)")
        cursor.execute("INSERT OR IGNORE INTO focus_profiles (id, name, grace_seconds, enforce_only_during_focus, checkin_interval_minutes, is_active) VALUES (3, 'Serbest Zaman', 0, 1, 0, 0)")
        cursor.execute("INSERT OR IGNORE INTO app_settings (setting_key, setting_value) VALUES ('focus_runtime_active', '0')")
        cursor.execute("INSERT OR IGNORE INTO app_settings (setting_key, setting_value) VALUES ('daily_target_minutes', '60')")

        # Günlük hedef geçmişi: hedef değişince geçmiş günlerin serisi yeniden hesaplanmasın.
        cursor.execute('''CREATE TABLE IF NOT EXISTS daily_targets (
            effective_date DATE PRIMARY KEY,
            target_minutes INTEGER NOT NULL
        )''')
        cursor.execute('''INSERT INTO daily_targets (effective_date, target_minutes)
                          SELECT '0001-01-01', CAST(setting_value AS INTEGER) FROM app_settings
                          WHERE setting_key = 'daily_target_minutes'
                            AND NOT EXISTS (SELECT 1 FROM daily_targets)''')

        # Eski kara listeyi varsayılan profile bir kez taşı.
        cursor.execute('''INSERT OR IGNORE INTO focus_profile_apps (profile_id, app_name, display_name)
                          SELECT 1, app_name, COALESCE(display_name, app_name) FROM blacklist''')
        
        conn.commit()

# --- GÖREV (TASK) İŞLEMLERİ ---
def add_task(subject, duration_minutes, priority=2, planned_date=None, due_date=None,
             roadmap_topic_id=None, planner_item_id=None):
    """Görevi 'waiting' (bekleme) durumunda oluşturur."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute(
            '''INSERT INTO tasks
               (subject, duration_minutes, status, priority, planned_date, due_date,
                roadmap_topic_id, planner_item_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
            (subject, duration_minutes, 'waiting', priority, planned_date, due_date,
             roadmap_topic_id, planner_item_id)
        )
        conn.commit()
        return cursor.lastrowid

def activate_task(task_id):
    """Bekleyen görevi aktife alır ve deadline hesaplar."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT duration_minutes FROM tasks WHERE id = ?', (task_id,))
        row = cursor.fetchone()
        if row:
            deadline = datetime.now() + timedelta(minutes=row[0])
            deadline_str = deadline.strftime("%Y-%m-%d %H:%M:%S")
            cursor.execute(
                'UPDATE tasks SET status = ?, fake_deadline = ? WHERE id = ?',
                ('active', deadline_str, task_id)
            )
            conn.commit()
            return {"id": task_id, "deadline": deadline_str, "deadline_ts": deadline.timestamp() * 1000}
    return None

def get_waiting_tasks():
    """Bekleme Odasındaki görevleri listeler."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute("""SELECT id, subject, duration_minutes, priority, planned_date, due_date, roadmap_topic_id
                          FROM tasks WHERE status = 'waiting'
                          ORDER BY COALESCE(planned_date, '9999-12-31'), priority, created_at DESC""")
        return [{"id": r[0], "subject": r[1], "minutes": r[2], "priority": r[3] or 2,
                 "planned_date": r[4], "due_date": r[5], "roadmap_topic_id": r[6]} for r in cursor.fetchall()]

def get_active_tasks():
    """Aktif deadline'ları listeler."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute("""SELECT id, subject, fake_deadline, duration_minutes, priority, planned_date,
                                 due_date, roadmap_topic_id, deadline_paused_at, deadline_remaining_seconds
                          FROM tasks WHERE status = 'active' ORDER BY fake_deadline ASC""")
        results = []
        for r in cursor.fetchall():
            try:
                dl = datetime.strptime(r[2], "%Y-%m-%d %H:%M:%S")
                results.append({"id": r[0], "subject": r[1], "deadline_ts": dl.timestamp() * 1000,
                                "duration_minutes": r[3], "priority": r[4] or 2,
                                "planned_date": r[5], "due_date": r[6], "roadmap_topic_id": r[7],
                                "paused": bool(r[8]), "remaining_seconds": r[9]})
            except:
                pass
        return results

def complete_task(task_id, actual_minutes=0):
    """Görevi tamamlandı işaretler."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute("""UPDATE tasks SET status = 'completed', is_completed = 1,
                                 actual_minutes = actual_minutes + ?, deadline_paused_at = NULL
                                 WHERE id = ?""", (max(0, int(actual_minutes or 0)), task_id))
        cursor.execute('''UPDATE planner_items SET status='done' WHERE id IN
                          (SELECT planner_item_id FROM tasks WHERE id=?)''', (task_id,))
        conn.commit()


def set_task_deadline_paused(task_id, paused):
    """Deadline'ı gerçekten durdurur ve kaldığı yerden devam ettirir."""
    now = datetime.now()
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT fake_deadline, deadline_paused_at, deadline_remaining_seconds FROM tasks WHERE id=? AND status="active"', (task_id,))
        row = cursor.fetchone()
        if not row:
            return False
        if paused and not row[1]:
            deadline = datetime.strptime(row[0], "%Y-%m-%d %H:%M:%S")
            remaining = max(0, int((deadline - now).total_seconds()))
            cursor.execute('UPDATE tasks SET deadline_paused_at=?, deadline_remaining_seconds=? WHERE id=?',
                           (now.strftime("%Y-%m-%d %H:%M:%S"), remaining, task_id))
        elif not paused and row[1]:
            remaining = max(0, int(row[2] or 0))
            new_deadline = now + timedelta(seconds=remaining)
            cursor.execute('''UPDATE tasks SET fake_deadline=?, deadline_paused_at=NULL,
                              deadline_remaining_seconds=NULL WHERE id=?''',
                           (new_deadline.strftime("%Y-%m-%d %H:%M:%S"), task_id))
        conn.commit()
    return True

def delete_task(task_id):
    """Görevi siler."""
    with _connect() as conn:
        conn.cursor().execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.commit()

# --- KARA LİSTE (BLACKLIST) İŞLEMLERİ ---
def get_blacklist():
    """Process tarama için sadece app_name listesi döndürür."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT app_name FROM blacklist')
        return [row[0] for row in cursor.fetchall()]

def get_blacklist_with_display():
    """UI için app_name + display_name döndürür."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT app_name, display_name FROM blacklist')
        return [{"app": r[0], "display": r[1] or r[0]} for r in cursor.fetchall()]

def add_to_blacklist(app_name):
    with _connect() as conn:
        try:
            conn.cursor().execute('INSERT INTO blacklist (app_name, display_name) VALUES (?, ?)', (app_name, app_name))
            conn.commit()
        except sqlite3.IntegrityError:
            pass 

def remove_from_blacklist(app_name):
    with _connect() as conn:
        conn.cursor().execute('DELETE FROM blacklist WHERE app_name = ?', (app_name,))
        conn.commit()

def rename_blacklist_app(app_name, new_display_name):
    """Kara listedeki uygulamanın görünen adını değiştirir."""
    with _connect() as conn:
        conn.cursor().execute('UPDATE blacklist SET display_name = ? WHERE app_name = ?', (new_display_name, app_name))
        conn.commit()

# --- İSTATİSTİK VE GRAFİK İŞLEMLERİ ---
def _valid_log_date(log_date):
    """Geçerli bir YYYY-MM-DD verilmişse onu, yoksa bugünü döndürür (gelecek tarih kabul edilmez)."""
    today = datetime.now().strftime("%Y-%m-%d")
    if not log_date:
        return today
    parsed = datetime.strptime(str(log_date), "%Y-%m-%d").strftime("%Y-%m-%d")
    return min(parsed, today)


def log_study_time(minutes, log_date=None):
    today = _valid_log_date(log_date)
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('INSERT OR IGNORE INTO daily_logs (log_date, total_minutes) VALUES (?, 0)', (today,))
        cursor.execute('UPDATE daily_logs SET total_minutes = total_minutes + ? WHERE log_date = ?', (minutes, today))
        conn.commit()

def get_today_stats():
    today = datetime.now().strftime("%Y-%m-%d")
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT total_minutes FROM daily_logs WHERE log_date = ?', (today,))
        result = cursor.fetchone()
        return result[0] if result else 0

def get_weekly_stats():
    """Son 7 takvim gününün çalışma dakikalarını grafik için çeker (en yeni önce).
    Çalışılmayan günler 0 olarak döner; böylece grafikte boşluk kaybolmaz."""
    today = datetime.now().date()
    days = [(today - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(7)]
    with _connect() as conn:
        rows = conn.execute(
            'SELECT log_date, total_minutes FROM daily_logs WHERE log_date BETWEEN ? AND ?',
            (days[-1], days[0])
        ).fetchall()
    minutes = {r[0]: r[1] or 0 for r in rows}
    return [(day, minutes.get(day, 0)) for day in days]

def get_all_daily_logs():
    """İlk günden beri tüm günlük çalışma loglarını döndürür."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT log_date, total_minutes FROM daily_logs ORDER BY log_date DESC')
        return [{"date": r[0], "minutes": r[1]} for r in cursor.fetchall()]

def get_all_time_stats():
    """Tüm zamanların özet istatistiklerini ve günlük dökümleri döndürür."""
    with _connect() as conn:
        cursor = conn.cursor()
        
        # 1. Genel özet metrikleri
        cursor.execute('''
            SELECT 
                AVG(NULLIF(focus_score, 0)),
                MAX(longest_uninterrupted_seconds),
                SUM(pause_count),
                COUNT(id)
            FROM session_logs
        ''')
        summary_row = cursor.fetchone()
        avg_score = round(summary_row[0] or 0, 1) if summary_row else 0
        longest_block_min = round((summary_row[1] or 0) / 60) if summary_row else 0
        total_pauses = summary_row[2] or 0 if summary_row else 0
        
        cursor.execute('SELECT COUNT(*) FROM routine_completions')
        rc_row = cursor.fetchone()
        routines_completed = rc_row[0] if rc_row else 0
        
        # 2. Günlük loglar (Session logs ile birleştirilmiş)
        cursor.execute('''
            SELECT 
                d.log_date, 
                d.total_minutes,
                (SELECT AVG(NULLIF(focus_score, 0)) FROM session_logs WHERE session_date = d.log_date) as avg_score,
                (SELECT COUNT(*) FROM session_logs WHERE session_date = d.log_date) as session_count
            FROM daily_logs d
            ORDER BY d.log_date DESC
        ''')
        
        daily_logs = []
        for r in cursor.fetchall():
            daily_logs.append({
                "date": r[0],
                "minutes": r[1],
                "avg_score": round(r[2] or 0, 1) if r[2] else 0,
                "sessions": r[3] or 0
            })
            
        return {
            "summary": {
                "avg_score": avg_score,
                "longest_block_min": longest_block_min,
                "total_pauses": total_pauses,
                "routines_completed": routines_completed
            },
            "daily_logs": daily_logs
        }


def update_daily_log(log_date, total_minutes):
    """Belirli bir günün toplam çalışma süresini günceller (düzenleme için)."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('INSERT OR IGNORE INTO daily_logs (log_date, total_minutes) VALUES (?, 0)', (log_date,))
        cursor.execute('UPDATE daily_logs SET total_minutes = ? WHERE log_date = ?', (total_minutes, log_date))
        conn.commit()

# --- EKRAN SÜRESİ (APP USAGE) İŞLEMLERİ ---
def log_app_usage(app_name, seconds):
    today = datetime.now().strftime("%Y-%m-%d")
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('INSERT OR IGNORE INTO app_usage (log_date, app_name, total_seconds) VALUES (?, ?, 0)', (today, app_name))
        cursor.execute('UPDATE app_usage SET total_seconds = total_seconds + ? WHERE log_date = ? AND app_name = ?', (seconds, today, app_name))
        conn.commit()

def get_today_app_usage():
    today = datetime.now().strftime("%Y-%m-%d")
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT app_name, total_seconds FROM app_usage WHERE log_date = ? ORDER BY total_seconds DESC', (today,))
        return [{"app": row[0], "seconds": row[1]} for row in cursor.fetchall()]

# --- HAFTALIK DERS PROGRAMI ---
def save_schedule(entries):
    """Tüm programı sıfırlayıp yeniden yazar. entries = [{ day, name, hours, minutes }, ...]"""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM weekly_schedule')
        for e in entries:
            cursor.execute(
                'INSERT INTO weekly_schedule (day_of_week, lesson_name, duration_hours, duration_minutes) VALUES (?, ?, ?, ?)',
                (e['day'], e['name'], e.get('hours', 0), e.get('minutes', 0))
            )
        conn.commit()

def save_schedule_and_create_tasks(entries):
    """Programı kaydeder; yalnızca bugünün eksik görevlerini idempotent oluşturur."""
    save_schedule(entries)
    return ensure_today_schedule_tasks()


def ensure_today_schedule_tasks():
    today = datetime.now()
    today_str = today.strftime('%Y-%m-%d')
    lessons = get_schedule_for_day(today.weekday())
    created_tasks = []
    with _connect() as conn:
        cursor = conn.cursor()
        for lesson in lessons:
            total_mins = int(lesson.get('hours', 0) or 0) * 60 + int(lesson.get('minutes', 0) or 0)
            name = str(lesson.get('name', '')).strip()
            if total_mins <= 0 or not name:
                continue
            cursor.execute('''SELECT id FROM tasks WHERE subject=? AND planned_date=?
                              AND status IN ('waiting','active','completed') LIMIT 1''', (name, today_str))
            if cursor.fetchone():
                continue
            cursor.execute('''INSERT INTO tasks(subject, duration_minutes, status, priority, planned_date)
                              VALUES (?, ?, 'waiting', 2, ?)''', (name, total_mins, today_str))
            created_tasks.append({"id": cursor.lastrowid, "subject": name, "minutes": total_mins})
        conn.commit()
    return created_tasks

def get_schedule_for_day(day_of_week):
    """O günün derslerini getirir."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute(
            'SELECT id, lesson_name, duration_hours, duration_minutes FROM weekly_schedule WHERE day_of_week = ? ORDER BY id',
            (day_of_week,)
        )
        return [{"id": r[0], "name": r[1], "hours": r[2], "minutes": r[3]} for r in cursor.fetchall()]

def get_full_schedule():
    """Tüm haftalık programı döndürür."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id, day_of_week, lesson_name, duration_hours, duration_minutes FROM weekly_schedule ORDER BY day_of_week, id')
        return [{"id": r[0], "day": r[1], "name": r[2], "hours": r[3], "minutes": r[4]} for r in cursor.fetchall()]

# --- AKILLI TEKRAR GÖREVLERİ ---
def add_smart_task(lesson_name, scheduled_date, duration_minutes=45, source='manual'):
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO smart_tasks (lesson_name, scheduled_date, duration_minutes, source) VALUES (?, ?, ?, ?)',
            (lesson_name, scheduled_date, duration_minutes, source)
        )
        conn.commit()
        return cursor.lastrowid

def get_todays_smart_tasks():
    today = datetime.now().strftime("%Y-%m-%d")
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute(
            'SELECT id, lesson_name, duration_minutes, is_completed, source FROM smart_tasks WHERE scheduled_date = ? ORDER BY id',
            (today,)
        )
        return [{"id": r[0], "lesson": r[1], "minutes": r[2], "completed": bool(r[3]), "source": r[4]} for r in cursor.fetchall()]

def complete_smart_task(task_id):
    with _connect() as conn:
        conn.cursor().execute('UPDATE smart_tasks SET is_completed = 1 WHERE id = ?', (task_id,))
        conn.commit()

def generate_daily_repeat(lessons):
    """Her dersin gününe akşam tekrarı ekler."""
    today = datetime.now().strftime("%Y-%m-%d")
    added = []
    for lesson in lessons:
        tid = add_smart_task(lesson, today, 45, 'daily_repeat')
        added.append({"id": tid, "lesson": lesson, "date": today})
    return added

def generate_spaced_repetition(lessons):
    """Unutma eğrisine göre 1, 3, 7. günlere görev atar."""
    today = datetime.now()
    added = []
    for lesson in lessons:
        for delta in [1, 3, 7]:
            target = (today + timedelta(days=delta)).strftime("%Y-%m-%d")
            tid = add_smart_task(lesson, target, 45, 'spaced_rep')
            added.append({"id": tid, "lesson": lesson, "date": target})
    return added

# --- ÖNEMLİ TARİHLER ---
def add_important_date(event_name, event_date):
    """Yeni bir önemli tarih/etkinlik ekler."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO important_dates (event_name, event_date) VALUES (?, ?)',
            (event_name, event_date)
        )
        conn.commit()
        return cursor.lastrowid

def get_important_dates():
    """Tüm önemli tarihleri döndürür."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id, event_name, event_date FROM important_dates ORDER BY event_date ASC')
        return [{"id": r[0], "name": r[1], "date": r[2]} for r in cursor.fetchall()]

def delete_important_date(date_id):
    """Önemli tarihi siler."""
    with _connect() as conn:
        conn.cursor().execute('DELETE FROM important_dates WHERE id = ?', (date_id,))
        conn.commit()

# --- KONU BAZLI ÇALIŞMA LOGLARI ---
def log_subject_time(subject_name, minutes, log_date=None):
    """Konuya süre yazar (varsayılan: bugün)."""
    today = _valid_log_date(log_date)
    with _connect() as conn:
        cursor = conn.cursor()
        # Aynı gün + aynı konu varsa süreyi topla
        cursor.execute(
            'SELECT id FROM subject_logs WHERE log_date = ? AND subject_name = ?',
            (today, subject_name)
        )
        existing = cursor.fetchone()
        if existing:
            cursor.execute(
                'UPDATE subject_logs SET duration_minutes = duration_minutes + ? WHERE id = ?',
                (minutes, existing[0])
            )
        else:
            cursor.execute(
                'INSERT INTO subject_logs (log_date, subject_name, duration_minutes) VALUES (?, ?, ?)',
                (today, subject_name, minutes)
            )
        conn.commit()

def get_subject_suggestions(limit=300):
    """Otomatik tamamlama için kayıtlı ders/konu adlarını döndürür.
    Sık ve yakın zamanda çalışılanlar önce gelir; büyük/küçük harf farkı tekilleştirilir."""
    sources = [
        # (sorgu, kaynak etiketi)
        ('''SELECT subject_name, SUM(duration_minutes) + 1000, MAX(log_date)
            FROM subject_logs GROUP BY subject_name''', 'history'),
        ('SELECT lesson_name, 500, NULL FROM weekly_schedule', 'schedule'),
        ('SELECT subject, 300, MAX(created_at) FROM tasks GROUP BY subject', 'task'),
        ('SELECT title, 200, MAX(planned_date) FROM planner_items GROUP BY title', 'planner'),
        ('''SELECT t.title, CASE WHEN t.is_completed THEN 50 ELSE 150 END, NULL
            FROM roadmap_topics t''', 'roadmap'),
        ('SELECT lesson_name, 100, MAX(scheduled_date) FROM smart_tasks GROUP BY lesson_name', 'repeat'),
    ]
    best = {}
    with _connect() as conn:
        cursor = conn.cursor()
        for query, source in sources:
            try:
                cursor.execute(query)
            except sqlite3.Error:
                continue
            for name, score, last_used in cursor.fetchall():
                name = (name or '').strip()
                if not name:
                    continue
                key = name.casefold()
                entry = best.get(key)
                if entry is None:
                    best[key] = {"name": name, "score": score or 0,
                                 "last_used": last_used or '', "source": source}
                else:
                    entry["score"] += score or 0
                    entry["last_used"] = max(entry["last_used"], last_used or '')
    ranked = sorted(best.values(), key=lambda e: (e["score"], e["last_used"]), reverse=True)
    return ranked[:limit]


def get_subject_logs_for_date(log_date):
    """Belirli bir günün konu bazlı çalışma sürelerini döndürür."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute(
            'SELECT subject_name, duration_minutes FROM subject_logs WHERE log_date = ? ORDER BY duration_minutes DESC',
            (log_date,)
        )
        return [{"subject": r[0], "minutes": r[1]} for r in cursor.fetchall()]


# --- ÇALIŞMA SERİSİ (STREAK) ---
def _get_week_start(date_obj):
    """Verilen tarihin Pazartesi gününü döndürür."""
    return date_obj - timedelta(days=date_obj.weekday())


STREAK_GRACE_WINDOW_DAYS = 7  # Bu pencerede 1 kaçırılan gün affedilir, 2. kaçırma seriyi bozar.


def get_study_streak(today=None):
    """Çalışma serisini hesaplar (günlük hedef: daily_target_minutes).

    Kurallar:
      - Hedefe ulaşılan her gün seriye +1 ekler.
      - OFF DAY olan günler nötrdür (ne ekler ne bozar).
      - Hedefe ulaşılmayan (kaçırılan) bir gün seriye eklenmez ama tek başına seriyi bozmaz.
        Aynı 7 günlük pencerede ikinci bir gün kaçırılırsa seri bozulur.
      - Bugün henüz bitmediği için bugünkü eksiklik kaçırma sayılmaz.
    """
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT log_date, total_minutes FROM daily_logs')
        rows = cursor.fetchall()
        cursor.execute('SELECT off_date FROM off_days')
        off_dates = {r[0] for r in cursor.fetchall()}
        cursor.execute('SELECT effective_date, target_minutes FROM daily_targets ORDER BY effective_date')
        target_history = cursor.fetchall()

    current_target = max(1, int(get_setting('daily_target_minutes', '60') or 60))

    def target_for(day_str):
        # O gün geçerli olan hedef (tarihler ISO formatında, metin karşılaştırması yeterli).
        target = None
        for effective_date, minutes in target_history:
            if effective_date <= day_str:
                target = minutes
            else:
                break
        return max(1, int(target or current_target))

    today = today or datetime.now().date()
    today_str = today.strftime("%Y-%m-%d")
    target_minutes = target_for(today_str)
    daily_map = {r[0]: r[1] or 0 for r in rows}
    today_minutes = daily_map.get(today_str, 0)
    today_qualified = today_minutes >= target_minutes

    def qualified(day_str):
        return daily_map.get(day_str, 0) >= target_for(day_str)

    qualified_dates = sorted(d for d in daily_map if qualified(d))
    result = {"streak": 0, "today_minutes": today_minutes, "today_qualified": today_qualified,
              "target_minutes": target_minutes, "grace_available": True,
              "missed_days_in_window": 0}
    if not qualified_dates:
        return result
    first_qualified = datetime.strptime(qualified_dates[0], "%Y-%m-%d").date()

    def is_missed(day):
        if day >= today or day < first_qualified:
            return False
        key = day.strftime("%Y-%m-%d")
        return key not in off_dates and not qualified(key)

    streak = 0
    check_date = today
    while check_date >= first_qualified:
        key = check_date.strftime("%Y-%m-%d")
        if check_date == today and not today_qualified:
            pass  # Gün sürüyor; bugünkü eksik henüz kaçırma değil.
        elif key in off_dates:
            pass
        elif qualified(key):
            streak += 1
        else:
            window_start = check_date - timedelta(days=STREAK_GRACE_WINDOW_DAYS - 1)
            earlier_miss = any(is_missed(check_date - timedelta(days=i))
                               for i in range(1, (check_date - window_start).days + 1))
            if earlier_miss:
                break
        check_date -= timedelta(days=1)

    recent_misses = sum(1 for i in range(1, STREAK_GRACE_WINDOW_DAYS)
                        if is_missed(today - timedelta(days=i)))
    result.update({
        "streak": streak,
        # Bugün de kaçırılırsa seri bozulur mu? (son 6 günde kaçırma varsa evet)
        "grace_available": recent_misses == 0,
        "missed_days_in_window": recent_misses,
    })
    return result


# --- OFF DAY ---
OFF_DAY_LOOKBACK_DAYS = 6


def use_off_day(date_str=None):
    """Bugün ya da son 6 günden biri için OFF DAY kullanır. O günün haftasında 1 hak."""
    today = datetime.now().date()
    if not date_str:
        date_str = today.strftime("%Y-%m-%d")
    try:
        off_date = datetime.strptime(str(date_str), "%Y-%m-%d").date()
    except ValueError:
        return {"success": False, "message": "Geçersiz tarih."}
    if off_date > today or off_date < today - timedelta(days=OFF_DAY_LOOKBACK_DAYS):
        return {"success": False,
                "message": f"OFF DAY yalnızca bugün veya son {OFF_DAY_LOOKBACK_DAYS} gün için kullanılabilir."}
    date_str = off_date.strftime("%Y-%m-%d")
    week_start = _get_week_start(off_date).strftime("%Y-%m-%d")

    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) FROM off_days WHERE week_start_date = ?', (week_start,))
        used = cursor.fetchone()[0]
        if used > 0:
            return {"success": False, "message": "Bu hafta OFF DAY hakkınız zaten kullanıldı."}
        
        try:
            cursor.execute('INSERT INTO off_days (off_date, week_start_date) VALUES (?, ?)',
                           (date_str, week_start))
            conn.commit()
            return {"success": True, "message": "Off day kaydedildi, seriniz korundu."}
        except sqlite3.IntegrityError:
            return {"success": False, "message": "Bu gün zaten OFF DAY olarak işaretli."}


def get_off_day_status():
    """Bu haftanın OFF DAY durumunu döndürür."""
    today = datetime.now().date()
    week_start = _get_week_start(today).strftime("%Y-%m-%d")
    
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT off_date FROM off_days WHERE week_start_date = ?', (week_start,))
        result = cursor.fetchone()
    
    return {
        "used": result is not None,
        "used_date": result[0] if result else None,
        "remaining": 0 if result else 1
    }


# --- RUTİN SİSTEMİ ---
def add_routine(name, period, icon, duration_minutes, active_days):
    """Yeni rutin ekler."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM routines WHERE period = ?', (period,))
        next_order = cursor.fetchone()[0]
        cursor.execute(
            '''INSERT INTO routines (name, period, icon, duration_minutes, active_days, sort_order)
               VALUES (?, ?, ?, ?, ?, ?)''',
            (name, period, icon, duration_minutes, active_days, next_order)
        )
        conn.commit()
        return cursor.lastrowid


def update_routine(routine_id, name, period, icon, duration_minutes, active_days):
    """Rutini günceller."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute(
            '''UPDATE routines SET name=?, period=?, icon=?, duration_minutes=?, active_days=?
               WHERE id=?''',
            (name, period, icon, duration_minutes, active_days, routine_id)
        )
        conn.commit()
        return True


def delete_routine(routine_id):
    """Rutini ve tamamlanma kayıtlarını siler."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM routine_completions WHERE routine_id = ?', (routine_id,))
        cursor.execute('DELETE FROM routines WHERE id = ?', (routine_id,))
        conn.commit()
        return True


def get_today_routines():
    """Bugünün aktif rutinlerini tamamlanma durumuyla döndürür."""
    today = datetime.now()
    today_str = today.strftime("%Y-%m-%d")
    day_of_week = today.isoweekday()  # 1=Pzt, 7=Paz
    
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute(
            '''SELECT r.id, r.name, r.period, r.icon, r.duration_minutes, r.active_days, r.sort_order,
                      CASE WHEN rc.id IS NOT NULL THEN 1 ELSE 0 END as completed
               FROM routines r
               LEFT JOIN routine_completions rc ON r.id = rc.routine_id AND rc.completion_date = ?
               WHERE r.is_active = 1
               ORDER BY r.period, r.sort_order''',
            (today_str,)
        )
        results = []
        for r in cursor.fetchall():
            active_days = [int(d) for d in r[5].split(',') if d.strip()]
            if day_of_week in active_days:
                results.append({
                    "id": r[0], "name": r[1], "period": r[2], "icon": r[3],
                    "duration_minutes": r[4], "sort_order": r[6], "completed": bool(r[7])
                })
    return results


def get_all_routines():
    """Tüm rutinleri döndürür (düzenleme için)."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute(
            'SELECT id, name, period, icon, duration_minutes, active_days, sort_order, is_active FROM routines ORDER BY period, sort_order'
        )
        return [{
            "id": r[0], "name": r[1], "period": r[2], "icon": r[3],
            "duration_minutes": r[4], "active_days": r[5], "sort_order": r[6], "is_active": bool(r[7])
        } for r in cursor.fetchall()]


def complete_routine(routine_id, date_str=None):
    """Rutini tamamlanmış olarak işaretler."""
    if date_str is None:
        date_str = datetime.now().strftime("%Y-%m-%d")
    with _connect() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute('INSERT INTO routine_completions (routine_id, completion_date) VALUES (?, ?)',
                           (routine_id, date_str))
            conn.commit()
        except sqlite3.IntegrityError:
            pass
    return True


def uncomplete_routine(routine_id, date_str=None):
    """Rutin tamamlanma kaydını siler."""
    if date_str is None:
        date_str = datetime.now().strftime("%Y-%m-%d")
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM routine_completions WHERE routine_id = ? AND completion_date = ?',
                       (routine_id, date_str))
        conn.commit()
    return True


def get_routine_completion_rate(period=None, date_str=None):
    """Belirli bir dönem veya günün rutin tamamlanma oranını hesaplar."""
    if date_str is None:
        date_str = datetime.now().strftime("%Y-%m-%d")
    day_of_week = datetime.strptime(date_str, "%Y-%m-%d").isoweekday()
    
    with _connect() as conn:
        cursor = conn.cursor()
        query = 'SELECT id, active_days, period FROM routines WHERE is_active = 1'
        params = []
        if period:
            query += ' AND period = ?'
            params.append(period)
        cursor.execute(query, params)
        routines = cursor.fetchall()
        
        total = 0
        for r in routines:
            active_days = [int(d) for d in r[1].split(',') if d.strip()]
            if day_of_week in active_days:
                total += 1
        
        if total == 0:
            return {"total": 0, "completed": 0, "rate": 100}
        
        cursor.execute(
            'SELECT COUNT(*) FROM routine_completions WHERE completion_date = ?' +
            (' AND routine_id IN (SELECT id FROM routines WHERE period = ?)' if period else ''),
            (date_str, period) if period else (date_str,)
        )
        completed = cursor.fetchone()[0]
    
    return {"total": total, "completed": completed, "rate": round(completed / total * 100) if total > 0 else 100}


# --- SEANS LOGLAMA + ODAK KALİTESİ ---
def log_session(session_date, subject, planned_minutes, actual_minutes, pause_count,
               longest_uninterrupted_seconds, focus_score=0, session_type='focus',
               task_id=None, routine_id=None, roadmap_topic_id=None,
               started_at=None, ended_at=None):
    """Seans detaylarını kaydeder."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute(
            '''INSERT INTO session_logs (session_date, subject, planned_minutes, actual_minutes,
               pause_count, longest_uninterrupted_seconds, focus_score, session_type,
               task_id, routine_id, roadmap_topic_id, started_at, ended_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (session_date, subject, planned_minutes, actual_minutes,
             pause_count, longest_uninterrupted_seconds, focus_score, session_type,
             task_id, routine_id, roadmap_topic_id, started_at, ended_at)
        )
        if task_id:
            cursor.execute('UPDATE tasks SET actual_minutes=actual_minutes+? WHERE id=?',
                           (max(0, int(actual_minutes or 0)), task_id))
        if roadmap_topic_id:
            cursor.execute('''INSERT INTO roadmap_topic_progress(topic_id, actual_minutes, last_session_date)
                              VALUES (?, ?, ?)
                              ON CONFLICT(topic_id) DO UPDATE SET
                              actual_minutes=actual_minutes+excluded.actual_minutes,
                              last_session_date=excluded.last_session_date''',
                           (roadmap_topic_id, max(0, int(actual_minutes or 0)), session_date))
        conn.commit()
        return cursor.lastrowid


def update_session_score(session_id, focus_score):
    """Seans odak skorunu günceller."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('UPDATE session_logs SET focus_score = ? WHERE id = ?', (focus_score, session_id))
        conn.commit()
    return True


def get_quality_metrics():
    """Tüm zamanların odak kalitesi metriklerini döndürür."""
    with _connect() as conn:
        cursor = conn.cursor()
        
        # En uzun kesintisiz seans (tüm zamanlar)
        cursor.execute('SELECT MAX(longest_uninterrupted_seconds) FROM session_logs')
        longest = cursor.fetchone()[0] or 0
        
        # Ortalama odak skoru (0 olanlar hariç)
        cursor.execute('SELECT AVG(focus_score) FROM session_logs WHERE focus_score > 0')
        avg_score = cursor.fetchone()[0] or 0
        
        # Ortalama durdurma sayısı
        cursor.execute('SELECT AVG(pause_count) FROM session_logs')
        avg_pauses = cursor.fetchone()[0] or 0
        
        # Hedef/Gerçek oranı (timer modundaki seanslar, planned > 0)
        cursor.execute('SELECT SUM(actual_minutes), SUM(planned_minutes) FROM session_logs WHERE planned_minutes > 0')
        result = cursor.fetchone()
        actual_sum = result[0] or 0
        planned_sum = result[1] or 1
        plan_ratio = round(actual_sum / planned_sum * 100) if planned_sum > 0 else 0
    
    return {
        "longest_uninterrupted_seconds": longest,
        "avg_focus_score": round(avg_score, 1),
        "avg_pause_count": round(avg_pauses, 1),
        "plan_vs_actual_pct": plan_ratio
    }


def get_daily_quality_summary(date_str):
    """Belirli bir günün seans detaylarını döndürür."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute(
            '''SELECT SUM(pause_count), MAX(longest_uninterrupted_seconds),
                      AVG(CASE WHEN focus_score > 0 THEN focus_score END),
                      COUNT(*)
               FROM session_logs WHERE session_date = ?''',
            (date_str,)
        )
        r = cursor.fetchone()
    return {
        "total_pauses": r[0] or 0,
        "longest_uninterrupted": r[1] or 0,
        "avg_score": round(r[2], 1) if r[2] else 0,
        "session_count": r[3] or 0
    }


# --- HAFTALIK DEĞERLENDİRME ---
def get_weekly_summary(week_start_str=None):
    """Geçen haftanın özetini döndürür."""
    today = datetime.now().date()
    if week_start_str:
        week_start = datetime.strptime(week_start_str, "%Y-%m-%d").date()
    else:
        week_start = _get_week_start(today) - timedelta(days=7)
    week_end = week_start + timedelta(days=6)
    ws = week_start.strftime("%Y-%m-%d")
    we = week_end.strftime("%Y-%m-%d")
    
    with _connect() as conn:
        cursor = conn.cursor()
        
        # Toplam çalışma
        cursor.execute('SELECT SUM(total_minutes) FROM daily_logs WHERE log_date BETWEEN ? AND ?', (ws, we))
        total_min = cursor.fetchone()[0] or 0
        
        # En iyi gün
        cursor.execute('SELECT log_date, total_minutes FROM daily_logs WHERE log_date BETWEEN ? AND ? ORDER BY total_minutes DESC LIMIT 1', (ws, we))
        best = cursor.fetchone()
        best_day = best[0] if best else None
        best_day_min = best[1] if best else 0
        
        # Odak skoru ortalaması
        cursor.execute('SELECT AVG(focus_score) FROM session_logs WHERE session_date BETWEEN ? AND ? AND focus_score > 0', (ws, we))
        avg_score = cursor.fetchone()[0] or 0
        
        # En uzun kesintisiz
        cursor.execute('SELECT MAX(longest_uninterrupted_seconds) FROM session_logs WHERE session_date BETWEEN ? AND ?', (ws, we))
        longest = cursor.fetchone()[0] or 0
        
        # OFF DAY kullanıldı mı
        cursor.execute('SELECT COUNT(*) FROM off_days WHERE week_start_date = ?', (ws,))
        off_used = cursor.fetchone()[0] > 0
        
        # Rutin tamamlanma oranı
        cursor.execute('SELECT COUNT(*) FROM routine_completions WHERE completion_date BETWEEN ? AND ?', (ws, we))
        routines_done = cursor.fetchone()[0]
    
    return {
        "week_start": ws,
        "total_minutes": total_min,
        "best_day": best_day,
        "best_day_minutes": best_day_min,
        "avg_focus_score": round(avg_score, 1),
        "longest_uninterrupted_seconds": longest,
        "off_day_used": off_used,
        "routines_completed": routines_done
    }


def save_weekly_priorities(week_start_str, priorities):
    """Haftalık öncelikleri kaydeder."""
    if not week_start_str:
        week_start_str = _get_week_start(datetime.now().date()).strftime("%Y-%m-%d")
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM weekly_priorities WHERE week_start_date = ?', (week_start_str,))
        for i, text in enumerate(priorities):
            if text and text.strip():
                cursor.execute('INSERT INTO weekly_priorities (week_start_date, priority_text, sort_order) VALUES (?, ?, ?)',
                               (week_start_str, text.strip(), i))
        conn.commit()
    return True


def get_weekly_priorities(week_start_str=None):
    """Bu haftanın önceliklerini döndürür."""
    if not week_start_str:
        week_start_str = _get_week_start(datetime.now().date()).strftime("%Y-%m-%d")
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT priority_text, sort_order FROM weekly_priorities WHERE week_start_date = ? ORDER BY sort_order',
                       (week_start_str,))
        return [{"text": r[0], "order": r[1]} for r in cursor.fetchall()]


def should_show_weekly_review():
    """Pazartesi günü haftalık değerlendirme gösterilmeli mi?"""
    today = datetime.now().date()
    week_start = _get_week_start(today).strftime("%Y-%m-%d")
    
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) FROM weekly_review_shown WHERE week_start_date = ?', (week_start,))
        already_shown = cursor.fetchone()[0] > 0
    
    return today.weekday() == 0 and not already_shown


def mark_weekly_review_shown():
    """Haftalık değerlendirmenin gösterildiğini kaydeder."""
    week_start = _get_week_start(datetime.now().date()).strftime("%Y-%m-%d")
    with _connect() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute('INSERT INTO weekly_review_shown (week_start_date) VALUES (?)', (week_start,))
            conn.commit()
        except sqlite3.IntegrityError:
            pass
    return True


# --- GÜNLÜK NOT DEFTERİ ---
def save_daily_note(note_date, content):
    """Belirli bir günün notunu kaydeder veya günceller."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute(
            '''INSERT INTO daily_notes (note_date, content, updated_at) 
               VALUES (?, ?, datetime('now'))
               ON CONFLICT(note_date) DO UPDATE SET content = ?, updated_at = datetime('now')''',
            (note_date, content, content)
        )
        conn.commit()


def get_daily_note(note_date):
    """Belirli bir günün notunu getirir."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT content FROM daily_notes WHERE note_date = ?', (note_date,))
        result = cursor.fetchone()
        return result[0] if result else ''


def get_recent_notes(limit=30):
    """Son N günün notlarını döndürür (boş olmayanlar)."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT note_date, content FROM daily_notes WHERE content != '' ORDER BY note_date DESC LIMIT ?",
            (limit,)
        )
        return [{"date": r[0], "content": r[1]} for r in cursor.fetchall()]

# =============================================
# YOL HARİTASI (ROADMAP) İŞLEMLERİ
# =============================================


def get_recent_productive_average(cursor):
    """Son 14 aktif günün ortalama gerçek çalışma dakikası."""
    cursor.execute('''SELECT AVG(total_minutes) FROM (
                      SELECT total_minutes FROM daily_logs
                      WHERE total_minutes > 0 ORDER BY log_date DESC LIMIT 14)''')
    value = cursor.fetchone()[0]
    return float(value or 0)

# --- PROGRAM CRUD ---
def add_roadmap_program(name, icon='📚'):
    """Yeni ana program ekler."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM roadmap_programs')
        next_order = cursor.fetchone()[0]
        cursor.execute(
            'INSERT INTO roadmap_programs (name, icon, sort_order) VALUES (?, ?, ?)',
            (name, icon, next_order)
        )
        conn.commit()
        return cursor.lastrowid


def update_roadmap_program(program_id, name, icon):
    """Program adını ve ikonunu günceller."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('UPDATE roadmap_programs SET name=?, icon=? WHERE id=?',
                       (name, icon, program_id))
        conn.commit()
    return True


def delete_roadmap_program(program_id):
    """Programı ve tüm alt öğelerini siler."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('PRAGMA foreign_keys = ON')
        # Get subprogram ids, then phase ids, then topic ids for cleanup
        cursor.execute('SELECT id FROM roadmap_subprograms WHERE program_id=?', (program_id,))
        sub_ids = [r[0] for r in cursor.fetchall()]
        for sub_id in sub_ids:
            cursor.execute('SELECT id FROM roadmap_phases WHERE subprogram_id=?', (sub_id,))
            phase_ids = [r[0] for r in cursor.fetchall()]
            for phase_id in phase_ids:
                cursor.execute('DELETE FROM roadmap_completions WHERE topic_id IN (SELECT id FROM roadmap_topics WHERE phase_id=?)', (phase_id,))
                cursor.execute('DELETE FROM roadmap_topics WHERE phase_id=?', (phase_id,))
            cursor.execute('DELETE FROM roadmap_phases WHERE subprogram_id=?', (sub_id,))
        cursor.execute('DELETE FROM roadmap_subprograms WHERE program_id=?', (program_id,))
        cursor.execute('DELETE FROM roadmap_programs WHERE id=?', (program_id,))
        conn.commit()
    return True


def get_roadmap_programs():
    """Tüm programları ilerleme yüzdeleriyle döndürür."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id, name, icon, sort_order FROM roadmap_programs ORDER BY sort_order, id')
        programs = []
        for r in cursor.fetchall():
            prog = {"id": r[0], "name": r[1], "icon": r[2], "sort_order": r[3]}
            # Yüzde hesapla
            cursor.execute('''
                SELECT COUNT(*), SUM(CASE WHEN t.is_completed = 1 THEN 1 ELSE 0 END)
                FROM roadmap_topics t
                JOIN roadmap_phases p ON t.phase_id = p.id
                JOIN roadmap_subprograms s ON p.subprogram_id = s.id
                WHERE s.program_id = ?
            ''', (r[0],))
            counts = cursor.fetchone()
            total = counts[0] or 0
            done = counts[1] or 0
            prog["total_topics"] = total
            prog["completed_topics"] = done
            prog["progress_pct"] = round(done / total * 100) if total > 0 else 0
            programs.append(prog)
        return programs


def reorder_roadmap_programs(program_ids):
    """Ana programları verilen kimlik sırasına göre kalıcı olarak sıralar."""
    try:
        ordered_ids = [int(program_id) for program_id in program_ids]
    except (TypeError, ValueError):
        return False

    if len(ordered_ids) != len(set(ordered_ids)):
        return False

    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM roadmap_programs')
        existing_ids = {row[0] for row in cursor.fetchall()}

        # Eksik/fazladan kimlikle kısmi bir sıralamanın veriyi bozmasına izin verme.
        if set(ordered_ids) != existing_ids:
            return False

        cursor.executemany(
            'UPDATE roadmap_programs SET sort_order=? WHERE id=?',
            [(sort_order, program_id) for sort_order, program_id in enumerate(ordered_ids, start=1)]
        )
        conn.commit()
    return True


def import_roadmap_outline(name, subprograms, icon='⚡'):
    """Ayrıştırılmış yol haritası ağacını tek transaction içinde kaydeder."""
    program_name = str(name or '').strip()[:200]
    if not program_name:
        raise ValueError('Yol haritası adı boş olamaz.')
    if not isinstance(subprograms, list) or not subprograms:
        raise ValueError('En az bir alt program gerekli.')
    if len(subprograms) > 100:
        raise ValueError('Tek seferde en fazla 100 alt program eklenebilir.')

    normalized = []
    phase_count = 0
    topic_count = 0
    for subprogram in subprograms:
        if not isinstance(subprogram, dict):
            raise ValueError('Alt program biçimi geçersiz.')
        sub_name = str(subprogram.get('name') or '').strip()[:250]
        phases = subprogram.get('phases')
        if not sub_name or not isinstance(phases, list) or not phases:
            raise ValueError('Her alt programın adı ve en az bir fazı olmalı.')
        if len(phases) > 500:
            raise ValueError('Bir alt programda en fazla 500 faz olabilir.')

        normalized_phases = []
        for phase in phases:
            if not isinstance(phase, dict):
                raise ValueError('Faz biçimi geçersiz.')
            phase_name = str(phase.get('name') or '').strip()[:250]
            topics = phase.get('topics')
            if not phase_name or not isinstance(topics, list) or not topics:
                raise ValueError('Her fazın adı ve en az bir konusu olmalı.')
            if len(topics) > 1000:
                raise ValueError('Bir fazda en fazla 1000 konu olabilir.')

            normalized_topics = []
            for topic in topics:
                if isinstance(topic, str):
                    topic = {'title': topic, 'description': ''}
                if not isinstance(topic, dict):
                    raise ValueError('Konu biçimi geçersiz.')
                title = str(topic.get('title') or '').strip()[:500]
                description = str(topic.get('description') or '').strip()[:4000]
                if not title:
                    raise ValueError('Konu başlığı boş olamaz.')
                normalized_topics.append((title, description))
                topic_count += 1

            normalized_phases.append((phase_name, normalized_topics))
            phase_count += 1
        normalized.append((sub_name, str(subprogram.get('icon') or '📂')[:8], normalized_phases))

    if topic_count > 5000:
        raise ValueError('Tek seferde en fazla 5000 konu eklenebilir.')

    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM roadmap_programs')
        program_order = cursor.fetchone()[0]
        cursor.execute(
            'INSERT INTO roadmap_programs (name, icon, sort_order) VALUES (?, ?, ?)',
            (program_name, str(icon or '⚡')[:8], program_order)
        )
        program_id = cursor.lastrowid

        for sub_order, (sub_name, sub_icon, phases) in enumerate(normalized, start=1):
            cursor.execute(
                '''INSERT INTO roadmap_subprograms (program_id, name, icon, sort_order)
                   VALUES (?, ?, ?, ?)''',
                (program_id, sub_name, sub_icon, sub_order)
            )
            subprogram_id = cursor.lastrowid
            for phase_order, (phase_name, topics) in enumerate(phases, start=1):
                cursor.execute(
                    '''INSERT INTO roadmap_phases (subprogram_id, name, sort_order)
                       VALUES (?, ?, ?)''',
                    (subprogram_id, phase_name, phase_order)
                )
                phase_id = cursor.lastrowid
                cursor.executemany(
                    '''INSERT INTO roadmap_topics
                       (phase_id, title, description, estimated_minutes, priority,
                        difficulty, sort_order)
                       VALUES (?, ?, ?, 60, 2, 3, ?)''',
                    [(phase_id, title, description, topic_order)
                     for topic_order, (title, description) in enumerate(topics, start=1)]
                )
        conn.commit()

    return {
        'success': True,
        'program_id': program_id,
        'subprogram_count': len(normalized),
        'phase_count': phase_count,
        'topic_count': topic_count,
    }


# --- ALT PROGRAM CRUD ---
def add_roadmap_subprogram(program_id, name, icon='📂'):
    """Yeni alt program ekler."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM roadmap_subprograms WHERE program_id=?', (program_id,))
        next_order = cursor.fetchone()[0]
        cursor.execute(
            'INSERT INTO roadmap_subprograms (program_id, name, icon, sort_order) VALUES (?, ?, ?, ?)',
            (program_id, name, icon, next_order)
        )
        conn.commit()
        return cursor.lastrowid


def update_roadmap_subprogram(sub_id, name, icon):
    """Alt program günceller."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('UPDATE roadmap_subprograms SET name=?, icon=? WHERE id=?',
                       (name, icon, sub_id))
        conn.commit()
    return True


def delete_roadmap_subprogram(sub_id):
    """Alt programı ve tüm alt öğelerini siler."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM roadmap_phases WHERE subprogram_id=?', (sub_id,))
        phase_ids = [r[0] for r in cursor.fetchall()]
        for phase_id in phase_ids:
            cursor.execute('DELETE FROM roadmap_completions WHERE topic_id IN (SELECT id FROM roadmap_topics WHERE phase_id=?)', (phase_id,))
            cursor.execute('DELETE FROM roadmap_topics WHERE phase_id=?', (phase_id,))
        cursor.execute('DELETE FROM roadmap_phases WHERE subprogram_id=?', (sub_id,))
        cursor.execute('DELETE FROM roadmap_subprograms WHERE id=?', (sub_id,))
        conn.commit()
    return True


def get_roadmap_subprograms(program_id):
    """Bir programın alt programlarını ilerleme yüzdeleriyle döndürür."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id, name, icon, sort_order FROM roadmap_subprograms WHERE program_id=? ORDER BY sort_order', (program_id,))
        subs = []
        for r in cursor.fetchall():
            sub = {"id": r[0], "name": r[1], "icon": r[2], "sort_order": r[3], "program_id": program_id}
            cursor.execute('''
                SELECT COUNT(*), SUM(CASE WHEN t.is_completed = 1 THEN 1 ELSE 0 END)
                FROM roadmap_topics t
                JOIN roadmap_phases p ON t.phase_id = p.id
                WHERE p.subprogram_id = ?
            ''', (r[0],))
            counts = cursor.fetchone()
            total = counts[0] or 0
            done = counts[1] or 0
            sub["total_topics"] = total
            sub["completed_topics"] = done
            sub["progress_pct"] = round(done / total * 100) if total > 0 else 0
            subs.append(sub)
        return subs


# --- FAZ CRUD ---
def add_roadmap_phase(subprogram_id, name):
    """Yeni faz ekler."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM roadmap_phases WHERE subprogram_id=?', (subprogram_id,))
        next_order = cursor.fetchone()[0]
        cursor.execute(
            'INSERT INTO roadmap_phases (subprogram_id, name, sort_order) VALUES (?, ?, ?)',
            (subprogram_id, name, next_order)
        )
        conn.commit()
        return cursor.lastrowid


def update_roadmap_phase(phase_id, name):
    """Faz adını günceller."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('UPDATE roadmap_phases SET name=? WHERE id=?', (name, phase_id))
        conn.commit()
    return True


def delete_roadmap_phase(phase_id):
    """Fazı ve konularını siler."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM roadmap_completions WHERE topic_id IN (SELECT id FROM roadmap_topics WHERE phase_id=?)', (phase_id,))
        cursor.execute('DELETE FROM roadmap_topics WHERE phase_id=?', (phase_id,))
        cursor.execute('DELETE FROM roadmap_phases WHERE id=?', (phase_id,))
        conn.commit()
    return True


def get_roadmap_phases(subprogram_id):
    """Bir alt programın fazlarını ilerleme yüzdeleriyle döndürür."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id, name, sort_order FROM roadmap_phases WHERE subprogram_id=? ORDER BY sort_order', (subprogram_id,))
        phases = []
        for r in cursor.fetchall():
            phase = {"id": r[0], "name": r[1], "sort_order": r[2], "subprogram_id": subprogram_id}
            cursor.execute('''
                SELECT COUNT(*), SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END)
                FROM roadmap_topics WHERE phase_id = ?
            ''', (r[0],))
            counts = cursor.fetchone()
            total = counts[0] or 0
            done = counts[1] or 0
            phase["total_topics"] = total
            phase["completed_topics"] = done
            phase["progress_pct"] = round(done / total * 100) if total > 0 else 0
            phases.append(phase)
        return phases


# --- KONU CRUD ---
def add_roadmap_topic(phase_id, title, description='', estimated_minutes=60, due_date=None,
                      priority=2, difficulty=3):
    """Yeni konu ekler."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM roadmap_topics WHERE phase_id=?', (phase_id,))
        next_order = cursor.fetchone()[0]
        cursor.execute(
            '''INSERT INTO roadmap_topics
               (phase_id, title, description, sort_order, estimated_minutes, due_date, priority, difficulty)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
            (phase_id, title, description, next_order, max(1, int(estimated_minutes or 60)),
             due_date or None, int(priority or 2), int(difficulty or 3))
        )
        conn.commit()
        return cursor.lastrowid


def update_roadmap_topic(topic_id, title, description='', estimated_minutes=60, due_date=None,
                         priority=2, difficulty=3):
    """Konu başlığını ve açıklamasını günceller."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('''UPDATE roadmap_topics SET title=?, description=?, estimated_minutes=?,
                          due_date=?, priority=?, difficulty=? WHERE id=?''',
                       (title, description, max(1, int(estimated_minutes or 60)), due_date or None,
                        int(priority or 2), int(difficulty or 3), topic_id))
        conn.commit()
    return True


def delete_roadmap_topic(topic_id):
    """Konuyu ve tamamlanma loglarını siler."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM roadmap_completions WHERE topic_id=?', (topic_id,))
        cursor.execute('DELETE FROM roadmap_topics WHERE id=?', (topic_id,))
        conn.commit()
    return True


def toggle_roadmap_topic(topic_id):
    """Konunun tamamlanma durumunu değiştirir. Streak'e bağlantı kurar."""
    today = datetime.now().strftime("%Y-%m-%d")
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT is_completed, title FROM roadmap_topics WHERE id=?', (topic_id,))
        row = cursor.fetchone()
        if not row:
            return {"success": False}
        
        was_completed = bool(row[0])
        topic_title = row[1]
        new_state = not was_completed
        
        if new_state:
            # Tamamlandı olarak işaretle
            cursor.execute('UPDATE roadmap_topics SET is_completed=1, completed_at=datetime("now") WHERE id=?', (topic_id,))
            # Tamamlanma logu ekle
            cursor.execute('INSERT INTO roadmap_completions (topic_id, completion_date) VALUES (?, ?)',
                           (topic_id, today))
        else:
            # Tamamlanmayı geri al
            cursor.execute('UPDATE roadmap_topics SET is_completed=0, completed_at=NULL WHERE id=?', (topic_id,))
            cursor.execute('DELETE FROM roadmap_completions WHERE topic_id=?', (topic_id,))
        
        conn.commit()
        return {"success": True, "completed": new_state, "title": topic_title}


def get_roadmap_topics(phase_id):
    """Bir fazın konularını döndürür."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute(
            '''SELECT t.id, t.title, t.description, t.is_completed, t.sort_order, t.completed_at,
                      t.estimated_minutes, t.due_date, t.priority, t.difficulty,
                      COALESCE(p.actual_minutes, 0)
               FROM roadmap_topics t
               LEFT JOIN roadmap_topic_progress p ON p.topic_id=t.id
               WHERE t.phase_id=? ORDER BY t.sort_order''',
            (phase_id,)
        )
        return [{
            "id": r[0], "title": r[1], "description": r[2],
            "completed": bool(r[3]), "sort_order": r[4],
            "completed_at": r[5], "estimated_minutes": r[6] or 60, "due_date": r[7],
            "priority": r[8] or 2, "difficulty": r[9] or 3, "actual_minutes": r[10] or 0,
            "phase_id": phase_id
        } for r in cursor.fetchall()]


# --- TAM AĞAÇ GETİRME ---
def get_full_roadmap(program_id):
    """Bir programın tüm hiyerarşisini derinlemesine getirir."""
    with _connect() as conn:
        cursor = conn.cursor()
        
        # Program bilgisi
        cursor.execute('SELECT id, name, icon FROM roadmap_programs WHERE id=?', (program_id,))
        prog_row = cursor.fetchone()
        if not prog_row:
            return None
        
        program = {"id": prog_row[0], "name": prog_row[1], "icon": prog_row[2], "subprograms": []}
        
        # Alt programlar
        cursor.execute('SELECT id, name, icon, sort_order FROM roadmap_subprograms WHERE program_id=? ORDER BY sort_order', (program_id,))
        for sub_row in cursor.fetchall():
            sub = {"id": sub_row[0], "name": sub_row[1], "icon": sub_row[2], "sort_order": sub_row[3], "phases": []}
            
            # Fazlar
            cursor.execute('SELECT id, name, sort_order FROM roadmap_phases WHERE subprogram_id=? ORDER BY sort_order', (sub_row[0],))
            for phase_row in cursor.fetchall():
                phase = {"id": phase_row[0], "name": phase_row[1], "sort_order": phase_row[2], "topics": []}
                
                # Konular
                cursor.execute(
                    '''SELECT t.id, t.title, t.description, t.is_completed, t.sort_order, t.completed_at,
                              t.estimated_minutes, t.due_date, t.priority, t.difficulty,
                              COALESCE(rp.actual_minutes, 0)
                       FROM roadmap_topics t
                       LEFT JOIN roadmap_topic_progress rp ON rp.topic_id=t.id
                       WHERE t.phase_id=? ORDER BY t.sort_order''',
                    (phase_row[0],)
                )
                for t in cursor.fetchall():
                    phase["topics"].append({
                        "id": t[0], "title": t[1], "description": t[2],
                        "completed": bool(t[3]), "sort_order": t[4], "completed_at": t[5],
                        "estimated_minutes": t[6] or 60, "due_date": t[7],
                        "priority": t[8] or 2, "difficulty": t[9] or 3,
                        "actual_minutes": t[10] or 0, "phase_id": phase_row[0]
                    })
                
                total = len(phase["topics"])
                done = sum(1 for t in phase["topics"] if t["completed"])
                phase["total_topics"] = total
                phase["completed_topics"] = done
                phase["progress_pct"] = round(done / total * 100) if total > 0 else 0
                sub["phases"].append(phase)
            
            # Alt program yüzdesi
            sub_total = sum(p["total_topics"] for p in sub["phases"])
            sub_done = sum(p["completed_topics"] for p in sub["phases"])
            sub["total_topics"] = sub_total
            sub["completed_topics"] = sub_done
            sub["progress_pct"] = round(sub_done / sub_total * 100) if sub_total > 0 else 0
            program["subprograms"].append(sub)
        
        # Program yüzdesi
        prog_total = sum(s["total_topics"] for s in program["subprograms"])
        prog_done = sum(s["completed_topics"] for s in program["subprograms"])
        program["total_topics"] = prog_total
        program["completed_topics"] = prog_done
        program["progress_pct"] = round(prog_done / prog_total * 100) if prog_total > 0 else 0
        all_topics = [t for s in program["subprograms"] for p in s["phases"] for t in p["topics"]]
        program["estimated_minutes"] = sum(t["estimated_minutes"] for t in all_topics)
        program["actual_minutes"] = sum(t["actual_minutes"] for t in all_topics)
        remaining = sum(t["estimated_minutes"] for t in all_topics if not t["completed"])
        recent_daily = get_recent_productive_average(cursor)
        program["projected_days"] = round(remaining / recent_daily) if recent_daily > 0 and remaining > 0 else 0
        
        return program


def get_roadmap_stats(program_id):
    """Bir programın genel ilerleme istatistiklerini döndürür."""
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT COUNT(*), SUM(CASE WHEN t.is_completed = 1 THEN 1 ELSE 0 END)
            FROM roadmap_topics t
            JOIN roadmap_phases p ON t.phase_id = p.id
            JOIN roadmap_subprograms s ON p.subprogram_id = s.id
            WHERE s.program_id = ?
        ''', (program_id,))
        counts = cursor.fetchone()
        total = counts[0] or 0
        done = counts[1] or 0
        
        # Bugün tamamlanan konu sayısı
        today = datetime.now().strftime("%Y-%m-%d")
        cursor.execute('''
            SELECT COUNT(*) FROM roadmap_completions rc
            JOIN roadmap_topics t ON rc.topic_id = t.id
            JOIN roadmap_phases p ON t.phase_id = p.id
            JOIN roadmap_subprograms s ON p.subprogram_id = s.id
            WHERE s.program_id = ? AND rc.completion_date = ?
        ''', (program_id, today))
        today_done = cursor.fetchone()[0] or 0
        
        return {
            "total_topics": total,
            "completed_topics": done,
            "progress_pct": round(done / total * 100) if total > 0 else 0,
            "today_completed": today_done
        }


# =============================================
# KALICI ODAK OTURUMU
# =============================================

def save_focus_session_state(state):
    """Aktif sayacı kapanma/çökme sonrasında geri yüklenebilmesi için kaydeder."""
    values = (
        str(state.get('mode', 'timer')),
        max(1, int(state.get('total_seconds', 1500))),
        str(state.get('subject', '') or ''),
        state.get('task_id'), state.get('routine_id'), state.get('roadmap_topic_id'),
        int(bool(state.get('is_running'))), int(bool(state.get('is_paused'))),
        int(state.get('start_timestamp', 0) or 0), int(state.get('pause_timestamp', 0) or 0),
        int(state.get('total_paused_ms', 0) or 0), int(state.get('user_pause_count', 0) or 0),
        int(state.get('current_block_start', 0) or 0), int(state.get('longest_block_ms', 0) or 0)
    )
    with _connect() as conn:
        conn.execute('''INSERT INTO focus_session_state
            (id, mode, total_seconds, subject, task_id, routine_id, roadmap_topic_id,
             is_running, is_paused, start_timestamp, pause_timestamp, total_paused_ms,
             user_pause_count, current_block_start, longest_block_ms, updated_at)
            VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(id) DO UPDATE SET
             mode=excluded.mode, total_seconds=excluded.total_seconds, subject=excluded.subject,
             task_id=excluded.task_id, routine_id=excluded.routine_id,
             roadmap_topic_id=excluded.roadmap_topic_id, is_running=excluded.is_running,
             is_paused=excluded.is_paused, start_timestamp=excluded.start_timestamp,
             pause_timestamp=excluded.pause_timestamp, total_paused_ms=excluded.total_paused_ms,
             user_pause_count=excluded.user_pause_count,
             current_block_start=excluded.current_block_start,
             longest_block_ms=excluded.longest_block_ms, updated_at=datetime('now')''', values)
        conn.commit()
    set_setting('focus_runtime_active', '1' if state.get('is_running') and not state.get('is_paused') else '0')
    return True


def get_focus_session_state():
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute('SELECT * FROM focus_session_state WHERE id=1').fetchone()
        return dict(row) if row else None


def clear_focus_session_state():
    with _connect() as conn:
        conn.execute('DELETE FROM focus_session_state WHERE id=1')
        conn.commit()
    set_setting('focus_runtime_active', '0')
    return True


# =============================================
# AYARLAR VE DİKKAT PROFİLLERİ
# =============================================

def set_setting(key, value):
    with _connect() as conn:
        conn.execute('''INSERT INTO app_settings(setting_key, setting_value) VALUES (?, ?)
                        ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value''',
                     (str(key), str(value)))
        if key == 'daily_target_minutes':
            # Yeni hedef bugünden itibaren geçerli; önceki günler eski hedefle değerlendirilir.
            conn.execute('''INSERT INTO daily_targets(effective_date, target_minutes) VALUES (?, ?)
                            ON CONFLICT(effective_date) DO UPDATE SET target_minutes=excluded.target_minutes''',
                         (datetime.now().strftime("%Y-%m-%d"), max(1, int(value))))
        conn.commit()
    return True


def get_setting(key, default=None):
    with _connect() as conn:
        row = conn.execute('SELECT setting_value FROM app_settings WHERE setting_key=?', (key,)).fetchone()
        return row[0] if row else default


def get_focus_profiles():
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('''SELECT p.id, p.name, p.grace_seconds, p.enforce_only_during_focus,
                                 p.checkin_interval_minutes, COALESCE(p.pause_on_windows_lock, 1),
                                 p.is_active, COUNT(a.app_name)
                          FROM focus_profiles p LEFT JOIN focus_profile_apps a ON a.profile_id=p.id
                          GROUP BY p.id ORDER BY p.id''')
        return [{"id": r[0], "name": r[1], "grace_seconds": r[2],
                 "enforce_only_during_focus": bool(r[3]), "checkin_interval_minutes": r[4],
                 "pause_on_windows_lock": bool(r[5]), "active": bool(r[6]),
                 "app_count": r[7]} for r in cursor.fetchall()]


def add_focus_profile(name, grace_seconds=120, enforce_only_during_focus=True,
                      checkin_interval_minutes=10, pause_on_windows_lock=True):
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('''INSERT INTO focus_profiles
                          (name, grace_seconds, enforce_only_during_focus,
                           checkin_interval_minutes, pause_on_windows_lock)
                          VALUES (?, ?, ?, ?, ?)''',
                       (name.strip(), max(0, int(grace_seconds)), int(bool(enforce_only_during_focus)),
                        max(0, int(checkin_interval_minutes)), int(bool(pause_on_windows_lock))))
        conn.commit()
        return cursor.lastrowid


def update_focus_profile(profile_id, grace_seconds, enforce_only_during_focus,
                         checkin_interval_minutes, pause_on_windows_lock=True):
    with _connect() as conn:
        conn.execute('''UPDATE focus_profiles SET grace_seconds=?, enforce_only_during_focus=?,
                        checkin_interval_minutes=?, pause_on_windows_lock=? WHERE id=?''',
                     (max(0, int(grace_seconds)), int(bool(enforce_only_during_focus)),
                      max(0, int(checkin_interval_minutes)), int(bool(pause_on_windows_lock)),
                      profile_id))
        conn.commit()
    return True


def should_pause_on_windows_lock():
    """Aktif profilin Windows kilidinde sayacı duraklatıp duraklatmayacağını döndürür."""
    with _connect() as conn:
        row = conn.execute('''SELECT COALESCE(pause_on_windows_lock, 1) FROM focus_profiles
                              WHERE is_active=1 LIMIT 1''').fetchone()
        return True if row is None else bool(row[0])


def activate_focus_profile(profile_id):
    with _connect() as conn:
        conn.execute('UPDATE focus_profiles SET is_active=0')
        conn.execute('UPDATE focus_profiles SET is_active=1 WHERE id=?', (profile_id,))
        conn.commit()
    return True


def get_active_profile_apps():
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('''SELECT a.app_name, COALESCE(a.display_name, a.app_name)
                          FROM focus_profile_apps a JOIN focus_profiles p ON p.id=a.profile_id
                          WHERE p.is_active=1 ORDER BY a.app_name''')
        return [{"app": r[0], "display": r[1]} for r in cursor.fetchall()]


def add_app_to_active_profile(app_name, display_name=None):
    app_name = os.path.basename(str(app_name)).lower()
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM focus_profiles WHERE is_active=1 LIMIT 1')
        row = cursor.fetchone()
        if not row:
            return False
        cursor.execute('''INSERT INTO focus_profile_apps(profile_id, app_name, display_name)
                          VALUES (?, ?, ?) ON CONFLICT(profile_id, app_name) DO UPDATE SET
                          display_name=excluded.display_name''',
                       (row[0], app_name, display_name or app_name))
        conn.commit()
    return True


def remove_app_from_active_profile(app_name):
    with _connect() as conn:
        conn.execute('''DELETE FROM focus_profile_apps WHERE app_name=? AND profile_id IN
                        (SELECT id FROM focus_profiles WHERE is_active=1)''', (app_name,))
        conn.commit()
    return True


def get_enforcement_config():
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('''SELECT id, name, grace_seconds, enforce_only_during_focus,
                                 checkin_interval_minutes, COALESCE(pause_on_windows_lock, 1)
                          FROM focus_profiles
                          WHERE is_active=1 LIMIT 1''')
        profile = cursor.fetchone()
        runtime = get_setting('focus_runtime_active', '0') == '1'
        if not profile:
            return {"enabled": False, "apps": [], "grace_seconds": 120,
                    "focus_runtime_active": runtime}
        apps = [item["app"] for item in get_active_profile_apps()]
        enabled = bool(apps) and (runtime or not bool(profile[3])) and profile[1] != 'Serbest Zaman'
        return {"enabled": enabled, "profile_id": profile[0], "profile_name": profile[1],
                "grace_seconds": max(1, int(profile[2] or 120)),
                "enforce_only_during_focus": bool(profile[3]),
                "checkin_interval_minutes": profile[4], "focus_runtime_active": runtime,
                "pause_on_windows_lock": bool(profile[5]),
                "apps": apps}


# =============================================
# HAFTALIK PLAN VE YOL HARİTASI BAĞLANTISI
# =============================================

def add_planner_item(title, planned_date, duration_minutes=45, priority=2,
                     source_type='manual', source_id=None):
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT COALESCE(MAX(sort_order), 0)+1 FROM planner_items WHERE planned_date=?',
                       (planned_date,))
        order = cursor.fetchone()[0]
        cursor.execute('''INSERT INTO planner_items
                          (title, planned_date, duration_minutes, priority, source_type, source_id, sort_order)
                          VALUES (?, ?, ?, ?, ?, ?, ?)''',
                       (title.strip(), planned_date, max(1, int(duration_minutes)), int(priority),
                        source_type, source_id, order))
        conn.commit()
        return cursor.lastrowid


def get_planner_items(date_from=None, date_to=None):
    today = datetime.now().date()
    if not date_from:
        date_from = _get_week_start(today).strftime('%Y-%m-%d')
    if not date_to:
        date_to = (_get_week_start(today) + timedelta(days=6)).strftime('%Y-%m-%d')
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('''SELECT id, title, planned_date, duration_minutes, priority,
                                 source_type, source_id, status, sort_order
                          FROM planner_items WHERE planned_date BETWEEN ? AND ?
                          ORDER BY planned_date, priority, sort_order''', (date_from, date_to))
        return [{"id": r[0], "title": r[1], "planned_date": r[2], "duration_minutes": r[3],
                 "priority": r[4], "source_type": r[5], "source_id": r[6],
                 "status": r[7], "sort_order": r[8]} for r in cursor.fetchall()]


def schedule_roadmap_topic(topic_id, planned_date, duration_minutes=None, priority=None):
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT title, estimated_minutes, priority, due_date FROM roadmap_topics WHERE id=?',
                       (topic_id,))
        row = cursor.fetchone()
        if not row:
            return None
        duration = max(1, int(duration_minutes or row[1] or 60))
        task_priority = int(priority or row[2] or 2)
        cursor.execute('''SELECT id FROM tasks WHERE roadmap_topic_id=? AND status IN ('waiting','active')
                          LIMIT 1''', (topic_id,))
        existing = cursor.fetchone()
        if existing:
            task_id = existing[0]
            cursor.execute('''UPDATE tasks SET planned_date=?, duration_minutes=?, priority=? WHERE id=?''',
                           (planned_date, duration, task_priority, task_id))
        else:
            cursor.execute('''INSERT INTO tasks
                              (subject, duration_minutes, status, priority, planned_date, due_date, roadmap_topic_id)
                              VALUES (?, ?, 'waiting', ?, ?, ?, ?)''',
                           (row[0], duration, task_priority, planned_date, row[3], topic_id))
            task_id = cursor.lastrowid
        cursor.execute('DELETE FROM planner_items WHERE source_type="roadmap" AND source_id=?', (topic_id,))
        cursor.execute('''INSERT INTO planner_items
                          (title, planned_date, duration_minutes, priority, source_type, source_id)
                          VALUES (?, ?, ?, ?, 'roadmap', ?)''',
                       (row[0], planned_date, duration, task_priority, topic_id))
        planner_item_id = cursor.lastrowid
        cursor.execute('UPDATE tasks SET planner_item_id=? WHERE id=?', (planner_item_id, task_id))
        conn.commit()
        return task_id


def update_planner_item(item_id, planned_date=None, status=None, sort_order=None):
    fields, params = [], []
    for name, value in (("planned_date", planned_date), ("status", status), ("sort_order", sort_order)):
        if value is not None:
            fields.append(f"{name}=?")
            params.append(value)
    if not fields:
        return True
    params.append(item_id)
    with _connect() as conn:
        conn.execute(f"UPDATE planner_items SET {', '.join(fields)} WHERE id=?", params)
        if planned_date is not None:
            conn.execute('UPDATE tasks SET planned_date=? WHERE planner_item_id=? AND status!="completed"',
                         (planned_date, item_id))
        if status == 'done':
            conn.execute('UPDATE tasks SET status="completed", is_completed=1 WHERE planner_item_id=?', (item_id,))
        elif status == 'planned':
            conn.execute('UPDATE tasks SET status="waiting", is_completed=0 WHERE planner_item_id=?', (item_id,))
        conn.commit()
    return True


def delete_planner_item(item_id):
    with _connect() as conn:
        conn.execute('DELETE FROM tasks WHERE planner_item_id=? AND status!="completed"', (item_id,))
        conn.execute('DELETE FROM planner_items WHERE id=?', (item_id,))
        conn.commit()
    return True


# =============================================
# GÜN SONU VE GELİŞMİŞ DİSİPLİN METRİKLERİ
# =============================================

def close_day_review(wins='', blockers='', tomorrow_first_task='', carry_task_ids=None):
    today = datetime.now().date()
    tomorrow = (today + timedelta(days=1)).strftime('%Y-%m-%d')
    carry_ids = [int(i) for i in (carry_task_ids or [])]
    total = get_today_stats()
    with _connect() as conn:
        cursor = conn.cursor()
        for task_id in carry_ids:
            cursor.execute('''UPDATE tasks SET status='waiting', planned_date=?, fake_deadline=NULL,
                              deadline_paused_at=NULL, deadline_remaining_seconds=NULL
                              WHERE id=? AND status!='completed' ''', (tomorrow, task_id))
            cursor.execute('''UPDATE planner_items SET planned_date=?, status='planned' WHERE id IN
                              (SELECT planner_item_id FROM tasks WHERE id=?)''', (tomorrow, task_id))
        cursor.execute('''INSERT INTO day_reviews
                          (review_date, wins, blockers, tomorrow_first_task, carried_task_ids, total_minutes, closed_at)
                          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                          ON CONFLICT(review_date) DO UPDATE SET wins=excluded.wins,
                          blockers=excluded.blockers, tomorrow_first_task=excluded.tomorrow_first_task,
                          carried_task_ids=excluded.carried_task_ids, total_minutes=excluded.total_minutes,
                          closed_at=datetime('now')''',
                       (today.strftime('%Y-%m-%d'), wins, blockers, tomorrow_first_task,
                        json.dumps(carry_ids), total))
        conn.commit()
    return {"success": True, "total_minutes": total, "carried": len(carry_ids),
            "tomorrow": tomorrow}


def get_day_close_context():
    today = datetime.now().strftime('%Y-%m-%d')
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('''SELECT id, subject, duration_minutes, status FROM tasks
                          WHERE status IN ('waiting','active') AND
                          (planned_date IS NULL OR planned_date<=?) ORDER BY priority, created_at''', (today,))
        tasks = [{"id": r[0], "subject": r[1], "minutes": r[2], "status": r[3]}
                 for r in cursor.fetchall()]
        cursor.execute('SELECT wins, blockers, tomorrow_first_task FROM day_reviews WHERE review_date=?', (today,))
        review = cursor.fetchone()
    return {"today": today, "total_minutes": get_today_stats(), "unfinished_tasks": tasks,
            "review": {"wins": review[0], "blockers": review[1], "tomorrow_first_task": review[2]}
                      if review else None}


def get_discipline_dashboard():
    today = datetime.now().date()
    week_start = _get_week_start(today).strftime('%Y-%m-%d')
    week_end = (_get_week_start(today) + timedelta(days=6)).strftime('%Y-%m-%d')
    with _connect() as conn:
        cursor = conn.cursor()
        cursor.execute('''SELECT COUNT(*), SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END)
                          FROM tasks WHERE planned_date BETWEEN ? AND ?''', (week_start, week_end))
        planned, completed = cursor.fetchone()
        cursor.execute('''SELECT COUNT(*), COALESCE(SUM(actual_minutes),0),
                                 COALESCE(SUM(pause_count),0),
                                 COALESCE(AVG(CASE WHEN focus_score>0 THEN focus_score END),0)
                          FROM session_logs WHERE session_date BETWEEN ? AND ?''', (week_start, week_end))
        sessions, actual, pauses, avg_score = cursor.fetchone()
        cursor.execute('SELECT COUNT(*) FROM routine_completions WHERE completion_date BETWEEN ? AND ?',
                       (week_start, week_end))
        routine_done = cursor.fetchone()[0]
        cursor.execute('SELECT COUNT(*) FROM roadmap_completions WHERE completion_date BETWEEN ? AND ?',
                       (week_start, week_end))
        roadmap_done = cursor.fetchone()[0]
    planned = planned or 0
    completed = completed or 0
    adherence = round(completed / planned * 100) if planned else 0
    return {"week_start": week_start, "plan_adherence_pct": adherence,
            "planned_tasks": planned, "completed_tasks": completed,
            "sessions": sessions or 0, "actual_minutes": actual or 0,
            "pause_per_session": round((pauses or 0) / sessions, 1) if sessions else 0,
            "avg_focus_score": round(avg_score or 0, 1), "routines_completed": routine_done,
            "roadmap_topics_completed": roadmap_done,
            "daily_target_minutes": int(get_setting('daily_target_minutes', '60') or 60)}


# =============================================
# YEDEKLEME VE DIŞA AKTARMA
# =============================================

def create_backup(label='manual'):
    backup_dir = DATA_DIR / 'backups'
    backup_dir.mkdir(parents=True, exist_ok=True)
    safe_label = ''.join(ch for ch in str(label) if ch.isalnum() or ch in ('-', '_'))[:30] or 'manual'
    target = backup_dir / f"FocusOS_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{safe_label}.db"
    with _connect() as source, _connect(str(target)) as dest:
        source.backup(dest)
    return {"success": True, "name": target.name, "path": str(target)}


def list_backups():
    backup_dir = DATA_DIR / 'backups'
    if not backup_dir.exists():
        return []
    return [{"name": p.name, "size": p.stat().st_size,
             "modified": datetime.fromtimestamp(p.stat().st_mtime).isoformat(timespec='seconds')}
            for p in sorted(backup_dir.glob('FocusOS_*.db'), key=lambda x: x.stat().st_mtime, reverse=True)]


def restore_backup(backup_name):
    backup_dir = (DATA_DIR / 'backups').resolve()
    source_path = (backup_dir / os.path.basename(str(backup_name))).resolve()
    if source_path.parent != backup_dir or not source_path.exists():
        return {"success": False, "message": "Yedek bulunamadı."}
    safety = create_backup('before_restore')
    with _connect(str(source_path)) as source, _connect() as dest:
        source.backup(dest)
    init_db()
    return {"success": True, "message": "Yedek geri yüklendi.", "safety_backup": safety["name"]}


def export_all_data():
    export_dir = DATA_DIR / 'exports'
    export_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    json_path = export_dir / f'FocusOS_export_{stamp}.json'
    csv_path = export_dir / f'FocusOS_sessions_{stamp}.csv'
    tables = ['tasks', 'daily_logs', 'subject_logs', 'session_logs', 'routines',
              'routine_completions', 'roadmap_programs', 'roadmap_subprograms',
              'roadmap_phases', 'roadmap_topics', 'planner_items', 'day_reviews']
    payload = {"exported_at": datetime.now().isoformat(timespec='seconds'), "tables": {}}
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        for table in tables:
            payload["tables"][table] = [dict(row) for row in conn.execute(f'SELECT * FROM {table}')]
        sessions = payload["tables"]["session_logs"]
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    headers = list(sessions[0].keys()) if sessions else ['id', 'session_date', 'subject', 'actual_minutes']
    with csv_path.open('w', encoding='utf-8-sig', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=headers, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(sessions)
    return {"success": True, "json_path": str(json_path), "csv_path": str(csv_path)}


if __name__ == "__main__":
    init_db()
    print("Sistem Hafızası (guardian.db) tüm tablolarıyla başarıyla oluşturuldu!")
