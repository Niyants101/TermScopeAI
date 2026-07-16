# TermScopeAI Version 9

TermScopeAI is a Chrome extension that detects a website's main Terms of Use and Privacy Policy, prepares ratings before a user opens a policy, and explains important clauses in plain language.

## Version 9 improvements

1. TermScopeAI now keeps a maximum of two policies per website: one Terms of Use and one Privacy Policy.
2. Extra documents such as previews, prohibited use policies, additional terms, service specific policies, FAQs, definitions, and combined Privacy & Terms pages are ignored.
3. When several links point to the same policy type, TermScopeAI chooses the strongest main-policy match instead of saving every URL variation.
4. The Policy Library automatically cleans existing duplicate entries the next time it opens.
5. Old entries with broken titles such as `&` or `preview of the new` are replaced by the correct website name.
6. Duplicate ratings no longer affect the Policy Library average.
7. Favorites are preserved when duplicate entries are merged.
8. Version numbers are updated to 9.0.0 while the Version 7 rating formula remains unchanged.

## Project structure

```text
TermScopeAI-v9/
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

Confirm the backend is live by opening the worker URL. It should return Version 9.0.0.

## Install the extension locally

1. Download and extract the project ZIP.
2. Open `chrome://extensions`.
3. Turn on Developer mode.
4. Remove the older TermScopeAI installation.
5. Click Load unpacked.
6. Select the `extension` folder.
7. Refresh the website being tested.
8. Open the Policy Library once so Version 9 can automatically remove old duplicates.

## Important limitation

TermScopeAI identifies the main policy links using the link text and destination URL. Unusually labeled or heavily scripted websites may still require a future site specific rule.
