import eel
import threading
import time
from datetime import datetime, timedelta
import database
from guardian import ProcessGuardian

# Web klasörünü sisteme tanıtıyoruz
eel.init('web')

guardian = ProcessGuardian()

# --- BEKLEME ODASI & SAHTE DEADLİNE ---
@eel.expose
def setup_task(subject, minutes):
    """Görev oluşturur ama 'waiting' statüsünde bırakır (Bekleme Odası)."""
    if subject and str(minutes).isdigit() and int(minutes) > 0:
        task_id = database.add_task(subject, int(minutes))
        return database.get_waiting_tasks()
    return None

@eel.expose
def activate_task(task_id):
    """Bekleme Odasından aktife alır, deadline hesaplanır."""
    result = database.activate_task(task_id)
    return result

@eel.expose
def get_waiting_tasks():
    """Bekleyen görevleri UI'a döndürür."""
    return database.get_waiting_tasks()

@eel.expose
def get_active_deadlines():
    """Aktif sahte deadline'ları döndürür."""
    return database.get_active_tasks()

@eel.expose
def complete_task(task_id):
    """Görevi tamamlandı işaretler."""
    database.complete_task(task_id)
    return True

@eel.expose
def delete_task(task_id):
    """Görevi siler."""
    database.delete_task(task_id)
    return True

# --- KARA LİSTE (BLACKLIST) ---
@eel.expose
def add_blacklisted_app_direct(app_name):
    """HTML dosya seçiciden gelen .exe adını veritabanına kaydeder."""
    database.add_to_blacklist(app_name.lower())
    return database.get_blacklist()

@eel.expose
def get_blacklist_apps():
    return database.get_blacklist()

@eel.expose
def remove_blacklisted_app(app_name):
    database.remove_from_blacklist(app_name)
    return database.get_blacklist()

@eel.expose
def rename_blacklisted_app(app_name, new_name):
    """Kara listedeki uygulamanın görünen adını değiştirir."""
    database.rename_blacklist_app(app_name, new_name)
    return True

@eel.expose
def get_blacklist_with_display():
    """UI için display_name dahil kara listeyi döndürür."""
    return database.get_blacklist_with_display()

@eel.expose
def get_live_blacklist_status():
    """Canlı Radar için açık ve kapalı uygulamaların durumunu döndürür."""
    live_active = guardian.get_live_status()
    all_blacklisted = database.get_blacklist_with_display()
    result = []
    for item in all_blacklisted:
        app = item["app"]
        display = item["display"]
        if app in live_active:
            result.append({"app": app, "display": display, "status": "Açık", "time_left": live_active[app]})
        else:
            result.append({"app": app, "display": display, "status": "Kapalı", "time_left": 0})
    return result

# --- GRAFİK & İSTATİSTİK ---
@eel.expose
def get_weekly_chart_data():
    """Arayüzdeki sarı dalgalı grafiğe verileri gönderir."""
    return database.get_weekly_stats()

@eel.expose
def log_study_time(minutes):
    """Kronometre durdurulduğunda çalışılan süreyi bugünün hesabına yazar."""
    if minutes > 0:
        database.log_study_time(minutes)
    return database.get_today_stats()

@eel.expose
def get_app_usage_report():
    """Günün ekran süresi verilerini UI'a gönderir."""
    return database.get_today_app_usage()

@eel.expose
def get_today_stats():
    """Bugünkü toplam mesaiyi getirir."""
    return database.get_today_stats()

@eel.expose
def get_all_daily_logs():
    """Tüm zamanların çalışma loglarını döndürür."""
    return database.get_all_daily_logs()

# --- DERS PROGRAMI ---
@eel.expose
def save_schedule(schedule_data):
    """Haftalık ders programını kaydeder ve otomatik bekleme odasına görev ekler."""
    created = database.save_schedule_and_create_tasks(schedule_data)
    return {"success": True, "created_tasks": created}

@eel.expose
def get_today_schedule():
    """Bugünkü dersleri döndürür (sistem saatinden)."""
    today_dow = datetime.now().weekday()  # 0=Pazartesi
    return database.get_schedule_for_day(today_dow)

@eel.expose
def get_full_schedule():
    """Tüm haftalık programı döndürür."""
    return database.get_full_schedule()

# --- AKILLI TEKRAR ---
@eel.expose
def apply_repeat_strategy(strategy):
    """'daily', 'spaced', 'none' stratejilerinden birini uygular."""
    today_dow = datetime.now().weekday()
    lessons = database.get_schedule_for_day(today_dow)
    lesson_names = [l['name'] for l in lessons]
    lesson_durations = {l['name']: l.get('hours', 0) * 60 + l.get('minutes', 0) for l in lessons}
    if not lesson_names:
        return {"success": False, "message": "Bugün için ders bulunamadı."}
    
    if strategy == 'daily':
        added = database.generate_daily_repeat(lesson_names)
        return {"success": True, "added": added, "message": f"{len(added)} tekrar görevi eklendi."}
    elif strategy == 'spaced':
        added = database.generate_spaced_repetition(lesson_names)
        return {"success": True, "added": added, "message": f"{len(added)} tekrar görevi (1-3-7 gün) eklendi."}
    else:
        return {"success": True, "added": [], "message": "Manuel mod seçildi."}

@eel.expose
def get_todays_smart_tasks():
    """Bugünkü akıllı tekrar görevlerini döndürür."""
    return database.get_todays_smart_tasks()

@eel.expose
def complete_smart_task(task_id):
    """Tekrar görevini tamamlar."""
    database.complete_smart_task(task_id)
    return True

@eel.expose
def add_manual_smart_task(lesson_name, duration_minutes):
    """Manuel akıllı tekrar görevi ekler."""
    today = datetime.now().strftime("%Y-%m-%d")
    tid = database.add_smart_task(lesson_name, today, duration_minutes, 'manual')
    return tid

# --- GÜNÜ KAPAT PROTOKOLÜ ---
@eel.expose
def end_day_protocol():
    """Günü kapatır, özet bilgi döndürür."""
    total = database.get_today_stats()
    app_usage = database.get_today_app_usage()
    return {
        "total_minutes": total,
        "app_usage": app_usage
    }

# --- ARKA PLAN DÖNGÜSÜ ---
def guardian_loop():
    """Arka planda uyarıları tarayıp UI'a gönderen sonsuz döngü"""
    while True:
        alerts = guardian.scan_and_enforce()
        if alerts:
            try:
                eel.show_alerts(alerts)()
            except:
                pass
        time.sleep(1)

# Gardiyanı ayrı bir iş parçacığında (thread) başlat ki ekranı dondurmasın
threading.Thread(target=guardian_loop, daemon=True).start()

# Veritabanını kontrol et ve arayüzü ateşle!
database.init_db()
eel.start('index.html', size=(1200, 800), mode='chrome', port=0)