import { mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir(new URL("../src/vendor/", import.meta.url), { recursive: true });
await build({
  stdin: { contents: 'export { createClient } from "@supabase/supabase-js";', resolveDir: process.cwd(), sourcefile: "supabase-browser-entry.js", loader: "js" },
  outfile: "src/vendor/supabase.js",
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: true,
  sourcemap: false,
  legalComments: "eof"
});
console.log("Built local Supabase browser client");
