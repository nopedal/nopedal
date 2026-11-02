# lauv

Draws a GitHub contribution year as a branch, as an animated SVG. The workflow in this repository redraws [`art/`](../art) every night.

| Data | Drawing |
| --- | --- |
| A day with contributions | A leaf |
| A week | A sprig, oldest at the base, this week at the tip |
| Contributions that day | Leaf size, four levels from the account's own quartiles |
| Yesterday | The light, from moonlight at zero to a wide shaft on a big day |
| A streak of 7 days or more | Berries or a blossom in the colour of a top language |
| The month | A seasonal tint |

Project cards use one leaf per week with commits, and the light shows how recently the project was worked on.

## Use it on your own profile

Add `.github/workflows/lauv.yml` to your profile repository:

```yaml
name: lauv
on:
  schedule:
    - cron: "17 0 * * *"
  workflow_dispatch:
permissions:
  contents: write
jobs:
  draw:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: nopedal/nopedal/lauv@main
      - run: |
          git add lauv
          git diff --cached --quiet && exit 0
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git commit -m "Redraw lauv"
          git push
```

Then in `README.md`:

```html
<img src="lauv/hero.svg" width="100%" alt="My contributions">
```

Cards go in `lauv.json` at the repository root. See [`lauv.json`](../lauv.json) here for an example.

Private repositories need a token that can read them. Create a fine-grained token with read-only Contents access, save it as a repository secret and pass it as `token`. The default token is enough for the branch alone.

| `lauv.json` | Default | |
| --- | --- | --- |
| `login` | Repository owner | Account to draw |
| `out` | `lauv` | Output directory |
| `detail` | `film` | `cel` for flat shading and smaller files |
| `hud` | `false` | Corner captions on the branch |
| `hero` | `hero.svg` | File name for the branch |
| `cuttings` | `[]` | `file`, `name`, then `repos` or `"source": "calendar"` |

## Command line

Node 24 runs the TypeScript sources directly. The token comes from `GITHUB_TOKEN`, or from `gh auth token`.

```sh
node lauv/src/cli.ts <login> --out lauv.svg
node lauv/src/cli.ts build --config lauv.json
```

MIT
