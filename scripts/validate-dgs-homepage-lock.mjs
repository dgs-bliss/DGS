import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import matter from 'gray-matter';

const root = resolve(process.cwd());
const fixtureRoot = join(root, 'tests/fixtures/dgs-homepage-authority');
const manifest = JSON.parse(readFileSync(join(fixtureRoot, 'authority-manifest.json'), 'utf8'));
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const fail = (message) => {
  console.error(`DGS_HOMEPAGE_LOCK_FAIL: ${message}`);
  process.exit(1);
};

for (const [name, expected] of Object.entries(manifest.fixtureFiles)) {
  const path = join(fixtureRoot, name);
  if (!existsSync(path)) fail(`missing authority fixture ${name}`);
  if (sha(path) !== expected) fail(`authority fixture drifted: ${name}`);
}

const authorityHtml = readFileSync(join(fixtureRoot, 'reference/static-preview.html'), 'utf8');
const frontPath = join(root, 'src/templates/FrontPage.astro');
const front = readFileSync(frontPath, 'utf8');
const counts = (text) => ({
  sections: (text.match(/<section\b/g) || []).length,
  articles: (text.match(/<article\b/g) || []).length,
  details: (text.match(/<details\b/g) || []).length,
  forms: (text.match(/<form\b/g) || []).length,
});
const authorityCounts = counts(authorityHtml);
const currentCounts = counts(front);
for (const key of ['sections', 'articles', 'details', 'forms']) {
  if (authorityCounts[key] !== manifest.expected[key]) fail(`authority ${key} count changed`);
  if (currentCounts[key] !== authorityCounts[key]) fail(`current ${key} count ${currentCounts[key]} != authority ${authorityCounts[key]}`);
}
if (/<header\b|<footer\b/.test(front)) fail('global header/footer leaked into FrontPage.astro');
if (!front.includes('config?.contactForm?.formspreeEndpoint')) fail('homepage form is not connected to global Formspree configuration');

const homePath = join(root, 'src/content/page/home.mdx');
const home = matter(readFileSync(homePath, 'utf8')).data;
const block = (home.blocks || []).find((item) => item?._template === 'homepageTemplate');
if (!block?.sourceContent) fail('homepageTemplate sourceContent is missing');
const sectionValues = Object.values(block.sourceContent);
const totals = {
  sourceContentSections: sectionValues.length,
  textEntries: sectionValues.reduce((n, section) => n + (section.texts || []).length, 0),
  imageEntries: sectionValues.reduce((n, section) => n + (section.images || []).length, 0),
  linkEntries: sectionValues.reduce((n, section) => n + (section.links || []).length, 0),
};
for (const [key, value] of Object.entries(totals)) {
  if (value !== manifest.expected[key]) fail(`${key} ${value} != ${manifest.expected[key]}`);
}

const pages = readdirSync(join(root, 'src/content/page')).filter((name) => name.endsWith('.mdx')).sort();
if (pages.length !== 1 || pages[0] !== 'home.mdx') fail(`homepage-only scope violated: ${pages.join(', ')}`);

const assetRoot = join(root, 'public/brand-assets/dgs-homepage');
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? walk(path) : [path];
});
const currentAssetHashes = walk(assetRoot).filter((path) => path.endsWith('.jpg')).map(sha).sort();
if (JSON.stringify(currentAssetHashes) !== JSON.stringify([...manifest.usedAuthorityImageHashes].sort())) {
  fail('public DGS JPG assets do not match the image assets used by the supplied mockup');
}

for (const file of ['src/templates/Header.astro', 'src/templates/Footer.astro']) {
  if (!existsSync(join(root, file))) fail(`missing global shell component ${file}`);
}

console.log(JSON.stringify({
  status: 'PASS',
  authority: 'dgs-handoff2.zip',
  ...currentCounts,
  ...totals,
  matchedAssets: currentAssetHashes.length,
  pages,
}, null, 2));
