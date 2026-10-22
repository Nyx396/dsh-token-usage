@echo off
setlocal DisableDelayedExpansion
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\portable.ps1" -Mode Install %*
set "TKU_EXIT=%errorlevel%"
echo.
if not "%TKU_EXIT%"=="0" echo Installation failed. Read the message above.
pause
exit /b %TKU_EXIT%
