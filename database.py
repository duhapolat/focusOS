import sqlite3
from datetime import datetime, timedelta

DB_NAME = "guardian.db"

def init_db():
    """Veritabanını ve tabloları güvenli bir şekilde oluşturur."""
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
        cursor = conn.cursor()
        
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
        
        conn.commit()

# --- GÖREV (TASK) İŞLEMLERİ ---
def add_task(subject, duration_minutes):
    """Görevi 'waiting' (bekleme) durumunda oluşturur."""
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO tasks (subject, duration_minutes, status) VALUES (?, ?, ?)',
            (subject, duration_minutes, 'waiting')
        )
        conn.commit()
        return cursor.lastrowid

def activate_task(task_id):
    """Bekleyen görevi aktife alır ve deadline hesaplar."""
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
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
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, subject, duration_minutes FROM tasks WHERE status = 'waiting' ORDER BY created_at DESC")
        return [{"id": r[0], "subject": r[1], "minutes": r[2]} for r in cursor.fetchall()]

def get_active_tasks():
    """Aktif deadline'ları listeler."""
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, subject, fake_deadline FROM tasks WHERE status = 'active' ORDER BY fake_deadline ASC")
        results = []
        for r in cursor.fetchall():
            try:
                dl = datetime.strptime(r[2], "%Y-%m-%d %H:%M:%S")
                results.append({"id": r[0], "subject": r[1], "deadline_ts": dl.timestamp() * 1000})
            except:
                pass
        return results

def complete_task(task_id):
    """Görevi tamamlandı işaretler."""
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
        conn.cursor().execute("UPDATE tasks SET status = 'completed', is_completed = 1 WHERE id = ?", (task_id,))
        conn.commit()

def delete_task(task_id):
    """Görevi siler."""
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
        conn.cursor().execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.commit()

# --- KARA LİSTE (BLACKLIST) İŞLEMLERİ ---
def get_blacklist():
    """Process tarama için sadece app_name listesi döndürür."""
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT app_name FROM blacklist')
        return [row[0] for row in cursor.fetchall()]

def get_blacklist_with_display():
    """UI için app_name + display_name döndürür."""
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT app_name, display_name FROM blacklist')
        return [{"app": r[0], "display": r[1] or r[0]} for r in cursor.fetchall()]

def add_to_blacklist(app_name):
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
        try:
            conn.cursor().execute('INSERT INTO blacklist (app_name, display_name) VALUES (?, ?)', (app_name, app_name))
            conn.commit()
        except sqlite3.IntegrityError:
            pass 

def remove_from_blacklist(app_name):
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
        conn.cursor().execute('DELETE FROM blacklist WHERE app_name = ?', (app_name,))
        conn.commit()

def rename_blacklist_app(app_name, new_display_name):
    """Kara listedeki uygulamanın görünen adını değiştirir."""
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
        conn.cursor().execute('UPDATE blacklist SET display_name = ? WHERE app_name = ?', (new_display_name, app_name))
        conn.commit()

# --- İSTATİSTİK VE GRAFİK İŞLEMLERİ ---
def log_study_time(minutes):
    today = datetime.now().strftime("%Y-%m-%d")
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
        cursor = conn.cursor()
        cursor.execute('INSERT OR IGNORE INTO daily_logs (log_date, total_minutes) VALUES (?, 0)', (today,))
        cursor.execute('UPDATE daily_logs SET total_minutes = total_minutes + ? WHERE log_date = ?', (minutes, today))
        conn.commit()

def get_today_stats():
    today = datetime.now().strftime("%Y-%m-%d")
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT total_minutes FROM daily_logs WHERE log_date = ?', (today,))
        result = cursor.fetchone()
        return result[0] if result else 0

def get_weekly_stats():
    """Son 7 günün çalışma dakikalarını grafik için çeker."""
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
        cursor = conn.cursor()
        cursor.execute('''
            SELECT log_date, total_minutes 
            FROM daily_logs 
            ORDER BY log_date DESC LIMIT 7
        ''')
        return cursor.fetchall()  

def get_all_daily_logs():
    """İlk günden beri tüm günlük çalışma loglarını döndürür."""
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT log_date, total_minutes FROM daily_logs ORDER BY log_date DESC')
        return [{"date": r[0], "minutes": r[1]} for r in cursor.fetchall()]

# --- EKRAN SÜRESİ (APP USAGE) İŞLEMLERİ ---
def log_app_usage(app_name, seconds):
    today = datetime.now().strftime("%Y-%m-%d")
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
        cursor = conn.cursor()
        cursor.execute('INSERT OR IGNORE INTO app_usage (log_date, app_name, total_seconds) VALUES (?, ?, 0)', (today, app_name))
        cursor.execute('UPDATE app_usage SET total_seconds = total_seconds + ? WHERE log_date = ? AND app_name = ?', (seconds, today, app_name))
        conn.commit()

def get_today_app_usage():
    today = datetime.now().strftime("%Y-%m-%d")
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT app_name, total_seconds FROM app_usage WHERE log_date = ? ORDER BY total_seconds DESC', (today,))
        return [{"app": row[0], "seconds": row[1]} for row in cursor.fetchall()]

# --- HAFTALIK DERS PROGRAMI ---
def save_schedule(entries):
    """Tüm programı sıfırlayıp yeniden yazar. entries = [{ day, name, hours, minutes }, ...]"""
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM weekly_schedule')
        for e in entries:
            cursor.execute(
                'INSERT INTO weekly_schedule (day_of_week, lesson_name, duration_hours, duration_minutes) VALUES (?, ?, ?, ?)',
                (e['day'], e['name'], e.get('hours', 0), e.get('minutes', 0))
            )
        conn.commit()

def save_schedule_and_create_tasks(entries):
    """Ders programını kaydeder VE her dersi otomatik bekleme odasına ekler (#6)."""
    save_schedule(entries)
    # Her giriş için bekleme odasına görev oluştur
    created_tasks = []
    for e in entries:
        total_mins = e.get('hours', 0) * 60 + e.get('minutes', 0)
        if total_mins > 0 and e.get('name', '').strip():
            task_id = add_task(e['name'].strip(), total_mins)
            created_tasks.append({"id": task_id, "subject": e['name'], "minutes": total_mins})
    return created_tasks

def get_schedule_for_day(day_of_week):
    """O günün derslerini getirir."""
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
        cursor = conn.cursor()
        cursor.execute(
            'SELECT id, lesson_name, duration_hours, duration_minutes FROM weekly_schedule WHERE day_of_week = ? ORDER BY id',
            (day_of_week,)
        )
        return [{"id": r[0], "name": r[1], "hours": r[2], "minutes": r[3]} for r in cursor.fetchall()]

def get_full_schedule():
    """Tüm haftalık programı döndürür."""
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
        cursor = conn.cursor()
        cursor.execute('SELECT id, day_of_week, lesson_name, duration_hours, duration_minutes FROM weekly_schedule ORDER BY day_of_week, id')
        return [{"id": r[0], "day": r[1], "name": r[2], "hours": r[3], "minutes": r[4]} for r in cursor.fetchall()]

# --- AKILLI TEKRAR GÖREVLERİ ---
def add_smart_task(lesson_name, scheduled_date, duration_minutes=45, source='manual'):
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO smart_tasks (lesson_name, scheduled_date, duration_minutes, source) VALUES (?, ?, ?, ?)',
            (lesson_name, scheduled_date, duration_minutes, source)
        )
        conn.commit()
        return cursor.lastrowid

def get_todays_smart_tasks():
    today = datetime.now().strftime("%Y-%m-%d")
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
        cursor = conn.cursor()
        cursor.execute(
            'SELECT id, lesson_name, duration_minutes, is_completed, source FROM smart_tasks WHERE scheduled_date = ? ORDER BY id',
            (today,)
        )
        return [{"id": r[0], "lesson": r[1], "minutes": r[2], "completed": bool(r[3]), "source": r[4]} for r in cursor.fetchall()]

def complete_smart_task(task_id):
    with sqlite3.connect(DB_NAME, timeout=10) as conn:
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

if __name__ == "__main__":
    init_db()
    print("Sistem Hafızası (guardian.db) tüm tablolarıyla başarıyla oluşturuldu!")