import { defineConfig } from "tinacms";
import { BlogCollection } from "./collections/blog";
import { CategoryCollection } from "./collections/category";
import { GlobalConfigCollection } from "./collections/global-config";
import { NavigationCollection } from "./collections/navigation";
import { PageCollection } from "./collections/page";
import { UserCollection } from "./collections/user";

// Your hosting provider likely exposes this as an environment variable
const branch =
  // Cloudflare Workers Builds exposes the actual Git ref. It must outrank the
  // stable fallback so pull-request previews use their own Tina branch/schema.
  process.env.WORKERS_CI_BRANCH ||
  process.env.CF_PAGES_BRANCH ||
  process.env.NEXT_PUBLIC_TINA_BRANCH ||
  process.env.TINA_BRANCH ||
  process.env.PUBLIC_TINA_BRANCH ||
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF ||
  process.env.GITHUB_BRANCH ||
  process.env.VERCEL_GIT_COMMIT_REF ||
  process.env.HEAD ||
  "main";

export default defineConfig({
  contentApiUrlOverride: process.env.TINA_DIRECT_CLOUD_CHECK === "1"
    ? undefined
    : process.env.NEXT_PUBLIC_TINA_CONTENT_API_URL,
  branch,

  // Every independently provisioned site must provide its own Tina project credentials.
  // `validate:site` fails before deployment when these are absent.
  clientId: process.env.NEXT_PUBLIC_TINA_CLIENT_ID || "",
  token: process.env.TINA_TOKEN || "",
  media: {
    tina: {
      publicFolder: "public",
      mediaRoot: "brand-assets/dgs-homepage",
      // DGS self-hosts its content endpoint. Tina's writable repo-media API is
      // TinaCloud-only, so keep the editor's library read-only and source every
      // image from this repository. New assets follow the documented Git PR flow.
      static: true,
    },
  },
  build: {
    outputFolder: "admin",
    publicFolder: "public",
  },

  // See docs on content modeling for more info on how to setup new content models: https://tina.io/docs/schema/
  schema: {
    collections: [
      BlogCollection,
      CategoryCollection,
      PageCollection,
      UserCollection,
      NavigationCollection,
      GlobalConfigCollection,
    ],
  },
});
