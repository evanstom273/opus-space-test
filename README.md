# Wayfarer

A 3D space exploration sandbox that runs in the browser (Three.js, no build step).
Five procedurally generated planets: fly between them in real time, land, and explore on foot.
There are no loading screens or teleports: every planet you see in the sky is the world you can land on.

**Play:** open the GitHub Pages site for this repo, or serve the folder locally:

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Click the page to capture the mouse. A desktop browser with WebGL2 is required.

## Controls

| On foot | | Piloting | |
|---|---|---|---|
| W A S D | Move | Mouse | Pitch & yaw (virtual stick) |
| Mouse | Look | W / S | Thrust / brake |
| Shift | Sprint | A / D | Roll |
| Space | Jump (hold for jetpack) | Space / C | Ascend / descend |
| F | Board ship (when close) | Shift | Boost, or cruise drive in space |
| Wheel | Camera distance | Right mouse | Look around |
| | | F | Exit ship (when landed) |

General: `Tab` discovery journal, `L` lamp (auto/on/off), `T` fast-forward time of day, `O` settings, `H` help, `M` mute, `Esc` release mouse.

**Gamepad** (standard layout):
- **Sticks:** left stick moves or steers; right stick looks around.
- **On foot:** A jumps (hold for jetpack), B sprints, X boards the ship.
- **Piloting:** RT/LT thrust and brake, A/B ascend and descend, LB/RB roll, Y boosts, X exits once landed.
- **Menus:** Start opens the journal.

To land, slow down near the ground. The gear deploys automatically, then hold `C` to settle onto the surface.
In space, hold `Shift` with `W` for the cruise drive. It slows automatically as you approach a planet.

## Settings, saving and night

- **Settings (`O`, or the button on the pause screen):** look sensitivity, invert-Y for walking and for flight, graphics quality (auto/high/low), a performance graph, lamp mode, volume, and a New game reset.
- **Performance graph:** shows the real time of each of the last ~240 frames (green ≤18 ms, yellow ≤34 ms, red above), with the CPU share in white. Below it are average fps, the worst frame, and the number of hitches (>34 ms) in the last 10 s.
- **Loading screen:** before play it generates the nearby terrain, builds every creature model and compiles every shader variant, including shadow variants, so nothing compiles mid-game.
- **Saving:** your position, ship and time of day are saved automatically in this browser and resumed on your next visit. Discoveries are kept too.
- **Night:** a helmet lamp (on foot) and ship headlights (when piloting) switch on automatically after dark.

## The worlds

- **Elysia**: teal meadows, amber spire forests, oceans. Longneck grazers, hoppers, sky skimmers.
- **Kharif**: dunes, layered mesas, canyons, salt flats. Dune serpents, shellback beetles, dust kites.
- **Borea**: glaciers, ice spires, frozen sea. Woolly striders, frost jellies.
- **Ignis**: basalt plains, glowing fissures, lava seas, volcanoes. Magma crawlers, ember moths.
- **Umbra**: terraced fungal hills, giant glowing mushrooms, luminous lakes. Stilt walkers, lumen jellies, glow hoppers.

## Tech notes

- Cube-sphere quadtree terrain with skirts, generated in Web Workers from shared noise functions.
  The same height function drives collisions on the main thread.
- Floating origin (everything is rendered relative to the camera) and rotating planet reference frames, which give day/night cycles.
- One cel-shading model with per-fragment sun direction, sun shadows, rim light, inverted-hull outlines,
  and single-scattering atmospheres (sky shell plus per-vertex aerial perspective).
- Procedural rigged characters and creatures: one skinned mesh each, with procedural gaits.
- Flora and rocks are placed deterministically per terrain cell and drawn as instanced batches.

## Mobile

On touch devices an on-screen layout appears (landscape recommended):
- **Left side:** a floating joystick. On foot it moves you; in the ship it steers.
- **Right side:** swipe to look around.
- **Buttons on foot:** JUMP (hold for jetpack), RUN, and BOARD when you're next to the ship.
- **Buttons in the ship:** THRUST, BRAKE, UP, DOWN, BOOST, roll, and EXIT once landed.

Graphics settings are reduced automatically on mobile.
