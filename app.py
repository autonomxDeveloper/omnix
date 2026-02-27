"""
LM Studio Chatbot - Flask Backend
Modular version using Blueprints
"""
from flask import Flask

# Import Blueprints
from app.core import core_bp
from app.chat import chat_bp
from app.services import services_bp
from app.audio import audio_bp
from app.audiobook import audiobook_bp
from app.podcast import podcast_bp
from app.llm import llm_bp
from app.llamacpp import llamacpp_bp

def create_app():
    # Force Flask to look for templates and static files in the root directory
    app = Flask(__name__, template_folder='templates', static_folder='static')
    
    # Register all Blueprints
    app.register_blueprint(core_bp)
    app.register_blueprint(chat_bp)
    app.register_blueprint(services_bp)
    app.register_blueprint(audio_bp)
    app.register_blueprint(audiobook_bp)
    app.register_blueprint(podcast_bp)
    app.register_blueprint(llm_bp)
    app.register_blueprint(llamacpp_bp)
    
    return app

if __name__ == '__main__':
    app = create_app()
    print("\n" + "=" * 50)
    print("Running with HTTP on http://0.0.0.0:5000")
    print("=" * 50 + "\n")
    app.run(debug=False, host='0.0.0.0', port=5000, use_reloader=False)