# DUSKFALL — Marlowe City

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/xenopatijaya/gta6-01-v4/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/xenopatijaya/gta6-01-v4/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

An original open-world crime game built for the make.fun **gta6-01** bounty.
Explore **Marlowe City** — a fictional neon dusk city — on foot and by car, steal
rides, outrun the Marlowe PD, and pull three jobs for the fixer Mara Quinn.

Everything in this game is invented: the city, the characters, the vehicles, the
story, the art and the sounds. No assets, names or music from any commercial game.

## Play

```sh
node serve.ts
# open http://localhost:8080
```

No build step, no network requests — the game is plain static files under `game/`
(three.js 0.187.0 is vendored at `game/vendor/three.module.min.js`).

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move / drive |
| Mouse drag | Orbit camera |
| Shift | Sprint |
| E | Steal / enter / exit car · hold E to crack the safe |
| F | Punch |
| Space | Handbrake |
| P | Pause · M mute |

## Features

- **Open city** — 6×6 blocks of buildings, roads, sidewalks, palms, street lamps,
  a beach and ocean on the west edge, neon signs, dusk sky.
- **On foot + driving** — steal any traffic car, drive with acceleration, steering
  and handbrake; exit any time.
- **Traffic AI + pedestrians** — cars cruise the road grid and turn at
  intersections; pedestrians stroll the sidewalks and flee from danger.
- **Wanted level 0–5** — stealing, assault and running people over raise your
  stars; Marlowe PD cruisers chase, ram and try to bust you. Lay low and the
  heat cools off.
- **3 story missions** — *Wheels Up* (steal a car, reach the garage),
  *The Marlowe Drop* (grab a hot package, deliver it south) and
  *Harbor Lights Heist* (crack the warehouse safe, escape to the safehouse).
  Cash rewards, then free roam.
- **Combat** — punch pedestrians and officers; police rams damage you.
- **HUD + live minimap** — cash, health, wanted stars, objective + distance,
  speedometer, and a real-time minimap with player, traffic, police and the
  mission beacon.
- **Start screen, pause, busted/wasted/story-complete screens**, auto-save to
  localStorage (continue where you left off), synthesized WebAudio sound
  (engine, sirens, pickups) — no audio files.

## Screenshots

Real renders of the game in Chrome, staged deterministically with
`?shot=start|cover|drive|mission&seed=N`.

## License

MIT — see [LICENSE](LICENSE).
