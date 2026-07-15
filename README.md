# TermScope AI v0.3

TermScope is a Chrome extension that places one small shield beside grouped Terms of Use and Privacy Policy links. Clicking it keeps the current page open, reads the linked policies, and shows AI identified concerns in a draggable popup.

## Project structure

- `extension/` Chrome extension
- `backend/` Cloudflare Worker API
- `website/` privacy policy and future landing page
- `wrangler.jsonc` Cloudflare deployment configuration

## Cloudflare deployment

The Cloudflare Worker project must be named `termscope-api`. The repository root must be `/`, the build command can remain empty, and the deploy command should remain `npx wrangler deploy`.

Cloudflare Workers AI is connected through the `AI` binding in `wrangler.jsonc`, so no Gemini or OpenRouter API key is required.

## Local extension installation

1. Open `chrome://extensions`
2. Enable Developer mode
3. Select Load unpacked
4. Select the `extension` folder

## Important

TermScope provides informational AI summaries and is not legal advice.
