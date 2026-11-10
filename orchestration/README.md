# Orchestration (Dagster)

The code location for the platform's orchestrator. First pass: each dataset the registry in
`packages/atlas-data` records (`app.dataset_lineage`) appears as an observable asset, and the
job `quan_sat_dang_ky` reads its stage states (`app.dataset_stage_state`). The schedule for that
job ships stopped.

It runs in Compose behind oauth2-proxy (Keycloak sign-in, realm role `dieu-phoi`); see
`infra/docker-compose.platform.yml` and `docs/superpowers/specs/2026-11-09-platform-shell-sso-design.md`.

Check the definitions load without the UI:

```sh
docker compose -p webatlas -f infra/docker-compose.yml -f infra/docker-compose.platform.yml \
  run --rm --no-deps dagster-webserver dagster definitions validate -w /opt/dagster/app/workspace.yaml
```
