FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt constraints-cpu.txt ./
# The constraints swap torch for its CPU build (constraints-cpu.txt).
RUN pip install --no-cache-dir -r requirements.txt -c constraints-cpu.txt
# Pull Debian security patches at build time so the image isn't pinned to
# whatever package set Docker Hub last baked into python:3.12-slim. See #393.
# A cached layer keeps the patches of the day it was built, so the local scan
# sets APT_REFRESH to rerun this step (#565); it sits after the pip install so
# that rerun costs the upgrade alone, not the wheels.
ARG APT_REFRESH=
RUN apt-get update && apt-get upgrade -y \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY app/ ./app/
RUN useradd --create-home --shell /usr/sbin/nologin appuser && chown -R appuser:appuser /app
USER appuser
EXPOSE 8000
# `--limit-concurrency 8` caps in-flight requests; excess connections get a
# 503 instead of stacking unbounded threads (ASVS V4.1.1). The body-size cap
# is enforced via app/middleware.py (CV_MAX_BODY_BYTES, default 100 MB).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--limit-concurrency", "8"]
