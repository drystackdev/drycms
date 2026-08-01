Plan
- Add per-file optimize switches in the upload dialog for jpg/jpeg/png/webp only.
- Optimize selected images client-side to WebP, max width 1024px, preserving PNG alpha.
- Upload the final files and use final names/sizes for duplicate checks and optimistic placeholders.

Status
- Added the client optimize helper.
- Added per-file optimize switches in the upload dialog.
- Wired upload to optimize files before duplicate checks/placeholders.
- Added focused unit tests for optimize eligibility and final WebP names.
- Added decode fallback for browsers where `createImageBitmap` cannot handle a file.
- Verified TypeScript and targeted tests pass.
- Verified upload row layout in Chromium for light/dark and PNG alpha preservation after WebP optimization.

Speed
- Small UI/client pipeline change; no server contract change planned.
