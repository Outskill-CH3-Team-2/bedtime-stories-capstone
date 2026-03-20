# --- Stage 1: Build Frontend ---
# USING NODE 20 to bypass the known npm v8 bug with optional dependencies
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend

# 1. Copy EVERYTHING from the frontend folder
COPY frontend/ ./

# 2. Clean slate and install using the fixed npm version
RUN rm -rf node_modules package-lock.json && \
    npm install

# Inject the production backend URL during the build process
ARG VITE_BACKEND_URL
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL

# 3. Build the production-ready static files
RUN npm run build

# --- Stage 2: Final Production Image ---
# We switch to a lightweight Python image for the actual server
FROM python:3.12-slim
WORKDIR /app

# Install system-level dependencies required for FAISS (RAG) and PDF parsing
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install Python backend dependencies
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy the backend source code
COPY backend/ ./backend/

# Copy the compiled React app from the first stage
# This lands in a folder called 'static' which FastAPI will serve
COPY --from=frontend-builder /app/frontend/dist ./static

# Ensure the RAG data directory exists for persistent storage
RUN mkdir -p /app/rag_data

# Expose the port defined in your .env (default 8000)
EXPOSE 8000

# Set environment variables for production
# STATIC_DIR tells main.py where to find the React index.html
ENV STATIC_DIR=/app/static
ENV PYTHONUNBUFFERED=1

# Start the application using your custom run script
CMD ["python", "backend/run.py"]