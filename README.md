# TermScopeAI Version 6

TermScopeAI is a Chrome extension that detects Terms of Use and Privacy Policy links, calculates a clear rating out of 10, and explains concerning clauses in simple language.

## Version 6 improvements

1. One shield is shown for all policy links on a page instead of placing an icon beside every link.
2. Internal table of contents links on policy pages are ignored so pages such as Google Terms are not covered in shields.
3. Ratings are prepared after the user opens TermScopeAI and are shown before the user chooses a policy.
4. Policies with lower ratings move to the top of each policy group.
5. Ratings now weigh both the number and seriousness of findings.
6. Multiple high severity findings sharply reduce a policy rating.
7. Older saved ratings are recalculated with the Version 6 scoring formula.
8. The Policy Library average uses only valid numeric ratings and calculates the arithmetic mean correctly.
9. Clause highlighting is softer, works better in dark mode, fades, and removes itself automatically.
10. The guided clause panel stays on the side and changes summaries as the user scrolls near reviewed clauses.
11. High severity explanations have more spacing and clearer sections.
12. The settings icon is centered and uses a standard gear shape.
13. The extension name is TermScopeAI throughout the project.

## Project structure

```text
TermScopeAI-v6/
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

Confirm the backend is live by opening the worker URL. It should return Version 6.0.0.

## Install the extension locally

1. Download the repository from GitHub as a ZIP.
2. Extract the ZIP.
3. Open `chrome://extensions`.
4. Turn on Developer mode.
5. Remove the older TermScopeAI installation.
6. Click Load unpacked.
7. Select the `extension` folder.
8. Refresh the website being tested.

## Important limitation

Clause matching works best on normal text based policy pages. A website that places its policy inside a PDF, canvas, inaccessible iframe, closed shadow root, or heavily protected application may prevent exact matching. TermScopeAI still displays the original clause and explanation in the side panel.
