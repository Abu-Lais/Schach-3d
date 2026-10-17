# Wizard Chess 3D — Real-Time Online Multiplayer & Matchmaking

Integration of a real-time full-stack online multiplayer system into Wizard Chess 3D, featuring private room codes, one-click shareable invite links, synchronized 5-minute blitz clocks, quick sanctuary chat, algebraic move history, and draw/resign controls.

### User Review & Critical Decisions

> [!IMPORTANT]
> The following parameters were confirmed through the interactive requirements interview and will guide the implementation:

- **Confirmed: Room Codes & Shareable Invite Links**: Matches are created as isolated sanctuaries with unique 6-character alphanumeric room codes and direct URLs (e.g. `?room=SANCTM`), making inviting friends instantaneous via clipboard copy.
- **Confirmed: 5-Minute Blitz Chess Clocks**: Each side begins with 300 seconds (5:00). Clocks tick down on the active side with server-authoritative timestamps, alerting players when entering time trouble (< 30 seconds).
- **Confirmed: Sanctum Chat & Interactive Match Controls**: In-game collapsible Gothic drawer with real-time text chat, thematic wizard quick-taunts ("A calculated sacrifice", "Checkmate looms", "Well played"), algebraic move notation log (e.g. `1. e4 e5 2. Nf3 Nc6`), and formal Draw Offer / Resign buttons.
- **Confirmed: Seamless Dual-Mode**: The app preserves the existing local Single-Player vs AI mode while adding a sleek "Play Online" lobby modal and top bar status badge.

---

### 1. Overview & Core Concept

- **What It Does**: Transforms the solo 3D Wizard Chess experience into an authentic online multiplayer duel. Players can host a private sanctuary room, share an invite link with a friend, pick or randomize sides (White/Black), execute real-time stone-crushing chess moves synchronized across browsers, and communicate via live chat.
- **Target Audience**: Chess enthusiasts and Harry Potter / fantasy wizard chess fans who want cinematic 3D stone-shattering battles with remote friends or rivals.
- **Key Value**: Low-friction multiplayer with zero account registration needed, instant room-link sharing, accurate chess clock synchronization, and spectator-friendly room states.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. *Online Lobby & Room Creation*: User clicks "Play Online" in the top HUD. A modal appears offering "Host Private Match" or "Join with Code".
  2. *Friend Invitation*: When hosting, the user receives a 6-character room code and an "Invite Friend (Copy Link)" button that copies `https://<domain>/?room=ABCDEF` to clipboard.
  3. *Waiting Sanctuary*: Host sees "Waiting for rival wizard to enter the sanctum...". As soon as Player 2 connects via the link or code, the match begins with a stone bell chime, assigning White and Black.
  4. *Live Match Execution*:
     - Turns alternate with live 5:00 blitz timers rendered in Gothic numerals.
     - When Player 1 moves a piece, the 3D move and cinematic melee attack play smoothly on both screens simultaneously.
     - Move log appends in standard algebraic notation.
     - Players can send messages or quick wizard reactions in the Sanctum Chat drawer.
  5. *Game Conclusion*: Checkmate, timeout (flag fall), resignation, or agreed draw triggers the victory banner with an option for "Rematch" or "Return to Hall".

- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Dark Gothic cathedral fantasy with stone obsidian plates, warm candle gold highlights (`#d4af37`), and ethereal spell accents.
  - *Color Tokens*:
    - Background: `#080a0f` deep sanctum darkness
    - HUD Surfaces: `rgba(12, 15, 22, 0.88)` with fine `rgba(212, 175, 55, 0.32)` hairline gold borders
    - White Player Clock: Ice marble glow (`#f0ece1`)
    - Black Player Clock: Obsidian shadow with gold numerals (`#d4af37`)
    - Critical Clock Alert (< 30s): Pulsing crimson ember (`#e63946`)
  - *Typography*: Pairing `Cinzel` / display serif for sanctum titles with crisp monospace tabular numerals (`JetBrains Mono` / `font-mono tabular-nums`) for clocks and move notations.
  - *No-Slop Discipline*: Zero floating candy badges; clean typography and unboxed metadata.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Full-Stack Express Server with Native WebSockets (`ws`)**:
  - *Chosen Approach*: Implement an Express HTTP server in `server.ts` that mounts Vite in development and handles native WebSocket connections (`/ws`) on port 3000.
  - *Why*: Provides sub-50ms latency for piece movements, true server-authoritative timekeeping, and simple connection lifecycle management without third-party external services.
  - *Alternatives Considered*: Firebase Firestore polling was considered, but WebSockets provide lower latency, instantaneous turn handoff, and immediate online presence detection.

- **Decision 2: Server-Authoritative Clock & Turn Validation**:
  - *Chosen Approach*: The WebSocket server tracks the room state, active turn, clocks, and move history. Timestamps are validated on the server to prevent clock tampering.
  - *Why*: Guarantees fair blitz play and ensures both players see identical remaining times.

- **Decision 3: Seamless Integration with the Three.js Engine**:
  - *Chosen Approach*: Provide a clean event bridge between the React HUD/Socket layer and `wizardChessEngine.js`. When a remote move is received, the 3D engine executes the exact same animated attack and stone-shatter sequence as local moves.
  - *Why*: Preserves 100% of the cinematic melee animations and stone fragmentation effects in multiplayer.

---

### 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER (Browser)                          │
│                                                                        │
│   ┌──────────────────────────────────────────────────────────────┐     │
│   │                      src/App.tsx                             │     │
│   │  • Top HUD: Mode Selector (AI vs Solo / Online Duel)         │     │
│   │  • Blitz Clocks (White 5:00 | Black 5:00) with Flag Alarm    │     │
│   │  • Multiplayer Lobby Modal (Create / Join / Copy Link)       │     │
│   │  • Sanctum Chat Drawer & Move History (Algebraic Notation)   │     │
│   │  • Draw Offer & Resign Modals                                │     │
│   └──────────────────────┬───────────────────────▲───────────────┘     │
│                          │                       │                     │
│               User Move  │                       │ Remote Move Sync    │
│               Event      ▼                       │                     │
│   ┌──────────────────────────────────────────────┴───────────────┐     │
│   │                 src/wizardChessEngine.js                     │     │
│   │  • 3D Board, Raycasting, Piece Selection                     │     │
│   │  • Cinematic Melee Capture & Stone Shatter Physics           │     │
│   │  • Move validation & local audio synthesis                   │     │
│   └──────────────────────┬───────────────────────▲───────────────┘     │
│                          │                       │                     │
└──────────────────────────┼───────────────────────┼─────────────────────┘
                           │ WebSocket (JSON)      │
                           ▼                       │
┌──────────────────────────────────────────────────┴─────────────────────┐
│                   SERVER LAYER (Node.js / Express)                     │
│                                                                        │
│   ┌──────────────────────────────────────────────────────────────┐     │
│   │                         server.ts                            │     │
│   │  • Port 3000 HTTP + WebSocket Upgrade Server (`ws`)          │     │
│   │  • Vite Middleware in Dev / Static Serving in Prod           │     │
│   │  • Room Manager (`Map<RoomId, RoomState>`)                   │     │
│   │    - 6-Char Alphanumeric Code generation                     │     │
│   │    - Player Slots: White, Black, Spectators                  │     │
│   │    - Clocks: 300s Blitz Countdown with Timestamp delta       │     │
│   │    - Move Broadcast & History validation                     │     │
│   │    - In-game Chat & Game-over broadcast (Checkmate/Draw)     │     │
│   └──────────────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────────────┘
```

#### Protocol Events (Client <-> Server WebSocket JSON):
- `room:create` -> Server generates room ID, assigns Host to White.
- `room:join` `{ roomId, name }` -> Server checks room capacity, assigns Black, starts 5:00 clock.
- `game:move` `{ roomId, from, to, promotion }` -> Server validates turn, updates board & timers, broadcasts to opponent.
- `game:chat` `{ roomId, sender, message, isQuickTaunt }` -> Broadcasts to room.
- `game:draw_offer` / `game:draw_respond` `{ accept: boolean }` -> Handled server-side.
- `game:resign` `{ roomId, side }` -> Ends match, declares opponent victor.
- `room:sync` `{ board, turn, clocks, whitePlayer, blackPlayer, status }` -> Sent on join/reconnect.

---

### Implementation Steps (Post-Approval)
1. **Server Setup**: Add `server.ts` with Express and `ws`, update `package.json` dev script to use `tsx server.ts`.
2. **Multiplayer Engine Bridge**: Add event hooks in `wizardChessEngine.js` for remote move dispatch and board synchronization.
3. **Multiplayer React UI**:
   - Online Lobby modal (Create room, Join with code, copy invite link with toast).
   - Synchronized 5-minute Blitz Clocks with time-trouble warnings.
   - Live Chat & Move History drawer with quick wizard dialogue pills.
   - Victory / Defeat / Draw modal with Rematch invitation.
4. **Verification**: Run unit tests, verify WebSocket handshakes, and test two-browser synchronization.
