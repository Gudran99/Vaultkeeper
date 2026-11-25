@echo off
rem Runs Vaultkeeper directly from source, with an error window (for testing)
cd /d "%~dp0"
call "%~dp0_setup.bat"
if errorlevel 1 goto :err
"%VPY%" app.py
if errorlevel 1 goto :err
exit /b 0
:err
echo.
echo An error occurred. Take a screenshot of this window and send it.
pause
