@echo off
rem Shared setup: finds the real python.exe, creates .venv and installs packages.
rem On success the variable VPY is set (python from .venv). On failure: errorlevel 1.
cd /d "%~dp0"
set "VPY=%~dp0.venv\Scripts\python.exe"
if exist "%VPY%" goto :install

echo Looking for Python...
set "PYEXE="
rem 1) Python Install Manager (new way of installing)
for %%V in (3.13 3.12 3.14 3.11) do if not defined PYEXE if exist "%LOCALAPPDATA%\Python\pythoncore-%%V-64\python.exe" set "PYEXE=%LOCALAPPDATA%\Python\pythoncore-%%V-64\python.exe"
rem 2) classic installer (per user or for all users)
for %%V in (313 312 314 311) do if not defined PYEXE if exist "%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe" set "PYEXE=%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe"
for %%V in (313 312 314 311) do if not defined PYEXE if exist "%ProgramFiles%\Python%%V\python.exe" set "PYEXE=%ProgramFiles%\Python%%V\python.exe"
rem 3) last resort: ask the py launcher where python is (3 attempts)
for /L %%N in (1,1,3) do if not defined PYEXE for /f "usebackq delims=" %%P in (`py "%~dp0tools\where_python.py" 2^>nul`) do set "PYEXE=%%P"
if not defined PYEXE (
  echo Python was not found. Install it from https://www.python.org/downloads/ and run again.
  exit /b 1
)
echo Using: %PYEXE%
echo Creating the environment for Vaultkeeper (.venv) - first time only...
"%PYEXE%" -m venv "%~dp0.venv"
if not exist "%VPY%" (
  echo Creating the environment failed.
  exit /b 1
)

:install
echo Installing required packages...
"%VPY%" -m pip install --quiet --upgrade pip
"%VPY%" -m pip install --upgrade -r "%~dp0requirements.txt"
if errorlevel 1 exit /b 1
rem Windows Hello packages are optional: if they fail, everything else works normally
"%VPY%" -m pip install --quiet --upgrade -r "%~dp0requirements-windows.txt"
if errorlevel 1 echo WARNING: Windows Hello packages were not installed - Hello unlock will not be available.
"%VPY%" -c "import webview, cryptography"
if errorlevel 1 exit /b 1
exit /b 0
