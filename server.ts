import express, { Request, Response } from 'express';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProd = process.env.NODE_ENV === 'production';
const PORT = 3000;

interface ChessMove {
  seq: number;
  color: 'w' | 'b';
  from: { r: number; c: number };
  to: { r: number; c: number };
  notation?: string;
  piece?: string;
  captured?: string;
  promotion?: string;
  ts: number;
}

interface ChatMessage {
  id: string;
  sender: string;
  side: 'w' | 'b' | 'spectator';
  text: string;
  ts: number;
  isQuickTaunt?: boolean;
}

interface RoomPlayer {
  token: string;
  name: string;
  side: 'w' | 'b';
  connected: boolean;
  lastSeen: number;
}

interface RoomData {
  code: string;
  status: 'waiting' | 'playing' | 'checkmate' | 'draw' | 'resigned' | 'timeout';
  whiteJoined: boolean;
  blackJoined: boolean;
  whitePlayer: RoomPlayer | null;
  blackPlayer: RoomPlayer | null;
  turn: 'w' | 'b';
  moves: ChessMove[];
  resetCount: number;
  clocks: { w: number; b: number }; // In seconds (default: 300 = 5 minutes)
  lastTurnSwitchTs: number;
  drawOfferFrom: 'w' | 'b' | null;
  winner: 'w' | 'b' | 'draw' | null;
  winReason: string | null;
  chat: ChatMessage[];
  updatedAt: number;
}

const rooms = new Map<string, RoomData>();
const roomSockets = new Map<string, Set<WebSocket>>();
const roomSseClients = new Map<string, Set<Response>>();

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return 'R' + Math.random().toString(36).slice(2, 7).toUpperCase();
}

function updateRoomClocks(room: RoomData): void {
  if (room.status !== 'playing' || !room.whiteJoined || !room.blackJoined) {
    return;
  }
  const now = Date.now();
  const elapsedSec = (now - room.lastTurnSwitchTs) / 1000;
  if (elapsedSec <= 0) return;

  const currentTurn = room.turn;
  const remaining = Math.max(0, room.clocks[currentTurn] - elapsedSec);
  room.clocks[currentTurn] = remaining;
  room.lastTurnSwitchTs = now;

  if (remaining <= 0) {
    room.status = 'timeout';
    room.winner = currentTurn === 'w' ? 'b' : 'w';
    room.winReason = `Zeit abgelaufen (5-Minuten-Blitz)`;
    broadcastRoomUpdate(room);
  }
}

function getSanitizedRoom(room: RoomData) {
  // Update clocks before serializing
  if (room.status === 'playing') {
    const now = Date.now();
    const elapsedSec = (now - room.lastTurnSwitchTs) / 1000;
    const currentTurn = room.turn;
    const currentClock = Math.max(0, room.clocks[currentTurn] - elapsedSec);
    return {
      ...room,
      clocks: {
        ...room.clocks,
        [currentTurn]: currentClock,
      },
    };
  }
  return room;
}

function broadcastRoomUpdate(room: RoomData) {
  room.updatedAt = Date.now();
  const sanitized = getSanitizedRoom(room);
  const payload = JSON.stringify({ type: 'room_state', room: sanitized });

  // WebSockets broadcast
  const sockets = roomSockets.get(room.code);
  if (sockets) {
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      }
    }
  }

  // SSE broadcast
  const sseClients = roomSseClients.get(room.code);
  if (sseClients) {
    const sseData = `data: ${JSON.stringify({ room: sanitized })}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(sseData);
      } catch {
        sseClients.delete(res);
      }
    }
  }
}

// Background Clock Ticker: check active games every 1000ms
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.status === 'playing' && room.whiteJoined && room.blackJoined) {
      updateRoomClocks(room);
      if (room.status === 'timeout') {
        broadcastRoomUpdate(room);
      }
    }
  }
}, 1000);

async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  app.use(express.json());

  // REST API Endpoints
  app.post('/api/rooms/create', (req: Request, res: Response) => {
    const { preferredColor, playerToken, playerName } = req.body || {};
    const code = generateRoomCode();
    const token = String(playerToken || 'tok_' + Math.random().toString(36).slice(2, 10));
    const side: 'w' | 'b' = preferredColor === 'b' ? 'b' : 'w';
    const name = String(playerName || (side === 'w' ? 'White Wizard' : 'Dark Wizard'));

    const room: RoomData = {
      code,
      status: 'waiting',
      whiteJoined: side === 'w',
      blackJoined: side === 'b',
      whitePlayer: side === 'w' ? { token, name, side: 'w', connected: true, lastSeen: Date.now() } : null,
      blackPlayer: side === 'b' ? { token, name, side: 'b', connected: true, lastSeen: Date.now() } : null,
      turn: 'w',
      moves: [],
      resetCount: 0,
      clocks: { w: 300, b: 300 }, // 5 minutes
      lastTurnSwitchTs: Date.now(),
      drawOfferFrom: null,
      winner: null,
      winReason: null,
      chat: [
        {
          id: 'welcome_1',
          sender: 'Sanctum Herald',
          side: 'spectator',
          text: `Sanctuary room ${code} established. Share the link with your rival!`,
          ts: Date.now(),
        },
      ],
      updatedAt: Date.now(),
    };

    rooms.set(code, room);
    res.json({
      ok: true,
      code,
      color: side,
      playerToken: token,
      room: getSanitizedRoom(room),
    });
  });

  app.post('/api/rooms/join', (req: Request, res: Response) => {
    const { code: rawCode, playerToken, playerName } = req.body || {};
    const code = String(rawCode || '').trim().toUpperCase();
    const token = String(playerToken || 'tok_' + Math.random().toString(36).slice(2, 10));

    let room = rooms.get(code);
    if (!room) {
      // Create new on-the-fly room if joining with non-existent code
      const side: 'w' | 'b' = 'b';
      room = {
        code,
        status: 'playing',
        whiteJoined: true,
        blackJoined: true,
        whitePlayer: { token: 'host_token', name: 'White Wizard', side: 'w', connected: true, lastSeen: Date.now() },
        blackPlayer: { token, name: String(playerName || 'Dark Wizard'), side: 'b', connected: true, lastSeen: Date.now() },
        turn: 'w',
        moves: [],
        resetCount: 0,
        clocks: { w: 300, b: 300 },
        lastTurnSwitchTs: Date.now(),
        drawOfferFrom: null,
        winner: null,
        winReason: null,
        chat: [],
        updatedAt: Date.now(),
      };
      rooms.set(code, room);
      return res.json({
        ok: true,
        code,
        color: side,
        playerToken: token,
        room: getSanitizedRoom(room),
      });
    }

    // Determine player side
    let assignedColor: 'w' | 'b' = 'b';
    if (room.whitePlayer?.token === token) {
      assignedColor = 'w';
      room.whiteJoined = true;
      room.whitePlayer.connected = true;
    } else if (room.blackPlayer?.token === token) {
      assignedColor = 'b';
      room.blackJoined = true;
      room.blackPlayer.connected = true;
    } else if (!room.whiteJoined) {
      assignedColor = 'w';
      room.whiteJoined = true;
      room.whitePlayer = { token, name: String(playerName || 'White Wizard'), side: 'w', connected: true, lastSeen: Date.now() };
    } else if (!room.blackJoined) {
      assignedColor = 'b';
      room.blackJoined = true;
      room.blackPlayer = { token, name: String(playerName || 'Dark Wizard'), side: 'b', connected: true, lastSeen: Date.now() };
    } else {
      // Room full, re-attach to black or spectator
      assignedColor = 'b';
    }

    if (room.whiteJoined && room.blackJoined && room.status === 'waiting') {
      room.status = 'playing';
      room.lastTurnSwitchTs = Date.now();
      room.chat.push({
        id: 'start_' + Date.now(),
        sender: 'Sanctum Herald',
        side: 'spectator',
        text: 'Both duelists have entered the sanctum! White makes the opening move. 5:00 blitz clock ticking.',
        ts: Date.now(),
      });
    }

    broadcastRoomUpdate(room);

    res.json({
      ok: true,
      code,
      color: assignedColor,
      playerToken: token,
      room: getSanitizedRoom(room),
    });
  });

  app.get('/api/rooms/:code/state', (req: Request, res: Response) => {
    const code = String(req.params.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      return res.status(404).json({ ok: false, error: 'Room not found' });
    }
    updateRoomClocks(room);
    res.json({ ok: true, room: getSanitizedRoom(room) });
  });

  app.post('/api/rooms/:code/move', (req: Request, res: Response) => {
    const code = String(req.params.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      return res.status(404).json({ ok: false, error: 'Room not found' });
    }

    const { color, from, to, notation, piece, captured, promotion } = req.body || {};
    updateRoomClocks(room);

    if (room.status === 'timeout' || room.status === 'checkmate') {
      return res.json({ ok: false, error: 'Game is concluded', room: getSanitizedRoom(room) });
    }

    const moveColor: 'w' | 'b' = color === 'b' ? 'b' : 'w';
    const nextTurn: 'w' | 'b' = moveColor === 'w' ? 'b' : 'w';

    const newMove: ChessMove = {
      seq: room.moves.length + 1,
      color: moveColor,
      from,
      to,
      notation: notation || `${String.fromCharCode(97 + from.c)}${8 - from.r}-${String.fromCharCode(97 + to.c)}${8 - to.r}`,
      piece,
      captured,
      promotion: promotion || 'queen',
      ts: Date.now(),
    };

    room.moves.push(newMove);
    room.turn = nextTurn;
    room.lastTurnSwitchTs = Date.now();
    room.drawOfferFrom = null;

    broadcastRoomUpdate(room);

    res.json({ ok: true, room: getSanitizedRoom(room) });
  });

  app.post('/api/rooms/:code/chat', (req: Request, res: Response) => {
    const code = String(req.params.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      return res.status(404).json({ ok: false, error: 'Room not found' });
    }
    const { sender, text, side, isQuickTaunt } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ ok: false, error: 'Text required' });
    }

    const msg: ChatMessage = {
      id: 'chat_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36),
      sender: String(sender || 'Wizard'),
      side: side === 'w' || side === 'b' ? side : 'spectator',
      text: text.slice(0, 200),
      ts: Date.now(),
      isQuickTaunt: Boolean(isQuickTaunt),
    };

    room.chat.push(msg);
    if (room.chat.length > 50) room.chat.shift();
    broadcastRoomUpdate(room);

    res.json({ ok: true, message: msg });
  });

  app.post('/api/rooms/:code/draw', (req: Request, res: Response) => {
    const code = String(req.params.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return res.status(404).json({ ok: false, error: 'Room not found' });

    const { action, side } = req.body || {};
    if (action === 'offer') {
      room.drawOfferFrom = side === 'b' ? 'b' : 'w';
      room.chat.push({
        id: 'draw_' + Date.now(),
        sender: 'Sanctum Herald',
        side: 'spectator',
        text: `${side === 'w' ? 'White' : 'Black'} proposes a draw.`,
        ts: Date.now(),
      });
    } else if (action === 'accept') {
      room.status = 'draw';
      room.winner = 'draw';
      room.winReason = 'Einvernehmliches Remis (Draw Agreed)';
      room.drawOfferFrom = null;
      room.chat.push({
        id: 'draw_acc_' + Date.now(),
        sender: 'Sanctum Herald',
        side: 'spectator',
        text: 'The wizards lower their staves — match concluded in a noble draw!',
        ts: Date.now(),
      });
    } else if (action === 'decline') {
      room.drawOfferFrom = null;
      room.chat.push({
        id: 'draw_dec_' + Date.now(),
        sender: 'Sanctum Herald',
        side: 'spectator',
        text: 'The draw offer was declined. Battle continues!',
        ts: Date.now(),
      });
    }

    broadcastRoomUpdate(room);
    res.json({ ok: true, room: getSanitizedRoom(room) });
  });

  app.post('/api/rooms/:code/resign', (req: Request, res: Response) => {
    const code = String(req.params.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return res.status(404).json({ ok: false, error: 'Room not found' });

    const { side } = req.body || {};
    const resigningSide: 'w' | 'b' = side === 'b' ? 'b' : 'w';
    room.status = 'resigned';
    room.winner = resigningSide === 'w' ? 'b' : 'w';
    room.winReason = `Aufgabe durch ${resigningSide === 'w' ? 'Weiß' : 'Schwarz'}`;
    room.chat.push({
      id: 'resign_' + Date.now(),
      sender: 'Sanctum Herald',
      side: 'spectator',
      text: `${resigningSide === 'w' ? 'White' : 'Black'} has yielded the board. Victory to ${room.winner === 'w' ? 'White' : 'Black'}!`,
      ts: Date.now(),
    });

    broadcastRoomUpdate(room);
    res.json({ ok: true, room: getSanitizedRoom(room) });
  });

  app.post('/api/rooms/:code/rematch', (req: Request, res: Response) => {
    const code = String(req.params.code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return res.status(404).json({ ok: false, error: 'Room not found' });

    // Swap sides for rematch
    const prevWhite = room.whitePlayer;
    const prevBlack = room.blackPlayer;
    if (prevWhite) prevWhite.side = 'b';
    if (prevBlack) prevBlack.side = 'w';
    room.whitePlayer = prevBlack;
    room.blackPlayer = prevWhite;

    room.status = 'playing';
    room.turn = 'w';
    room.moves = [];
    room.clocks = { w: 300, b: 300 };
    room.lastTurnSwitchTs = Date.now();
    room.resetCount = (room.resetCount || 0) + 1;
    room.winner = null;
    room.winReason = null;
    room.drawOfferFrom = null;
    room.chat.push({
      id: 'rematch_' + Date.now(),
      sender: 'Sanctum Herald',
      side: 'spectator',
      text: 'Rematch started! Colors have swapped. 5-minute blitz clocks reset.',
      ts: Date.now(),
    });

    broadcastRoomUpdate(room);
    res.json({ ok: true, room: getSanitizedRoom(room) });
  });

  // Server-Sent Events (SSE) Stream
  app.get('/api/rooms/:code/events', (req: Request, res: Response) => {
    const code = String(req.params.code || '').trim().toUpperCase();
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    if (!roomSseClients.has(code)) {
      roomSseClients.set(code, new Set());
    }
    roomSseClients.get(code)!.add(res);

    const room = rooms.get(code);
    if (room) {
      res.write(`data: ${JSON.stringify({ room: getSanitizedRoom(room) })}\n\n`);
    }

    req.on('close', () => {
      const clients = roomSseClients.get(code);
      if (clients) {
        clients.delete(res);
        if (clients.size === 0) roomSseClients.delete(code);
      }
    });
  });

  // WebSocket Server Connection Handler
  wss.on('connection', (ws: WebSocket, req) => {
    let currentRoomCode: string | null = null;

    ws.on('message', (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString());
        if (msg.type === 'join_ws_room') {
          const code = String(msg.code || '').trim().toUpperCase();
          currentRoomCode = code;
          if (!roomSockets.has(code)) {
            roomSockets.set(code, new Set());
          }
          roomSockets.get(code)!.add(ws);
          const room = rooms.get(code);
          if (room) {
            ws.send(JSON.stringify({ type: 'room_state', room: getSanitizedRoom(room) }));
          }
        }
      } catch {
        // ignore malformed payloads
      }
    });

    ws.on('close', () => {
      if (currentRoomCode) {
        const set = roomSockets.get(currentRoomCode);
        if (set) {
          set.delete(ws);
          if (set.size === 0) roomSockets.delete(currentRoomCode);
        }
      }
    });
  });

  // Dev & Prod Frontend Serving
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist/index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Wizard Chess Sanctum Server listening on http://0.0.0.0:${PORT} (env: ${isProd ? 'production' : 'development'})`);
  });
}

startServer();
