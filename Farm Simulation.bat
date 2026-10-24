@echo off
title Farm Simulation
cd /d "%~dp0"
set hero=Haze
:menu
echo.
echo  Hero Farming balance simulations (they never touch the bot's data)   Hero: %hero%
echo   1  ladder   does each target open at its level?
echo   2  siege    what a full siege run needs
echo   3  growth   how clearing a target again and again changes it
echo   4  tune     the enemy damage that gives typical builds 55 percent wins
echo   5  rank     how much each shop item helps
echo   6  check    does this hero pass every target? (run it for every new hero)
echo   8  lanes    the three Walkers and the siege they open
echo   9  waves    how far a wave run gets and what it pays
echo   D  descend  how deep /descend runs get: random picks against good picks
echo   R  race     every hero from nothing: +1 level, +1 item ... who wins each target first (about 4 minutes)
echo   7  change the hero
echo   0  quit
echo.
set /p choice=Pick a number: 
if "%choice%"=="1" node tools/farm-sim.js ladder --hero=%hero%
if "%choice%"=="2" node tools/farm-sim.js siege --hero=%hero%
if "%choice%"=="3" node tools/farm-sim.js growth --hero=%hero%
if "%choice%"=="4" node tools/farm-sim.js tune --hero=%hero%
if "%choice%"=="5" node tools/farm-sim.js rank --hero=%hero%
if "%choice%"=="6" node tools/farm-sim.js check --hero=%hero%
if "%choice%"=="8" node tools/farm-sim.js lanes --hero=%hero%
if "%choice%"=="9" node tools/farm-sim.js waves --hero=%hero%
if /i "%choice%"=="D" node tools/farm-sim.js descend --hero=%hero%
if /i "%choice%"=="R" node tools/farm-sim.js race
if "%choice%"=="7" set /p hero=Hero name: 
if "%choice%"=="0" exit /b
goto menu
