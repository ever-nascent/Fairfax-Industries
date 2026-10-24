@echo off
cd /d "%~dp0"
title Fairfax Industries Bot
rem First the latest version from GitHub (his call, Oct 16): main is pulled, then this file starts again so its new version runs.
rem The pull and the restart sit in one ( ) block: cmd reads a block whole, so a pull that changes this file can't mix old and new lines.
rem Only a fast-forward: anything changed or committed on this PC is never overwritten; the bot then starts with the files here.
set "GIT=git"
where git >nul 2>nul || for /d %%d in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do if exist "%%d\resources\app\git\cmd\git.exe" set "GIT=%%d\resources\app\git\cmd\git.exe"
set GIT_TERMINAL_PROMPT=0
if not "%~1"=="updated" (
  echo Getting the latest version from GitHub...
  "%GIT%" --version >nul 2>nul
  if errorlevel 1 (
    echo Git was not found, starting with the files on this PC.
  ) else (
    "%GIT%" rev-parse --abbrev-ref HEAD | findstr /x main >nul
    if errorlevel 1 (
      echo This folder is not on the main branch, so nothing was pulled. Switch it to main once ^(GitHub Desktop: Current branch^). It is on:
      "%GIT%" branch --show-current
    ) else (
      "%GIT%" pull --ff-only origin main
      if errorlevel 1 echo Could not update from GitHub ^(see above^), starting with the files on this PC.
    )
  )
  echo.
  "%~f0" updated
)
echo Checking dependencies...
call npm install --no-audit --no-fund --prefer-offline
if errorlevel 1 (
  if not exist node_modules goto :fail
  echo Could not update the packages, starting with the ones already installed.
)
rem Once a day: new heroes are reported; hero images, rival portraits and emojis are fetched by the wiki's file hash; trivia and Hero Farming data are refreshed when their pages changed (tools/startup-check.js). Other starts: nothing to do.
echo Checking the bot's data...
call node tools/startup-check.js
echo.
rem The bot registers its slash commands itself on startup, only when one changed.
echo Starting bot...
call npm start
:fail
echo.
pause
