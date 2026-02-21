# Omnix Dockerfile
# Use NVIDIA CUDA base image for GPU support
FROM nvidia/cuda:12.4.0-runtime-ubuntu22.04

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Install Python 3.10 and system dependencies
RUN apt-get update && apt-get install -y \
    python3.10 \
    python3.10-venv \
    python3-pip \
    gcc \
    g++ \
    libsndfile1 \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set python3.10 as default
RUN update-alternatives --install /usr/bin/python python /usr/bin/python3.10 1 \
    && update-alternatives --install /usr/bin/pip pip /usr/bin/pip3 1

# Set working directory
WORKDIR /app

# Install PyTorch with CUDA 12.4 support FIRST (critical for version matching)
RUN pip install --no-cache-dir \
    torch==2.6.0+cu124 \
    torchvision==0.21.0+cu124 \
    torchaudio==2.6.0+cu124 \
    --index-url https://download.pytorch.org/whl/cu124

# Copy requirements file
COPY requirements.txt .

# Install Python dependencies (excluding torch - already installed)
RUN pip install --no-cache-dir -r requirements.txt || true

# Install Chatterbox TTS
RUN pip install --no-cache-dir chatterbox-tts==0.1.6

# Install NeMo ASR for Parakeet STT
RUN pip install --no-cache-dir "nemo_toolkit[asr]"

# Pre-download Parakeet TDT 0.6B model
RUN python -c "from nemo.collections.asr.models import ASRModel; ASRModel.from_pretrained('nvidia/parakeet-tdt-0.6b-v2'); print('Parakeet model downloaded!')"

# Copy application files
COPY . .

# Create directories
RUN mkdir -p /app/data

# Expose ports
# 5000: Main Flask app
# 8000: STT server (Parakeet)
# 8001: Realtime server
# 8020: TTS server (Chatterbox)
EXPOSE 5000 8000 8001 8020

# Set environment variables
ENV FLASK_APP=app.py

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

# Default command - run main app
CMD ["python", "app.py"]