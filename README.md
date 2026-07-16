# TermScope AI Version 5

TermScope is a Chrome extension that detects Terms of Use and Privacy Policy links, analyzes one policy at a time, gives the policy a clear rating out of 10, and explains concerning clauses in simple language.

## Version 5 features

1. A shield appears beside every detected Terms or Privacy link.
2. The main popup lists every unique policy found on the current page.
3. Each policy is analyzed separately for faster and clearer results.
4. Every result has a large rating out of 10.
5. Result screens include a back button.
6. Actual clauses open in a new tab directly beside the current tab.
7. The new tab automatically scrolls to and highlights the matching clause.
8. A movable TermScope popup explains what the clause means, why it matters, and what the user can do.
9. Every analyzed policy is saved locally in the Policy Library.
10. The Policy Library sorts policies by rating and supports search, filtering, favorites, and removal.

## Project structure

```text
TermScopeAI/
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

Cloudflare is connected to the GitHub repository. Commit the updated files and wait for the `termscope-api` deployment to finish.

Confirm the backend is live by opening:

```text
https://termscope-api.nsithamraju.workers.dev
```

It should return Version 5.0.0.

## Install the extension locally

1. Download the repository from GitHub as a ZIP.
2. Extract the ZIP.
3. Open `chrome://extensions`.
4. Turn on Developer mode.
5. Remove the older TermScope installation.
6. Click Load unpacked.
7. Select the `extension` folder.
8. Refresh the website being tested.

## Important limitation

Clause highlighting works best on normal text based policy pages. A website that places its policy inside a PDF, canvas, inaccessible iframe, or heavily protected application may prevent exact highlighting. In that case TermScope still opens the correct policy and displays the original clause in its popup.
