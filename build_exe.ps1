$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$script:PythonExe = $env:PYTHON
$script:PythonArgs = @()

if (-not $script:PythonExe) {
    if (Get-Command python -ErrorAction SilentlyContinue) {
        $script:PythonExe = "python"
    }
    elseif (Get-Command py -ErrorAction SilentlyContinue) {
        $script:PythonExe = "py"
        $script:PythonArgs = @("-3")
    }
    else {
        throw "Python bulunamadi. Python 3 kurun ya da PYTHON ortam degiskenine python.exe yolunu verin."
    }
}

function Invoke-ProjectPython {
    $allArgs = @($script:PythonArgs) + $args
    & $script:PythonExe @allArgs
}

Write-Host "Focus OS build basliyor..." -ForegroundColor Cyan
Invoke-ProjectPython -m pip install --upgrade pip
Invoke-ProjectPython -m pip install -r requirements.txt
Invoke-ProjectPython -m PyInstaller --clean --noconfirm FocusOS.spec

Write-Host ""
Write-Host "Hazir: $Root\dist\FocusOS.exe" -ForegroundColor Green
Write-Host "Kullanici veritabani: %APPDATA%\FocusOS\guardian.db"
