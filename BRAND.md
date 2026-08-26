# WatchVault — Brand Guidelines

**Concept: the personal cinema archive.** WatchVault is not a social app — it's
your private vault of everything you've watched. The identity borrows from the
places films live: the warm dark of a screening room, the amber of a marquee
bulb and projector beam, the cream of an old ticket stub, the typewritten index
card of a film archive. Warm, analog, a little literary — never neon, never
"tech startup blue".

---

## 1. Color

Two set moods. **Screening Room** (dark) is the primary identity; **Matinée**
(light) is the daytime companion. Both are *warm* — no pure blacks, whites or
grays anywhere.

### Screening Room (dark)

| Role | Hex | Use |
|---|---|---|
| Page | `#141210` | window background |
| Surface | `#1c1917` | panels, cards |
| Surface-2 / 3 | `#26211d` / `#322b25` | inputs, hovers, wells |
| Ink | `#f5f0e6` | primary text (warm white) |
| Ink-2 | `#cbc2b2` | secondary text |
| Muted | `#8f8778` | labels, hints |
| **Marquee Amber** | `#e89b2e` | THE brand accent: primary buttons, active states, links |
| Amber ink | `#201503` | text **on** amber (never white on amber) |
| Velvet Red | `#e0655f` | danger and destructive actions only |
| Reel Green | `#3fa35c` | success, watched |
| Star Gold | `#eda100` | rating stars only |

### Matinée (light)

| Role | Hex | Use |
|---|---|---|
| Page | `#f5efe4` | window background (aged paper) |
| Surface | `#fffdf8` | panels, cards (ticket cream) |
| Surface-2 / 3 | `#f2ebdd` / `#e6dcc8` | inputs, hovers, wells |
| Ink | `#201b15` | primary text (warm near-black) |
| Ink-2 / Muted | `#5a5348` / `#90887a` | secondary / labels |
| **Deep Amber** | `#9c6404` | accent on cream (darker for contrast); text on it `#fffdf8` |
| Velvet Red | `#c23b34` | danger |
| Reel Green | `#2e7d32` | success |
| Star Gold | `#d99500` | rating stars |

### Chart colors (validated, do not eyeball-substitute)

Charts never reuse UI accent tokens directly — these pairs passed CVD-separation,
lightness-band and 3:1 contrast checks against their exact surfaces:

| Series | Dark (`#1c1917`) | Light (`#fffdf8`) |
|---|---|---|
| Movies | `#cc7f0d` | `#c07508` |
| Episodes / TV | `#218a6c` | `#0f8a68` |

Calendar heat ramp (sequential amber, low→high):
dark `#322b25 → #6b4a08 → #98690a → #cc7f0d → #f0aa3e`;
light `#ece4d3 → #f0d9a4 → #e3b45c → #c07508 → #7d4e04`.

**Rules:** amber = interaction, green = state "watched", red = destructive,
gold = stars. Never use amber for success, red for a data series, or star gold
for buttons. Text always wears ink tokens, never series colors.

## 2. Typography (all free on Google Fonts)

| Font | Role | Rules |
|---|---|---|
| **Fraunces** (variable) | Display: page titles, panel & modal headings, hero stat numbers, wordmark | Weights 550–700, optical size high (`opsz 32`). The wordmark *WatchVault* is Fraunces **italic** 600. Never use for body text or buttons. |
| **Instrument Sans** (variable) | Everything else: body, buttons, chips, inputs, labels | 400 body, 500–600 emphasis/buttons. Line-height ~1.45. |
| **JetBrains Mono** (variable) | Archive-card accents: episode codes (`S02E07`), dates, chart axis labels, counts, rating-source tags | Small sizes only (10–12px). This is seasoning — never paragraphs. |

Loading: bundled locally via Fontsource (`@fontsource-variable/fraunces`,
`…/instrument-sans`, `…/jetbrains-mono`) so the app works offline; on the web
the same three come from Google Fonts.

## 3. Shape & space

- Radius: 10px cards/inputs, 14px modals, 20px chips (pill), 50% checks.
- Hairline borders everywhere (`--hairline`), shadows only in light mode and
  only soft warm ones — dark mode separates by surface steps, not shadows.
- Posters are sacred: 2:3, never cropped, never tinted. Badges sit on top with
  blur, 6px radius: state top-left, ❤️ top-right, ENDED bottom-right.
  **ENDED wears the neutral scrim, never red.** A finished series is the
  ordinary condition of most of the library, not a warning; on a shelf of
  ended shows a red tag on each one is noise that outranks the posters.
- Active nav carries a 3px amber beam in the sidebar gutter, vertically
  centred and inset, plus a warm amber falloff across the left third of the
  pill — the "projector beam". **Never draw it as an inset box-shadow:** the
  shadow follows the pill's 8px radius and renders as a tapering arc around
  the corners instead of a bar.

## 4. Voice

Labels are quiet and factual ("277 movies watched", "added Mar 6, 2026");
insight copy may be warm and personal ("that's your patience threshold").
Numbers get the display face when they're the point, mono when they're metadata.

## 5. Implementation

The single source of truth is `src/styles.css` — the token blocks at the top
define every value above as CSS custom properties for both themes
(`:root` / `:root[data-theme="dark"]`). To restyle anything, change tokens, not
component rules.
