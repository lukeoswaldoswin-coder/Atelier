@echo off
setlocal

REM =====================================================================
REM  P6.7 test build launcher (double-click to run)
REM
REM  Data safety:
REM    By default uses a SEPARATE test data folder:
REM      %LOCALAPPDATA%\Atelier\P6.7-test-data
REM    It copies your real database there on first run.
REM    Your real profile %APPDATA%\atelier is never written.
REM
REM  Options:
REM    start-p67-test.cmd --real    use the real profile (runs migration 006,
REM                                 an automatic backup is created first)
REM    start-p67-test.cmd --fresh   discard last test data, copy again
REM
REM  NOTE: this file is intentionally ASCII-only.
REM        Chinese notes: see the .txt file next to this script.
REM =====================================================================

set "PROJECT=%~dp0.."
pushd "%PROJECT%" || (echo [ERROR] cannot enter project dir & pause & exit /b 1)
REM Normalise: %~dp0 ends with a backslash, so "%PROJECT%" is "...\scripts\.."
REM which some tools do not resolve. cd without args gives the real path.
set "PROJECT=%CD%"

REM Known issue on this machine: the electron binary inside the project dir
REM cannot start; prefer the copy outside the workspace.
set "ELECTRON="
if exist "D:\Atelier\atelier-electron-runtime\electron.exe" (
  set "ELECTRON=D:\Atelier\atelier-electron-runtime\electron.exe"
)
if not defined ELECTRON (
  if exist "%PROJECT%\node_modules\electron\dist\electron.exe" (
    set "ELECTRON=%PROJECT%\node_modules\electron\dist\electron.exe"
  )
)
if not defined ELECTRON (
  echo [ERROR] Electron executable not found.
  echo Run: node scripts\ensure-electron.mjs
  popd & pause & exit /b 1
)

if not exist "%PROJECT%\out\main\index.js" (
  echo [ERROR] Build output out\main\index.js not found.
  echo Run: npx electron-vite build
  popd & pause & exit /b 1
)

set "REALDIR=%APPDATA%\atelier"
set "TESTDIR=%LOCALAPPDATA%\Atelier\P6.7-test-data"

if /I "%~1"=="--real" goto usereal
if /I "%~1"=="--fresh" goto fresh

:usetest
if not exist "%TESTDIR%" mkdir "%TESTDIR%" >nul 2>&1
if not exist "%TESTDIR%\atelier.db" (
  if not exist "%REALDIR%\atelier.db" (
    echo [ERROR] Real database not found; cannot create test data.
    popd & pause & exit /b 1
  )
  copy /Y "%REALDIR%\atelier.db" "%TESTDIR%\atelier.db" >nul
  echo [INFO] Copied real database to test folder:
  echo        %TESTDIR%\atelier.db
)
set "USERDATA=%TESTDIR%"
goto launch

:fresh
if exist "%TESTDIR%" rmdir /S /Q "%TESTDIR%" >nul 2>&1
echo [INFO] Cleared previous test data.
goto usetest

:usereal
echo.
echo ========================================================
echo  WARNING: using the REAL data folder
echo  %REALDIR%
echo  Migration 006 will run on first start (adds one table only).
echo  An automatic backup is created before migrating.
echo ========================================================
echo.
set "USERDATA=%REALDIR%"
goto launch

:launch
echo.
echo --------------------------------------------------------
echo  Electron : %ELECTRON%
echo  Data dir : %USERDATA%
echo --------------------------------------------------------
echo.

REM ELECTRON_RUN_AS_NODE turns Electron into plain Node; must be cleared.
set ELECTRON_RUN_AS_NODE=
set ATELIER_USER_DATA_DIR=%USERDATA%

"%ELECTRON%" .
set "CODE=%ERRORLEVEL%"

echo.
echo Electron exited with code %CODE%.
if /I not "%~1"=="--real" (
  echo Test data kept at: %USERDATA%
  echo To start over run: start-p67-test.cmd --fresh
)
popd
pause
exit /b %CODE%
