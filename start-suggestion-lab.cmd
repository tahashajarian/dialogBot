@echo off
cd /d "%~dp0"
echo Starting Muze Suggestion Lab...
npm.cmd run qa:suggestions:web
if errorlevel 1 pause
