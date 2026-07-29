import { defineConfig } from 'astro/config';
import dry from 'drycms';
/*
dry({
	storage: {
		kind: 'github'
	},
	content: {
		engine: "file",
		kind: "github"
	},
})
*/
export default defineConfig({
	integrations: [dry()],
});
