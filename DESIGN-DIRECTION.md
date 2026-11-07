# PlaceSync: Visual Direction (Draft)

> Draft notes from looking at reference sites on 2026-11-07. Not final.

## What we took from each reference
| Site | What works there | What we borrow (as an idea, not a copy) |
|---|---|---|
| launchdarkly.com | Black canvas, very large bold headline, one bright accent on the CTA, floating product UI cards, small sparkle shapes | Show **real product screens** (drive card, live queue, QR check-in) as floating cards on the landing page |
| foundry.coehemang.dev | Pixel-art mascot, pixel confetti loader, small pixel characters placed **inside sentences**, big bold text on a bright band | **Pixel characters as personality**: tiny sprites next to words like "student", "HR", "TPO" |
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

## Gemini API key
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
