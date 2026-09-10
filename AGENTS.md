# Agent rules for chrome-use-sites

## Never test the chatgpt/ adapters against the live ChatGPT

Do **not** run `chrome-use site chatgpt/*`, or open chatgpt.com in scratch sessions, to check an adapter. They run in the user's own signed-in browser, and chatgpt.com throttles that account by **request count**. A full page load is about 45 backend requests, and scripted live checks have already tripped "Too many requests" on the account the user works in.

Verify offline:

```sh
node --test chatgpt/ twitter/
```

The tests load each adapter the way chrome-use does (with its family `_helper.js` in scope) against stubbed `fetch` and `document`; see `loadAdapter` and `router` in `chatgpt/adapters.test.js`. New behaviour gets a stubbed test there. If something can only be confirmed live, say so in the PR and leave it unverified.

The same caution applies to other packs that drive a real logged-in account (twitter/, sggit/): prefer the stubbed tests to live calls.

## Adding an adapter

Add its path to `PACKS` in `install.sh`; the guard tests fail if an adapter is missing from it or a listed file doesn't exist.
