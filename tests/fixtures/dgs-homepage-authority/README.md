# Digital Growth Society: Astro build package

Read with the handoff doc "Digital Growth Society: Astro Build Handoff":
https://claude.ai/artifact/GfpjdYd7DiiBpyAbNbHSaJ

## What's here

- content/      Seed data for Astro content collections. Copy to src/content/.
  - members.json   The Dozen, in display order: nickname, cred, bio, badges, url, photo paths
  - advisors.json  Board of Advisors (former members)
  - council.json   Master Council (past guest speakers), in tier order; url/photo may be null
  - site.json      Mission, LOVE values, the 8 lab topics, retreat places, apply perks, photo paths
- images/       Copy to src/assets/ (or public/) and serve through Astro <Image>.
  - members/  card crops (face-centered, 10:11)
  - ring/     hero ring circles
  - advisors/, council/  headshots
  - photos/   hero, Friday Zoom, retreat photos
- reference/
  - static-preview.html  The approved design flattened to plain HTML. Open it in a browser.
                         This is the visual source of truth. Fonts fall back offline;
                         the real fonts are Newsreader, Public Sans and Sora.
  - design-source.dc.html  The original design file (template + data), for exact CSS values.
  - screens/  Full-page screenshots at 1440px and 390px.

Image paths in the JSON are root-relative (/images/...). Change them to match
wherever you put the files.
