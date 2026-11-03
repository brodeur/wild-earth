# Wild Earth, hosted (docs/hosting.md): the dev server as it is, serving the client, the built tiles and the hub from one
# origin. The pipeline is not installed (builds are off on the host; tiles are built on a workstation and shipped in the
# image), so the image is Python and pyproj. State that must outlive a deploy (the hub's accounts, the played game
# worlds) lives on the volume at /app/data; deploy/entrypoint.sh points the tiles' game folders at it.
# Build from a checkout that has the tiles' rasters (they are git-ignored; .dockerignore keeps the pipeline's
# intermediates out): docker build -t wild-earth .
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
RUN pip install pyproj==3.7.1
COPY server.py hub.py ws.py digworld.py carrionworld.py ./
COPY pipeline/ pipeline/
COPY library/ library/
COPY client/ client/
COPY tiles/ tiles/
COPY deploy/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh && mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 8080
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["python", "server.py", "--port", "8080", "--bind", "0.0.0.0"]
