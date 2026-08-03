# Server-rendered client config

## Plan

- Replace the Vite virtual config module with a server-injected browser config.
- Inject the same resolved values in dev and production HTML responses.
- Update client imports and TypeScript declarations.
- Test escaping, typecheck, build, and verify a real dev HTML response.

## Status

- Completed. `window.__DRY_CONFIG__` now carries `path` and `contentEngine` from the server-resolved config.
- The old `virtual:drycms/config` Vite plugin and all client imports were removed.
- HTML-sensitive config values are escaped before entering the inline script.

## Speed

- Validation complete: 56 test files, 591 tests, typecheck, production build, and a live dev-server HTML check pass.
