@echo off
rem Packs Vaultkeeper into a single file: dist\Vaultkeeper.exe
cd /d "%~dp0"
echo [1/2] Preparing...
call "%~dp0_setup.bat"
if errorlevel 1 goto :err
"%VPY%" -m pip install --quiet --upgrade pyinstaller
if errorlevel 1 goto :err

echo.
echo [2/2] Building Vaultkeeper.exe (can take a few minutes)...
"%VPY%" -m PyInstaller --noconfirm --clean --onefile --windowed --name Vaultkeeper --icon vaultkeeper.ico --add-data "ui;ui" --add-data "extension;extension" app.py
if errorlevel 1 goto :err

echo.
echo ============================================================
echo  Done! The program is in: %~dp0dist\Vaultkeeper.exe
echo  Close the old Vaultkeeper (Quit Vaultkeeper) before replacing it.
echo ============================================================
explorer "%~dp0dist"
pause
exit /b 0

:err
echo.
echo An error occurred. Take a screenshot of this window and send it.
pause
exit /b 1
