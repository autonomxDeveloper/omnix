import os
import time
import threading
import urllib.request
import json
from flask import Blueprint, request, jsonify
import app.shared as shared

llamacpp_bp = Blueprint('llamacpp', __name__)

def get_latest():
    try:
        req = urllib.request.Request("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest", headers={'User-Agent': 'Omnix/1.0'})
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read()).get('tag_name', 'b3650').lstrip('b')
    except: return "b3650"

@llamacpp_bp.route('/api/llamacpp/releases', methods=['GET'])
def get_releases():
    import platform
    sys, mach = platform.system().lower(), platform.machine().lower()
    rec = "windows-cublas" if sys == "windows" else "macos-arm" if sys == "darwin" and "arm" in mach else "linux-cublas" if sys == "linux" else "windows"
    
    ver = get_latest()
    rels = [
        {"id": "windows-cublas", "name": "Windows (CUDA)", "url": f"https://github.com/ggml-org/llama.cpp/releases/download/b{ver}/llama-b{ver}-bin-win-cuda-cu12.2-x64.zip", "extension": ".zip"},
        {"id": "windows", "name": "Windows (CPU only)", "url": f"https://github.com/ggml-org/llama.cpp/releases/download/b{ver}/llama-b{ver}-bin-win-x64.zip", "extension": ".zip"},
        {"id": "macos-arm", "name": "macOS (Apple Silicon)", "url": f"https://github.com/ggml-org/llama.cpp/releases/download/b{ver}/llama-b{ver}-bin-macos-arm64.tar.gz", "extension": ".tar.gz"},
        {"id": "linux-cublas", "name": "Linux (CUDA)", "url": f"https://github.com/ggml-org/llama.cpp/releases/download/b{ver}/llama-b{ver}-bin-ubuntu-x64-cuda-cu12.2.tar.gz", "extension": ".tar.gz"}
    ]
    for r in rels: r['recommended'] = (r['id'] == rec)
    return jsonify({"success": True, "latest_version": ver, "releases": rels})

@llamacpp_bp.route('/api/llamacpp/server/status', methods=['GET'])
def server_status():
    server_dir = os.path.join(shared.BASE_DIR, 'models', 'server')
    binary = next((n for n in ["llama-server.exe", "llama-server", "llama.exe", "llama"] if os.path.exists(os.path.join(server_dir, n))), None)
    return jsonify({"success": True, "server_dir": server_dir, "binary_found": bool(binary), "binary_name": binary})

@llamacpp_bp.route('/api/llamacpp/server/start', methods=['POST'])
def start_server():
    model = request.get_json().get('model', '')
    if not model: return jsonify({"success": False, "error": "Model required"}), 400
    
    s_dir = os.path.join(shared.BASE_DIR, 'models', 'server')
    binary = next((n for n in ["llama-server.exe", "llama-server", "llama.exe", "llama"] if os.path.exists(os.path.join(s_dir, n))), None)
    if not binary: return jsonify({"success": False, "error": "Binary not found"}), 400
    
    m_path = model if os.path.isabs(model) else next((p for p in [os.path.join(shared.BASE_DIR, 'models', 'llm', model), os.path.join(s_dir, model)] if os.path.exists(p)), None)
    if not m_path: return jsonify({"success": False, "error": "Model file not found"}), 400
    
    port = 8080
    try: port = int(shared.load_settings().get('llamacpp', {}).get('base_url', '').split(':')[-1])
    except: pass

    try:
        import subprocess as sp
        sp.run(f'netstat -ano | findstr :{port} | findstr LISTENING | awk \'{{print $5}}\' | xargs taskkill /F /PID 2>nul', shell=True)
        time.sleep(1)
        proc = sp.Popen([os.path.join(s_dir, binary), "-m", m_path, "-c", "4096", "-ngl", "999", "--host", "0.0.0.0", "--port", str(port)], cwd=s_dir, stdout=sp.PIPE, stderr=sp.STDOUT)
        return jsonify({"success": True, "message": f"Started on port {port}", "pid": proc.pid})
    except Exception as e: return jsonify({"success": False, "error": str(e)}), 500

@llamacpp_bp.route('/api/llamacpp/server/stop', methods=['POST'])
def stop_server():
    try:
        import subprocess as sp
        port = 8080
        try: port = int(shared.load_settings().get('llamacpp', {}).get('base_url', '').split(':')[-1])
        except: pass
        sp.run(f'netstat -ano | findstr :{port} | findstr LISTENING | awk \'{{print $5}}\' | xargs taskkill /F /PID 2>nul', shell=True)
        return jsonify({"success": True, "message": f"Stopped port {port}"})
    except Exception as e: return jsonify({"success": False, "error": str(e)}), 500