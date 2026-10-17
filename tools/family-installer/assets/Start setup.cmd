@echo off
setlocal
chcp 65001 >nul
"%~dp0runtime\node.exe" "%~dp0installer\installer.cjs"
if errorlevel 1 (
  pause
  exit /b 1
)
pause
endlocal
exit /b 0
