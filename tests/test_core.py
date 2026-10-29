import importlib
import gc
import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


class FocusOSCoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory(prefix="focusos-tests-")
        os.environ["FOCUSOS_DATA_DIR"] = cls.temp_dir.name
        if "database" in sys.modules:
            del sys.modules["database"]
        cls.db = importlib.import_module("database")
        cls.db.init_db()

    @classmethod
    def tearDownClass(cls):
        sys.modules.pop("database", None)
        cls.db = None
        gc.collect()
        cls.temp_dir.cleanup()
        os.environ.pop("FOCUSOS_DATA_DIR", None)

    def setUp(self):
        with self.db._connect() as conn:
            for table in (
                "tasks", "daily_logs", "off_days", "roadmap_completions",
                "roadmap_topic_progress", "roadmap_topics", "roadmap_phases",
                "roadmap_subprograms", "roadmap_programs", "planner_items",
                "focus_session_state", "weekly_schedule",
                "routine_completions", "routines", "subject_logs", "daily_targets",
            ):
                conn.execute(f"DELETE FROM {table}")
            conn.commit()
        self.db.set_setting("focus_runtime_active", "0")
        self.db.set_setting("daily_target_minutes", "60")

    def test_focus_session_state_round_trip(self):
        payload = {
            "mode": "timer", "total_seconds": 1500, "subject": "Matematik",
            "is_running": True, "is_paused": False,
            "start_timestamp": 123456, "current_block_start": 123456,
        }
        self.assertTrue(self.db.save_focus_session_state(payload))
        restored = self.db.get_focus_session_state()
        self.assertEqual(restored["subject"], "Matematik")
        self.assertEqual(restored["start_timestamp"], 123456)
        self.assertEqual(self.db.get_setting("focus_runtime_active"), "1")
        self.db.clear_focus_session_state()
        self.assertIsNone(self.db.get_focus_session_state())

    def test_roadmap_completion_does_not_invent_study_time(self):
        program = self.db.add_roadmap_program("Python")
        sub = self.db.add_roadmap_subprogram(program, "Temeller")
        phase = self.db.add_roadmap_phase(sub, "Faz 1")
        topic = self.db.add_roadmap_topic(phase, "Değişkenler", estimated_minutes=30)
        self.db.toggle_roadmap_topic(topic)
        self.assertEqual(self.db.get_today_stats(), 0)
        self.db.toggle_roadmap_topic(topic)
        with self.db._connect() as conn:
            count = conn.execute("SELECT COUNT(*) FROM roadmap_completions WHERE topic_id=?", (topic,)).fetchone()[0]
        self.assertEqual(count, 0)

    def test_multiple_roadmaps_can_be_added_and_reordered(self):
        first = self.db.add_roadmap_program("Python")
        second = self.db.add_roadmap_program("Matematik")
        third = self.db.add_roadmap_program("İngilizce")

        self.assertEqual(
            [program["id"] for program in self.db.get_roadmap_programs()],
            [first, second, third],
        )
        self.assertTrue(self.db.reorder_roadmap_programs([third, first, second]))
        self.assertEqual(
            [program["id"] for program in self.db.get_roadmap_programs()],
            [third, first, second],
        )
        self.assertFalse(self.db.reorder_roadmap_programs([first, second]))
        self.assertEqual(
            [program["id"] for program in self.db.get_roadmap_programs()],
            [third, first, second],
        )

    def test_quick_roadmap_outline_is_imported_atomically(self):
        outline = [{
            "name": "1.0 Giriş",
            "icon": "🧭",
            "phases": [{
                "name": "1.1 Sinyaller",
                "topics": [
                    {"title": "1.1.1 Örnekler", "description": "Kısa not"},
                    {"title": "1.1.2 Enerji ve Güç", "description": ""},
                ],
            }],
        }]
        result = self.db.import_roadmap_outline("Sinyaller ve Sistemler", outline)
        self.assertTrue(result["success"])
        self.assertEqual(result["topic_count"], 2)

        tree = self.db.get_full_roadmap(result["program_id"])
        self.assertEqual(tree["name"], "Sinyaller ve Sistemler")
        self.assertEqual(tree["subprograms"][0]["name"], "1.0 Giriş")
        self.assertEqual(tree["subprograms"][0]["phases"][0]["topics"][0]["description"], "Kısa not")

        before = len(self.db.get_roadmap_programs())
        with self.assertRaises(ValueError):
            self.db.import_roadmap_outline("Bozuk", [{"name": "Eksik", "phases": []}])
        self.assertEqual(len(self.db.get_roadmap_programs()), before)

    def test_streak_is_preserved_during_current_unfinished_day(self):
        yesterday = (datetime.now().date() - timedelta(days=1)).strftime("%Y-%m-%d")
        today = datetime.now().strftime("%Y-%m-%d")
        with self.db._connect() as conn:
            conn.execute("INSERT INTO daily_logs(log_date,total_minutes) VALUES (?,60)", (yesterday,))
            conn.execute("INSERT INTO daily_logs(log_date,total_minutes) VALUES (?,0)", (today,))
            conn.commit()
        self.assertEqual(self.db.get_study_streak()["streak"], 1)
        self.db.use_off_day()
        self.assertEqual(self.db.get_study_streak()["streak"], 1)

    def _log_days(self, today, minutes_by_offset):
        """minutes_by_offset: {gün_önce: dakika}"""
        with self.db._connect() as conn:
            for offset, minutes in minutes_by_offset.items():
                day = (today - timedelta(days=offset)).strftime("%Y-%m-%d")
                conn.execute("INSERT OR REPLACE INTO daily_logs(log_date,total_minutes) VALUES (?,?)",
                             (day, minutes))
            conn.commit()

    def test_single_missed_day_does_not_break_streak(self):
        # 8 gün çalışıldı, 9. gün boş, 10. gün (bugün) 1 saat → seri 9 olmalı.
        today = datetime(2026, 10, 29).date()
        logs = {offset: 60 for offset in range(2, 10)}
        logs[1] = 0
        logs[0] = 60
        self._log_days(today, logs)
        result = self.db.get_study_streak(today=today)
        self.assertEqual(result["streak"], 9)
        self.assertFalse(result["grace_available"])

    def test_today_unfinished_keeps_streak_after_one_miss(self):
        today = datetime(2026, 10, 29).date()
        self._log_days(today, {3: 60, 2: 60, 1: 0, 0: 20})
        self.assertEqual(self.db.get_study_streak(today=today)["streak"], 2)

    def test_two_misses_within_a_week_break_streak(self):
        today = datetime(2026, 10, 29).date()
        logs = {offset: 60 for offset in range(1, 12)}
        logs[6] = 0
        logs[3] = 0  # 7 gün içinde ikinci kaçırma → seri burada kırılır
        self._log_days(today, logs)
        self.assertEqual(self.db.get_study_streak(today=today)["streak"], 2)

    def test_two_consecutive_misses_break_streak(self):
        today = datetime(2026, 10, 29).date()
        self._log_days(today, {5: 60, 4: 60, 3: 60, 2: 0, 0: 60})  # 1 gün önce kayıt yok
        self.assertEqual(self.db.get_study_streak(today=today)["streak"], 1)

    def test_misses_more_than_a_week_apart_are_both_forgiven(self):
        today = datetime(2026, 10, 29).date()
        logs = {offset: 60 for offset in range(0, 20)}
        logs[15] = 0
        logs[5] = 0
        self._log_days(today, logs)
        self.assertEqual(self.db.get_study_streak(today=today)["streak"], 18)

    def test_off_day_is_neutral_and_not_a_miss(self):
        today = datetime.now().date()
        self._log_days(today, {4: 60, 3: 60, 2: 0, 1: 0, 0: 60})
        two_days_ago = (today - timedelta(days=2)).strftime("%Y-%m-%d")
        self.assertEqual(self.db.get_study_streak(today=today)["streak"], 1)
        self.assertTrue(self.db.use_off_day(two_days_ago)["success"])
        # OFF DAY + tek kaçırma → seri korunur (4 gün önce, 3 gün önce, bugün)
        self.assertEqual(self.db.get_study_streak(today=today)["streak"], 3)

    def test_raising_daily_target_does_not_rewrite_past_streak(self):
        today = datetime.now().date()
        self._log_days(today, {3: 60, 2: 60, 1: 60})
        self.assertEqual(self.db.get_study_streak(today=today)["streak"], 3)
        with self.db._connect() as conn:
            conn.execute("INSERT OR REPLACE INTO daily_targets VALUES ('0001-01-01', 60)")
        self.db.set_setting("daily_target_minutes", "120")  # bugünden itibaren geçerli
        result = self.db.get_study_streak(today=today)
        self.assertEqual(result["streak"], 3)
        self.assertEqual(result["target_minutes"], 120)

    def test_off_day_accepts_only_recent_past_days(self):
        today = datetime.now().date()
        tomorrow = (today + timedelta(days=1)).strftime("%Y-%m-%d")
        too_old = (today - timedelta(days=10)).strftime("%Y-%m-%d")
        yesterday = (today - timedelta(days=1)).strftime("%Y-%m-%d")
        self.assertFalse(self.db.use_off_day(tomorrow)["success"])
        self.assertFalse(self.db.use_off_day(too_old)["success"])
        self.assertFalse(self.db.use_off_day("bozuk")["success"])
        self.assertTrue(self.db.use_off_day(yesterday)["success"])

    def test_study_time_can_be_logged_to_previous_day(self):
        yesterday = (datetime.now().date() - timedelta(days=1)).strftime("%Y-%m-%d")
        future = (datetime.now().date() + timedelta(days=3)).strftime("%Y-%m-%d")
        self.db.log_study_time(30, yesterday)
        self.db.log_subject_time("Fizik", 30, yesterday)
        self.db.log_study_time(15, future)  # gelecek tarih bugüne yazılır
        logs = {item["date"]: item["minutes"] for item in self.db.get_all_daily_logs()}
        self.assertEqual(logs[yesterday], 30)
        self.assertEqual(self.db.get_today_stats(), 15)
        self.assertEqual(self.db.get_subject_logs_for_date(yesterday)[0]["minutes"], 30)

    def test_weekly_stats_include_days_without_study(self):
        today = datetime.now().date()
        self._log_days(today, {0: 30, 2: 45, 10: 99})
        stats = self.db.get_weekly_stats()
        self.assertEqual(len(stats), 7)
        self.assertEqual(stats[0], (today.strftime("%Y-%m-%d"), 30))
        self.assertEqual(stats[1][1], 0)
        self.assertEqual(stats[2][1], 45)

    def test_subject_suggestions_merge_sources(self):
        self.db.log_subject_time("Matematik", 30)
        self.db.add_task("matematik", 45)
        program = self.db.add_roadmap_program("Python")
        sub = self.db.add_roadmap_subprogram(program, "Temeller")
        phase = self.db.add_roadmap_phase(sub, "Faz 1")
        self.db.add_roadmap_topic(phase, "Pointer temeli")
        names = [item["name"] for item in self.db.get_subject_suggestions()]
        self.assertEqual(names.count("Matematik") + names.count("matematik"), 1)
        self.assertIn("Pointer temeli", names)
        self.assertEqual(names[0], "Matematik")

    def test_deadline_pause_persists(self):
        task_id = self.db.add_task("Deneme", 1)
        self.db.activate_task(task_id)
        self.assertTrue(self.db.set_task_deadline_paused(task_id, True))
        active = self.db.get_active_tasks()[0]
        self.assertTrue(active["paused"])
        self.assertGreaterEqual(active["remaining_seconds"], 0)
        self.assertTrue(self.db.set_task_deadline_paused(task_id, False))
        self.assertFalse(self.db.get_active_tasks()[0]["paused"])

    def test_planner_and_task_status_stay_linked(self):
        date_str = datetime.now().strftime("%Y-%m-%d")
        item_id = self.db.add_planner_item("Rapor", date_str, 45, 1)
        task_id = self.db.add_task("Rapor", 45, 1, date_str, None, None, item_id)
        self.db.update_planner_item(item_id, status="done")
        with self.db._connect() as conn:
            status = conn.execute("SELECT status FROM tasks WHERE id=?", (task_id,)).fetchone()[0]
        self.assertEqual(status, "completed")

    def test_weekly_schedule_does_not_duplicate_today_task(self):
        entry = {"day": datetime.now().weekday(), "name": "Fizik", "hours": 0, "minutes": 45}
        self.db.save_schedule_and_create_tasks([entry])
        self.db.ensure_today_schedule_tasks()
        tasks = [task for task in self.db.get_waiting_tasks() if task["subject"] == "Fizik"]
        self.assertEqual(len(tasks), 1)

    def test_focus_profile_only_enforces_during_focus(self):
        self.db.activate_focus_profile(1)
        self.db.add_app_to_active_profile("example.exe")
        self.db.set_setting("focus_runtime_active", "0")
        self.assertFalse(self.db.get_enforcement_config()["enabled"])
        self.db.set_setting("focus_runtime_active", "1")
        config = self.db.get_enforcement_config()
        self.assertTrue(config["enabled"])
        self.assertIn("example.exe", config["apps"])

    def test_windows_lock_pause_is_enabled_by_default_and_profile_scoped(self):
        profile_id = self.db.add_focus_profile("Kilit Testi")
        self.db.activate_focus_profile(profile_id)
        self.assertTrue(self.db.should_pause_on_windows_lock())

        self.db.update_focus_profile(profile_id, 120, True, 10, False)
        self.assertFalse(self.db.should_pause_on_windows_lock())
        profile = next(item for item in self.db.get_focus_profiles() if item["id"] == profile_id)
        self.assertFalse(profile["pause_on_windows_lock"])

    def test_backup_and_export_are_created(self):
        backup = self.db.create_backup("test")
        export = self.db.export_all_data()
        self.assertTrue(Path(backup["path"]).exists())
        self.assertTrue(Path(export["json_path"]).exists())
        self.assertTrue(Path(export["csv_path"]).exists())

    def test_routine_can_be_updated_and_deleted(self):
        routine_id = self.db.add_routine("Sabah okuması", "morning", "📖", 15, "1,2,3,4,5")
        self.assertTrue(self.db.update_routine(routine_id, "Akşam okuması", "evening", "🌙", 20, "1,3,5"))
        routine = self.db.get_all_routines()[0]
        self.assertEqual(routine["name"], "Akşam okuması")
        self.assertEqual(routine["duration_minutes"], 20)
        self.db.complete_routine(routine_id)
        self.assertTrue(self.db.delete_routine(routine_id))
        self.assertEqual(self.db.get_all_routines(), [])


if __name__ == "__main__":
    unittest.main()
