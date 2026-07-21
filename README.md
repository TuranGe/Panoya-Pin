# Panoya Pin

An open-source party game that turns your friend group's own memories, inside
jokes, and shared knowledge into the game itself. Unlike Skribbl/Pictionary-style
games, the word list or category isn't fixed — **the players write the
content themselves**. That means no two groups ever play the same game.

**Everyone plays remotely, from their own device** (think Codenames Online /
Gartic Phone) — you don't need to be in the same room. There's no "shared
screen" requirement; the room creator is a normal player just like everyone
else, they just hold the authority to advance the game (the "★ host" badge).

## How to play

1. Someone hits **"Create Room"** on the homepage, enters a nickname → gets a
   6-letter room code and joins the game as the "host".
2. Everyone else hits **"Join Room"** and enters the code and their own
   nickname — from their own phone or computer, wherever they are.
3. **Mode select**: in the lobby, the host picks the game mode before opening
   the prompt round:
   - **Who Would?** — everyone writes scenarios only
   - **Who's Lying?** — everyone writes trivia questions + real answers only
   - **Mixed** — players choose per submission which type to write
4. **Prompt round**: everyone writes content matching the chosen mode:
   - **Who Would?**: a scenario about your group ("who would do this?" style
     question or memory)
   - **Who's Lying?**: a real question + its real answer (e.g. "What was my
     nickname in high school? → Shrimp")
5. The game runs through the submitted content round by round:
   - **Who Would?** round: a scenario appears on screen, everyone votes on who
     in the group would most likely do it. Whoever matches the majority vote
     scores points; whoever gets the most votes also earns an "iconic" bonus.
   - **Who's Lying?** round: everyone except the person who asked writes a
     convincing fake answer, then everyone except the asker votes on which
     answer is real. Guessing correctly scores points; fooling someone with
     your fake answer scores points too; the person who asked the question
     gets a flat bonus.
6. After the last round, a **highlights screen** shows a handful of
   superlative awards ("Best Liar", "Most Gullible", "Detective", "Black
   Sheep", "Best Round"...) based on what actually happened in the game,
   followed by the final scoreboard. If the host hits **"Play Again"**,
   scores and stats reset but the submitted content stays in the pool (the
   host picks a mode again for the next game).

If not enough content was submitted (fewer than four), the system
automatically fills the gap with a few ready-made questions/scenarios
matching the chosen mode, so the game stays playable even on a first try
with just 3 people.

Every round has a **25-second timer**; when it runs out, anyone who hasn't
responded is simply counted as having passed, and the round resolves
automatically — you don't have to wait for everyone.

If the room host (★) refreshes their page, they don't lose host status (there's
a ~15-second grace period for brief interruptions). The host can transfer
their role to another player from the lobby, or kick a player. If the host
leaves for good (past the grace period), the role automatically passes to
another connected player — the game never gets stuck waiting on one person.

## Quick start

```bash
npm install
npm run dev -- --open
```

Create a room, send the invite link (there's a copy-link button) to your
friends — everyone can join from their own internet connection. If you want
to test from a phone on your local network, use `npm run dev -- --host`.

## Architecture

- **SvelteKit + Svelte 5 (runes)**, plain JavaScript.
- Real-time sync is handled by a **plain WebSocket server** (the `ws`
  package); no external service (Pusher, Supabase, etc.) required.
  - A small plugin in `vite.config.js` attaches the WebSocket server to
    Vite's own HTTP server during `npm run dev`.
  - `server.js` attaches the `build/handler.js` produced by `adapter-node` in
    production (`npm run build && npm start`) to a plain `http.Server` and
    opens the `/ws` path on the same server.
- Room state (`src/lib/server/rooms.js`, `gameLogic.js`) lives in an in-memory
  `Map` — plenty for the scale of a friend group (a handful of people, a
  handful of rooms). To scale further, swap that `Map` for a shared store
  like Redis.
- **Owner model**: the player who creates the room is marked as
  `room.ownerId`, and only they can trigger phase transitions (start
  prompting/start game, next round, play again). Short interruptions like a
  page refresh don't immediately hand off ownership — there's a grace period
  (`OWNER_GRACE_MS`, 15s by default). The owner can transfer their role with
  `transfer_ownership`, or kick a player with `kick_player` (see `rooms.js`).
- **Round timer**: each round auto-resolves after `ROUND_DURATION_MS` (25s by
  default) even if not everyone has responded; non-responders are counted as
  having passed (see `wsServer.js` → `scheduleRoundTimer`). Both durations can
  be shortened via environment variables in a test environment.
- The client keeps a single shared WebSocket connection
  (`src/lib/client/socket.svelte.js`, reactive via Svelte 5 runes); even after
  a page refresh, it automatically resumes where it left off using the room
  code/player id stored in `localStorage`.
- Two routes: `/` (landing) and `/play/[code]` (the single screen everyone
  plays on — extra control buttons appear there if you're the host).

### Why WebSocket + in-memory state instead of serverless?

The game needs long-lived connections and shared, frequently-updated room
state — that's a better fit for a single, always-on Node process (Railway,
Fly.io, Render, or your own VPS) than a typical serverless function.
`server.js` is written exactly for that.

## Design

The interface is deliberately bright and energetic: a warm
yellow-orange-pink gradient background, thick-bordered "sticky note" cards, a
`Fredoka` display font, and big, playful buttons (an energy close to the
Gartic Phone / Kahoot family). All color/typography values are defined as CSS
custom properties in `src/app.css` — the whole palette can be changed from
one file.

A few extra touches reinforce that energy:

- **Sound cues** — round start, results reveal, a countdown tick in the last
  5 seconds, scoring a point, and a small fanfare on game end. These are all
  synthesized on the fly with the Web Audio API (`src/lib/client/sound.svelte.js`)
  rather than loaded from audio files, so there's nothing to download and no
  licensing to worry about. There's a mute toggle (🔊/🔇) in the top bar; the
  preference is remembered in `localStorage`.
- **Confetti** — a small burst when you personally score a point, and a
  bigger celebration when the game ends (via the `canvas-confetti` package).
- **Connection toasts** — if someone's connection drops or comes back
  mid-game, everyone else sees a small "so-and-so disconnected/reconnected"
  notification, so a quiet phone doesn't get mistaken for someone ignoring
  their turn.
- **Animated scores** — points count up smoothly instead of jumping (via
  Svelte 5's `Tween` from `svelte/motion`, see `src/lib/components/AnimatedScore.svelte`),
  including a slightly slower, more dramatic count-up on the final scoreboard.
- **"Your turn" tab title** — if you background the tab while it's your turn
  to vote/answer, the document title flashes ("🔴 Sıra sende!") until you
  come back or the round moves on, so you don't accidentally sit out a round.
- A **bouncing-dots loader** (`src/lib/components/LoadingDots.svelte`)
  replaces the plain "connecting…" text while the socket connects.

## Tests

Instead of a real browser, there are integration tests that verify the
entire room/voting/scoring logic end to end (using the `ws` package to open
fake clients against a real running server):

```bash
npm run dev &          # or: npm run build && npm start
node tests/game-flow.test.mjs
node tests/edge-cases.test.mjs
node tests/new-features.test.mjs
node tests/reconnect-mid-game.test.mjs
node tests/yalanci-kim.test.mjs
node tests/awards.test.mjs
```

- `edge-cases.test.mjs` — too few players, blocking late joins, ownership
  surviving a brief disconnect, ownership transfer on a permanent departure,
  mode selection being required/enforced, and `player_left`/`player_returned`
  connection notifications reaching everyone except the affected player.
- `new-features.test.mjs` — ownership transfer, kicking a player, a round
  auto-resolving when its timer runs out.
- `reconnect-mid-game.test.mjs` — a player reconnecting after the game has
  already started (verifies the server returns a valid state without
  erroring).
- `yalanci-kim.test.mjs` — the writing/voting exclusion rules (the asker can
  neither write nor vote), scoring for correct guesses + fooling + the
  asker's bonus, and forced progress when time runs out.
- `awards.test.mjs` — end-game superlatives only appear for modes that were
  actually played, and every award has a well-formed winner/description.

Test durations can be shortened via the `OWNER_GRACE_MS` and
`ROUND_DURATION_MS` environment variables, e.g.
`OWNER_GRACE_MS=1000 ROUND_DURATION_MS=3000 npm start`.

## Game modes

The host picks a mode in the lobby, before the prompt round opens
(`room.selectedMode`, set via `start_collecting {mode}`):

- **Who Would?** (`kim_yapar`) — only scenario prompts are accepted; every
  round is a "who would do this" vote.
- **Who's Lying?** (`yalanci`) — only question+answer prompts are accepted;
  every round is a Fibbage-style bluffing round.
- **Mixed** (`mixed`) — players choose per submission, and rounds come up in
  a shuffled, mixed order.

Submissions that don't match the selected mode are rejected server-side
(see `addSubmission` in `gameLogic.js`), and the auto-fill fallback content
(used when fewer than 4 prompts were submitted) also respects the chosen
mode.

- **Who Would?** — a scenario; everyone votes on who in the group would do
  it. Matching the majority scores +10; getting the most votes earns a +5
  "iconic" bonus.
- **Who's Lying?** (Fibbage/Balderdash-style) — everyone except the asker
  writes a convincing fake answer, then everyone except the asker votes on
  which one is real. Guessing correctly scores +10; each person you fool with
  your fake answer scores you +5; the asker gets a flat +5. The asker can
  neither write nor vote (they already know the answer).

## License

MIT — see `LICENSE`.
