# Omnix

A modern AI voice platform by Autonomx - featuring chat, audiobook generation, AI podcasts, live conversation, and voice cloning.

![Omnix Logo](logo/omnix.png)

## Features

- **💬 Chat Interface**: Modern chat UI with markdown support
- **📚 Audiobook Reader**: Convert text to audio with multiple voices
- **🎙️ AI Podcast Generator**: Create AI-generated podcast episodes
- **🎤 Live Conversation**: Real-time voice-based conversation with AI
- **👤 Voice Cloning**: Clone your voice from audio recordings
- **🗣️ Text-to-Speech (TTS)**: Using Chatterbox for natural voice synthesis
- **👂 Speech-to-Text (STT)**: Using Parakeet for voice transcription
- **🎭 AI Roleplay** *(coming soon)*: Interactive role-playing experiences
- **🔌 Multiple Providers**: Cerebras (fastest), OpenRouter (cloud), LM Studio (local)

## Prerequisites

1. **Python 3.8 or higher** - [Download Python](https://www.python.org/)
2. **LM Studio** - [Download LM Studio](https://lmstudio.ai/) (for local models)
3. A model loaded in LM Studio with server enabled

## Quick Start

### 1. Install Dependencies

Run the setup script:
```bash
setup.bat
```

Or manually install:
```bash
pip install -r requirements.txt
```

### 2. Start LM Studio

1. Open LM Studio
2. Download and load a model (e.g., Llama 3, Mistral)
3. Enable the server (default: http://localhost:1234)

### 3. Start the Chatbot

```bash
python app.py
```

Then open your browser to http://localhost:5000

## Project Structure

```
Chatbot/
├── app.py                 # Main Flask application
├── requirements.txt       # Python dependencies
├── setup.bat            # Setup script
├── start_chatbot.bat    # Start chatbot only
├── start_parakeet_stt.bat # Start STT server only
├── start_all.bat        # Start all services
├── templates/
│   └── index.html      # Frontend HTML
├── static/
│   ├── script.js      # Frontend JavaScript
│   └── style.css      # Frontend styles
├── data/               # Session and settings storage
├── parakeet-tdt-0.6b-v2/  # Parakeet STT server
└── xtts_mantella_api_server/ # XTTS TTS server
```

## Usage

### Regular Chat
- Type messages in the input box
- Press Enter or click Send
- Click the speaker icon to have AI responses read aloud

### Voice Cloning
1. Click the voice clone button (microphone icon)
2. Enter a name for your voice clone
3. Hold the record button and speak for 10+ seconds
4. Click Save Voice

### Conversation Mode
1. Click the voice mode toggle button
2. Hold the microphone button to speak
3. The AI will respond with synthesized speech
4. Click Exit to return to regular chat

### Service Management
- TTS and STT status indicators in the header
- Click on status to open control panel
- Start/Stop/Restart servers as needed
- View server logs

## Configuration

Edit `data/settings.json` or use the Settings modal:
- Provider: LM Studio (local) or OpenRouter (cloud)
- Model selection
- System prompt
- API keys (for OpenRouter)

## Troubleshooting

### Chatbot won't start
- Ensure Python is installed: `python --version`
- Install dependencies: `pip install -r requirements.txt`

### TTS not working
- Make sure XTTS server is running
- Check status in the header - click to manage

### STT not working
- Make sure Parakeet STT is running
- Check microphone permissions in browser

### LM Studio not connecting
- Verify LM Studio is running
- Check server is enabled in LM Studio Developer page
- Verify base URL in settings (default: http://localhost:1234)

## License

MIT
