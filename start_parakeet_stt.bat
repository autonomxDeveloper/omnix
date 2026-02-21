@echo off
echo Starting Parakeet TDT STT Server...
echo.
echo Make sure you have installed: pip install nemo_toolkit[asr]
echo.
echo If this is the first run, the model will be downloaded automatically.
echo.
cd /d "%~dp0"
python parakeet_stt_server.py
