#!/bin/bash

echo "================================================"
echo "Omnix - Full Launcher"
echo "================================================"
echo ""
echo "This will start:"
echo "  1. Parakeet STT Server (port 8000) - Voice recognition"
echo "  2. Chatterbox TTS TURBO (port 8020) - Fast English voice synthesis"
echo "  3. Chatbot Web Server (port 5000) - Main application"
echo ""
echo "Note: Make sure LM Studio is running with a model loaded."
echo "      Or use Cerebras/OpenRouter API in settings."
echo ""
echo "Starting services..."
echo ""

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Install dependencies
echo "[Setup] Installing Python dependencies..."
pip install -q fastapi uvicorn websockets aiohttp pydub numpy soundfile 2>/dev/null

# Function to cleanup background processes on exit
cleanup() {
    echo ""
    echo "Shutting down services..."
    kill $STT_PID $TTS_PID $CHATBOT_PID 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM

# Start Parakeet STT Server in background
echo "[1/3] Starting Parakeet STT Server on port 8000..."
if [ -f "$SCRIPT_DIR/parakeet_stt_server.py" ]; then
    python parakeet_stt_server.py &
    STT_PID=$!
else
    echo "WARNING: parakeet_stt_server.py not found - STT will not be available"
    echo "Run setup to install nemo_toolkit[asr]."
    STT_PID=""
fi

# Wait a bit for STT to start
sleep 5

# Start Chatterbox TTS TURBO Server in background
echo "[2/3] Starting Chatterbox TTS TURBO on port 8020..."
python chatterbox_tts_server.py &
TTS_PID=$!

# Wait a bit for TTS to start
sleep 5


# Start Chatbot (foreground)
echo "[3/3] Starting Chatbot on port 5000..."
echo ""
python app.py &
CHATBOT_PID=$!

# Wait for chatbot
wait $CHATBOT_PID

# Cleanup when done
cleanup