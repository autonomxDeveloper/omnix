#!/bin/bash

echo "================================================"
echo "Omnix - Full Launcher"
echo "================================================"
echo ""
echo "This will start:"
echo "  1. Parakeet STT Server (port 8000) - Voice recognition"
echo "  2. Chatterbox TTS TURBO (port 8020) - Fast English voice synthesis"
echo "  3. Realtime WebSocket Server (port 8001) - Streaming voice chat"
echo "  4. Chatbot Web Server (port 5000) - Main application"
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
    kill $STT_PID $TTS_PID $REALTIME_PID $CHATBOT_PID 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM

# Start Parakeet STT Server in background
echo "[1/4] Starting Parakeet STT Server on port 8000..."
if [ -d "$SCRIPT_DIR/parakeet-tdt-0.6b-v2" ]; then
    cd "$SCRIPT_DIR/parakeet-tdt-0.6b-v2"
    python app.py &
    STT_PID=$!
    cd "$SCRIPT_DIR"
else
    echo "WARNING: parakeet-tdt-0.6b-v2 directory not found - STT will not be available"
    echo "You can clone it from: https://github.com/NVIDIA/NeMo"
    STT_PID=""
fi

# Wait a bit for STT to start
sleep 5

# Start Chatterbox TTS TURBO Server in background
echo "[2/4] Starting Chatterbox TTS TURBO on port 8020..."
python chatterbox_tts_server.py &
TTS_PID=$!

# Wait a bit for TTS to start
sleep 5

# Start Realtime WebSocket Server in background
echo "[3/4] Starting Realtime Server on port 8001..."
python realtime_server.py &
REALTIME_PID=$!

# Wait a bit for realtime server to start
sleep 3

# Start Chatbot (foreground)
echo "[4/4] Starting Chatbot on port 5000..."
echo ""
python app.py &
CHATBOT_PID=$!

# Wait for chatbot
wait $CHATBOT_PID

# Cleanup when done
cleanup