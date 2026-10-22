# Build Board

A dashboard for build pipelines.

## Configuration

Settings come from three layers. A later layer wins:

1. The defaults in the code.
2. `config/overrides.json`. This file is optional. Most installations do not have it.
3. The values that admins save through `PUT /v1/settings/...`.

See `docs/api.md` for the settings endpoints.
