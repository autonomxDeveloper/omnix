"""
Llama.cpp Installation Manager

Handles automatic installation of precompiled llama.cpp wheels and binaries.
Provides both Python wheel installation and binary download capabilities.
"""

import os
import sys
import subprocess
import platform
import json
import urllib.request
import zipfile
import tarfile
import shutil
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any
import threading
import time

from app.shared import BASE_DIR


class LlamaCppInstaller:
    """Manages installation of llama.cpp Python wheel and server binaries."""
    
    def __init__(self):
        self.base_dir = Path(BASE_DIR)
        self.models_dir = self.base_dir / "models"
        self.server_dir = self.models_dir / "server"
        self.llm_dir = self.models_dir / "llm"
        self.installation_status = {}
        self.installation_lock = threading.Lock()
        
        # Ensure directories exist
        self.server_dir.mkdir(parents=True, exist_ok=True)
        self.llm_dir.mkdir(parents=True, exist_ok=True)
    
    def get_system_info(self) -> Dict[str, str]:
        """Get system information for determining appropriate downloads."""
        sys_name = platform.system().lower()
        machine = platform.machine().lower()
        python_version = f"{sys.version_info.major}.{sys.version_info.minor}"
        
        # Determine OS
        if sys_name == "windows":
            os_type = "windows"
        elif sys_name == "darwin":
            os_type = "macos"
        elif sys_name == "linux":
            os_type = "linux"
        else:
            os_type = "unknown"
        
        # Determine architecture
        if "arm" in machine or "aarch64" in machine:
            arch = "arm64" if os_type == "macos" else "arm64"
        elif "64" in machine or machine in ["x86_64", "amd64"]:
            arch = "x64"
        else:
            arch = "x86"
        
        # Determine CUDA support
        cuda_available = self._check_cuda_availability()
        
        return {
            "os": os_type,
            "arch": arch,
            "python_version": python_version,
            "cuda_available": cuda_available,
            "full_machine": machine
        }
    
    def _check_cuda_availability(self) -> bool:
        """Check if CUDA is available on the system."""
        try:
            # Try to run nvidia-smi to check for CUDA
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader,nounits"],
                capture_output=True,
                text=True,
                timeout=5
            )
            return result.returncode == 0 and len(result.stdout.strip()) > 0
        except:
            return False
    
    def get_python_wheel_url(self) -> Tuple[str, str]:
        """Get the appropriate Python wheel URL based on system configuration."""
        sys_info = self.get_system_info()
        python_version = sys_info["python_version"]
        
        # Check if CUDA is available for GPU acceleration
        if sys_info["cuda_available"]:
            # Use CUDA wheel
            wheel_url = f"https://parisneo.github.io/llama-cpp-python-wheels/whl/cu121/llama_cpp_python-0.3.16-cp{python_version.replace('.', '')}-cp{python_version.replace('.', '')}-win_amd64.whl"
            wheel_name = f"llama_cpp_python-0.3.16-cp{python_version.replace('.', '')}-cp{python_version.replace('.', '')}-win_amd64.whl"
        else:
            # Use CPU wheel
            wheel_url = f"https://parisneo.github.io/llama-cpp-python-wheels/whl/cpu/llama_cpp_python-0.3.16-cp{python_version.replace('.', '')}-cp{python_version.replace('.', '')}-win_amd64.whl"
            wheel_name = f"llama_cpp_python-0.3.16-cp{python_version.replace('.', '')}-cp{python_version.replace('.', '')}-win_amd64.whl"
        
        return wheel_url, wheel_name
    
    def is_python_wheel_installed(self) -> bool:
        """Check if llama-cpp-python is installed."""
        try:
            import llama_cpp
            return True
        except ImportError:
            return False
    
    def install_python_wheel(self) -> Dict[str, Any]:
        """Install the llama-cpp-python wheel using pip."""
        with self.installation_lock:
            if self.is_python_wheel_installed():
                return {"success": True, "message": "llama-cpp-python is already installed"}
            
            wheel_url, wheel_name = self.get_python_wheel_url()
            
            try:
                # Install using pip with the custom index URL
                cmd = [
                    sys.executable, "-m", "pip", "install", "llama-cpp-python",
                    "--extra-index-url", "https://parisneo.github.io/llama-cpp-python-wheels/whl/cu121/" if "cu121" in wheel_url else "https://parisneo.github.io/llama-cpp-python-wheels/whl/cpu/"
                ]
                
                print(f"Installing llama-cpp-python with command: {' '.join(cmd)}")
                
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=300  # 5 minute timeout
                )
                
                if result.returncode == 0:
                    # Verify installation
                    if self.is_python_wheel_installed():
                        return {"success": True, "message": "llama-cpp-python installed successfully"}
                    else:
                        return {"success": False, "error": "Installation completed but verification failed"}
                else:
                    return {"success": False, "error": f"Installation failed: {result.stderr}"}
                    
            except subprocess.TimeoutExpired:
                return {"success": False, "error": "Installation timed out"}
            except Exception as e:
                return {"success": False, "error": f"Installation error: {str(e)}"}
    
    def get_server_binary_url(self) -> Tuple[str, str, str]:
        """Get the appropriate server binary URL based on system configuration."""
        sys_info = self.get_system_info()
        os_type = sys_info["os"]
        arch = sys_info["arch"]
        cuda_available = sys_info["cuda_available"]
        
        # Get latest version
        latest_version = self.get_latest_version()
        
        if os_type == "windows":
            if cuda_available:
                url = f"https://github.com/ggml-org/llama.cpp/releases/download/b{latest_version}/llama-b{latest_version}-bin-win-cuda-cu12.2-x64.zip"
                extension = ".zip"
                binary_name = "llama-server.exe"
            else:
                url = f"https://github.com/ggml-org/llama.cpp/releases/download/b{latest_version}/llama-b{latest_version}-bin-win-x64.zip"
                extension = ".zip"
                binary_name = "llama-server.exe"
        elif os_type == "macos":
            if arch == "arm64":
                url = f"https://github.com/ggml-org/llama.cpp/releases/download/b{latest_version}/llama-b{latest_version}-bin-macos-arm64.tar.gz"
                extension = ".tar.gz"
                binary_name = "llama-server"
            else:
                url = f"https://github.com/ggml-org/llama.cpp/releases/download/b{latest_version}/llama-b{latest_version}-bin-macos-x64.tar.gz"
                extension = ".tar.gz"
                binary_name = "llama-server"
        elif os_type == "linux":
            if cuda_available:
                url = f"https://github.com/ggml-org/llama.cpp/releases/download/b{latest_version}/llama-b{latest_version}-bin-ubuntu-x64-cuda-cu12.2.tar.gz"
                extension = ".tar.gz"
                binary_name = "llama-server"
            else:
                url = f"https://github.com/ggml-org/llama.cpp/releases/download/b{latest_version}/llama-b{latest_version}-bin-ubuntu-x64.tar.gz"
                extension = ".tar.gz"
                binary_name = "llama-server"
        else:
            raise ValueError(f"Unsupported operating system: {os_type}")
        
        return url, extension, binary_name
    
    def get_latest_version(self) -> str:
        """Get the latest llama.cpp version from GitHub API."""
        try:
            req = urllib.request.Request(
                "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest",
                headers={'User-Agent': 'Omnix/1.0'}
            )
            with urllib.request.urlopen(req, timeout=10) as response:
                data = json.loads(response.read())
                return data.get('tag_name', 'b3650').lstrip('b')
        except Exception:
            return "b3650"  # Fallback version
    
    def is_server_binary_available(self) -> bool:
        """Check if the server binary is available."""
        binary_names = ["llama-server.exe", "llama-server", "llama.exe", "llama"]
        for binary_name in binary_names:
            if (self.server_dir / binary_name).exists():
                return True
        return False
    
    def download_and_extract_server(self, progress_callback=None) -> Dict[str, Any]:
        """Download and extract the llama.cpp server binary."""
        with self.installation_lock:
            if self.is_server_binary_available():
                return {"success": True, "message": "Server binary already available"}
            
            url, extension, binary_name = self.get_server_binary_url()
            temp_file = self.server_dir / f"llama-cpp-download{extension}"
            
            try:
                # Download the file
                print(f"Downloading llama.cpp server from: {url}")
                
                def progress_hook(count, block_size, total_size):
                    if progress_callback and total_size > 0:
                        percent = int(count * block_size * 100 / total_size)
                        progress_callback({
                            "type": "download",
                            "progress": percent,
                            "message": f"Downloading... {percent}%"
                        })
                
                urllib.request.urlretrieve(url, temp_file, reporthook=progress_hook)
                
                if progress_callback:
                    progress_callback({
                        "type": "extract",
                        "progress": 0,
                        "message": "Extracting files..."
                    })
                
                # Extract based on file type
                if extension == ".zip":
                    with zipfile.ZipFile(temp_file, 'r') as zip_ref:
                        zip_ref.extractall(self.server_dir)
                elif extension == ".tar.gz":
                    with tarfile.open(temp_file, 'r:gz') as tar_ref:
                        tar_ref.extractall(self.server_dir)
                
                # Make binary executable on Unix systems
                if binary_name != "llama-server.exe":
                    binary_path = self.server_dir / binary_name
                    if binary_path.exists():
                        os.chmod(binary_path, 0o755)
                
                # Clean up temp file
                temp_file.unlink(missing_ok=True)
                
                if progress_callback:
                    progress_callback({
                        "type": "complete",
                        "progress": 100,
                        "message": "Installation complete!"
                    })
                
                return {"success": True, "message": "Server binary downloaded and extracted successfully"}
                
            except Exception as e:
                # Clean up on error
                temp_file.unlink(missing_ok=True)
                return {"success": False, "error": f"Download/extract failed: {str(e)}"}
    
    def get_installation_status(self) -> Dict[str, Any]:
        """Get comprehensive installation status."""
        sys_info = self.get_system_info()
        python_wheel_installed = self.is_python_wheel_installed()
        server_binary_available = self.is_server_binary_available()
        
        # Check if server is running
        server_running = self.is_server_running()
        
        return {
            "python_wheel": {
                "installed": python_wheel_installed,
                "version": self.get_python_wheel_version() if python_wheel_installed else None
            },
            "server_binary": {
                "available": server_binary_available,
                "binary_name": self.get_server_binary_name() if server_binary_available else None
            },
            "server_status": {
                "running": server_running
            },
            "system_info": sys_info,
            "recommended_action": self.get_recommended_action()
        }
    
    def get_python_wheel_version(self) -> Optional[str]:
        """Get the installed llama-cpp-python version."""
        try:
            import llama_cpp
            return getattr(llama_cpp, '__version__', 'unknown')
        except ImportError:
            return None
    
    def get_server_binary_name(self) -> Optional[str]:
        """Get the name of the available server binary."""
        binary_names = ["llama-server.exe", "llama-server", "llama.exe", "llama"]
        for binary_name in binary_names:
            if (self.server_dir / binary_name).exists():
                return binary_name
        return None
    
    def is_server_running(self) -> bool:
        """Check if the llama.cpp server is running."""
        try:
            import requests
            response = requests.get("http://localhost:8080/v1/models", timeout=2)
            return response.status_code == 200
        except:
            return False
    
    def get_recommended_action(self) -> str:
        """Get the recommended installation action based on current status."""
        python_installed = self.is_python_wheel_installed()
        binary_available = self.is_server_binary_available()
        
        if not python_installed and not binary_available:
            return "Install both Python wheel and server binary"
        elif not python_installed:
            return "Install Python wheel"
        elif not binary_available:
            return "Download server binary"
        else:
            return "All components installed - ready to use!"
    
    def install_complete(self, progress_callback=None) -> Dict[str, Any]:
        """Install both Python wheel and server binary."""
        results = {}
        
        # Install Python wheel
        print("Installing Python wheel...")
        wheel_result = self.install_python_wheel()
        results["python_wheel"] = wheel_result
        
        if progress_callback:
            progress_callback({
                "type": "python_wheel",
                "success": wheel_result["success"],
                "message": wheel_result.get("message", wheel_result.get("error", ""))
            })
        
        # Download server binary
        print("Downloading server binary...")
        binary_result = self.download_and_extract_server(progress_callback)
        results["server_binary"] = binary_result
        
        # Overall success
        overall_success = wheel_result["success"] and binary_result["success"]
        
        return {
            "success": overall_success,
            "message": "Complete installation finished" if overall_success else "Some components failed to install",
            "results": results
        }


# Global installer instance
_installer = LlamaCppInstaller()


def get_installer() -> LlamaCppInstaller:
    """Get the global installer instance."""
    return _installer