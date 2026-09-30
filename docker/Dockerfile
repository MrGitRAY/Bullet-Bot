FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MPLCONFIGDIR=/tmp/matplotlib
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home bot
COPY app ./app
COPY locales ./locales
COPY alembic.ini .
RUN mkdir /app/data && chown bot:bot /app/data
USER bot
CMD ["sh", "-c", "alembic upgrade head && exec python -m app.main"]
