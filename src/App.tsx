import { useEffect, useRef, useState } from 'react';
import { initWizardChess } from './wizardChessEngine.js';

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

interface RoomState {
  code: string;
  status: 'waiting' | 'playing' | 'checkmate' | 'draw' | 'resigned' | 'timeout';
  whiteJoined: boolean;
  blackJoined: boolean;
  turn: 'w' | 'b';
  moves: ChessMove[];
  resetCount: number;
  clocks: { w: number; b: number };
  lastTurnSwitchTs: number;
  drawOfferFrom: 'w' | 'b' | null;
  winner: 'w' | 'b' | 'draw' | null;
  winReason: string | null;
  chat: ChatMessage[];
  updatedAt: number;
}

const QUICK_TAUNTS = [
  '✦ Guter Zug!',
  '⚔ Schach droht!',
  '♟ Ein kühnes Opfer...',
  '☠ Dein König ist verloren!',
  '⚡ Zauberschach kennt keine Gnade!',
  '🤝 Ein ehrenvolles Duell'
];

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export default function App() {
  const initializedRef = useRef(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  // Online Multiplayer State
  const [onlineModalOpen, setOnlineModalOpen] = useState(false);
  const [activeModalTab, setActiveModalTab] = useState<'create' | 'join'>('create');
  const [preferredColor, setPreferredColor] = useState<'w' | 'b'>('w');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [modalStatusMsg, setModalStatusMsg] = useState('');
  const [createdRoomCode, setCreatedRoomCode] = useState<string | null>(null);

  // Active Game & Room State
  const [gameMode, setGameMode] = useState<'single' | 'multi'>('single');
  const [myPlayerColor, setMyPlayerColor] = useState<'w' | 'b'>('w');
  const [activeTurn, setActiveTurn] = useState<'w' | 'b'>('w');
  const [roomData, setRoomData] = useState<RoomState | null>(null);

  // Clocks
  const [displayClocks, setDisplayClocks] = useState<{ w: number; b: number }>({ w: 300, b: 300 });

  // Chat & Move Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'chat' | 'moves'>('chat');
  const [chatInput, setChatInput] = useState('');
  const [unreadChatCount, setUnreadChatCount] = useState(0);

  // Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = (msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 3200);
  };

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    initWizardChess();

    // Check URL parameters for direct room joining
    const params = new URLSearchParams(window.location.search);
    const urlRoom = params.get('room');
    if (urlRoom) {
      showToast(`Sanktuarium-Raum ${urlRoom.toUpperCase()} betreten...`);
    }
  }, []);

  // Listen for room updates dispatched by wizardChessEngine
  useEffect(() => {
    const handleRoomUpdated = (e: Event) => {
      const customEv = e as CustomEvent<{
        room: RoomState | null;
        playerColor: 'w' | 'b';
        roomCode: string | null;
        gameMode: 'single' | 'multi';
        currentTurn: 'w' | 'b';
      }>;
      const detail = customEv.detail;
      if (!detail) return;

      if (detail.room) {
        setRoomData(detail.room);
        setGameMode('multi');
        setMyPlayerColor(detail.playerColor);
        setActiveTurn(detail.room.turn);
        setDisplayClocks(detail.room.clocks);

        // If drawer is closed, track unread messages
        if (!drawerOpen && detail.room.chat?.length) {
          setUnreadChatCount((prev) => prev + 1);
        }

        if (detail.room.status === 'playing' && detail.room.whiteJoined && detail.room.blackJoined) {
          setModalStatusMsg(`Beide Duellanten verbunden in Raum ${detail.room.code}!`);
        }
      } else {
        setRoomData(null);
        setGameMode(detail.gameMode || 'single');
        setMyPlayerColor(detail.playerColor || 'w');
        setActiveTurn(detail.currentTurn || 'w');
        setDisplayClocks({ w: 300, b: 300 });
      }
    };

    window.addEventListener('wizardChess:roomUpdated', handleRoomUpdated);
    return () => {
      window.removeEventListener('wizardChess:roomUpdated', handleRoomUpdated);
    };
  }, [drawerOpen]);

  // Real-time Clock tick calculation
  useEffect(() => {
    if (gameMode !== 'multi' || !roomData || roomData.status !== 'playing') return;

    const interval = setInterval(() => {
      const now = Date.now();
      const elapsedSec = (now - roomData.lastTurnSwitchTs) / 1000;
      const turn = roomData.turn;
      const currentRemaining = Math.max(0, (roomData.clocks[turn] || 300) - elapsedSec);

      setDisplayClocks({
        ...roomData.clocks,
        [turn]: currentRemaining,
      });

      if (currentRemaining <= 0) {
        showToast(`Zeit abgelaufen! 5-Minuten-Blitz beendet.`);
      }
    }, 250);

    return () => clearInterval(interval);
  }, [gameMode, roomData]);

  // Keyboard navigation & responsive helpers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileSheetOpen(false);
        setOnlineModalOpen(false);
        setDrawerOpen(false);
      }
    };
    const handleResize = () => {
      if (window.innerWidth > 768) {
        setMobileSheetOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const handleRestoreUI = () => {
    const win = window as unknown as { wizardChess?: { toggleUI?: (force?: boolean) => void } };
    if (win.wizardChess?.toggleUI) {
      win.wizardChess.toggleUI(false);
    } else {
      document.body.classList.remove('cinematic-ui-hidden');
      const btnHide = document.getElementById('btn-hide-ui');
      if (btnHide) btnHide.textContent = 'Hide UI [H]';
    }
  };

  // Online Multiplayer Handlers
  const handleCreateRoom = async () => {
    setModalStatusMsg('Sanktuarium wird vorbereitet...');
    const win = window as unknown as {
      wizardChess?: {
        createMultiplayerRoom?: (color: 'w' | 'b') => Promise<void>;
        getRoomCode?: () => string;
      };
    };

    if (win.wizardChess?.createMultiplayerRoom) {
      await win.wizardChess.createMultiplayerRoom(preferredColor);
      const code = win.wizardChess.getRoomCode?.();
      if (code) {
        setCreatedRoomCode(code);
        setModalStatusMsg(`Raum ${code} erschaffen! Warte auf Gegner...`);
      }
    }
  };

  const handleJoinRoom = async (codeToJoin?: string) => {
    const code = (codeToJoin || joinCodeInput).trim().toUpperCase();
    if (!code) {
      setModalStatusMsg('Bitte gib einen Raum-Code ein.');
      return;
    }
    setModalStatusMsg(`Trete Raum ${code} bei...`);
    const win = window as unknown as {
      wizardChess?: {
        joinMultiplayerRoom?: (c: string) => Promise<boolean>;
      };
    };

    if (win.wizardChess?.joinMultiplayerRoom) {
      const ok = await win.wizardChess.joinMultiplayerRoom(code);
      if (ok) {
        setOnlineModalOpen(false);
        setJoinCodeInput('');
        setModalStatusMsg('');
        showToast(`Erfolgreich Raum ${code} beigetreten!`);
      } else {
        setModalStatusMsg(`Konnte Raum ${code} nicht finden.`);
      }
    }
  };

  const handleCopyCode = () => {
    const code = createdRoomCode || roomData?.code;
    if (!code) return;
    navigator.clipboard?.writeText(code);
    showToast(`Raum-Code ${code} kopiert!`);
  };

  const handleCopyLink = () => {
    const code = createdRoomCode || roomData?.code;
    if (!code) return;
    const url = `${window.location.origin}${window.location.pathname}?room=${code}`;
    navigator.clipboard?.writeText(url);
    showToast('Einladungs-Link kopiert! Teile ihn mit deinem Freund.');
  };

  const handleSendChat = (textToSend?: string) => {
    const msg = (textToSend || chatInput).trim();
    if (!msg) return;
    const win = window as unknown as {
      wizardChess?: {
        sendChatMessage?: (t: string, isTaunt?: boolean) => Promise<boolean>;
      };
    };
    if (win.wizardChess?.sendChatMessage) {
      win.wizardChess.sendChatMessage(msg, Boolean(textToSend));
      if (!textToSend) setChatInput('');
    }
  };

  const handleOfferDraw = () => {
    const win = window as unknown as { wizardChess?: { offerDraw?: () => Promise<boolean> } };
    win.wizardChess?.offerDraw?.();
    showToast('Remis-Angebot an Gegner übermittelt.');
  };

  const handleRespondDraw = (accept: boolean) => {
    const win = window as unknown as { wizardChess?: { respondDraw?: (acc: boolean) => Promise<boolean> } };
    win.wizardChess?.respondDraw?.(accept);
    showToast(accept ? 'Remis angenommen!' : 'Remis abgelehnt.');
  };

  const handleResign = () => {
    if (confirm('Möchtest du dieses Schachduell wirklich aufgeben?')) {
      const win = window as unknown as { wizardChess?: { resignMatch?: () => Promise<boolean> } };
      win.wizardChess?.resignMatch?.();
      showToast('Du hast aufgegeben.');
    }
  };

  const handleLeaveOnline = () => {
    const win = window as unknown as { wizardChess?: { leaveMultiplayer?: () => void } };
    win.wizardChess?.leaveMultiplayer?.();
    setDrawerOpen(false);
    showToast('Online-Sanktuarium verlassen. Zurück im Einzelspieler-Modus.');
  };

  const handleRematch = () => {
    const win = window as unknown as { wizardChess?: { requestRematch?: () => Promise<boolean> } };
    win.wizardChess?.requestRematch?.();
    showToast('Revanche gestartet! Seiten getauscht.');
  };

  const movesList = roomData?.moves || [];

  return (
    <>
      <div id="loading-overlay">
        <div className="loader-title">Wizard Chess</div>
        <div className="loader-bar-wrap">
          <div className="loader-bar" id="loader-bar"></div>
        </div>
        <div id="loader-text">Summoning Sanctum Architecture &amp; Sculpted Pieces...</div>
      </div>

      <div id="canvas-container"></div>

      <button
        type="button"
        className="hud-btn mobile-only-restore-ui"
        id="btn-mobile-show-ui"
        onClick={handleRestoreUI}
        title="Show HUD Controls"
      >
        Show UI
      </button>

      {/* Top HUD */}
      <div id="hud-top">
        <div className="hud-group" id="hud-left">
          <div className="brand-pill">
            <span className="brand-title">Wizard Chess</span>
          </div>

          <div className="status-pill" id="status-pill">
            <span className={`turn-dot ${activeTurn === 'b' ? 'black' : ''}`} id="turn-dot"></span>
            <span id="turn-text">{activeTurn === 'w' ? 'White to Move' : 'Black to Move'}</span>
            <span className="mode-badge" id="mode-badge">
              {gameMode === 'multi'
                ? `Online: ${roomData?.code || 'Duel'} (${myPlayerColor === 'w' ? 'White' : 'Black'})`
                : myPlayerColor === 'w' ? 'Playing as White' : 'Playing as Black'}
            </span>
          </div>

          {/* 5-Minute Blitz Clocks (Active in Online Duel or Display) */}
          <div className="blitz-clocks-group" title="5-Minuten Blitzschachuhren">
            <div
              className={`blitz-clock-item white-side ${activeTurn === 'w' && gameMode === 'multi' ? 'active-turn' : ''} ${displayClocks.w < 30 ? 'time-trouble' : ''}`}
            >
              <span className="blitz-clock-dot"></span>
              <span>{formatTime(displayClocks.w)}</span>
            </div>
            <div className="blitz-clock-divider"></div>
            <div
              className={`blitz-clock-item black-side ${activeTurn === 'b' && gameMode === 'multi' ? 'active-turn' : ''} ${displayClocks.b < 30 ? 'time-trouble' : ''}`}
            >
              <span className="blitz-clock-dot black"></span>
              <span>{formatTime(displayClocks.b)}</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          className={`hud-btn mobile-controls-trigger ${mobileSheetOpen ? 'active' : ''}`}
          id="btn-mobile-controls"
          aria-expanded={mobileSheetOpen}
          aria-controls="hud-right"
          onClick={() => setMobileSheetOpen((prev) => !prev)}
        >
          {mobileSheetOpen ? 'Close' : 'Controls'}
        </button>

        <div
          className={`mobile-sheet-backdrop ${mobileSheetOpen ? 'open' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setMobileSheetOpen(false);
          }}
          aria-hidden="true"
        ></div>

        <div
          className={`hud-group ${mobileSheetOpen ? 'mobile-sheet-open' : ''}`}
          id="hud-right"
        >
          <div
            className="mobile-sheet-handle-wrap"
            onClick={(e) => {
              e.stopPropagation();
              setMobileSheetOpen(false);
            }}
            aria-hidden="true"
          >
            <div className="mobile-sheet-handle"></div>
          </div>

          <div className="mobile-sheet-header">
            <span className="mobile-sheet-title">Controls</span>
            <button
              type="button"
              className="mobile-sheet-close"
              id="btn-mobile-sheet-close"
              onClick={(e) => {
                e.stopPropagation();
                setMobileSheetOpen(false);
              }}
              aria-label="Close Controls"
            >
              Close ✕
            </button>
          </div>

          {/* Online Matchmaking Trigger Button */}
          <button
            type="button"
            className="hud-btn primary"
            id="btn-open-online-modal"
            title="Online Sanctum mit Freunden oder Matchmaking"
            onClick={() => {
              setMobileSheetOpen(false);
              setOnlineModalOpen(true);
            }}
          >
            ⚔ Play Online
          </button>

          {/* Sanctum Chat & Moves Drawer Toggle */}
          <button
            type="button"
            className={`hud-btn ${drawerOpen ? 'active' : ''}`}
            id="btn-toggle-chat-drawer"
            title="Live Chat & Zug-Chronik öffnen"
            onClick={() => {
              setDrawerOpen((prev) => !prev);
              setUnreadChatCount(0);
            }}
          >
            💬 Chat &amp; Moves {unreadChatCount > 0 && `(${unreadChatCount})`}
          </button>

          <div className="hud-divider" aria-hidden="true"></div>
          <div className="mobile-sheet-section-label">Game Actions</div>

          <button
            className="hud-btn"
            id="btn-side-toggle"
            title="Switch between Playing as White and Playing as Black"
            onClick={() => setMobileSheetOpen(false)}
          >
            Play as Black
          </button>
          <button
            className="hud-btn"
            id="btn-ai-move"
            title="Let the AI make the next move immediately"
            onClick={() => setMobileSheetOpen(false)}
          >
            AI Move
          </button>
          <button
            className="hud-btn"
            id="btn-reset"
            title="Start a fresh game on the altar"
            onClick={() => setMobileSheetOpen(false)}
          >
            New Game
          </button>

          <div className="hud-divider" aria-hidden="true"></div>
          <div className="mobile-sheet-section-label">
            <span>Camera Views</span>
            <span className="mobile-sheet-section-sub">Tap active view to flip</span>
          </div>

          <button
            className="hud-btn active"
            id="btn-cam-player"
            title="Player Camera (Click again to flip White / Black view)"
          >
            Player Cam
          </button>
          <button
            className="hud-btn"
            id="btn-cam-top"
            title="Overhead Board View (Click again to flip White / Black orientation)"
          >
            Overhead
          </button>
          <button
            className="hud-btn"
            id="btn-cam-side"
            title="Side Profile View (Click again to switch East / West side)"
          >
            Side
          </button>
          <button
            className="hud-btn"
            id="btn-cam-wide"
            title="Wide Cathedral View (Click again to switch North Rose / South Narthex)"
          >
            Cathedral
          </button>

          <div className="hud-divider" aria-hidden="true"></div>
          <div className="mobile-sheet-section-label">Display &amp; Gestures</div>

          <button
            className="hud-btn"
            id="btn-hide-ui"
            title="Toggle HUD visibility (Shortcut: H)"
            onClick={() => setMobileSheetOpen(false)}
          >
            Hide UI [H]
          </button>

          <div className="mobile-sheet-hint">
            <strong>Touch:</strong> Tap Piece to Move &nbsp;•&nbsp; 1-Finger Drag: Orbit &nbsp;•&nbsp; 2-Finger Drag: Pan &nbsp;•&nbsp; Pinch: Zoom
          </div>
        </div>
      </div>

      {/* Bottom HUD */}
      <div id="hud-bottom">
        <div className="hint-pill" id="controls-hint">
          <strong>Controls:</strong> Click Piece to Move &nbsp;•&nbsp; Left-Drag: Orbit &nbsp;•&nbsp; Right-Drag: Pan &nbsp;•&nbsp; Scroll: Zoom &nbsp;•&nbsp; WASD + R/F: Fly Cam &nbsp;•&nbsp; H: Hide UI
        </div>
        <div className="captured-pill" id="captured-tray"></div>
      </div>

      {/* Online Matchmaking Modal */}
      {onlineModalOpen && (
        <div className="sanctum-modal-backdrop" id="sanctum-online-modal">
          <div className="sanctum-modal-box">
            <div className="sanctum-modal-header">
              <span className="sanctum-modal-title">⚔ Online Sanctum</span>
              <button
                type="button"
                className="sanctum-modal-close"
                onClick={() => setOnlineModalOpen(false)}
                aria-label="Schließen"
              >
                ✕
              </button>
            </div>

            <div className="sanctum-tabs">
              <button
                type="button"
                className={`sanctum-tab-btn ${activeModalTab === 'create' ? 'active' : ''}`}
                onClick={() => setActiveModalTab('create')}
              >
                Raum erstellen
              </button>
              <button
                type="button"
                className={`sanctum-tab-btn ${activeModalTab === 'join' ? 'active' : ''}`}
                onClick={() => setActiveModalTab('join')}
              >
                Freund beitreten
              </button>
            </div>

            {activeModalTab === 'create' ? (
              <div className="sanctum-panel-body">
                {!createdRoomCode ? (
                  <>
                    <div className="sanctum-label">Wähle deine Seite</div>
                    <div className="sanctum-color-picker">
                      <div
                        className={`sanctum-color-option ${preferredColor === 'w' ? 'selected' : ''}`}
                        id="pick-mp-white"
                        onClick={() => setPreferredColor('w')}
                      >
                        <span className="sanctum-color-icon">♔</span>
                        <span className="sanctum-color-name">Weißer Marmor</span>
                      </div>
                      <div
                        className={`sanctum-color-option ${preferredColor === 'b' ? 'selected' : ''}`}
                        id="pick-mp-black"
                        onClick={() => setPreferredColor('b')}
                      >
                        <span className="sanctum-color-icon">♚</span>
                        <span className="sanctum-color-name">Dunkler Obsidian</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="sanctum-primary-btn"
                      id="btn-create-room"
                      onClick={handleCreateRoom}
                    >
                      Raum beschwören
                    </button>
                  </>
                ) : (
                  <div id="room-created-panel" style={{ display: 'block' }}>
                    <div className="sanctum-label">Dein Sanctum Raum-Code</div>
                    <div className="sanctum-code-display">
                      <span className="sanctum-code-val" id="modal-room-code">
                        {createdRoomCode}
                      </span>
                    </div>

                    <div className="sanctum-actions-row" style={{ marginTop: '14px' }}>
                      <button
                        type="button"
                        className="sanctum-sub-btn"
                        id="btn-copy-code"
                        onClick={handleCopyCode}
                      >
                        Code kopieren
                      </button>
                      <button
                        type="button"
                        className="sanctum-sub-btn"
                        id="btn-copy-link"
                        onClick={handleCopyLink}
                      >
                        Link kopieren
                      </button>
                    </div>

                    <button
                      type="button"
                      className="sanctum-primary-btn"
                      id="btn-enter-created-room"
                      style={{ marginTop: '16px', width: '100%' }}
                      onClick={() => setOnlineModalOpen(false)}
                    >
                      Ins Sanktuarium eintreten
                    </button>
                  </div>
                )}

                <div className="sanctum-status-msg" id="mp-status-msg">
                  {modalStatusMsg || '5-Minuten-Blitzschachuhren werden synchronisiert.'}
                </div>
              </div>
            ) : (
              <div className="sanctum-panel-body">
                <div className="sanctum-label">Gib den 6-stelligen Raum-Code ein</div>
                <input
                  type="text"
                  maxLength={6}
                  className="sanctum-input"
                  id="input-room-code"
                  placeholder="z.B. SANCTM"
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleJoinRoom();
                  }}
                />

                <button
                  type="button"
                  className="sanctum-primary-btn"
                  id="btn-join-room"
                  onClick={() => handleJoinRoom()}
                >
                  Raum betreten
                </button>

                <div className="sanctum-status-msg">
                  {modalStatusMsg || 'Oder nutze einen direkten Einladungs-Link aus deiner Zwischenablage.'}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sanctum Chat & Move History Side Drawer */}
      {drawerOpen && (
        <>
          <div
            className="sanctum-drawer-backdrop"
            onClick={() => setDrawerOpen(false)}
          ></div>
          <aside className="sanctum-drawer" aria-label="Sanctum Chat &amp; Chronik">
            <div className="sanctum-drawer-header">
              <span className="sanctum-drawer-title">
                {gameMode === 'multi' ? `Sanctum ${roomData?.code || 'Duell'}` : 'Sanctum Chronik'}
              </span>
              <button
                type="button"
                className="sanctum-modal-close"
                onClick={() => setDrawerOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="sanctum-drawer-tabs">
              <button
                type="button"
                className={`sanctum-drawer-tab ${drawerTab === 'chat' ? 'active' : ''}`}
                onClick={() => setDrawerTab('chat')}
              >
                💬 Chat
              </button>
              <button
                type="button"
                className={`sanctum-drawer-tab ${drawerTab === 'moves' ? 'active' : ''}`}
                onClick={() => setDrawerTab('moves')}
              >
                📜 Züge ({movesList.length})
              </button>
            </div>

            {drawerTab === 'chat' ? (
              <>
                <div className="sanctum-chat-body">
                  {(roomData?.chat || []).map((msg) => {
                    const isMine = msg.side === myPlayerColor;
                    const isSystem = msg.side === 'spectator';
                    return (
                      <div
                        key={msg.id}
                        className={`chat-bubble ${isSystem ? 'system' : isMine ? 'mine' : 'theirs'}`}
                      >
                        {!isSystem && (
                          <div className="chat-bubble-sender">
                            {isMine ? 'Du' : msg.sender}
                          </div>
                        )}
                        <div>{msg.text}</div>
                      </div>
                    );
                  })}
                  {(!roomData?.chat || roomData.chat.length === 0) && (
                    <div className="chat-bubble system">
                      Noch keine Nachrichten im Sanktuarium. Sende eine Botschaft oder nutze Schnell-Sprüche!
                    </div>
                  )}
                </div>

                <div className="quick-taunts-bar">
                  {QUICK_TAUNTS.map((taunt, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className="quick-taunt-pill"
                      onClick={() => handleSendChat(taunt)}
                    >
                      {taunt}
                    </button>
                  ))}
                </div>

                <div className="chat-input-bar">
                  <input
                    type="text"
                    className="chat-input-field"
                    placeholder="Zauberformel eingeben..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSendChat();
                    }}
                  />
                  <button
                    type="button"
                    className="chat-send-btn"
                    onClick={() => handleSendChat()}
                  >
                    Senden
                  </button>
                </div>
              </>
            ) : (
              <div className="moves-history-body">
                {movesList.length === 0 ? (
                  <div style={{ color: 'var(--muted)', fontSize: '0.82rem', textAlign: 'center', padding: '24px 0' }}>
                    Noch keine Züge gespielt. Eröffne das Duell!
                  </div>
                ) : (
                  Array.from({ length: Math.ceil(movesList.length / 2) }).map((_, moveIdx) => {
                    const whiteMove = movesList[moveIdx * 2];
                    const blackMove = movesList[moveIdx * 2 + 1];
                    return (
                      <div key={moveIdx} className="move-entry">
                        <span className="move-num">{moveIdx + 1}.</span>
                        <span className="move-white">{whiteMove?.notation || '-'}</span>
                        <span className="move-black">{blackMove?.notation || '-'}</span>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {gameMode === 'multi' && (
              <div className="drawer-match-controls">
                <button
                  type="button"
                  className="drawer-ctrl-btn"
                  onClick={handleOfferDraw}
                  title="Remis anbieten"
                >
                  Remis anbieten
                </button>
                <button
                  type="button"
                  className="drawer-ctrl-btn danger"
                  onClick={handleResign}
                  title="Partie aufgeben"
                >
                  Aufgeben
                </button>
                <button
                  type="button"
                  className="drawer-ctrl-btn"
                  onClick={handleLeaveOnline}
                  title="Sanktuarium verlassen"
                >
                  Verlassen
                </button>
              </div>
            )}
          </aside>
        </>
      )}

      {/* Opponent Draw Offer Popup */}
      {roomData?.drawOfferFrom && roomData.drawOfferFrom !== myPlayerColor && (
        <div className="draw-offer-popup" role="dialog" aria-label="Remis Angebot">
          <div className="draw-offer-text">
            Dein Gegner bietet ein Remis (Unentschieden) an. Annehmen?
          </div>
          <div className="draw-offer-btns">
            <button
              type="button"
              className="draw-btn-accept"
              onClick={() => handleRespondDraw(true)}
            >
              Remis annehmen
            </button>
            <button
              type="button"
              className="draw-btn-decline"
              onClick={() => handleRespondDraw(false)}
            >
              Ablehnen
            </button>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className="sanctum-toast" role="status">
          {toastMessage}
        </div>
      )}

      {/* Checkmate & Game Over Overlay */}
      <div id="checkmate-overlay" role="status" aria-live="polite">
        <div className="checkmate-banner">
          <div className="checkmate-ornament">✦ &nbsp; Sanctum Judgment &nbsp; ✦</div>
          <div className="checkmate-crown" id="checkmate-crown">♔</div>
          <div className="checkmate-title" id="checkmate-title">
            {roomData?.status === 'draw'
              ? 'Remis'
              : roomData?.status === 'timeout'
              ? 'Zeit abgelaufen'
              : roomData?.status === 'resigned'
              ? 'Aufgabe'
              : 'Checkmate'}
          </div>
          <div className="checkmate-rule"></div>
          <div className="checkmate-subtitle" id="checkmate-subtitle">
            {roomData?.winReason || 'White Triumphs • The Black King Has Fallen'}
          </div>
          <div className="checkmate-actions">
            {gameMode === 'multi' ? (
              <button
                className="checkmate-btn"
                id="btn-multi-rematch"
                onClick={handleRematch}
              >
                Revanche fordern
              </button>
            ) : (
              <button className="checkmate-btn" id="btn-checkmate-replay">
                Replay King Fall
              </button>
            )}
            <button className="checkmate-btn" id="btn-checkmate-newgame">
              New Game
            </button>
            <button className="checkmate-btn secondary" id="btn-checkmate-dismiss">
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
