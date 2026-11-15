import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPublishedPageList, routePathFromPageFile } from '../src/lib/published-pages.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const pagesRoot = join(root, 'src', 'pages');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const routeFiles = walk(pagesRoot)
  .filter((file) => /\.(astro|md|mdx)$/i.test(file))
  .map((file) => `./${relative(pagesRoot, file).replaceAll('\\', '/')}`);
const actual = buildPublishedPageList(routeFiles);
const actualRoutes = actual.map((page) => page.href);
const expectedRoutes = ['/', '/cookies-policy/', '/privacy-policy/', '/terms-of-use/'];
assert.deepEqual(actualRoutes, expectedRoutes, 'HTML sitemap must expose exactly the current public page routes');
assert.equal(new Set(actualRoutes).size, actualRoutes.length, 'HTML sitemap routes must be unique');

assert.equal(routePathFromPageFile('./about.astro'), '/about/', 'new public routes must be discovered automatically');
for (const excluded of ['./404.astro', './thank-you.astro', './sitemap.astro', './api/apply.ts', './tina-island/[name].astro']) {
  assert.equal(routePathFromPageFile(excluded), null, `utility route must stay out of sitemap: ${excluded}`);
}

const sitemapSource = readFileSync(join(pagesRoot, 'sitemap.astro'), 'utf8');
assert.match(sitemapSource, /import\.meta\.glob\('\.\/\*\*\/\*\.\{astro,md,mdx\}'/, 'sitemap must discover route files automatically');
assert.match(sitemapSource, /data-sitemap-content/, 'sitemap content must retain its route-specific scope marker');
assert.match(sitemapSource, /buildPublishedPageList\(Object\.keys\(routeFiles\)\)/, 'sitemap must use the shared pure route helper');

const footer = JSON.parse(readFileSync(join(root, 'src', 'content', 'navigation', 'footer.json'), 'utf8'));
const footerLinks = new Map((footer.items || []).map((item) => [item.label, item.href]));
assert.equal(footerLinks.get('Privacy'), '/privacy-policy/');
assert.equal(footerLinks.get('Terms'), '/terms-of-use/');
assert.equal(footerLinks.get('Cookies'), '/cookies-policy/');
assert.equal(footerLinks.get('Sitemap'), '/sitemap/');
const footerTemplate = readFileSync(join(root, 'src', 'templates', 'Footer.astro'), 'utf8');
for (const href of ['/privacy-policy/', '/terms-of-use/', '/cookies-policy/', '/sitemap/']) {
  assert.ok(footerTemplate.includes(href), `public footer must enforce the required destination: ${href}`);
}
assert.match(footerTemplate, /cmsFooterItems/, 'footer must preserve non-policy CMS-managed links');

const contentAssertions = [
  ['privacy-policy.md', 'This Privacy Policy describes Our policies and procedures', '## Contact Us'],
  ['terms-of-use.md', 'Please read these terms and conditions carefully', '## Limitation of Liability'],
  ['cookies-policy.md', 'This Cookies Policy explains what Cookies are', '## Your Choices Regarding Cookies'],
];
for (const [file, opening, section] of contentAssertions) {
  const source = readFileSync(join(pagesRoot, file), 'utf8');
  assert.match(source, /layout: \.\.\/layouts\/LegalPage\.astro/);
  assert.ok(source.includes(opening), `${file} must preserve the source opening`);
  assert.ok(source.includes(section), `${file} must preserve required policy sections`);
  assert.ok(source.includes('admin@digitalgrowthsociety.org'), `${file} must preserve the published contact address`);
}

const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
assert.match(packageJson.scripts?.['validate:starter'] || '', /dgs:sitemap-lock/, 'normal validation must run the sitemap contract');
console.log(`DGS sitemap contract: PASS (${actualRoutes.length} published pages)`);
