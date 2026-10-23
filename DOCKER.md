# Container Operations

Studio publishes two images: `ghcr.io/maxexcloo/studio` for the application and `ghcr.io/maxexcloo/studio-worker` for GPU runtimes. Use exact verified version tags in deployments.

## Application

Mount persistent data at `/data` and the `ai` configuration checkout at `/config:ro`. Set `STUDIO_CONFIG_DIR=/config` and configure workers, authentication and provider credentials using [Configuration](CONFIGURATION.md). Generated media and editable profiles, guides and catalogue data remain in the Studio data mount. The ai mount supplies workload metadata and fills only missing seed definitions; worker model files belong on worker mounts.

```sh
docker build -t studio:development .
docker run --rm --init -p 127.0.0.1:8787:8787 \
  -e STUDIO_DOCKER_HOST_ONLY=1 \
  -e STUDIO_CONFIG_DIR=/config \
  -e STUDIO_OUTPUT_STORAGE=studio \
  -v studio-data:/data \
  -v /absolute/path/to/ai:/config:ro \
  studio:development
```

`docker compose -f docker-compose.yaml up --build` also works after setting the configuration mount and worker list described in that file. The localhost-only port binding and `STUDIO_DOCKER_HOST_ONLY` setting belong together.

Run one application replica. Kubernetes deployments use `Recreate`; two schedulers must not control the same workers or SQLite database. Back up data while Studio is stopped, or use a SQLite-aware snapshot for the database alongside its media files. Never copy a live SQLite database without its WAL state.

## Workers & Admission

Build the worker from the Studio checkout:

```sh
docker build -f worker/Dockerfile -t studio-worker:development .
```

[Worker operations](worker/README.md) describe fixed placements, lease mounts, media/text launch modes, the forwarded Docker Engine connection and text admission. Keep compatible workers warm. Lifecycle switching stays disabled until AI Control has relinquished ownership and local text traffic uses Studio admission.

## Updating & Rollback

Pull the verified application and worker versions, stop Studio, back up runtime state and rehearse the [SQLite migration and restoration](CONFIGURATION.md#sqlite-migration--rollback) in a separate directory. Verify generation, saved results, ownership and old result links before updating the live deployment.

Retain the previous image and protected backup until cutover is accepted. Reverting an application image alone does not restore metadata created in SQLite; restore the matching pre-migration metadata after stopping the rewritten application. Media paths and existing identifiers are preserved.
