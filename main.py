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
checkin_manager = CheckinManager(interval_seconds=600, response_timeout=10)

# pywebview penceresi (start() sonrası atanır)
_window = None
_session_lock_pause_requested = False
_session_lock_started_ms = 0


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
    
    def setup_task(self, subject, minutes, priority=2, planned_date=None,
                   due_date=None, roadmap_topic_id=None):
        """Görev oluşturur ama 'waiting' statüsünde bırakır (Bekleme Odası)."""
        if subject and str(minutes).isdigit() and int(minutes) > 0:
            task_id = database.add_task(subject.strip(), int(minutes), int(priority or 2),
                                        planned_date or None, due_date or None, roadmap_topic_id)
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

    def complete_task(self, task_id, actual_minutes=0):
        """Görevi tamamlandı işaretler."""
        database.complete_task(task_id, actual_minutes)
        return True

    def set_task_deadline_paused(self, task_id, paused):
        return database.set_task_deadline_paused(task_id, bool(paused))

    def delete_task(self, task_id):
        """Görevi siler."""
        database.delete_task(task_id)
        return True

    # =======================================
    # KARA LİSTE (BLACKLIST)
    # =======================================
    
    def add_blacklisted_app_direct(self, app_name):
        """HTML dosya seçiciden gelen .exe adını veritabanına kaydeder."""
        database.add_app_to_active_profile(app_name.lower())
        return database.get_active_profile_apps()

    def get_blacklist_apps(self):
        return [item["app"] for item in database.get_active_profile_apps()]

    def remove_blacklisted_app(self, app_name):
        database.remove_app_from_active_profile(app_name)
        return [item["app"] for item in database.get_active_profile_apps()]

    def rename_blacklisted_app(self, app_name, new_name):
        """Kara listedeki uygulamanın görünen adını değiştirir."""
        apps = database.get_active_profile_apps()
        database.add_app_to_active_profile(app_name, new_name)
        return True

    def get_blacklist_with_display(self):
        """UI için display_name dahil kara listeyi döndürür."""
        return database.get_active_profile_apps()

    def get_live_blacklist_status(self):
        """Canlı Radar için açık ve kapalı uygulamaların durumunu döndürür."""
        live_active = guardian.get_live_status()
        all_blacklisted = database.get_active_profile_apps()
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

    def get_all_time_stats(self):
        """Tüm zamanların özet istatistiklerini ve detaylı loglarını döndürür."""
        return database.get_all_time_stats()

    def update_daily_log(self, date, minutes):
        """Belirli bir günün çalışma süresini günceller (düzenleme için)."""
        if minutes >= 0:
            database.update_daily_log(date, int(minutes))
        return True

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
        database.ensure_today_schedule_tasks()
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
        configured = database.get_setting('checkin_enabled', '0') == '1'
        if configured:
            database.set_setting('checkin_enabled', '0')
            checkin_manager.stop()
            return {"active": False, "message": "El Sallama modu kapatıldı."}
        else:
            database.set_setting('checkin_enabled', '1')
            if database.get_setting('focus_runtime_active', '0') == '1':
                checkin_manager.start()
            return {"active": True, "message": "El Sallama modu açıldı."}

    def get_checkin_status(self):
        """Check-in modunun durumunu döndürür."""
        return {
            "active": database.get_setting('checkin_enabled', '0') == '1',
            "running": checkin_manager.is_active,
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

    def set_checkin_interval(self, minutes):
        """Check-in aralığını dakika cinsinden ayarlar."""
        if minutes and int(minutes) > 0:
            checkin_manager.interval_seconds = int(minutes) * 60
            database.set_setting('checkin_interval_minutes', int(minutes))
        return True

    def set_focus_runtime(self, active):
        """Gardiyan ve check-in'i gerçek odak durumuna bağlar."""
        is_active = bool(active)
        database.set_setting('focus_runtime_active', '1' if is_active else '0')
        checkin_enabled = database.get_setting('checkin_enabled', '0') == '1'
        if is_active and checkin_enabled:
            checkin_manager.start()
        elif not is_active and checkin_manager.is_active:
            checkin_manager.stop()
        return True

    # =======================================
    # ÖNEMLİ TARİHLER
    # =======================================

    def add_important_date(self, name, date):
        """Önemli tarih/etkinlik ekler."""
        if name and date:
            return database.add_important_date(name.strip(), date)
        return None

    def get_important_dates(self):
        """Tüm önemli tarihleri döndürür."""
        return database.get_important_dates()

    def delete_important_date(self, date_id):
        """Önemli tarihi siler."""
        database.delete_important_date(date_id)
        return True

    # =======================================
    # KONU BAZLI SÜRE TAKİBİ
    # =======================================

    def log_study_time_with_subject(self, minutes, subject, log_date=None):
        """Süreyi hem toplam hem de konu bazında kaydeder.
        log_date: gece yarısını geçen seansların önceki güne düşen kısmı için."""
        if minutes > 0:
            database.log_study_time(minutes, log_date)
            if subject and subject.strip():
                database.log_subject_time(subject.strip(), minutes, log_date)
        return database.get_today_stats()

    def get_subject_logs_for_date(self, date):
        """Belirli bir günün konu bazlı loglarını döndürür."""
        return database.get_subject_logs_for_date(date)

    def get_subject_suggestions(self):
        """Otomatik tamamlama için kayıtlı ders/konu adlarını döndürür."""
        return database.get_subject_suggestions()

    def notify_timer_finished(self, subject=''):
        """Zamanlayıcı süresi dolduğunda Windows bildirimi gösterir."""
        def _notify():
            try:
                from plyer import notification
                label = f"“{subject}” için " if subject else ""
                notification.notify(
                    title="Focus OS — Süre doldu ⏰",
                    message=f"{label}planlanan süre tamamlandı. Kaydetmek için ⏭ ya da ↺ kullan.",
                    app_name="Focus OS",
                    timeout=8,
                )
            except Exception as e:
                print(f"[Main] Süre bildirimi gönderilemedi: {e}")
        threading.Thread(target=_notify, daemon=True).start()
        return True

    # =======================================
    # ÇALIŞMA SERİSİ (STREAK)
    # =======================================

    def get_study_streak(self):
        """Çalışma serisi bilgisini döndürür."""
        return database.get_study_streak()

    # =======================================
    # GÜNLÜK NOT DEFTERİ
    # =======================================

    def save_daily_note(self, note_date, content):
        """Belirli bir günün notunu kaydeder."""
        if note_date:
            database.save_daily_note(note_date, content or '')
        return True

    def get_daily_note(self, note_date):
        """Belirli bir günün notunu getirir."""
        if note_date:
            return database.get_daily_note(note_date)
        return ''

    def get_recent_notes(self):
        """Son 30 günün notlarını döndürür."""
        return database.get_recent_notes(30)

    # =======================================
    # RUTİN SİSTEMİ
    # =======================================

    def add_routine(self, name, period, icon, duration, active_days):
        """Yeni rutin ekler."""
        return database.add_routine(name, period, icon, duration, active_days)

    def update_routine(self, routine_id, name, period, icon, duration, active_days):
        """Rutini günceller."""
        return database.update_routine(routine_id, name, period, icon, duration, active_days)

    def delete_routine(self, routine_id):
        """Rutini siler."""
        return database.delete_routine(routine_id)

    def get_today_routines(self):
        """Bugünün rutinlerini döndürür."""
        return database.get_today_routines()

    def get_all_routines(self):
        """Tüm rutinleri döndürür."""
        return database.get_all_routines()

    def complete_routine(self, routine_id):
        """Rutini tamamlanmış olarak işaretler."""
        return database.complete_routine(routine_id)

    def uncomplete_routine(self, routine_id):
        """Rutin tamamlanma kaydını siler."""
        return database.uncomplete_routine(routine_id)

    # =======================================
    # OFF DAY
    # =======================================

    def use_off_day(self, date_str=None):
        """Bugün (veya son 6 günden biri) için OFF DAY kullanır."""
        return database.use_off_day(date_str or None)

    def get_off_day_status(self):
        """Bu haftanın OFF DAY durumunu döndürür."""
        return database.get_off_day_status()

    # =======================================
    # SEANS LOGLAMA + ODAK KALİTESİ
    # =======================================

    def log_session(self, session_date, subject, planned_minutes, actual_minutes,
                    pause_count, longest_uninterrupted_seconds, focus_score=0, session_type='focus',
                    task_id=None, routine_id=None, roadmap_topic_id=None,
                    started_at=None, ended_at=None):
        """Seans detaylarını kaydeder."""
        return database.log_session(session_date, subject, planned_minutes, actual_minutes,
                                     pause_count, longest_uninterrupted_seconds, focus_score, session_type,
                                     task_id, routine_id, roadmap_topic_id, started_at, ended_at)

    def update_session_score(self, session_id, focus_score):
        """Seans odak skorunu günceller."""
        return database.update_session_score(session_id, focus_score)

    def get_quality_metrics(self):
        """Tüm zamanların kalite metriklerini döndürür."""
        return database.get_quality_metrics()

    def get_daily_quality_summary(self, date):
        """Bir günün seans kalite özetini döndürür."""
        return database.get_daily_quality_summary(date)

    # =======================================
    # HAFTALIK DEĞERLENDİRME
    # =======================================

    def check_weekly_review(self):
        """Haftalık değerlendirme gösterilmeli mi kontrol eder."""
        should_show = database.should_show_weekly_review()
        week_data = database.get_weekly_summary() if should_show else {}
        priorities = database.get_weekly_priorities()
        return {"should_show": should_show, "week_data": week_data, "priorities": priorities}

    def get_weekly_review_data(self):
        """Haftalık değerlendirme verisini döndürür (her zaman erişilebilir)."""
        return {
            "week_data": database.get_weekly_summary(),
            "priorities": database.get_weekly_priorities()
        }

    def save_weekly_priorities(self, priorities):
        """Haftalık öncelikleri kaydeder."""
        return database.save_weekly_priorities(None, priorities)

    def dismiss_weekly_review(self):
        """Haftalık değerlendirmeyi gösterildi olarak işaretler."""
        return database.mark_weekly_review_shown()

    def get_current_priorities(self):
        """Bu haftanın önceliklerini döndürür."""
        return database.get_weekly_priorities()

    # =======================================
    # CHECK-IN POPUP PENCERESİ
    # =======================================

    def checkin_popup_yes(self):
        """Popup'tan 'Evet' yanıtı."""
        checkin_manager.confirm()
        _close_checkin_popup()
        return True

    def checkin_popup_no(self):
        """Popup'tan 'Hayır' yanıtı."""
        checkin_manager.decline()
        _close_checkin_popup()
        return True

    # =======================================
    # YOL HARİTASI (ROADMAP)
    # =======================================

    # --- Program ---
    def add_roadmap_program(self, name, icon='📚'):
        return database.add_roadmap_program(name, icon)

    def update_roadmap_program(self, program_id, name, icon):
        return database.update_roadmap_program(program_id, name, icon)

    def delete_roadmap_program(self, program_id):
        return database.delete_roadmap_program(program_id)

    def get_roadmap_programs(self):
        return database.get_roadmap_programs()

    def reorder_roadmap_programs(self, program_ids):
        return database.reorder_roadmap_programs(program_ids)

    def import_roadmap_outline(self, name, subprograms, icon='⚡'):
        return database.import_roadmap_outline(name, subprograms or [], icon)

    # --- Alt Program ---
    def add_roadmap_subprogram(self, program_id, name, icon='📂'):
        return database.add_roadmap_subprogram(program_id, name, icon)

    def update_roadmap_subprogram(self, sub_id, name, icon):
        return database.update_roadmap_subprogram(sub_id, name, icon)

    def delete_roadmap_subprogram(self, sub_id):
        return database.delete_roadmap_subprogram(sub_id)

    def get_roadmap_subprograms(self, program_id):
        return database.get_roadmap_subprograms(program_id)

    # --- Faz ---
    def add_roadmap_phase(self, subprogram_id, name):
        return database.add_roadmap_phase(subprogram_id, name)

    def update_roadmap_phase(self, phase_id, name):
        return database.update_roadmap_phase(phase_id, name)

    def delete_roadmap_phase(self, phase_id):
        return database.delete_roadmap_phase(phase_id)

    def get_roadmap_phases(self, subprogram_id):
        return database.get_roadmap_phases(subprogram_id)

    # --- Konu ---
    def add_roadmap_topic(self, phase_id, title, description='', estimated_minutes=60,
                          due_date=None, priority=2, difficulty=3):
        return database.add_roadmap_topic(phase_id, title, description, estimated_minutes,
                                          due_date, priority, difficulty)

    def update_roadmap_topic(self, topic_id, title, description='', estimated_minutes=60,
                             due_date=None, priority=2, difficulty=3):
        return database.update_roadmap_topic(topic_id, title, description, estimated_minutes,
                                             due_date, priority, difficulty)

    def delete_roadmap_topic(self, topic_id):
        return database.delete_roadmap_topic(topic_id)

    def toggle_roadmap_topic(self, topic_id):
        return database.toggle_roadmap_topic(topic_id)

    def get_roadmap_topics(self, phase_id):
        return database.get_roadmap_topics(phase_id)

    # --- Tam ağaç ve istatistikler ---
    def get_full_roadmap(self, program_id):
        return database.get_full_roadmap(program_id)

    def get_roadmap_stats(self, program_id):
        return database.get_roadmap_stats(program_id)

    # =======================================
    # KALICI OTURUM
    # =======================================

    def save_focus_session_state(self, state):
        return database.save_focus_session_state(state or {})

    def get_focus_session_state(self):
        return database.get_focus_session_state()

    def clear_focus_session_state(self):
        return database.clear_focus_session_state()

    # =======================================
    # PLANLAYICI VE YOL HARİTASI BAĞLANTISI
    # =======================================

    def get_planner_items(self, date_from=None, date_to=None):
        return database.get_planner_items(date_from, date_to)

    def add_planner_item(self, title, planned_date, duration=45, priority=2):
        if not title or not planned_date:
            return None
        item_id = database.add_planner_item(title, planned_date, duration, priority)
        database.add_task(title.strip(), int(duration), int(priority), planned_date,
                          None, None, item_id)
        return item_id

    def update_planner_item(self, item_id, planned_date=None, status=None, sort_order=None):
        return database.update_planner_item(item_id, planned_date, status, sort_order)

    def delete_planner_item(self, item_id):
        return database.delete_planner_item(item_id)

    def schedule_roadmap_topic(self, topic_id, planned_date, duration=None, priority=None):
        return database.schedule_roadmap_topic(topic_id, planned_date, duration, priority)

    # =======================================
    # GÜN SONU VE DİSİPLİN PANELİ
    # =======================================

    def get_day_close_context(self):
        return database.get_day_close_context()

    def close_day_review(self, wins='', blockers='', tomorrow_first_task='', carry_task_ids=None):
        return database.close_day_review(wins, blockers, tomorrow_first_task, carry_task_ids or [])

    def get_discipline_dashboard(self):
        return database.get_discipline_dashboard()

    def get_app_settings(self):
        return {
            "daily_target_minutes": int(database.get_setting('daily_target_minutes', '60') or 60),
            "user_name": database.get_setting('user_name', 'Kullanıcı'),
            "checkin_enabled": database.get_setting('checkin_enabled', '0') == '1'
        }

    def save_app_settings(self, settings):
        settings = settings or {}
        if 'daily_target_minutes' in settings:
            database.set_setting('daily_target_minutes', max(1, int(settings['daily_target_minutes'])))
        if 'user_name' in settings:
            database.set_setting('user_name', str(settings['user_name']).strip()[:80] or 'Kullanıcı')
        return self.get_app_settings()

    # =======================================
    # DİKKAT PROFİLLERİ
    # =======================================

    def get_focus_profiles(self):
        return database.get_focus_profiles()

    def add_focus_profile(self, name, grace_seconds=120, enforce_only_during_focus=True,
                          checkin_interval_minutes=10, pause_on_windows_lock=True):
        return database.add_focus_profile(name, grace_seconds, enforce_only_during_focus,
                                          checkin_interval_minutes, pause_on_windows_lock)

    def update_focus_profile(self, profile_id, grace_seconds, enforce_only_during_focus,
                             checkin_interval_minutes, pause_on_windows_lock=True):
        return database.update_focus_profile(profile_id, grace_seconds,
                                             enforce_only_during_focus, checkin_interval_minutes,
                                             pause_on_windows_lock)

    def activate_focus_profile(self, profile_id):
        checkin_manager.stop()
        result = database.activate_focus_profile(profile_id)
        config = database.get_enforcement_config()
        checkin_manager.interval_seconds = max(60, int(config.get('checkin_interval_minutes') or 10) * 60)
        return result

    # =======================================
    # YEDEKLEME / DIŞA AKTARMA
    # =======================================

    def create_backup(self, label='manual'):
        return database.create_backup(label)

    def list_backups(self):
        return database.list_backups()

    def restore_backup(self, backup_name):
        return database.restore_backup(backup_name)

    def export_all_data(self):
        return database.export_all_data()


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
    """Oturum kilitlendiğinde aktif profil izin veriyorsa sayacı duraklatır."""
    global _session_lock_pause_requested, _session_lock_started_ms
    if not database.should_pause_on_windows_lock():
        _session_lock_pause_requested = False
        _session_lock_started_ms = 0
        return

    _session_lock_started_ms = int(time.time() * 1000)
    _session_lock_pause_requested = True
    _send_session_pause_to_ui('lock', _session_lock_started_ms)


def _send_session_pause_to_ui(reason, event_timestamp_ms):
    """Duraklatmayı olayın gerçek zaman damgasıyla arayüze iletir."""
    global _window
    if _window:
        try:
            _window.evaluate_js(
                f"pauseFromBackend({_js_serialize(reason)}, {int(event_timestamp_ms)})"
            )
        except Exception as e:
            print(f"[Main] JS pauseFromBackend hatası: {e}")


def _on_session_unlock():
    """Oturum açıldığında kaçırılmış kilit olayını telafi eder."""
    global _window, _session_lock_pause_requested, _session_lock_started_ms
    if _session_lock_pause_requested and _session_lock_started_ms:
        _send_session_pause_to_ui('lock', _session_lock_started_ms)
    _session_lock_pause_requested = False
    _session_lock_started_ms = 0
    if _window:
        try:
            _window.evaluate_js("resumeFromBackend('unlock')")
        except Exception as e:
            print(f"[Main] JS resumeFromBackend hatası: {e}")


def _on_system_sleep():
    """Sistem uykuya geçtiğinde çalışır — aktif sayacı duraklatır."""
    _send_session_pause_to_ui('sleep', int(time.time() * 1000))


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
    """Check-in sorusu sorulacağında — always-on-top popup penceresi aç."""
    _open_checkin_popup()


def _on_checkin_timeout():
    """Check-in zaman aşımı — sayacı duraklat ve popup'u kapat."""
    _close_checkin_popup()
    global _window
    if _window:
        try:
            _window.evaluate_js("pauseFromBackend('checkin_timeout')")
        except Exception as e:
            print(f"[Main] JS pauseFromBackend hatası: {e}")


def _on_checkin_confirmed():
    """Check-in onaylandı — popup'u kapat ve overlay'i gizle."""
    _close_checkin_popup()
    global _window
    if _window:
        try:
            _window.evaluate_js("hideCheckinPrompt()")
        except Exception as e:
            print(f"[Main] JS hideCheckinPrompt hatası: {e}")


# =======================================
# CHECK-IN POPUP PENCERESİ
# =======================================

_checkin_popup = None


def _open_checkin_popup():
    """Always-on-top küçük check-in penceresi açar."""
    global _checkin_popup
    try:
        # Eğer zaten açık bir popup varsa kapat
        if _checkin_popup:
            try:
                _checkin_popup.destroy()
            except Exception:
                pass
            _checkin_popup = None

        popup_html = resource_path("web/checkin_popup.html")
        _checkin_popup = webview.create_window(
            title="Focus OS - Kontrol",
            url=popup_html.as_uri(),
            js_api=FocusAPI(),
            width=380,
            height=240,
            resizable=False,
            on_top=True,
            minimized=False
        )
        print("[Main] Check-in popup açıldı")
    except Exception as e:
        print(f"[Main] Popup açılamadı, fallback overlay kullanılıyor: {e}")
        # Fallback: mevcut overlay sistemini kullan
        if _window:
            try:
                _window.evaluate_js("showCheckinPrompt()")
            except Exception:
                pass


def _close_checkin_popup():
    """Check-in popup penceresini kapatır."""
    global _checkin_popup
    if _checkin_popup:
        try:
            _checkin_popup.destroy()
        except Exception as e:
            print(f"[Main] Popup kapatma hatası: {e}")
        _checkin_popup = None


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
    # Günde bir güvenlik yedeği; kullanıcı verisine dokunmadan geri dönüş noktası sağlar.
    today_prefix = f"FocusOS_{datetime.now().strftime('%Y%m%d')}_"
    if not any(item["name"].startswith(today_prefix) for item in database.list_backups()):
        database.create_backup('startup')
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
        # Ölçekli laptop ekranlarında (örn. 1920×1080 @ %150 = 1280×720) 800px
        # yüksek pencere ekrandan taşıyordu; ekranı dolduracak şekilde açılır.
        maximized=True,
        background_color="#f5f7f4",
        text_select=False
    )
    
    # Pencere yüklendiğinde arka plan servislerini başlat
    webview.start(
        _on_window_loaded,
        debug=False,
        gui="edgechromium"  # Windows'ta EdgeWebView2 kullan
    )
