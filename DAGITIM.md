# FocusOS Dağıtım Notları

Bu proje tek dosyalık Windows `.exe` olarak paketlenir. Karşı tarafa verdiğinizde çift tıklayıp aynı FocusOS arayüzünü açar.

## Veritabanı nerede tutulur?

Uygulama `guardian.db` dosyasını proje klasöründen okumaz. Her kullanıcının verisi kendi Windows hesabında oluşur:

```text
%APPDATA%\FocusOS\guardian.db
```

Yedekler `%APPDATA%\FocusOS\backups`, dışa aktarımlar `%APPDATA%\FocusOS\exports` altındadır. Bu sayede GitHub'dan indirilen uygulama sizin verinizi taşımaz; karşı tarafta ilk açılışta boş bir veritabanı oluşur.

## Yerelde EXE üretme

Windows PowerShell'de proje klasöründe şunu çalıştırın:

```powershell
.\build_exe.ps1
```

Komut `requirements-dev.txt` içindeki bağımlılıkları (PyInstaller dahil) kurar ve `dist\FocusOS.exe` dosyasını üretir.

## GitHub Releases ile yayınlama (önerilen)

`.github/workflows/release.yml`, `v` ile başlayan bir etiket gönderildiğinde testleri çalıştırır, `.exe` dosyasını derler ve bir GitHub Release'e ekler:

```powershell
git tag v1.0.0
git push origin v1.0.0
```

`guardian.db`, `build/` ve `dist/` depoya eklenmemelidir (`.gitignore` bunları dışarıda tutar). Hazır uygulama yalnızca Releases üzerinden paylaşılır.

## Notlar

- Windows 10/11'de Microsoft Edge WebView2 Runtime genellikle hazır gelir. Açılmazsa karşı tarafta WebView2 Runtime kurulması gerekir.
- İmzasız `.exe` dosyaları için Windows SmartScreen uyarı verebilir; "Ek bilgi → Yine de çalıştır" ile açılabilir.
- Veriyi özel bir klasöre almak için uygulamayı başlatmadan önce `FOCUSOS_DATA_DIR` ortam değişkenini ayarlayın.
