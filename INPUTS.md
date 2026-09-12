# What you have to supply

Claude Code writes the code. These are the things only you can provide.

## Before you start

| Input | Where to get it | Needed for |
| --- | --- | --- |
| `RAWG_KEY` | rawg.io/apidocs — instant, free | Everything. The only mandatory key. |
| `SGDB_KEY` | steamgriddb.com → profile → Preferences → API | Portrait cover art. Skip it and most covers land in the review queue. |
| `OPENROUTER_KEY` | openrouter.ai/keys | Back-cover copy, art prompts, vision review. Optional. |
| `games.txt` contents | Your own library | The actual work list. |
| `COVER_MARK` | Your initials or monogram | Printed where a publisher logo would be. |
| `COVER_ACCENT` | A hex colour | Band and bullet colour across every cover. |

## The two reference scans

Put your Assassin's Creed Odyssey and Spider-Man 2 cover scans in a `refs/` folder
before starting step 2, and add to that prompt:

```
refs/ contains two scanned retail covers. Study the structural layout only — where
the band, tagline, screenshot column, spec chips, legal block, rating box and barcode
sit. Reproduce that anatomy. Do not reproduce any logo, rating board mark, disc format
mark or publisher mark from them.
```

Claude Code can read images, and it will get the proportions closer from the scans
than from my written description of them.

## During the build

**Step 3 is the one that needs your eyes.** Open `out/smoke.png` and judge it. Text
too big, block too tall, screenshots badly proportioned — say so in plain language and
have it adjust. Every later step inherits whatever you accept here.

**Step 6, first real build**, check that the art actually landed on the front panel
and the back copy filled its column.

**Step 8**, the ruler check. 270 mm or the print settings are wrong.

## After it works

Your game list, and — if you want your own artwork — running `npm run prompts` and
generating images in the Gemini app, saving each as `art/<slug>.png`.

## Setting up Claude Code

Native installer, no Node.js needed for Claude Code itself:

```bash
curl -fsSL https://claude.ai/install.sh | bash      # macOS, Linux, WSL
```

The npm route needs Node.js 22+ as of v2.1.198:

```bash
npm install -g @anthropic-ai/claude-code
```

Then:

```bash
mkdir coverpress && cd coverpress
# copy CLAUDE.md in, and refs/ if you have the scans
claude
```

Your project still needs Node 20.6+ separately, since the npm scripts use `--env-file`.
