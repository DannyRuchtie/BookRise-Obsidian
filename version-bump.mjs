import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packageJsonPath = path.join(__dirname, 'package.json');
const manifestPath = path.join(__dirname, 'manifest.json');
const versionsPath = path.join(__dirname, 'versions.json');

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

manifest.version = packageJson.version;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Updated manifest version to ${manifest.version}`);

const minAppVersion = manifest.minAppVersion;
if (!minAppVersion) {
  throw new Error('manifest.json is missing minAppVersion.');
}

let versions = {};
if (existsSync(versionsPath)) {
  versions = JSON.parse(readFileSync(versionsPath, 'utf8'));
}

versions[packageJson.version] = minAppVersion;
writeFileSync(versionsPath, JSON.stringify(versions, null, 2) + '\n');
console.log(`Pinned Obsidian compatibility ${minAppVersion} for version ${packageJson.version}`);
