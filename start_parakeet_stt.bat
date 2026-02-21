@echo off
echo Starting Parakeet TDT STT Server...
echo.
echo Make sure you have installed the required packages:
echo   pip install -r parakeet-tdt-0.6b-v2/requirements.txt
echo.
echo If this is the first run, the model will be downloaded automatically.
echo This may take several minutes depending on your internet connection.
echo.
cd /d "%~dp0"
python -m uvicorn parakeet-tdt-0.6b-v2.app:app --host 0.0.0.0 --port 8000
