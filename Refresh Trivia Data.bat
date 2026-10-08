@echo off
title Refresh Trivia Data
cd /d "%~dp0"
echo.
echo  Rebuilds the /trivia questions from deadlock.wiki (run it after a game patch or a new hero).
echo  It never touches Discord or the bot's data. Nothing is saved if the download has a problem.
echo.
echo   1  check    show what would change, save nothing
echo   2  refresh  download and save
echo   0  quit
echo.
set /p choice=Pick a number: 
if "%choice%"=="1" node tools/trivia-data.js --check
if "%choice%"=="2" node tools/trivia-data.js
if "%choice%"=="0" exit /b
echo.
pause
