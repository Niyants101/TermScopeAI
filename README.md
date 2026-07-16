# TermScopeAI Version 7

TermScopeAI is a Chrome extension that detects Terms of Use and Privacy Policy links, prepares ratings before a user opens a policy, and explains important clauses in plain language.

## Version 7 improvements

1. One clean shield is shown for each nearby Terms and Privacy pair instead of one shield for every link.
2. Separate policy pairs on the same page can each receive one shield, including third party Privacy and Terms pairs.
3. Ratings remain inside the TermScopeAI interface and are no longer displayed on webpage shields.
4. The settings button now uses the official Google Material settings icon.
5. Invalid action text such as only High, Medium, or Low is replaced with a useful step the user can take.
6. New AI reviews provide slightly more detailed plain language explanations and practical consequences.
7. Clause highlights keep the same soft appearance and remain until another reviewed clause is selected or the clause panel is closed.
8. The clause panel remains draggable in every view, including guided clause summaries.
9. The guided clause view resets its own scroll position and protects its layout from webpage styles that caused large blank spaces.
10. High, Medium, and Low labels are larger in the guided clause view.
11. Low action sections keep their blue treatment, while Medium and High use matching severity colors.
12. Policy Library text is larger and easier to read.

## Project structure

```text
TermScopeAI-v7/
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

Confirm the backend is live by opening the worker URL. It should return Version 7.0.0.

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
