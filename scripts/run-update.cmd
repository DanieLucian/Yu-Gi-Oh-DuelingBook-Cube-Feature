@echo off
setlocal DisableDelayedExpansion
title DuelingBook Cube Draft updater

echo DuelingBook Cube Draft v0.5.0 updater
echo Keep run-update.cmd and update-from-zip.ps1 in the same folder.
echo The ZIP picker opens after your extension folder is checked.
echo.

if not exist "%~dp0update-from-zip.ps1" (
    echo ERROR: update-from-zip.ps1 was not found beside this launcher.
    echo Download both files into the same folder using their exact names.
    echo.
    pause
    exit /b 2
)

set "DBCD_PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%DBCD_PS_EXE%" (
    echo ERROR: Windows PowerShell could not be found.
    echo.
    pause
    exit /b 2
)

"%DBCD_PS_EXE%" -NoLogo -NoProfile -STA -File "%~dp0update-from-zip.ps1"
set "DBCD_EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%DBCD_EXIT_CODE%"=="0" (
    echo Updater exited with code %DBCD_EXIT_CODE%.
)
echo If no ZIP picker appeared, copy or screenshot the error above.
echo This launcher does not change PowerShell execution policy.
echo.
pause
exit /b %DBCD_EXIT_CODE%
