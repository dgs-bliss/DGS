#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const fail = (message) => {
  process.stderr.write(`REPOSITORY_MEDIA_ADMIN_BUILD_FAIL: ${message}\n`);
  process.exit(1);
};

const indexPath = resolve('public/admin/index.html');
if (!existsSync(indexPath)) fail('public/admin/index.html is missing');
const html = readFileSync(indexPath, 'utf8');
const scriptMatch = html.match(/src=["']([^"']*index-[^"']+\.js)["']/);
if (!scriptMatch) fail('generated admin bundle reference is missing');
const bundlePath = resolve('public', scriptMatch[1].replace(/^\//, ''));
if (!existsSync(bundlePath)) fail(`generated admin bundle is missing: ${bundlePath}`);
const bundle = readFileSync(bundlePath, 'utf8');

const required = [
  ['repository media root', 'brand-assets/dgs-homepage'],
  ['Tina client ID', String(process.env.NEXT_PUBLIC_TINA_CLIENT_ID || '')],
  ['Tina branch', String(process.env.NEXT_PUBLIC_TINA_BRANCH || '')],
  ['Tina content endpoint', String(process.env.NEXT_PUBLIC_TINA_CONTENT_API_URL || '')],
];
for (const [label, value] of required) {
  if (!value) fail(`${label} environment value is empty`);
  if (!bundle.includes(value)) fail(`${label} is not embedded in the generated production admin`);
}
for (const forbidden of ['/api/cloudinary/media', 'TinaCloudCloudinaryMediaStore']) {
  if (bundle.includes(forbidden)) fail(`obsolete external media implementation remains: ${forbidden}`);
}

const mediaRoot = resolve('public/brand-assets/dgs-homepage');
const collectMediaFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = resolve(directory, entry.name);
  if (entry.isDirectory()) return collectMediaFiles(path);
  return statSync(path).isFile() ? [entry.name] : [];
});
if (!existsSync(mediaRoot)) fail('repository media directory is missing');
const mediaFiles = collectMediaFiles(mediaRoot);
if (mediaFiles.length < 53) fail(`repository media snapshot is incomplete: found ${mediaFiles.length} files`);
for (const filename of mediaFiles) {
  if (!bundle.includes(filename)) fail(`static repository media is missing from the generated admin: ${filename}`);
}

process.stdout.write('REPOSITORY_MEDIA_ADMIN_BUILD_PASS\n');
