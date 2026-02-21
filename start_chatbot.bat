@echo off
echo ================================================
echo LM Studio Chatbot Launcher
echo ================================================
echo.

cd /d "%~dp0"

echo [1/3] Checking for existing services...
echo.

REM Kill any existing TTS processes on port 8020
echo Closing any existing TTS servers...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8020 ^| findstr LISTENING') do (
    taskkill /F /PID %%a 2>nul
)

REM Kill any existing Parakeet STT processes (python running app.py on port 8000)
echo Closing any existing STT servers...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a 2>nul
)

timeout /t 2 /nobreak >nul

echo [2/3] Starting CosyVoice 3.0 TTS server...
echo.
start "CosyVoice-TTS" cmd /k "python cosyvoice_tts_server.py"

echo [3/3] Starting Parakeet STT server...
echo.
start "Parakeet STT" cmd /k "cd /d "%~dp0parakeet-tdt-0.6b-v2" && python app.py"

echo.
echo Waiting for services to initialize...
echo CosyVoice 3.0 may take 20-30 seconds to load on first run...
echo.

REM Wait 30 seconds for services to start (CosyVoice takes longer)
timeout /t 30 /nobreak >nul

REM Check if TTS is running
echo Checking CosyVoice 3.0 TTS server status...
curl -s -o nul -w "%%{http_code}" http://localhost:8020/health 2>nul > tts_check.tmp
set /p TTS_STATUS=<tts_check.tmp
del tts_check.tmp 2>nul

if "%TTS_STATUS%"=="200" (
    echo [OK] CosyVoice 3.0 TTS server is running
) else (
    echo [WARNING] CosyVoice TTS server may not be ready yet (HTTP: %TTS_STATUS%^)
    echo You can start it manually from the web interface
)

REM Check if STT is running
echo Checking STT server status...
curl -s -o nul -w "%%{http_code}" http://localhost:8000/health 2>nul > stt_check.tmp
set /p STT_STATUS=<stt_check.tmp
del stt_check.tmp 2>nul

if "%STT_STATUS%"=="200" (
    echo [OK] STT server is running
) else (
    echo [WARNING] STT server may not be ready yet (HTTP: %STT_STATUS%^)
)

echo.
echo Starting chatbot server...
echo.
echo Services:
echo   - CosyVoice 3.0 TTS: http://localhost:8020
echo   - Parakeet STT: http://localhost:8000
echo   - Chatbot: http://localhost:5000
echo.

python app.py

echo.
echo Server closed. Press any key to exit...
pause >nul
