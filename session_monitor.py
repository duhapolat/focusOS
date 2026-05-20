"""
Focus OS — Windows Oturum Monitörü (Session Monitor)
=====================================================
Windows oturum kilidini (Win+L), uyku modunu (Sleep/Suspend) ve
ekran kapanmasını algılayarak Python callback'leri tetikler.

Teknik: ctypes ile gizli bir Win32 pencere oluşturup
WTSRegisterSessionNotification ile oturum olaylarını dinler.
"""

import ctypes
import ctypes.wintypes
import threading
import time

# --- Windows API Sabitleri ---
WM_WTSSESSION_CHANGE = 0x02B1
WM_POWERBROADCAST = 0x0218

# WTS Session olayları
WTS_SESSION_LOCK = 0x7
WTS_SESSION_UNLOCK = 0x8

# Power olayları
PBT_APMSUSPEND = 0x0004        # Uyku moduna geçiyor
PBT_APMRESUMEAUTOMATIC = 0x0012  # Uykudan uyanıyor (otomatik)
PBT_APMRESUMESUSPEND = 0x0007   # Uykudan uyanıyor (kullanıcı)

# WTS bildirimi için
NOTIFY_FOR_THIS_SESSION = 0

# Win32 pencere sınıfı sabitleri
WS_EX_NOACTIVATE = 0x08000000
HWND_MESSAGE = ctypes.wintypes.HWND(-3)

# Win32 API yükleme
user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32
wtsapi32 = ctypes.windll.wtsapi32

# Callback fonksiyon prototipi
WNDPROC = ctypes.WINFUNCTYPE(
    ctypes.c_long,
    ctypes.wintypes.HWND,
    ctypes.c_uint,
    ctypes.wintypes.WPARAM,
    ctypes.wintypes.LPARAM
)


class WNDCLASSEX(ctypes.Structure):
    """Win32 WNDCLASSEX yapısı"""
    _fields_ = [
        ("cbSize", ctypes.c_uint),
        ("style", ctypes.c_uint),
        ("lpfnWndProc", WNDPROC),
        ("cbClsExtra", ctypes.c_int),
        ("cbWndExtra", ctypes.c_int),
        ("hInstance", ctypes.wintypes.HINSTANCE),
        ("hIcon", ctypes.wintypes.HICON),
        ("hCursor", ctypes.wintypes.HANDLE),
        ("hbrBackground", ctypes.wintypes.HBRUSH),
        ("lpszMenuName", ctypes.wintypes.LPCWSTR),
        ("lpszClassName", ctypes.wintypes.LPCWSTR),
        ("hIconSm", ctypes.wintypes.HICON),
    ]


class SessionMonitor:
    """
    Windows oturum olaylarını izleyen monitör.
    
    Kullanım:
        monitor = SessionMonitor()
        monitor.on_lock = lambda: print("Kilitlendi!")
        monitor.on_unlock = lambda: print("Açıldı!")
        monitor.on_sleep = lambda: print("Uykuya geçti!")
        monitor.on_wake = lambda: print("Uyandı!")
        monitor.start()
    """
    
    def __init__(self):
        self.on_lock = None      # Oturum kilitlendiğinde
        self.on_unlock = None    # Oturum açıldığında
        self.on_sleep = None     # Uyku moduna geçtiğinde
        self.on_wake = None      # Uykudan uyandığında
        
        self._hwnd = None
        self._thread = None
        self._running = False
        self._lock_time = None   # Kilitlenme anının timestamp'i
    
    def start(self):
        """Monitörü arka plan thread'inde başlatır."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._run_message_loop, daemon=True)
        self._thread.start()
        print("[SessionMonitor] Oturum izleme başlatıldı.")
    
    def stop(self):
        """Monitörü durdurur."""
        self._running = False
        if self._hwnd:
            user32.PostMessageW(self._hwnd, 0x0012, 0, 0)  # WM_QUIT
    
    @property
    def lock_duration_seconds(self):
        """Kilitli kalınan süreyi saniye olarak döndürür."""
        if self._lock_time:
            return time.time() - self._lock_time
        return 0
    
    def _wnd_proc(self, hwnd, msg, wparam, lparam):
        """Win32 mesaj işleyicisi — oturum ve güç olaylarını yakalar."""
        
        if msg == WM_WTSSESSION_CHANGE:
            if wparam == WTS_SESSION_LOCK:
                print("[SessionMonitor] 🔒 Oturum KİLİTLENDİ")
                self._lock_time = time.time()
                if self.on_lock:
                    try:
                        self.on_lock()
                    except Exception as e:
                        print(f"[SessionMonitor] on_lock hatası: {e}")
                        
            elif wparam == WTS_SESSION_UNLOCK:
                duration = self.lock_duration_seconds
                print(f"[SessionMonitor] 🔓 Oturum AÇILDI ({duration:.0f}s kilitli kaldı)")
                self._lock_time = None
                if self.on_unlock:
                    try:
                        self.on_unlock()
                    except Exception as e:
                        print(f"[SessionMonitor] on_unlock hatası: {e}")
        
        elif msg == WM_POWERBROADCAST:
            if wparam == PBT_APMSUSPEND:
                print("[SessionMonitor] 💤 Sistem UYKUYA GEÇİYOR")
                self._lock_time = time.time()
                if self.on_sleep:
                    try:
                        self.on_sleep()
                    except Exception as e:
                        print(f"[SessionMonitor] on_sleep hatası: {e}")
                        
            elif wparam in (PBT_APMRESUMEAUTOMATIC, PBT_APMRESUMESUSPEND):
                duration = self.lock_duration_seconds
                print(f"[SessionMonitor] ☀️ Sistem UYANDI ({duration:.0f}s uyuyordu)")
                self._lock_time = None
                if self.on_wake:
                    try:
                        self.on_wake()
                    except Exception as e:
                        print(f"[SessionMonitor] on_wake hatası: {e}")
        
        return user32.DefWindowProcW(hwnd, msg, wparam, lparam)
    
    def _run_message_loop(self):
        """Gizli Win32 penceresi oluşturup mesaj döngüsünü çalıştırır."""
        
        # Pencere sınıfını kaydet
        wnd_proc_callback = WNDPROC(self._wnd_proc)
        
        hinstance = kernel32.GetModuleHandleW(None)
        class_name = "FocusOS_SessionMonitor"
        
        wc = WNDCLASSEX()
        wc.cbSize = ctypes.sizeof(WNDCLASSEX)
        wc.lpfnWndProc = wnd_proc_callback
        wc.hInstance = hinstance
        wc.lpszClassName = class_name
        
        atom = user32.RegisterClassExW(ctypes.byref(wc))
        if not atom:
            print(f"[SessionMonitor] RegisterClassEx başarısız: {kernel32.GetLastError()}")
            return
        
        # Gizli mesaj penceresi oluştur (görünmez)
        self._hwnd = user32.CreateWindowExW(
            0,                      # dwExStyle
            class_name,             # lpClassName
            "FocusOS_Hidden",       # lpWindowName
            0,                      # dwStyle
            0, 0, 0, 0,            # x, y, w, h
            HWND_MESSAGE,           # hWndParent (mesaj penceresi)
            None,                   # hMenu
            hinstance,              # hInstance
            None                    # lpParam
        )
        
        if not self._hwnd:
            print(f"[SessionMonitor] CreateWindowEx başarısız: {kernel32.GetLastError()}")
            return
        
        # WTS oturum bildirimlerini kaydet
        result = wtsapi32.WTSRegisterSessionNotification(
            self._hwnd, NOTIFY_FOR_THIS_SESSION
        )
        if not result:
            print(f"[SessionMonitor] WTSRegisterSessionNotification başarısız: {kernel32.GetLastError()}")
        
        print(f"[SessionMonitor] Gizli pencere oluşturuldu (HWND: {self._hwnd})")
        
        # Win32 mesaj döngüsü
        msg = ctypes.wintypes.MSG()
        while self._running:
            ret = user32.GetMessageW(ctypes.byref(msg), None, 0, 0)
            if ret <= 0:
                break
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))
        
        # Temizlik
        wtsapi32.WTSUnRegisterSessionNotification(self._hwnd)
        user32.DestroyWindow(self._hwnd)
        user32.UnregisterClassW(class_name, hinstance)
        print("[SessionMonitor] Monitör durduruldu.")


# --- Test kodu ---
if __name__ == "__main__":
    monitor = SessionMonitor()
    monitor.on_lock = lambda: print(">>> CALLBACK: Kilitlendi!")
    monitor.on_unlock = lambda: print(">>> CALLBACK: Açıldı!")
    monitor.on_sleep = lambda: print(">>> CALLBACK: Uykuya geçti!")
    monitor.on_wake = lambda: print(">>> CALLBACK: Uyandı!")
    monitor.start()
    
    print("Oturum monitörü çalışıyor. Win+L ile test edebilirsiniz...")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        monitor.stop()
