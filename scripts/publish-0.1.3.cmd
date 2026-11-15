@echo off
setlocal EnableDelayedExpansion

REM =====================================================================
REM  Atelier 0.1.3 - publish installer to release folder and upgrade
REM
REM  Run this OUTSIDE the AI sandbox (double-click is fine).
REM  The sandbox can only write inside D:\Atelier\project, so the
REM  installer must be copied and installed from here.
REM
REM  What it does:
REM    1. Copy dist\*-Setup-0.1.3.exe to %LOCALAPPDATA%\Atelier\release
REM       (release folder has Medium integrity; dist has Low integrity,
REM        running the installer straight from dist fails with error 5)
REM    2. Print SHA256 of the copied file
REM    3. Ask whether to install now
REM
REM  Your data in %APPDATA%\atelier is preserved by the installer.
REM =====================================================================

set "PROJECT=%~dp0.."
pushd "%PROJECT%" || (echo [ERROR] cannot enter project dir & pause & exit /b 1)
set "PROJECT=%CD%"

REM Locate the installer by wildcard: the file name contains Chinese
REM characters, and keeping this .cmd pure ASCII avoids GBK misparsing.
set "SETUP="
for %%F in ("%PROJECT%\dist\*-Setup-0.1.3.exe") do set "SETUP=%%~fF"
set "SETUPNAME="
for %%F in ("%PROJECT%\dist\*-Setup-0.1.3.exe") do set "SETUPNAME=%%~nxF"
set "RELDIR=%LOCALAPPDATA%\Atelier\release"

if not defined SETUP (
  echo [ERROR] Installer *-Setup-0.1.3.exe not found in:
  echo         %PROJECT%\dist
  popd & pause & exit /b 1
)

if not exist "%RELDIR%" mkdir "%RELDIR%" >nul 2>&1

echo.
echo ========================================================
echo  Copying installer to release folder
echo ========================================================
copy /Y "%SETUP%" "%RELDIR%\" >nul
if errorlevel 1 (
  echo [ERROR] Copy failed. Target may be locked by a running Atelier.
  echo         Close Atelier and try again.
  popd & pause & exit /b 1
)

set "TARGET=%RELDIR%\%SETUPNAME%"
echo [OK] %TARGET%
for %%A in ("%TARGET%") do echo      Size: %%~zA bytes
echo.
echo SHA256:
certutil -hashfile "%TARGET%" SHA256 | findstr /v ":"
echo.

echo ========================================================
echo  Install now? Your data in %%APPDATA%%\atelier is kept.
echo ========================================================
choice /C YN /M "Install 0.1.3 over the current version"
if errorlevel 2 goto done

echo.
echo Installing (silent, keeps data)...
REM /NOCLOSEAPPLICATIONS avoids Inno's Restart Manager closing a running
REM instance the user may still be using.
start "" /wait "%TARGET%" /SILENT /NOCLOSEAPPLICATIONS /NORESTART

if errorlevel 1 (
  echo.
  echo [WARN] Installer returned an error. You can run it manually:
  echo        %TARGET%
) else (
  echo.
  echo [OK] Installed. Check version:
  powershell -NoProfile -Command "(Get-Item '%LOCALAPPDATA%\Programs\Atelier\Atelier.exe').VersionInfo.ProductVersion"
)

:done
echo.
echo Installer kept at:
echo   %TARGET%
popd
pause
