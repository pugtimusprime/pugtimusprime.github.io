import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = resolve(import.meta.dirname, "..");
const workerUrl = pathToFileURL(resolve(projectRoot, "dist/server/index.js"));
workerUrl.searchParams.set("github-pages-export", Date.now().toString());
const { default: worker } = await import(workerUrl.href);
const environment = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
};
const context = { waitUntil() {}, passThroughOnException() {} };

async function render(pathname, output) {
  const response = await worker.fetch(
    new Request(`https://pugtimusprime.github.io${pathname}`, {
      headers: { accept: "text/html" },
    }),
    environment,
    context,
  );
  if (!response.ok) throw new Error(`Could not render ${pathname}: ${response.status}`);
  await mkdir(resolve(projectRoot, output, ".."), { recursive: true });
  await writeFile(resolve(projectRoot, output), await response.text());
}

const clientManifest = JSON.parse(
  await readFile(resolve(projectRoot, "dist/client/.vite/manifest.json"), "utf8"),
);
const serverManifest = JSON.parse(
  await readFile(resolve(projectRoot, "dist/server/.vite/manifest.json"), "utf8"),
);
const currentAssets = new Set(
  [...Object.values(clientManifest), ...Object.values(serverManifest)]
    .flatMap((entry) => [entry.file, ...(entry.css || [])])
    .filter((file) => file.startsWith("assets/")),
);
await mkdir(resolve(projectRoot, "assets"), { recursive: true });
for (const asset of currentAssets) {
  await copyFile(resolve(projectRoot, "dist/client", asset), resolve(projectRoot, asset));
}
await render("/", "index.html");
await render("/raid", "raid/index.html");
console.log("GitHub Pages export contains / and /raid.");
