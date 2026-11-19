import type { APIRoute } from 'astro';

export const prerender = false;

function isStagingHost(url: URL) {
  const hostname = url.hostname.toLowerCase();
  return hostname === 'staging.digitalgrowthsociety.org' || hostname.endsWith('.workers.dev');
}

export const GET: APIRoute = ({ url }) => {
  const body = isStagingHost(url)
    ? 'User-agent: *\nDisallow: /\n'
    : `User-agent: *\nAllow: /\nSitemap: ${url.origin}/sitemap-index.xml\n`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
};
