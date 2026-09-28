@echo off
cd /d "%~dp0"
title Fairfax Industries Bot
echo Checking dependencies...
call npm install --no-audit --no-fund || goto :fail
echo Registering slash commands...
call npm run deploy || goto :fail
echo Starting bot...
call npm start
:fail
echo.
pause
