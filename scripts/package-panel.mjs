import { createWriteStream, existsSync, rmSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join, relative, sep } from "node:path";

const require = createRequire(import.meta.url);
const yazl = require("yazl");

const distDir = join(process.cwd(), "dist");
const zipPath = join(process.cwd(), "management-panel.zip");
const requiredEntries = new Set(["index.html", "assets", "xf.png"]);

if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
  throw new Error("dist directory not found. Run npm run build first.");
}

for (const entry of requiredEntries) {
  if (!existsSync(join(distDir, entry))) {
    throw new Error(`dist/${entry} is required for XFProxyAPI panel packaging.`);
  }
}

if (existsSync(zipPath)) {
  rmSync(zipPath);
}

const output = createWriteStream(zipPath);
const archive = new yazl.ZipFile();
const entries = await collectFiles(distDir);

await new Promise((resolve, reject) => {
  output.on("close", resolve);
  output.on("error", reject);
  archive.outputStream.on("error", reject);
  archive.outputStream.pipe(output);

  for (const entry of entries) {
    const name = toZipName(relative(distDir, entry));
    archive.addFile(entry, name);
  }

  archive.end();
});

console.log(`Created ${basename(zipPath)} with required root entries: index.html, assets/, xf.png`);

async function collectFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const path = join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }

  return files;
}

function toZipName(path) {
  return sep === "/" ? path : path.split(sep).join("/");
}
