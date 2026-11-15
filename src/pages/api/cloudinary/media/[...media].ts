import type { APIContext } from "astro";
import { v2 as cloudinary } from "cloudinary";
import { env as cloudflareEnv } from "cloudflare:workers";
import { isAuthorized } from "@tinacms/auth";

export const prerender = false;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function runtimeEnv(_context: APIContext, name: string) {
  const binding = (cloudflareEnv as Record<string, unknown>)[name];
  if (typeof binding === "string" && binding.trim()) return binding.trim();
  const fallback = process.env[name];
  return typeof fallback === "string" ? fallback.trim() : "";
}

function getCredentials(context: APIContext) {
  const cloud_name = runtimeEnv(context, "CLOUDINARY_CLOUD_NAME");
  const api_key = runtimeEnv(context, "CLOUDINARY_API_KEY");
  const api_secret = runtimeEnv(context, "CLOUDINARY_API_SECRET");

  if (!cloud_name || !api_key || !api_secret) {
    throw new Error("Missing Cloudinary environment variables");
  }

  cloudinary.config({ cloud_name, api_key, api_secret, secure: true });
}

async function authorized(context: APIContext, url: URL) {
  if (process.env.NODE_ENV === "development") return true;

  const configuredClientId = runtimeEnv(context, "NEXT_PUBLIC_TINA_CLIENT_ID");
  const requestedClientId = url.searchParams.get("clientID")?.trim() || "";
  if (!configuredClientId || requestedClientId !== configuredClientId) return false;

  const reqForTina = {
    query: Object.fromEntries(url.searchParams.entries()),
    headers: {
      authorization: context.request.headers.get("authorization") || undefined,
    },
  };

  const user = await isAuthorized(reqForTina as any, configuredClientId);
  // `isAuthorized` only returns a value after Tina Identity validates the
  // bearer token against this exact project. Current Identity responses do
  // not consistently expose the legacy top-level `verified` property, so
  // requiring it rejects valid authenticated editors on the deployed admin.
  return Boolean(user);
}

function cleanPath(value: string | null | undefined) {
  return (value || "").replace(/^\/+|\/+$/g, "");
}

function directoryPrefix(directory: string | null) {
  const clean = cleanPath(directory);
  return clean ? clean + "/" : "";
}

function rootPrefix(context: APIContext) {
  const clean = cleanPath(runtimeEnv(context, "CLOUDINARY_ROOT_FOLDER") || runtimeEnv(context, "CLOUDINARY_FOLDER"));
  if (!clean) {
    throw new Error("Missing CLOUDINARY_ROOT_FOLDER. Each clone must use its own isolated media folder.");
  }
  return clean + "/";
}

function withRootPrefix(context: APIContext, path: string) {
  const root = rootPrefix(context);
  const clean = cleanPath(path);
  if (!root) return clean;
  if (!clean) return root.replace(/\/$/, "");
  return clean.startsWith(root) ? clean : root + clean;
}

function stripRootPrefix(context: APIContext, publicId: string) {
  const root = rootPrefix(context);
  return root && publicId.startsWith(root) ? publicId.slice(root.length) : publicId;
}

function itemFromCloudinary(context: APIContext, asset: any) {
  const publicId = asset.public_id || "";
  const displayId = stripRootPrefix(context, publicId);
  const parts = displayId.split("/");
  const filename = parts.pop() || displayId || publicId;
  const directory = parts.length ? "/" + parts.join("/") : "/";
  const src = asset.secure_url || asset.url;

  return {
    type: "file",
    id: displayId,
    filename,
    directory,
    src,
    thumbnails: {
      "75x75": src,
      "400x400": src,
      "1000x1000": src,
    },
  };
}

export async function GET(context: APIContext) {
  try {
    const { request } = context;
    const url = new URL(request.url);
    if (!(await authorized(context, url))) return json({ message: "Unauthorized" }, 401);
    getCredentials(context);

    const directory = url.searchParams.get("directory") || "";
    const offset = url.searchParams.get("offset") || undefined;
    const prefix = withRootPrefix(context, directory);

    let search = cloudinary.search
      .expression(prefix ? `resource_type:image AND public_id:${prefix}*` : "resource_type:image")
      .sort_by("created_at", "desc")
      .max_results(50);

    if (offset) search = search.next_cursor(offset);
    const result = await search.execute();

    return json({
      items: (result.resources || []).map((asset: any) => itemFromCloudinary(context, asset)),
      offset: result.next_cursor || null,
    });
  } catch (e: any) {
    console.error("Cloudinary media GET failed", e);
    return json({ message: "Cloudinary media GET failed", e: e?.message || String(e) }, 500);
  }
}

export async function POST(context: APIContext) {
  try {
    const { request } = context;
    const url = new URL(request.url);
    if (!(await authorized(context, url))) return json({ message: "Unauthorized" }, 401);
    getCredentials(context);

    const form = await request.formData();
    const file = form.get("file");
    const directory = directoryPrefix(String(form.get("directory") || ""));
    const filename = String(form.get("filename") || (file as File)?.name || "upload");

    if (!(file instanceof File)) return json({ message: "Missing upload file" }, 400);

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const dataUri = `data:${file.type || "application/octet-stream"};base64,${buffer.toString("base64")}`;
    const publicId = withRootPrefix(context, directory + filename.replace(/\.[^.]+$/, ""));

    const result = await cloudinary.uploader.upload(dataUri, {
      public_id: publicId,
      overwrite: true,
      resource_type: "image",
    });

    return json(result);
  } catch (e: any) {
    console.error("Cloudinary media POST failed", e);
    return json({ message: "Cloudinary media POST failed", e: e?.message || String(e) }, 500);
  }
}

export async function DELETE(context: APIContext) {
  try {
    const { request, params } = context;
    const url = new URL(request.url);
    if (!(await authorized(context, url))) return json({ message: "Unauthorized" }, 401);
    getCredentials(context);

    const mediaParam = Array.isArray((params as any).media) ? (params as any).media.join("/") : String((params as any).media || "");
    const publicId = withRootPrefix(context, decodeURIComponent(mediaParam));
    if (!publicId) return json({ message: "Missing media id" }, 400);

    const result = await cloudinary.uploader.destroy(publicId, { resource_type: "image" });
    return json(result);
  } catch (e: any) {
    console.error("Cloudinary media DELETE failed", e);
    return json({ message: "Cloudinary media DELETE failed", e: e?.message || String(e) }, 500);
  }
}
