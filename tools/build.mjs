/** Assemble the dependency-free static site and syntax-check every module. */
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'dist');
async function checkDirectory(dir) {
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    if ((await stat(path)).isDirectory()) await checkDirectory(path);
    else if (name.endsWith('.js')) execFileSync(process.execPath, ['--check', path], { stdio: 'inherit' });
  }
}

await checkDirectory(join(root, 'src'));
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const name of ['index.html', 'styles.css', 'src', 'docs']) {
  await cp(join(root, name), join(out, name), { recursive: true });
}
console.log(`Built static site at ${out}`);
