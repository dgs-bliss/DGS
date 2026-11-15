const EXCLUDED_ROUTES = new Set([
  '/404/',
  '/thank-you/',
  '/sitemap/',
]);

const EXCLUDED_ROOTS = new Set([
  'api',
  'admin',
  'tina-island',
]);

function titleCaseSegment(value) {
  const special = {
    'cookies-policy': 'Cookies Policy',
    'privacy-policy': 'Privacy Policy',
    'terms-of-use': 'Terms of Use',
  };
  if (special[value]) return special[value];
  return value
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function routePathFromPageFile(filePath) {
  let relative = String(filePath || '').replaceAll('\\', '/');
  const pagesMarker = '/pages/';
  if (relative.includes(pagesMarker)) relative = relative.split(pagesMarker).pop();
  relative = relative.replace(/^\.\//, '').replace(/\.(astro|md|mdx)$/i, '');
  if (!relative || relative.includes('[') || relative.includes(']')) return null;

  const segments = relative.split('/').filter(Boolean);
  if (!segments.length || EXCLUDED_ROOTS.has(segments[0])) return null;
  if (segments.at(-1) === 'index') segments.pop();

  const route = segments.length ? `/${segments.join('/')}/` : '/';
  return EXCLUDED_ROUTES.has(route) ? null : route;
}

export function pageTitleFromRoute(route) {
  if (route === '/') return 'Home';
  const segment = route.split('/').filter(Boolean).at(-1) || '';
  return titleCaseSegment(segment);
}

export function buildPublishedPageList(filePaths) {
  const routes = new Map();
  for (const filePath of filePaths) {
    const href = routePathFromPageFile(filePath);
    if (!href || routes.has(href)) continue;
    routes.set(href, { href, title: pageTitleFromRoute(href) });
  }
  return [...routes.values()].sort((a, b) => {
    if (a.href === '/') return -1;
    if (b.href === '/') return 1;
    return a.title.localeCompare(b.title, 'en');
  });
}
