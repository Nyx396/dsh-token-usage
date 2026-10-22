@echo off
setlocal DisableDelayedExpansion
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\portable.ps1" -Mode Check %*
set "TKU_EXIT=%errorlevel%"
echo.
pause
exit /b %TKU_EXIT%
