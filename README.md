# Hollowspire

A one-thumb, swipe-duel, tower-climbing action RPG. This repository is the
first playable slice of the design in the **Hollowspire: Game Design Document**.
It is a browser prototype (TypeScript + three.js) whose purpose is to prove
combat feel early (GDD section 13: "provided combat feel is proven in the
first two months").

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for the combat rules, formulas and tower
npm run build      # typecheck + production build into dist/
```

Open it on a phone on the same network (`npm run dev -- --host`) for touch
controls. It plays in landscape.

Dev shortcut: `?duel=<enemy-id>` jumps straight into a duel, for example
`?duel=iron-warden`. The IDs are `ashen-footman`, `ember-hound`,
`gate-archer`, `brute` and `iron-warden`.

## Controls

| Action | Touch | Keyboard |
| --- | --- | --- |
| Parry | Swipe toward the strike as the ring closes | Arrow keys (or I J K L) |
| Slash | Swipe across the enemy during an opening | Arrow keys |
| Riposte | Tap right after a Perfect Parry | R or Enter |
| Dodge | Swipe left/right in the bottom band, or tap a chevron | A, D |
| Block | Hold the shield (bottom left) | Hold S or Shift |
| Soul Burst | Tap the Soul ring (bottom right) | Space |
| Tonic | Tonic button | E |
| Pause | Pause button | Esc |

## What's in this slice

- **Combat (GDD section 4):** shape- and colour-coded tells (quick, heavy,
  unblockable, projectile); a 220 ms parry window with a 90 ms Perfect Parry;
  350 ms dodge with a 0.6 s cooldown; block and the Guard meter, including
  shield break; a combo multiplier from 1.0x to 2.5x; Soul meter and Soul
  Burst; riposte; Tonic; Second Wind; stagger resistance; enemy attack decks
  that never repeat an attack three times in a row; Warden phases and elite
  enrage.
- **Fairness rules** are enforced: tells are never shorter than 0.45 s even
  after speed-ups, and a combo's last strike is never more than 25% faster
  than its first (both checked by unit tests). The death screen shows the
  exact tell that killed you and how to counter it.
- **Tier I, the Cinder Gate (sections 7 and 8):** the authored door layout
  (Floor A: Duel, Duel, Vault · B: Shrine, Duel, Elite · C: Merchant, Duel),
  the Ashen Footman, Ember Hound, Gate Archer, the Brute (elite) and the Iron
  Warden (two phases plus enrage). A no-damage duel reveals the secret door.
- **Progression and economy (sections 5, 6 and 14):** levels with the
  `90 · L^1.6` XP curve and 3 free points per level, free respec, Tier I gear
  at GDD prices, tempering with `0.04 · P · 1.4^n` costs, merchant, vault keys,
  and autosave after every room.
- **Presentation (section 12):** low-poly flat-shaded models built from
  primitives, the burning gatehouse arena, rim and fire lighting, embers,
  hit-stop, slow motion on Perfect Parry, a finger-following slash trail,
  synthesized sound per tell type, haptics, and a wide-parry accessibility
  option.

## Layout

```
src/core/      engine-agnostic rules: duel simulation, formulas, profile, tower
src/data/      tuning tables, enemies and gear (numbers from the GDD)
src/render/    three.js stage, models and procedural animation
src/input/     touch gestures and keyboard
src/ui/        DOM helpers and icons
src/main.ts    game controller: screens, HUD, duel event handling
tests/         Vitest unit tests for src/core and the enemy data
```

`src/core` has no rendering or DOM dependencies, so the rules port directly
to the Unity 6 build the GDD specifies.

## Provisional numbers

The GDD doesn't specify everything a playable build needs. Values marked
`PROVISIONAL` in `src/data/tuning.ts` were chosen for this prototype: stagger
lengths, gold and XP amounts per room, Guard costs for quick strikes, and what
a free stat point buys. The stagger lengths are sized so an opening fits
about 4 to 6 slashes, in line with the GDD's "56 slashes in 10 to 12
openings" for the Hollow King.

## Not built yet

Tiers II to V and the Hollow King, spells and Focus, runes and Ember Shards,
helm and armor set bonuses, Hearth upgrades, Hearth Fires across tiers,
Mystery, Gauntlet and Forge rooms, aggression and counter-learning AI, grabs
and sweeps, Rebirth cycles and Oaths, extra modes, cloud save and analytics.
