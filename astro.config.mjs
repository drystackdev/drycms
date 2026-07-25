import { defineConfig } from 'astro/config';
import dry from 'drycms';

export default defineConfig({
	integrations: [dry({ storage: { kind: 'github' } })],
});
