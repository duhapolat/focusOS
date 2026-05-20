# Focus OS Dagitim Notlari

Bu proje tek dosyalik Windows `.exe` olarak paketlenebilir. Karsi tarafa verdiginizde cift tiklayip ayni Focus OS arayuzunu acar.

## Veritabani nerede tutulur?

Uygulama artik `guardian.db` dosyasini proje klasorunden okumaz. Her kullanicinin verisi kendi Windows hesabinda olusur:

```text
%APPDATA%\FocusOS\guardian.db
```

Bu sayede USB ile verdiginiz veya GitHub'dan indirilen uygulama sizin veritabani verinizi tasimaz. Karsi tarafta ilk acilista bos/kendine ait veritabani olusur.

## EXE uretme

Windows PowerShell'de proje klasorunde sunu calistirin:

```powershell
.\build_exe.ps1
```

Cikti:

```text
dist\FocusOS.exe
```

Karsi tarafa gondermeniz gereken dosya budur.

## GitHub'a yuklerken

`guardian.db`, `build/` ve `dist/` repoya eklenmemeli. Kaynak kodu GitHub'a koyun; hazir uygulama paylasmak icin GitHub Releases bolumune `dist\FocusOS.exe` yukleyin.

## Notlar

Windows 10/11'de Microsoft Edge WebView2 Runtime genellikle hazir gelir. Acilmazsa karsi tarafta WebView2 Runtime kurulmasi gerekebilir.

Veriyi ozel bir klasore almak isterseniz uygulamayi baslatmadan once `FOCUSOS_DATA_DIR` ortam degiskenini ayarlayabilirsiniz.
