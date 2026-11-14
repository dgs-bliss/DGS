const FALLBACK_ORIGIN = "https://staging.digitalgrowthsociety.org";
const WORKERS_ACCOUNT_SUBDOMAIN = "almira2022t";
const WORKER_NAME = "dgs";
const PUBLIC_ORIGIN = "https://preview.digitalgrowthsociety.org";
const BRANCH_COOKIE = "dgs_preview_branch";
const TEXT_TYPES = [
  "text/",
  "application/javascript",
  "application/json",
  "application/xml",
  "application/xhtml+xml",
  "image/svg+xml"
];

export function sanitizeBranch(branch) {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function isValidBranch(branch) {
  return (
    typeof branch === "string" &&
    branch.length >= 1 &&
    branch.length <= 120 &&
    /^[A-Za-z0-9._/-]+$/.test(branch) &&
    !branch.startsWith("/") &&
    !branch.endsWith("/") &&
    !branch.includes("..")
  );
}

export function selectionFromBranch(branch) {
  if (!isValidBranch(branch)) {
    return {
      mode: "staging-fallback",
      branch: "staging",
      targetOrigin: FALLBACK_ORIGIN
    };
  }

  const alias = `${sanitizeBranch(branch)}-${WORKER_NAME}`;
  return {
    mode: "pull-request",
    branch,
    targetOrigin: `https://${alias}.${WORKERS_ACCOUNT_SUBDOMAIN}.workers.dev`
  };
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(valueParts.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function selectionForRequest(request, incomingUrl) {
  const requestedBranch = incomingUrl.searchParams.get("branch");
  if (requestedBranch !== null) return selectionFromBranch(requestedBranch);
  return selectionFromBranch(getCookie(request, BRANCH_COOKIE));
}

function branchRedirect(incomingUrl, branch) {
  if (!isValidBranch(branch)) {
    return new Response("Invalid preview branch.", {
      status: 400,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Robots-Tag": "noindex, nofollow, noarchive"
      }
    });
  }

  const cleanUrl = new URL(incomingUrl);
  cleanUrl.searchParams.delete("branch");
  return new Response(null, {
    status: 302,
    headers: {
      Location: cleanUrl.toString(),
      "Set-Cookie": `${BRANCH_COOKIE}=${encodeURIComponent(branch)}; Max-Age=7200; Path=/; Secure; HttpOnly; SameSite=Lax`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive"
    }
  });
}

function clearRedirect(incomingUrl) {
  const cleanUrl = new URL(incomingUrl);
  cleanUrl.searchParams.delete("clear");
  return new Response(null, {
    status: 302,
    headers: {
      Location: cleanUrl.toString(),
      "Set-Cookie": `${BRANCH_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive"
    }
  });
}

function shouldRewrite(contentType) {
  return TEXT_TYPES.some((type) => contentType.toLowerCase().includes(type));
}

export function rewriteText(text, targetOrigin) {
  return text
    .split(targetOrigin).join(PUBLIC_ORIGIN)
    .split(`https://${WORKER_NAME}.${WORKERS_ACCOUNT_SUBDOMAIN}.workers.dev`).join(PUBLIC_ORIGIN);
}

async function proxyResponse(upstream, selection) {
  const headers = new Headers(upstream.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set("X-DGS-Preview-Mode", selection.mode);
  headers.set("X-DGS-Preview-Branch", selection.branch);

  const location = headers.get("Location");
  if (location) headers.set("Location", rewriteText(location, selection.targetOrigin));

  const contentType = headers.get("Content-Type") || "";
  if (!shouldRewrite(contentType) || upstream.body === null) {
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers
    });
  }

  const text = rewriteText(await upstream.text(), selection.targetOrigin);
  headers.delete("Content-Encoding");
  headers.delete("Content-Length");
  headers.delete("ETag");
  return new Response(text, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  });
}

function statusResponse(selection) {
  return new Response(
    JSON.stringify(
      {
        ready: true,
        mode: selection.mode,
        branch: selection.branch,
        publicOrigin: PUBLIC_ORIGIN
      },
      null,
      2
    ),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow, noarchive"
      }
    }
  );
}

export default {
  async fetch(request) {
    const incomingUrl = new URL(request.url);

    if (incomingUrl.searchParams.has("clear")) return clearRedirect(incomingUrl);
    if (incomingUrl.searchParams.has("branch")) {
      return branchRedirect(incomingUrl, incomingUrl.searchParams.get("branch"));
    }

    const selection = selectionForRequest(request, incomingUrl);
    if (incomingUrl.pathname === "/__preview/status") return statusResponse(selection);

    const targetUrl = new URL(incomingUrl.pathname + incomingUrl.search, selection.targetOrigin);
    const headers = new Headers(request.headers);
    headers.delete("Host");
    headers.set("X-Forwarded-Host", incomingUrl.host);
    headers.set("X-Forwarded-Proto", "https");

    const upstreamRequest = new Request(targetUrl, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual"
    });

    try {
      return proxyResponse(await fetch(upstreamRequest), selection);
    } catch {
      return new Response("The requested preview is temporarily unavailable.", {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Retry-After": "30",
          "X-Robots-Tag": "noindex, nofollow, noarchive"
        }
      });
    }
  }
};
