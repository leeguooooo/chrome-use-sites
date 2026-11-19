# `gemini/` — ask Gemini and read its conversations

English · [中文](README.zh.md)

Drives `gemini.google.com` as the Google account signed in there: send a prompt and get the answer, read the open conversation, list recent conversations, open one. chrome-use runs them in a `gemini.google.com` tab of your own Chrome.

These take the names of four OpenCLI commands (`gemini/ask`, `gemini/read`, `gemini/history`, `gemini/detail`), and chrome-use now runs the files here for them. They are a new implementation, not a port of OpenCLI's code. OpenCLI's `gemini/image`, `gemini/models`, `gemini/new`, `gemini/status` and the deep-research commands are untouched.

Why they exist ([chrome-use #904](https://github.com/leeguooooo/chrome-use/issues/904)): with a dialog open over the page ("解锁最适合你的 Gemini"), the OpenCLI `gemini/ask` returned side-navigation text (the titles of recent conversations) as the answer and exited 0, and `read` / `detail` / `history` could not read the page. Here an answer is only ever the text of the answer element, anything else is an error, and a dialog is reported with its title and buttons.

## Commands

```sh
chrome-use site gemini/ask "Summarise this in one line: ..."          # continue the open conversation
chrome-use site gemini/ask "A new question" --fresh true --timeout 400  # in a new conversation
chrome-use site gemini/read                                           # the open conversation
chrome-use site gemini/read --last 2
chrome-use site gemini/history --limit 10
chrome-use site gemini/detail "Trip plan" --until-done                # by title, id or URL
```

## Adapters

| adapter | args | returns / does |
| --- | --- | --- |
| `gemini/ask` | `<prompt> [--fresh true]` | Types the prompt into the prompt box with real key presses (`args.ui`), presses Enter once, waits for Gemini's own "finished" marker under the new answer, and returns `response` (the answer element's text), `conversation_id`, `conversation_url`, `sent: true`, `elapsed_ms`. `--fresh true` clicks "new chat" first; without it the prompt continues the conversation open in the tab. Write adapter: it sends a message as you. |
| `gemini/read` | `[--last N]` | The open conversation: `conversation_id`, `conversation_url`, `generating`, `count`, `total_loaded`, `turns` as `{role: "user" \| "assistant", text}`. Only the turns Gemini has loaded in the page. |
| `gemini/history` | `[--limit N]` | Recent conversations from the side navigation: `count`, `loaded`, `conversations` as `{title, id, url}`. `limit` default 20, max 100. Only what the side navigation has loaded. |
| `gemini/detail` | `<url \| id \| title> [--last N]` | Opens that conversation and returns it as `gemini/read` does. A title is matched exactly first, then as the only title containing the text; several matches are an error listing them. The first run navigates and returns `status: "navigating"`; run it again or pass `--until-done`. |

## When it fails

Every failure is an `error` with a `hint`, and the command exits non-zero. The ones worth knowing:

| `status` | meaning |
| --- | --- |
| `blocked_by_dialog` | A dialog is open over the page. The result carries `dialog: {title, text, buttons}`. Nothing was typed or sent (for `ask` before sending). Press the button you want in the page, then run the command again. The adapter never presses one for you. |
| `not_sent` | The prompt did not go out: typing did not land in the box, Enter sent nothing, or the run did not have the time to type it. Safe to run again after looking at the tab. |
| `answer_not_read` | The prompt **was sent** (`sent: true`) but no finished answer could be read before the run's time ended. `partial` holds what the answer element had so far, or `null`. Do not send the prompt again: read the answer with `gemini/read` later. |
| `outcome_unknown` | Enter was pressed, the box emptied, and no new turn appeared. Check with `gemini/read` or `gemini/history` before asking again. |

`ask` declares no rerun status, so `--until-done` never sends a prompt twice.

## Gotchas

- **`--new` and `--model` are chrome-use global flags**, not adapter arguments: they never reach an adapter. Start a new conversation with `--fresh true`. Model and thinking level are not selectable here; choose them in the page.
- **Typing is paced like a person's**, about 7 characters a second as measured (99 characters in 15 s). A 2,000-character prompt takes about five minutes before Gemini starts answering, and `ask` refuses up front when the run's `--timeout` cannot cover the typing. The default is 300 s. Very long prompts (the 17 KB one in #904) are not practical this way.
- **`ask` needs an idle prompt box.** Text already in the box, or an answer still being written, is refused before typing.
- **Line breaks** in the prompt are typed as Shift+Enter, so the prompt stays one message.
- Titles, turns and answers are read from the page as rendered: a conversation longer than what Gemini has loaded returns the loaded part (`total_loaded`).

## Safety / testing

- These run as you. `ask` sends a real message from your account; the other three only read.
- Develop against the stubbed page in `gemini/adapters.test.js`. A live check is a few short prompts in a conversation of your own, never a loop, and never a button in a dialog you did not decide on.

## Tests

`node --test gemini/`

See [CHANGELOG](../CHANGELOG.md) for changes.
