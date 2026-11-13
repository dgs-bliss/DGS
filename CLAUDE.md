# DGS content-editing rules

## Allowed changes

For routine content updates, edit only:

- `src/content/`
- `src/assets/`
- Markdown or MDX content pages

New approved headshots may be added to the corresponding content asset directory. Crop new headshots to match the dimensions and framing of the existing card and ring images.

## Pull-request workflow

- Create a branch for every requested change.
- Open a pull request and include a concise summary of the content changed.
- Wait for the Cloudflare preview URL and include it in the pull request.
- Never push routine content changes directly to `main`.
- Do not merge until Rich has reviewed the preview.

## Protected areas

Do not modify any of the following during a routine content request:

- Form endpoints or spam-protection logic
- Authentication or Tina configuration
- Cloudflare configuration
- Build scripts
- Environment variables or secret files
- GitHub Actions or deployment settings

Never place API keys, tokens, passwords or other secrets in Git, source files, pull-request descriptions or issue comments.
