# Dev Notes

## Clean dev restarts
When restarting the app, stop any old server bound to port 3000 and any lingering `node dist/server.js` process.

Preferred command:
```bash
npm run dev:clean
```

What it does:
- Loads variables from `.env` if present.
- Kills anything listening on `APP_PORT` (defaults to 3000).
- Kills `node dist/server.js` if it is still running.
- Starts `npm run dev`.

If you want to do it manually:
```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
kill <pid>
```

## Repo hygiene
Always keep `.DS_Store` out of the repo. It should be ignored via `.gitignore`.

## Docker Hub multi-arch reminder
If you see this error when pulling on Linux:
```
no matching manifest for linux/amd64 in the manifest list entries
```
it means the image was pushed without a linux/amd64 manifest (often when building on macOS).

Fix: use buildx to push a multi-arch manifest:
```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t kaoshonen/receipty:latest -t kaoshonen/receipty:<version> --push .
```

Reminder: always use the buildx multi-arch command when publishing to Docker Hub.
