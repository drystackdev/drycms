import { defineConfig } from "astro/config";
import dry from "drycms";

export default defineConfig({
  integrations: [
    dry({
      content: {
        engine: "file",
        kind: "github",
      },
      storage: {
        kind: "github",
      },
    }),
  ],
});
