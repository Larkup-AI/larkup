# Docker

The Docker image runs the Larkup dashboard on port `4567`. Local Knowledge Servers launched from the dashboard use the first available port from `8080` through `8090`.

```bash
docker compose -f docker/docker-compose-prod.yaml up -d --build
```

Open `http://localhost:4567`. Keep the `larkup_data` volume: it contains project settings, documents, vector indexes, media, and installed tools. `media_tmp` is disposable working storage.

The image is built for Linux AMD64 and ARM64. Docker Desktop supports macOS and Windows hosts; native Linux uses the same Compose file.

Before merging container changes, build the image and run the Docker E2E suite:

```bash
docker build -f docker/Dockerfile .
docker compose -f docker/docker-compose.e2e.yml up --build --abort-on-container-exit
```
