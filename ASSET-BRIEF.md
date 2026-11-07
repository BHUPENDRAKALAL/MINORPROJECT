# Cyrus: Asset Brief

Hi! Thanks a lot for offering to help! 🙌
This brief covers everything we'd like generated (Vertex AI), the style, sizes, and how to send it over. Change anything that doesn't work with your setup.

— Bhupendra Kalal & Seya Mali (MBM University, 7th sem minor project)

---

## 1. What Cyrus is (30 seconds)

An app for our college's placement cell. Companies run hiring drives on campus. Students join drives, check in at the venue with a QR code, wait in a live interview line, and get results and offer letters. The TPO (placement officer), staff, volunteers, HR and interviewers each have their own screens.

**Where the art shows up:**
- the public landing page
- empty screens ("no drives yet")
- the waiting screen in the interview line
- success/failure screens (selected, offer accepted)
- loaders

The app's main screens stay clean and simple. The pixel art adds personality around them.

---

## 2. Style

- **Pixel art**, crisp, no blur or anti-aliasing, hard pixel edges. Same family as your blog/Foundry sprites (fine-grid characters, warm and friendly), but **new characters**: not your avatar and not the Foundry mascot, so Cyrus has its own identity.
- Flat colours, at most 1–2 shading tones per colour, 1 px dark outline.
- Friendly, a bit playful, never goofy. Indian college setting.
- **Diverse cast:** different skin tones, hair styles, genders, glasses / no glasses. **No real people, no logos, no brand names, no text inside images.**
- Transparent background for characters and shapes.

### Palette (please stick to these as much as possible)

| Name | Hex | Use |
|---|---|---|
| Ink | `#14171d` | outlines, darkest shade |
| Night | `#232a36` | dark clothes, shadows |
| Paper | `#f6f7f9` | highlights, white clothes |
| Fog | `#9aa3b2` | grey details |
| Mint | `#5fcf9c` | brand accent, success |
| Sky | `#7ba7f0` | secondary accent |
| Amber | `#e5b84e` | highlights, badges, stars |
| Coral | `#f08a63` | alerts, warm accent |
| Skin 1–4 | `#f2c9a5` `#d9a079` `#b07a52` `#7a4e33` | skin tones |
| Hair | `#1b1410` `#3b2a20` `#6b4a2f` | hair |

If Vertex drifts from the palette, no problem. We snap colours to the palette afterwards (section 7).

---

## 3. What we need

### A. Characters (the cast): highest priority

Each character: **full body, front-facing, standing, transparent background.**
Target look: about **48 × 96 pixel grid** (a little shorter than your blog avatar).

| Character | Look and props | Poses needed |
|---|---|---|
| **Student A** | Backpack, casual shirt/kurta, ID card on a lanyard | idle, waving, waiting (checking phone), celebrating (arms up), sad/rejected (shoulders down), walking |
| **Student B** | Different gender, skin tone and hair from A, glasses, laptop bag | idle, waving, waiting, celebrating, sad, walking |
| **HR (company recruiter)** | Smart-casual blazer, company lanyard (no logo), clipboard or tablet | idle, waving, holding up a paper (offer letter), thumbs up |
| **TPO (placement officer)** | Formal, older, glasses, big rubber stamp or keys | idle, stamping (approve), pointing (directions), arms crossed |
| **Interviewer** | Headset or notepad, sitting at a small table | sitting idle, talking, writing notes, nodding |
| **Volunteer** | Bright armband (Amber), holding a phone showing a QR | idle, scanning, pointing, thumbs up |

**Consistency:** the same character must look the same in every pose (same clothes, colours, proportions). Generating a **character sheet** first (all poses of one character in one image, on a grid) and then cropping usually works better than one image per pose. A reference image or the same seed for every pose of a character also helps.

### B. Abstract pixel shapes (decorations)
Transparent background, about **64 × 64 grid** each:
1. **Stairs**: 4–5 steps going up (stands for interview rounds)
2. **Queue line**: a row of 5–6 blocks, one highlighted in Mint (the student's place in line)
3. **Ticket / pass**: a pixel ticket with a QR-like pattern (check-in)
4. **Envelope**: closed and open (offer letter)
5. **Stamp mark**: an "approved" stamp shape, no text
6. **Sparkles / confetti**: 3–4 small sparkle shapes (8×8 to 16×16)
7. **Clock**: small, for "waiting"
8. **Bell**: small, for notifications

### C. Scenes (lower priority)
Wide, about **320 × 180 grid**, can have a background:
1. **Campus at dusk**: college building, trees, a few students walking. Landing page hero.
2. **Waiting area**: chairs outside an interview room, a door with a light above it. Interview line screen.
3. **Celebration**: confetti and a student holding an envelope. Offer accepted.

### D. Icons (optional)
16 × 16 grid, single colour or two colours: drive, calendar, QR, bell, document, check, cross, user, building, trophy.

---

## 4. Prompt templates (Vertex AI / Imagen)

Feel free to rework these. They're just a starting point.

**Character sheet**
```
Pixel art character sheet, [CHARACTER DESCRIPTION], Indian college setting,
front-facing full body, 6 poses in a row: [POSES], same character in every pose,
crisp hard-edged pixels, no anti-aliasing, 1px dark outline, flat colours with
minimal shading, limited palette of deep ink, mint green, sky blue, amber, coral
and warm skin tones, plain transparent background, no text, no logos.
```

Example `[CHARACTER DESCRIPTION]`:
`a young woman student with a backpack, light kurta, ID card on a lanyard, short wavy hair, medium-brown skin`

**Abstract shape**
```
Single pixel art icon of [SHAPE], centered, crisp hard-edged pixels, no anti-aliasing,
1px dark outline, flat colours, mint green and amber accents, transparent background,
no text.
```

**Scene**
```
Pixel art scene, 16:9, [SCENE], dusk lighting, calm and friendly mood,
crisp hard-edged pixels, limited palette (deep navy, mint, sky blue, amber, coral),
no text, no logos, no real people.
```

**Things to add as negative prompt / avoid:** blur, gradients, anti-aliasing, 3D render, photorealistic, text, watermark, logo, extra limbs, cropped feet.

---

## 5. Files to send

- **Format:** PNG with transparency, the **largest size Vertex gives** (we downscale it ourselves).
- If you already convert to clean pixel SVG (like your blog sprites), even better. Send the SVGs too.
- **Naming:**
  - `character-<name>-<pose>.png`, e.g. `character-student-a-waving.png`
  - `sheet-<name>.png`, e.g. `sheet-hr.png`
  - `shape-<name>.png`, e.g. `shape-stairs.png`
  - `scene-<name>.png`, e.g. `scene-campus-dusk.png`
- One folder per section (characters, shapes, scenes, icons), zipped, or a shared Drive folder.
- A short note with the **model and settings** you used, so we can mention it in the project report.

---

## 6. Permission and credit (important for our college submission)

Please send a short message (WhatsApp or email is fine) saying something like:

> "I generated these assets for Cyrus using Vertex AI. Bhupendra and Seya may use, edit and publish them in the Cyrus app, website, demo and project report."

If you also share any of your **own existing** blog/Foundry assets, please mention which ones in the same message.

**We will credit you:**
- **Your name won't appear anywhere** (app, README or report), as agreed.
- The project will say the pixel art was **AI-generated (Vertex AI) and contributed to the team**. We don't hide AI use in this project.
- If any file comes from one of your open-source repos (e.g. Apache-2.0), we only keep its license file next to it in the repo, as that license requires. Nothing is shown in the app.

If your Vertex project has any usage terms that matter for a public demo, please let us know.

---

## 7. What we do after receiving them

So you don't need to perfect anything:
1. Downscale each image to its target grid (nearest-neighbour, no smoothing).
2. Snap colours to the palette above.
3. Clean stray pixels by hand.
4. Convert to pixel SVG (one path per colour, `crispEdges`), so the art stays sharp at any size and can follow light/dark mode.
5. Split poses into animation frames and play them with a small sprite component.

---

## 8. Priority (if time is short)

1. Student A + Student B (all poses)
2. HR, TPO
3. Shapes: queue line, stairs, ticket, envelope, sparkles
4. Interviewer, Volunteer
5. Scenes
6. Icons

Thanks again! Ping us anytime with questions. 🙏
