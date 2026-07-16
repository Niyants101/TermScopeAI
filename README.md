# TermScopeAI Version 8

TermScopeAI is a Chrome extension that detects Terms of Use and Privacy Policy links, prepares ratings before a user opens a policy, and explains important clauses in plain language.

## Version 8 improvements

1. The guided clause panel removes the large blank gap that could appear between a severity label and the clause title on Google policy pages.
2. The interface opens from the bottom right corner and grows upward. When a user moved panel becomes taller, it is automatically nudged back inside the visible screen instead of extending below the browser window.
3. Guided summaries now open reliably for Google Terms of Service and other pages that redirect or remove the TermScopeAI URL marker. The background service sends the saved clause request directly to the finished policy tab and retries while the page loads.
4. The panel remains draggable after opening any standard view or guided clause view.
5. Version numbers are updated to 8.0.0 while the Version 7 rating formula remains unchanged.

## Project structure

```text
TermScopeAI-v8/
  backend/
    index.js
  extension/
    background.js
    content.css
    content.js
    library.css
    library.html
    library.js
    manifest.json
    icons/
  website/
    privacy.html
  package.json
  wrangler.jsonc
```

## Deploy the backend

Commit the updated files to the connected GitHub repository and wait for the Cloudflare Worker deployment to finish.

Confirm the backend is live by opening the worker URL. It should return Version 8.0.0.

## Install the extension locally

1. Download and extract the project ZIP.
2. Open `chrome://extensions`.
3. Turn on Developer mode.
4. Remove the older TermScopeAI installation.
5. Click Load unpacked.
6. Select the `extension` folder.
7. Refresh the website being tested.

## Important limitation

Clause matching works best on normal text based policy pages. A website that places its policy inside a PDF, canvas, inaccessible iframe, closed shadow root, or heavily protected application may prevent exact matching. TermScopeAI still displays the original clause and explanation in the side panel.
