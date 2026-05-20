"""
Focus OS — "El Sallama" (Check-in) Modülü
==========================================
Belirli aralıklarla kullanıcıya "Hala çalışıyor musun?" diye sorar.
Cevap gelmezse veya "Hayır" derse sayacı duraklatır.

İki bildirim kanalı:
1. Windows 10/11 Bildirimi (toast notification) — uygulamanın dışında da görünür
2. HTML overlay — uygulama ön plandaysa modal gösterir
"""

import threading
import time


class CheckinManager:
    """
    El Sallama (Check-in) yöneticisi.
    
    Kullanım:
        checkin = CheckinManager()
        checkin.on_timeout = lambda: print("Zaman aşımı! Sayaç duraklatılacak.")
        checkin.start()
        
        # Kullanıcı "Evet" dediğinde:
        checkin.confirm()
        
        # Moddan çık:
        checkin.stop()
    """
    
    def __init__(self, interval_seconds=600, response_timeout=10):
        """
        Args:
            interval_seconds: Sorular arası bekleme süresi (varsayılan: 600 = 10 dakika)
            response_timeout: Kullanıcının cevap vermesi için süre (varsayılan: 10 saniye)
        """
        self.interval_seconds = interval_seconds
        self.response_timeout = response_timeout
        
        # Callback'ler
        self.on_checkin_prompt = None   # "Hala çalışıyor musun?" gösterilecekse
        self.on_timeout = None          # Süre dolduğunda veya "Hayır" dendiğinde
        self.on_confirmed = None        # "Evet" dendiğinde
        
        self._active = False
        self._thread = None
        self._waiting_response = False
        self._response_received = threading.Event()
        self._user_said_yes = False
        self._stop_event = threading.Event()
    
    @property
    def is_active(self):
        """Check-in modu aktif mi?"""
        return self._active
    
    @property
    def is_waiting_response(self):
        """Şu an kullanıcıdan cevap bekleniyor mu?"""
        return self._waiting_response
    
    def start(self):
        """Check-in modunu başlatır."""
        if self._active:
            return
        self._active = True
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        print("[CheckinManager] El Sallama modu AKTİF")
    
    def stop(self):
        """Check-in modunu durdurur."""
        self._active = False
        self._stop_event.set()
        self._response_received.set()  # Beklemeyi kır
        print("[CheckinManager] El Sallama modu KAPALI")
    
    def confirm(self):
        """Kullanıcı 'Evet' dediğinde çağrılır."""
        self._user_said_yes = True
        self._response_received.set()
        print("[CheckinManager] ✅ Kullanıcı onayladı")
    
    def decline(self):
        """Kullanıcı 'Hayır' dediğinde çağrılır."""
        self._user_said_yes = False
        self._response_received.set()
        print("[CheckinManager] ❌ Kullanıcı reddetti")
    
    def _loop(self):
        """Ana döngü: Belirli aralıklarla check-in sorusu sorar."""
        while self._active:
            # interval_seconds kadar bekle (stop_event ile kesilebilir)
            if self._stop_event.wait(timeout=self.interval_seconds):
                break  # Stop istendi
            
            if not self._active:
                break
            
            # Check-in sorusu sor
            self._ask_checkin()
    
    def _ask_checkin(self):
        """Check-in sorusunu tetikler ve cevap bekler."""
        self._waiting_response = True
        self._user_said_yes = False
        self._response_received.clear()
        
        print(f"[CheckinManager] 🔔 Check-in sorusu gönderildi ({self.response_timeout}s bekleniyor)")
        
        # Bildirim callback'ini tetikle (Python → JS)
        if self.on_checkin_prompt:
            try:
                self.on_checkin_prompt()
            except Exception as e:
                print(f"[CheckinManager] on_checkin_prompt hatası: {e}")
        
        # Windows bildirimi gönder
        self._send_windows_notification()
        
        # response_timeout kadar bekle
        self._response_received.wait(timeout=self.response_timeout)
        
        self._waiting_response = False
        
        if not self._active:
            return
        
        if self._user_said_yes:
            # Kullanıcı onayladı, devam et
            print("[CheckinManager] ✅ Check-in başarılı, sayaç devam ediyor")
            if self.on_confirmed:
                try:
                    self.on_confirmed()
                except Exception as e:
                    print(f"[CheckinManager] on_confirmed hatası: {e}")
        else:
            # Süre doldu veya "Hayır" denildi — sayacı duraklat
            print("[CheckinManager] ⏸️ Zaman aşımı veya ret — sayaç DURAKLATILACAK")
            if self.on_timeout:
                try:
                    self.on_timeout()
                except Exception as e:
                    print(f"[CheckinManager] on_timeout hatası: {e}")
    
    def _send_windows_notification(self):
        """Windows 10/11 toast bildirimi gönderir."""
        try:
            from plyer import notification
            notification.notify(
                title="Focus OS — El Sallama 👋",
                message="Hala çalışıyor musun? Onaylamak için uygulamaya dön!",
                app_name="Focus OS",
                timeout=self.response_timeout
            )
        except ImportError:
            # plyer yoksa sadece HTML overlay ile devam et
            print("[CheckinManager] plyer yüklü değil, sadece HTML overlay kullanılıyor")
        except Exception as e:
            print(f"[CheckinManager] Bildirim hatası: {e}")


# --- Test kodu ---
if __name__ == "__main__":
    checkin = CheckinManager(interval_seconds=5, response_timeout=10)
    checkin.on_checkin_prompt = lambda: print(">>> PROMPT: Hala çalışıyor musun?")
    checkin.on_timeout = lambda: print(">>> TIMEOUT: Sayaç duraklatılacak!")
    checkin.on_confirmed = lambda: print(">>> CONFIRMED: Devam!")
    checkin.start()
    
    print("Check-in testi çalışıyor (5 saniyede bir soracak)...")
    try:
        while True:
            cmd = input("'y' = onayla, 'n' = reddet, 'q' = çık: ").strip().lower()
            if cmd == 'y':
                checkin.confirm()
            elif cmd == 'n':
                checkin.decline()
            elif cmd == 'q':
                break
    except KeyboardInterrupt:
        pass
    checkin.stop()
