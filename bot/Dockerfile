FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy bot source
COPY main.py .

# Create non-root user
RUN useradd -m -u 1000 botuser
USER botuser

# Environment variables
ENV TELEGRAM_BOT_TOKEN=""
ENV APP_URL=""

# Run bot
CMD ["python", "main.py"]
