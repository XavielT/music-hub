FROM python:3.13-slim

# ffmpeg does the audio extraction; yt-dlp shells out to it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

# Not root: this process runs a downloader against untrusted input.
RUN useradd --create-home --uid 10001 companion
USER companion

# Free tiers hand the port over in $PORT and differ on what it is.
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
