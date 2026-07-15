# TermScope AI v0.2

TermScope adds one small shield beside a website's Terms of Use and Privacy Policy links. Clicking it keeps the current page open, fetches the linked policies in the background, and shows a movable popup containing only the most important problems by default.

## Changes in this version

* Removed the word Explain from the webpage button
* Uses one shield for a Terms and Privacy group instead of placing buttons everywhere
* Removed the Chrome side panel
* Added a movable bottom corner popup
* Enlarged and redesigned the TermScope logo and settings icon
* Prevents the policy link from opening when the TermScope shield is clicked
* Fetches the linked policy page in the background
* Sends the actual policy text to an AI backend
* Shows problems first instead of a long general summary
* Opens the original policy in a new tab when View actual clause is clicked
* Attempts to scroll to and highlight the quoted clause in the new tab

## Install the extension

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Click Load unpacked.
4. Select the `termscope-extension` folder.
5. Reload any webpage that was already open.

## Start the AI backend

The OpenAI key stays in a local server and is never placed inside the extension.

```bash
cd backend
npm install
```

Copy `.env.example` to `.env`, then add your OpenAI API key.

```bash
npm start
```

The backend will run at:

```text
http://localhost:8787/analyze
```

That address is already entered in the extension settings.

## GitHub structure

```text
termscope-extension/
  manifest.json
  background.js
  content.js
  content.css
  icons/
  backend/
    server.js
    package.json
    .env.example
```

## Notes

Some websites render policy pages using JavaScript or block automated fetching. Those sites may require a later fallback that briefly opens a background tab to extract the rendered page. The clause highlighter works best when the exact AI quote appears as normal webpage text.
