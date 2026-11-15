@echo off
setlocal EnableDelayedExpansion

REM =====================================================================
REM  Clean up Atelier test folders left over from previous rounds.
REM
REM  Run this OUTSIDE the AI sandbox (double-click is fine).
REM  The sandbox can only write inside D:\Atelier\project, so deleting
REM  anything under %LOCALAPPDATA% must be done here.
REM
REM  How targets are found: every leftover test folder name starts with
REM  "P6." - that prefix is ASCII, so this .cmd can stay pure ASCII
REM  (folder names themselves contain Chinese; putting them here would
REM  be garbled by the GBK code page).
REM
REM  NEVER deleted:
REM    %APPDATA%\atelier              - your REAL data (db + backups)
REM    %LOCALAPPDATA%\Atelier\release - installers
REM    %LOCALAPPDATA%\Programs\Atelier - installed app
REM =====================================================================

set "BASE=%LOCALAPPDATA%\Atelier"
set /a TOTAL=0
set /a COUNT=0

echo.
echo ========================================================
echo  Atelier test folder cleanup
echo  Base: %BASE%
echo ========================================================
echo.

if not exist "%BASE%" (
  echo [skip] %BASE% not found
  goto done
)

for /d %%D in ("%BASE%\P6.*") do (
  set "T=%%~fD"
  REM Safety: must be a direct child of %BASE%
  for %%A in ("!T!") do set "PARENT=%%~dpA"
  if /I not "!PARENT!"=="%BASE%\" (
    echo [ABORT] not a direct child: !T!
  ) else (
    set "SZ=0"
    for /f "usebackq" %%S in (`powershell -NoProfile -Command "(Get-ChildItem -LiteralPath '!T!' -Recurse -File -ErrorAction SilentlyContinue ^| Measure-Object -Property Length -Sum).Sum"`) do set "SZ=%%S"
    echo [del ] !T!
    rmdir /S /Q "!T!" 2>nul
    if exist "!T!" (
      echo [WARN] could not fully delete - something is using it.
      echo        Close Atelier and run this again.
    ) else (
      echo [ok  ] deleted
      set /a COUNT+=1
      if not "!SZ!"=="" set /a TOTAL+=!SZ!
    )
  )
)

:done
echo.
echo --------------------------------------------------------
echo  Deleted %COUNT% folder(s), about %TOTAL% bytes freed
echo --------------------------------------------------------
echo.
echo Kept (never touched):
echo   %APPDATA%\atelier               (your real data)
echo   %BASE%\release                  (installers)
echo   %LOCALAPPDATA%\Programs\Atelier (installed app)
echo.
pause
exit /b 0
