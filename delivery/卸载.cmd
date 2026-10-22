@echo off
setlocal DisableDelayedExpansion
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\portable.ps1" -Mode Uninstall %*
set "TKU_EXIT=%errorlevel%"
echo.
if not "%TKU_EXIT%"=="0" echo Removal failed. Read the message above.
pause
exit /b %TKU_EXIT%
