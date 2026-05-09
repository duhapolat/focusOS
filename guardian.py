import psutil
import time
import os
import database

class ProcessGuardian:
    def __init__(self):
        self.active_threats = {}  # { app_name: start_time }
        
    def scan_and_enforce(self):
        blacklist = database.get_blacklist()
        
        # Çoklu İşlem Desteği: Aynı uygulama birden fazla process açabilir
        # set() ile grupla, tek uygulama gibi say
        found_apps = set()
        process_map = {}  # { app_name: [proc1, proc2, ...] }
        
        for proc in psutil.process_iter(['name']):
            try:
                name = proc.info['name']
                if name and name.lower() in blacklist:
                    app = name.lower()
                    found_apps.add(app)
                    if app not in process_map:
                        process_map[app] = []
                    process_map[app].append(proc)
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                pass
                
        # Yeni tespit edilen uygulamaları kaydet
        for app in found_apps:
            if app not in self.active_threats:
                self.active_threats[app] = time.time()
            # Her saniye kullanım süresini veritabanına yaz
            database.log_app_usage(app, 1)
                
        # Kapanmış uygulamaları listeden çıkar
        for name in list(self.active_threats.keys()):
            if name not in found_apps:
                del self.active_threats[name]
                
        alerts = []
        for app in found_apps:
            elapsed_time = time.time() - self.active_threats[app]
            
            if elapsed_time >= 120: 
                # SÜRE DOLDU: Tüm eşleşen process'leri öldür
                try:
                    # Windows'un acımasız taskkill komutu
                    os.system(f"taskkill /F /IM {app} >nul 2>&1")
                    # Ekstra garanti: psutil ile de tüm process'leri vur
                    for proc in process_map.get(app, []):
                        try:
                            proc.kill()
                        except:
                            pass
                except:
                    pass
                
                alerts.append({"type": "kill", "app": app})
                
                if app in self.active_threats:
                    del self.active_threats[app]
                    
            elif elapsed_time >= 110: 
                remaining = 120 - int(elapsed_time)
                alerts.append({"type": "countdown", "app": app, "time": remaining})
            elif 0 < elapsed_time < 2: 
                alerts.append({"type": "warning", "app": app})
                
        return alerts

    def get_live_status(self):
        """Canlı radar için tüm uygulamaların durumunu döndürür."""
        status = {}
        for app, start_time in self.active_threats.items():
            elapsed = time.time() - start_time
            remaining = int(120 - elapsed)
            if remaining < 0:
                remaining = 0
            status[app] = remaining
        return status