# Cyrus: Visual Direction (Draft)

> Draft notes from looking at reference sites on 2026-11-07. Not final.

## What we took from each reference
| Site | What works there | What we borrow (as an idea, not a copy) |
|---|---|---|
| launchdarkly.com | Black canvas, very large bold headline, one bright accent on the CTA, floating product UI cards, small sparkle shapes | Show **real product screens** (drive card, live queue, QR check-in) as floating cards on the landing page |
| Foundry (a friend's project) | Pixel-art mascot, pixel confetti loader, small pixel characters placed **inside sentences**, big bold text on a bright band | **Pixel characters as personality**: tiny sprites next to words like "student", "HR", "TPO" |
| railway.com | Pixel-art landscape behind a clean headline, calm dark UI | A pixel scene in the hero (e.g. a campus at dusk), quiet UI on top |
| linear.app | Precise, minimal, dark product UI; nothing decorative inside the app | **Inside the app stays clean.** Personality lives on public pages, empty states and loaders |

## Proposed direction
- **Two layers:** a playful public site (landing, company portal, empty states, loaders) and a calm, fast app UI (dashboards, queues, forms).
- **Our own pixel cast** (original designs, not copies of anyone's mascot):
  - Student (backpack), HR (badge + clipboard), TPO (keys / stamp), Interviewer (headset), Volunteer (armband)
  - Each in 3–4 poses: waiting, success, error, celebrating (offer accepted)
- **Abstract shapes:** chunky geometric blocks (stairs = rounds, a line of blocks = the queue, a ticket = the QR pass) used as section decorations.
- **Where pixels appear in the app:** empty states ("no drives yet"), the waiting screen in the interview line, success/failure screens, loading.

## Making the assets
- **Pixel characters:** image models (Gemini "Nano Banana" image models included) usually produce "pixel-looking" art that isn't on a real pixel grid. So after generating:
  1. downscale to the real size (e.g. 32×32) with nearest-neighbour,
  2. reduce to our fixed palette (8–16 colours),
  3. clean up by hand if needed, and export as SVG/PNG at 4× or 8×.
  - For tiny icons (16×16) it's often faster to draw them as a grid in code.
- **Abstract shapes:** draw as SVG directly, so they follow the light/dark theme.

## Assets offered by our asset contributor (Foundry + their blog)

> **The contributor is never named** in the app, README or report (their wish). Docs call them "the asset contributor".

**What his sites use (seen 2026-11-07):**
- **Pixel characters as SVG.** Each frame is its own SVG on a fine pixel grid (about 44×119 px), drawn as `crispEdges` paths with one colour per path. Animations are frame sets: `body-idle-00…07`, `eyes-open/half/closed` (blink layer on top of the body), `dp-shades-00…07`, `dp-laugh-00…07`.
- PNG sprite sheets for moves (`arrive-hop`, `arrive-wave`), pixel-art scene covers, a halftone cover.
- Small UI sound effects.
- Fonts: Departure Mono (pixel mono), Fraunces, Newsreader. All three are free (SIL Open Font License), so we can use them even without his files.

**Can we use them? Yes, with three conditions:**
1. **Written permission** (a message or email is enough) that names what he gives us and says we may **use and modify** it in Cyrus, including showing it in the demo/report and hosting it publicly. Keep it privately (outside the repo); the repo only notes that permission was given.
2. **Credit** in the app's About page, the README and the project report.
3. **Don't use his personal avatar or Foundry's mascot as Cyrus's face.** That character is *him* and *his product's* brand. On our landing page it would look like his app, and examiners might read it as copied work. Use his assets as a **base**:
   - the body/animation rig, the eye-blink layer, the frame timing
   - recolour, new hair, new outfits and props to make **our own cast**: Student (backpack), HR (lanyard + clipboard), TPO (stamp/keys), Interviewer (headset), Volunteer (armband)
   - his scenes and abstract pixel pieces can be used more freely, if he's fine with it

**What to ask him for:** the source SVG frames (not the hashed build files), the sprite sheets, the palette he uses, and whether the sound effects are his own or from a library with its own license.

**This removes the need for the Gemini key.** His sprites are plain pixel-grid SVGs, so new frames can be drawn **in code** (a grid of colour codes → SVG paths) in the same style. That gives crisp art that can be recoloured for light/dark themes and is easy to animate. No image model needed.

**Where they go in the repo:**
```
apps/web/src/assets/pixel/
  contributed/          contributor's files (+ LICENSE file for anything taken from an Apache-2.0 repo)
  cast/                 our characters (derived from his base, or drawn from scratch)
  shapes/               abstract blocks: stairs (rounds), queue line, ticket (QR pass)
```
A small `<Sprite frames fps>` React component plays the frame sets. `prefers-reduced-motion` shows the first frame only.

## Dashboard UI: taken from Foundry (decided 2026-11-07)

The app's dashboards (TPO, staff, HR, interviewer, student) reuse **Foundry's dashboard design directly**: layout, components, icons and styles from `src/foundry/dashboard/` in the public Foundry repo, adapted to React and to Cyrus's screens.
- Foundry is **Apache-2.0**. Allowed with two conditions: keep its `LICENSE` file at `apps/web/src/vendor/foundry/LICENSE`, and keep any copyright headers in files we copy. **No name in the app UI** (the contributor stays anonymous).
- Files we change get a short note at the top: "Adapted from Foundry (Apache-2.0)".
- Foundry's own mascots/brand (logo, wordmark, team sprites) are **not** used as Cyrus branding.

## Gemini API key (optional now)
- **Don't paste the key in chat.** Put it in a `.env` file in the project folder:
  ```
  GEMINI_API_KEY=your-key-here
  ```
  and make sure `.env` is in `.gitignore`. A small script will read it from there.
- The model name will be checked against Google's current docs before writing the script, since the image model names change often.

## Open questions
1. Dark-first site (like LaunchDarkly / Railway) or light-first?
2. One brand accent colour? Candidates to try on the pixel cast.
3. Mascot name / one main character, or an ensemble of roles?
