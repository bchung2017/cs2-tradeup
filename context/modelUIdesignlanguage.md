# Journeyman — Chain UI ("Route View") Design Context

Reference implementation: `journeyman-chain-ui-example.html` (static mock, hardcoded data).

## Naming stack (settled)

- **Venture** — the route view / chain surface. Journey with money staked;
  the buy-in is in the word. Firmware title treatment available:
  `venture.bin`, `VENTURE_FW`.
- **IGL-9000** — the model (JourneyPlanner policy + JourneySim MC rollout).
  IGL = in-game leader (shotcaller, reads the economy, calls the buy);
  9000 = machine designation, faint HAL echo without the literalism.
- **Lore** — history tracking. Dragon Lore destination + accumulated
  knowledge double read.

Rejected registers, do not resurrect: esports surface names (Strat Book,
Operation HQ), space-flavored treatments (odyssey.exe), literal
forward-progress skin names (Asiimov).

## Identity & voice (Matrix × Artemis Fowl × Ghibli koi)

The three poles map to the three layers — voice assignments, not themes:

- **Matrix → the numbers.** Honest math is the red-pill moment:
  "this step loses you money vs. selling" is the wake-up. Delta/warning
  copy is flat and undeniable, never softened. Anti-gamba posture IS the
  escape-the-matrix narrative (everyone else's calculators are asleep).
- **Artemis Fowl → IGL-9000's voice.** Boy-genius mastermind working for
  you: suave, precise, faintly smug, mercenary on your behalf.
  "I've found something. Buy two pinks — $6.30 — and hop 2 opens."
  Solves the coddling requirement with style instead of softness.
- **Ghibli koi → the stash.** Product thesis: the value was in your
  inventory the whole time; the route reveals it. Start card is the
  emotional anchor; koi environment is its visual argument (calm water
  over live circuitry).

The tension is the identity: Fowl's polish keeps Ghibli from going soft;
Matrix bluntness keeps Fowl honest.

**White koi = white rabbit.** One desaturated koi among the colored
schemes, rare spawn on the landing surface; following/clicking it is the
onboarding pull into Venture. (Requires a seventh, white smoke-texture
color scheme + click handler — no new systems.)

Identity line: *the value was always in the water — follow the white koi
and I'll show you the route.*

## Concept

Horizontal skill-tree route (Skyrim-style, left→right) on desktop; same tree
vertical on mobile (<720px breakpoint, links rotate, pulses travel downward).
Nodes = contracts. Links = dependency flow. Start node = stash summary.
End node = destination skin.

Design target: pre-attentive (~400ms) legibility. Every key fact rides a
fast visual channel (color, size, fill ratio, position) — not text reading.

## Channel map

| Fact                  | Channel |
|-----------------------|---------|
| Hop profit/loss       | One 24px signed number per card, --profit green / --loss red. Largest element on card. |
| Route financials      | Header strip: cash needed (amber), likely end value, net vs. selling (signed, colored). |
| Chaining / progress   | Rail with animated pulses on live links; links past current hop are cold/dim. "How far the route is lit" = progress. |
| Contract fill state   | 2×5 slot grid. Filled = owned (rarity-tinted), amber = buy-needed, hollow = waiting on upstream hop. |
| Missing / action      | Amber = exclusively "action needed" (buy slots, need-line, BUY button). One hue, one meaning. |
| Rarity escalation     | 3px top-band per node in CS2 rarity colors: purple #8847ff → pink #d32ce6 → red #eb4b4b. Audience parses these instantly. |
| Start / end           | Stash card opens; destination card closes with corner brackets, biggest number (28px payout), p10/p50/p90 spread. |
| Purpose / next action | Exactly one armed (inverted-green) button visible at a time. Hop breadcrumb "hop N of M". Locked hops visibly wait downstream. |

## Node card anatomy (top to bottom)

1. Rank line: rarity tier label (rarity-colored) + hop number (hud chrome)
2. Delta: signed $, 24px bold, colored; sub-caption "vs. selling these 10"
3. Slot grid 2×5
4. Status line: ready (green) / need N more · buy ~$X · unlocks in Nd (amber) / waiting-on-upstream (faint)
5. Button: RUN TRADE-UP (armed, green-inverted) / BUY N → ARM (amber outline) / WAITING (dim)

Node states: armed · needs-buy · locked (opacity 0.55, dashed border, delta desaturated but still shown).

## Copy register (9th-grade gamer)

Domain terms allowed: trade-up, float, odds, stash, hop, route, rarity names.
Banned: EV, expected value, liquidation, variance, basis, profit (as noun in UI copy).
The one installed concept: everything compares to "just selling" —
"vs. selling these 10", "vs. just selling it all", "sell-now: $X".
Odds in plain frequencies: "1 in 5 pulls hits the AWP — the rest still sell".
Spread labels: "rough day / normal / lucky" (p10/p50/p90).

## Honesty invariants (carried from core model doc)

- Locked hops still show their signed delta.
- Route net reconciles to sum of hop deltas — narrative facade, never numeric.
- Destination shows p10 alongside p50; odds line always visible.
- Amber buy costs are real ask-side prices; lock durations shown inline.

## Style base

Phosphor terminal tokens (see phosphor-terminal-ui skill): --fg neutral body
text, green as accent only, one .glow on the title, faint scanlines,
JetBrains Mono. Semantic additions: CS2 rarity triad above; rarity-tinted
slot fills (--r-purple owned slots use #5a2fb0, pink #8c1e99, dimmed for
fill vs. border legibility).

## Deviations / open dials

- Destination leads with p50, p10 kept visible — spread weight is tunable.
- Connector pulses: 2.2s linear loop; reduced-motion query freezes them at 50%.
- Slot grid carries no per-skin identity (hover-lock popup is the planned
  affordance for slot detail, per the skill's hover-reveal pattern — not
  yet in the mock).