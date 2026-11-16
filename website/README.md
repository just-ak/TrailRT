# TrailRT website

The one-page site for TrailRT, deployed to Cloudflare Pages with Wrangler. It is
also the page given to App Store Connect for the marketing, support and privacy
policy URLs.

## Kept away from the app

This folder is deliberately separate from the application:

- **Nothing here reaches the app.** `electron-builder.yml` packages only `out/`,
  `package.json` and `LICENSE`. The app's lint, typecheck and tests cover `src/`
  and `tests/` only, and the root licence check reads the root `node_modules/`.
- **No dependencies.** Plain HTML and CSS with no build step, no scripts, and no
  fonts or assets from other hosts. Wrangler runs through `npx` at a pinned
  version and is never added to the app's `package.json`.
- **Its own `package.json` and `wrangler.toml`.** Run every command from this
  folder, not from the repository root.
- **The app never links to a file in here.** If the app needs to point at the
  site, it uses the deployed URL.

## Files

| Path | What it is |
| --- | --- |
| `public/index.html` | The page: hero, features, privacy policy (`#privacy`), support (`#support`) |
| `public/styles.css` | All styling. Dark, matching the app icon |
| `public/_headers` | Security headers for Pages, including a CSP that allows only this site's own CSS and images |
| `public/icon.svg` | Copy of `build/icon.svg`. Copy it again if the app icon changes |
| `public/og.png`, `public/apple-touch-icon.png` | Rendered from `art/og.svg` and `public/icon.svg` |
| `art/og.svg` | Source of the social sharing image. Not deployed |

Regenerate the PNGs after changing their sources:

```sh
rsvg-convert -w 1200 -h 630 art/og.svg -o public/og.png
rsvg-convert -w 180 -h 180 public/icon.svg -o public/apple-touch-icon.png
```

## Preview and deploy

```sh
cd website
npm run preview          # local server via wrangler pages dev
npx --yes wrangler@4.163.0 login   # first time only
npm run deploy           # publishes public/ to the Pages project in wrangler.toml
```

Before the first deploy, check three things:

1. `name` in `wrangler.toml` is your Pages project.
2. `og:image` in `index.html` points at your real domain. It assumes
   `trailrt.pages.dev`.
3. The GitHub links (`just-ak/TrailRT`) are public. The releases link is the
   page's download button.

## App Store Connect

| Field | URL |
| --- | --- |
| Marketing URL | `https://<your domain>/` |
| Support URL | `https://<your domain>/#support` |
| Privacy Policy URL | `https://<your domain>/#privacy` |

## Keeping it honest

The page follows the same rule as the app: claim nothing the app does not do.
When the app changes, check the features, "Good to know" and privacy sections.

- **The privacy policy names every service the app contacts.** A new network
  call in the app means a new line in that section, and new App Store privacy
  details, before the release that adds it.
- **The store button stays "Coming soon"** until the app is live. Then replace
  it with Apple's official "Download on the Mac App Store" badge, from Apple's
  marketing resources, used as Apple's guidelines say. Apple's logo is not used
  anywhere until then.
- **The hero picture is an illustration and says so.** Store screenshots must be
  real captures of the app.
