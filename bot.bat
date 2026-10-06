@echo off
cd /d "%~dp0"

REM ==========================================
REM Check if port 3000 is already in use
REM ==========================================

netstat -ano | findstr ":3000" | findstr "LISTENING" >nul

if %errorlevel% == 0 (
    start "" "http://localhost:3000/admin"
    exit /b 0
)

REM ==========================================
REM Start development server
REM ==========================================

start "Server" cmd /k "npm run dev"

REM ==========================================
REM Wait until port 3000 is available
REM ==========================================

:WAIT_FOR_SERVER

timeout /t 1 /nobreak >nul

netstat -ano | findstr ":3000" | findstr "LISTENING" >nul

if %errorlevel% == 0 (
    start "" "http://localhost:3000/admin"
    exit /b 0
)

goto WAIT_FOR_SERVER