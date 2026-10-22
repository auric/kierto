# User directory

A small service that serves user profiles to the team pages.

- `src/users/repo.ts` reads and writes the `users` table.
- `src/users/service.ts` holds the lookups that the HTTP handlers use.
- `src/http/routes.ts` maps the routes to the service.
