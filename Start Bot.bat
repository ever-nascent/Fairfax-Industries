@echo off
cd /d "%~dp0"
title Fairfax Industries Bot
echo Checking dependencies...
call npm install --no-audit --no-fund --prefer-offline
if errorlevel 1 (
  if not exist node_modules goto :fail
  echo Could not update the packages, starting with the ones already installed.
)
rem The bot registers its slash commands itself on startup, only when one changed.
echo Starting bot...
call npm start
:fail
echo.
pause
