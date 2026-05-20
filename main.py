"""
Focus OS — Ana Modül (pywebview motor)
=======================================
Eel yerine pywebview kullanarak native Windows penceresi açar.
Tüm Python ↔ JS iletişimi pywebview API sınıfı üzerinden yapılır.

Yeni özellikler:
  - Kilit Ekranında Otomatik Duraklatma (SessionMonitor)
  - El Sallama (Check-in) Modu (CheckinManager)
"""

import webview
import threading
import time
import sys
from datetime import datetime, timedelta
from pathlib import Path
import database
from guardian import ProcessGuardian
from session_monitor import SessionMonitor
from checkin import CheckinManager

# --- Modül örnekleri ---
guardian = ProcessGuardian()
session_monitor = SessionMonitor()
checkin_manager = CheckinManager(interval_seconds=600, response_timeout=25)

# pywebview penceresi (start() sonrası atanır)
_window = None


def resource_path(relative_path):
    """Resolve files both from source and from a PyInstaller bundle."""
    if hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS) / relative_path
    return Path(__file__).resolve().parent / relative_path


class FocusAPI:
    """
    pywebview tarafından JS'e açılan tüm Python metotları.
    JS tarafında: window.pywebview.api.method_name(args)
    """

    # =======================================
    # BEKLEME ODASI & SAHTE DEADLİNE
    # =======================================
    
    def setup_task(self, subject, minutes):
        """Görev oluşturur ama 'waiting' statüsünde bırakır (Bekleme Odası)."""
        if subject and str(minutes).isdigit() and int(minutes) > 0:
            task_id = database.add_task(subject, int(minutes))
            return database.get_waiting_tasks()
        return None

    def activate_task(self, task_id):
        """Bekleme Odasından aktife alır, deadline hesaplanır."""
        return database.activate_task(task_id)

    def get_waiting_tasks(self):
        """Bekleyen görevleri UI'a döndürür."""
        return database.get_waiting_tasks()

    def get_active_deadlines(self):
        """Aktif sahte deadline'ları döndürür."""
        return database.get_active_tasks()

    def complete_task(self, task_id):
        """Görevi tamamlandı işaretler."""
        database.complete_task(task_id)
        return True

    def delete_task(self, task_id):
        """Görevi siler."""
        database.delete_task(task_id)
        return True

    # =======================================
    # KARA LİSTE (BLACKLIST)
    # =======================================
    
    def add_blacklisted_app_direct(self, app_name):
        """HTML dosya seçiciden gelen .exe adını veritabanına kaydeder."""
        database.add_to_blacklist(app_name.lower())
        return database.get_blacklist()

    def get_blacklist_apps(self):
        return database.get_blacklist()

    def remove_blacklisted_app(self, app_name):
        database.remove_from_blacklist(app_name)
        return database.get_blacklist()

    def rename_blacklisted_app(self, app_name, new_name):
        """Kara listedeki uygulamanın görünen adını değiştirir."""
        database.rename_blacklist_app(app_name, new_name)
        return True

    def get_blacklist_with_display(self):
        """UI için display_name dahil kara listeyi döndürür."""
        return database.get_blacklist_with_display()

    def get_live_blacklist_status(self):
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

    # =======================================
    # GRAFİK & İSTATİSTİK
    # =======================================
    
    def get_weekly_chart_data(self):
        """Arayüzdeki sarı dalgalı grafiğe verileri gönderir."""
        return database.get_weekly_stats()

    def log_study_time(self, minutes):
        """Kronometre durdurulduğunda çalışılan süreyi bugünün hesabına yazar."""
        if minutes > 0:
            database.log_study_time(minutes)
        return database.get_today_stats()

    def get_app_usage_report(self):
        """Günün ekran süresi verilerini UI'a gönderir."""
        return database.get_today_app_usage()

    def get_today_stats(self):
        """Bugünkü toplam mesaiyi getirir."""
        return database.get_today_stats()

    def get_all_daily_logs(self):
        """Tüm zamanların çalışma loglarını döndürür."""
        return database.get_all_daily_logs()

    # =======================================
    # DERS PROGRAMI
    # =======================================
    
    def save_schedule(self, schedule_data):
        """Haftalık ders programını kaydeder ve otomatik bekleme odasına görev ekler."""
        created = database.save_schedule_and_create_tasks(schedule_data)
        return {"success": True, "created_tasks": created}

    def get_today_schedule(self):
        """Bugünkü dersleri döndürür (sistem saatinden)."""
        today_dow = datetime.now().weekday()
        return database.get_schedule_for_day(today_dow)

    def get_full_schedule(self):
        """Tüm haftalık programı döndürür."""
        return database.get_full_schedule()

    # =======================================
    # AKILLI TEKRAR
    # =======================================
    
    def apply_repeat_strategy(self, strategy):
        """'daily', 'spaced', 'none' stratejilerinden birini uygular."""
        today_dow = datetime.now().weekday()
        lessons = database.get_schedule_for_day(today_dow)
        lesson_names = [l['name'] for l in lessons]
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

    def get_todays_smart_tasks(self):
        """Bugünkü akıllı tekrar görevlerini döndürür."""
        return database.get_todays_smart_tasks()

    def complete_smart_task(self, task_id):
        """Tekrar görevini tamamlar."""
        database.complete_smart_task(task_id)
        return True

    def add_manual_smart_task(self, lesson_name, duration_minutes):
        """Manuel akıllı tekrar görevi ekler."""
        today = datetime.now().strftime("%Y-%m-%d")
        tid = database.add_smart_task(lesson_name, today, duration_minutes, 'manual')
        return tid

    # =======================================
    # GÜNÜ KAPAT PROTOKOLÜ
    # =======================================
    
    def end_day_protocol(self):
        """Günü kapatır, özet bilgi döndürür."""
        total = database.get_today_stats()
        app_usage = database.get_today_app_usage()
        return {
            "total_minutes": total,
            "app_usage": app_usage
        }

    # =======================================
    # ÖZELLİK 1: KİLİT EKRANI OTOMATİK DURAKLATMA
    # =======================================
    
    def get_session_status(self):
        """Oturum durumunu döndürür (kilitli mi, ne kadar süredir kilitli)."""
        return {
            "is_locked": session_monitor._lock_time is not None,
            "lock_duration": session_monitor.lock_duration_seconds
        }

    # =======================================
    # ÖZELLİK 2: EL SALLAMA (CHECK-IN) MODU
    # =======================================
    
    def toggle_checkin_mode(self):
        """Check-in modunu açar/kapatır. Mevcut durumun tersini uygular."""
        if checkin_manager.is_active:
            checkin_manager.stop()
            return {"active": False, "message": "El Sallama modu kapatıldı."}
        else:
            checkin_manager.start()
            return {"active": True, "message": "El Sallama modu açıldı."}

    def get_checkin_status(self):
        """Check-in modunun durumunu döndürür."""
        return {
            "active": checkin_manager.is_active,
            "waiting_response": checkin_manager.is_waiting_response
        }

    def checkin_confirm(self):
        """Kullanıcı 'Evet, çalışıyorum' dediğinde."""
        checkin_manager.confirm()
        return True

    def checkin_decline(self):
        """Kullanıcı 'Hayır' dediğinde."""
        checkin_manager.decline()
        return True


# =======================================
# ARKA PLAN DÖNGÜSÜ: Gardiyan
# =======================================

def guardian_loop():
    """Arka planda uyarıları tarayıp UI'a gönderen sonsuz döngü."""
    global _window
    while True:
        alerts = guardian.scan_and_enforce()
        if alerts and _window:
            try:
                _window.evaluate_js(f"showAlertsFromPython({_js_serialize(alerts)})")
            except Exception:
                pass
        time.sleep(1)


# =======================================
# OTURUM MONİTÖRÜ CALLBACK'LERİ
# =======================================

def _on_session_lock():
    """Oturum kilitlendiğinde çalışır — aktif sayacı duraklatır."""
    global _window
    if _window:
        try:
            _window.evaluate_js("pauseFromBackend('lock')")
        except Exception as e:
            print(f"[Main] JS pauseFromBackend hatası: {e}")


def _on_session_unlock():
    """Oturum açıldığında çalışır — bilgi gönderir."""
    global _window
    if _window:
        try:
            _window.evaluate_js("resumeFromBackend('unlock')")
        except Exception as e:
            print(f"[Main] JS resumeFromBackend hatası: {e}")


def _on_system_sleep():
    """Sistem uykuya geçtiğinde çalışır — aktif sayacı duraklatır."""
    global _window
    if _window:
        try:
            _window.evaluate_js("pauseFromBackend('sleep')")
        except Exception as e:
            print(f"[Main] JS pauseFromBackend hatası: {e}")


def _on_system_wake():
    """Sistem uyandığında çalışır — bilgi gönderir."""
    global _window
    if _window:
        try:
            _window.evaluate_js("resumeFromBackend('wake')")
        except Exception as e:
            print(f"[Main] JS resumeFromBackend hatası: {e}")


# =======================================
# CHECK-IN CALLBACK'LERİ
# =======================================

def _on_checkin_prompt():
    """Check-in sorusu sorulacağında — JS overlay'i göster."""
    global _window
    if _window:
        try:
            _window.evaluate_js("showCheckinPrompt()")
        except Exception as e:
            print(f"[Main] JS showCheckinPrompt hatası: {e}")


def _on_checkin_timeout():
    """Check-in zaman aşımı — sayacı duraklat."""
    global _window
    if _window:
        try:
            _window.evaluate_js("pauseFromBackend('checkin_timeout')")
        except Exception as e:
            print(f"[Main] JS pauseFromBackend hatası: {e}")


def _on_checkin_confirmed():
    """Check-in onaylandı — overlay'i kapat."""
    global _window
    if _window:
        try:
            _window.evaluate_js("hideCheckinPrompt()")
        except Exception as e:
            print(f"[Main] JS hideCheckinPrompt hatası: {e}")


# =======================================
# YARDIMCI FONKSIYONLAR
# =======================================

def _js_serialize(obj):
    """Python nesnesini JS-uyumlu JSON stringine çevirir."""
    import json
    return json.dumps(obj, ensure_ascii=False)


def _on_window_loaded():
    """Pencere yüklendiğinde arka plan servislerini başlatır."""
    global _window
    print("[Main] Pencere yüklendi, servisler başlatılıyor...")
    
    # Gardiyan thread'ini başlat
    threading.Thread(target=guardian_loop, daemon=True).start()
    
    # Oturum monitörünü kur ve başlat
    session_monitor.on_lock = _on_session_lock
    session_monitor.on_unlock = _on_session_unlock
    session_monitor.on_sleep = _on_system_sleep
    session_monitor.on_wake = _on_system_wake
    session_monitor.start()
    
    # Check-in callback'lerini kur (mod varsayılan kapalı, kullanıcı açacak)
    checkin_manager.on_checkin_prompt = _on_checkin_prompt
    checkin_manager.on_timeout = _on_checkin_timeout
    checkin_manager.on_confirmed = _on_checkin_confirmed


# =======================================
# ANA GİRİŞ NOKTASI
# =======================================

if __name__ == "__main__":
    # Veritabanını hazırla
    database.init_db()
    print(f"[Main] Database path: {database.get_db_path()}")
    
    # pywebview API sınıfı
    api = FocusAPI()
    index_file = resource_path("web/index.html")
    
    # Pencere oluştur
    _window = webview.create_window(
        title="Focus OS - Focus Studio",
        url=index_file.as_uri(),
        js_api=api,
        width=1200,
        height=800,
        min_size=(900, 600),
        background_color="#f5f7f4",
        text_select=False
    )
    
    # Pencere yüklendiğinde arka plan servislerini başlat
    webview.start(
        _on_window_loaded,
        debug=False,
        gui="edgechromium"  # Windows'ta EdgeWebView2 kullan
    )
