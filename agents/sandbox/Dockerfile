# Isolated test-execution image. pytest baked in so runs need NO network.
FROM python:3.12-slim
RUN pip install --no-cache-dir pytest==8.3.4
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONPYCACHEPREFIX=/tmp/pycache
WORKDIR /work
