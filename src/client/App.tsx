import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CircleAlert,
  Clock3,
  Eye,
  Layers,
  LogIn,
  Plus,
  Radio,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  UsersRound,
  X
} from "lucide-react";
import {
  addBotHttp,
  callBullshitHttp,
  connectRoomSocket,
  createRoom,
  joinRoom,
  removeBotHttp,
  sendRoomMessage,
  startGameHttp,
  submitClaimHttp,
  type LifecycleWireResult,
  type SeatCredential
} from "./api";
import {
  cardTone,
  claimKey,
  compactClaim,
  formatCard,
  formatClaim,
  legalClaimsByHandType,
  playerName
} from "./claimUi";
import type {
  Claim,
  ClaimTemplate,
  PrivateGameView,
  PublicPlayerView,
  RoomServerMessage
} from "../shared/index.ts";

const STORAGE_KEY = "bullshit-poker-seat";

type ConnectionStatus = "idle" | "connecting" | "open" | "closed" | "error";
type EntryMode = "create" | "join";

function requestId(prefix: string): string {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function normalizedCode(code: string): string {
  return code.trim().toUpperCase();
}

function connectionLabel(status: ConnectionStatus): string {
  switch (status) {
    case "connecting":
      return "Connecting";
    case "open":
      return "Live";
    case "closed":
      return "Offline";
    case "error":
      return "Connection issue";
    case "idle":
      return "Not connected";
  }
}

function canReconnect(status: ConnectionStatus): boolean {
  return status === "closed" || status === "error" || status === "idle";
}

function saveCredential(credential: SeatCredential): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(credential));
}

function loadCredential(): SeatCredential | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? (JSON.parse(value) as SeatCredential) : null;
  } catch {
    return null;
  }
}

function removeCredential(): void {
  localStorage.removeItem(STORAGE_KEY);
}

type OkLifecycleWireResult = Extract<LifecycleWireResult, { ok: true }>;

function assertOk(result: LifecycleWireResult): OkLifecycleWireResult {
  if (!result.ok) {
    throw new Error(result.code);
  }
  return result;
}

function useCountdown(view: PrivateGameView | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  if (!view?.turnExpiresAt) return 0;
  return Math.min(
    Math.ceil(view.turnDurationMs / 1000),
    Math.max(0, Math.ceil((view.turnExpiresAt - now) / 1000))
  );
}

export function App() {
  const [entryMode, setEntryMode] = useState<EntryMode>("create");
  const [displayName, setDisplayName] = useState("");
  const [pin, setPin] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [credential, setCredential] = useState<SeatCredential | null>(() => loadCredential());
  const [view, setView] = useState<PrivateGameView | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("idle");
  const [notice, setNotice] = useState<string>("");
  const [claimPickerOpen, setClaimPickerOpen] = useState(false);
  const [lastRoundOpen, setLastRoundOpen] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const countdown = useCountdown(view);

  useEffect(() => {
    return () => socketRef.current?.close();
  }, []);

  function handleServerMessage(message: RoomServerMessage): void {
    if (message.type === "SESSION_ACCEPTED") {
      setView(message.view);
      setNotice("");
      return;
    }
    if (message.type === "SESSION_REJECTED") {
      setNotice(message.code);
      setConnectionStatus("error");
      return;
    }
    if (message.type === "ROOM_UPDATED") {
      setView(message.view);
      if (message.roundResult) {
        setLastRoundOpen(true);
      }
      return;
    }
    if (message.type === "ACTION_REJECTED") {
      setNotice(message.code);
      if (message.view) {
        setView(message.view);
      }
    }
  }

  function connectLive(nextCredential: SeatCredential): void {
    socketRef.current?.close();
    socketRef.current = connectRoomSocket(nextCredential, handleServerMessage, setConnectionStatus);
  }

  async function handleCreateRoom() {
    setNotice("");
    try {
      const result = await createRoom(displayName, pin);
      const okResult = assertOk(result);
      const nextView = okResult.view;
      const nextCredential = {
        code: nextView.code,
        playerId: okResult.playerId!,
        reconnectToken: okResult.reconnectToken!,
        name: displayName.trim()
      };
      saveCredential(nextCredential);
      setCredential(nextCredential);
      setView(nextView);
      connectLive(nextCredential);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "CREATE_FAILED");
    }
  }

  async function handleJoinRoom() {
    setNotice("");
    try {
      const code = normalizedCode(roomCode);
      const result = await joinRoom(code, displayName, pin);
      const okResult = assertOk(result);
      const nextView = okResult.view;
      const nextCredential = {
        code,
        playerId: okResult.playerId!,
        reconnectToken: okResult.reconnectToken!,
        name: displayName.trim()
      };
      saveCredential(nextCredential);
      setCredential(nextCredential);
      setView(nextView);
      connectLive(nextCredential);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "JOIN_FAILED");
    }
  }

  function handleReconnect() {
    if (credential) {
      setNotice("");
      connectLive(credential);
    }
  }

  function handleLeaveLocal() {
    socketRef.current?.close();
    socketRef.current = null;
    removeCredential();
    setCredential(null);
    setView(null);
    setConnectionStatus("idle");
    setNotice("");
  }

  async function addBot() {
    if (!credential || !view) return;
    const sent = sendRoomMessage(socketRef.current, {
      type: "ADD_BOT",
      requestId: requestId("add-bot")
    });
    if (!sent) {
      const result = await addBotHttp(credential.code, credential.playerId);
      setView(assertOk(result).view);
    }
  }

  async function removeBot(botPlayerId: string) {
    if (!credential || !view) return;
    const sent = sendRoomMessage(socketRef.current, {
      type: "REMOVE_BOT",
      requestId: requestId("remove-bot"),
      botPlayerId
    });
    if (!sent) {
      const result = await removeBotHttp(credential.code, credential.playerId, botPlayerId);
      setView(assertOk(result).view);
    }
  }

  async function startGame() {
    if (!credential || !view) return;
    const sent = sendRoomMessage(socketRef.current, {
      type: "START_GAME",
      requestId: requestId("start-game")
    });
    if (!sent) {
      const result = await startGameHttp(credential.code, credential.playerId);
      setView(assertOk(result).view);
    }
  }

  async function submitClaim(claim: ClaimTemplate) {
    if (!credential || !view) return;
    const envelope = {
      requestId: requestId("claim"),
      roomId: view.roomId,
      playerId: credential.playerId,
      stateRevision: view.stateRevision,
      turnId: view.currentTurnId,
      claimWindowId: view.activeClaimWindow?.id,
      payload: {
        claim
      }
    };

    setClaimPickerOpen(false);
    const sent = sendRoomMessage(socketRef.current, {
      type: "SUBMIT_CLAIM",
      envelope
    });
    if (!sent) {
      const result = await submitClaimHttp(credential.code, envelope);
      if (result.ok) setView(result.view);
      else setNotice(result.code);
    }
  }

  async function callBullshit() {
    if (!credential || !view?.activeClaimWindow) return;
    const envelope = {
      requestId: requestId("bullshit"),
      roomId: view.roomId,
      playerId: credential.playerId,
      stateRevision: view.stateRevision,
      claimWindowId: view.activeClaimWindow.id,
      payload: {}
    };

    const sent = sendRoomMessage(socketRef.current, {
      type: "CALL_BULLSHIT",
      envelope
    });
    if (!sent) {
      const result = await callBullshitHttp(credential.code, envelope);
      if (result.ok) setView(result.view);
      else setNotice(result.code);
    }
  }

  if (!view) {
    return (
      <EntryScreen
        credential={credential}
        connectionStatus={connectionStatus}
        displayName={displayName}
        entryMode={entryMode}
        notice={notice}
        pin={pin}
        roomCode={roomCode}
        onCreate={handleCreateRoom}
        onJoin={handleJoinRoom}
        onReconnect={handleReconnect}
        onSetDisplayName={setDisplayName}
        onSetEntryMode={setEntryMode}
        onSetPin={setPin}
        onSetRoomCode={setRoomCode}
      />
    );
  }

  return (
    <div className="app-shell">
      <TopBar
        countdown={countdown}
        status={connectionStatus}
        view={view}
        onLeave={handleLeaveLocal}
        onReconnect={handleReconnect}
      />

      {notice && (
        <div className="toast" role="status">
          <CircleAlert size={16} />
          <span>{notice}</span>
        </div>
      )}

      {view.phase === "Lobby" ? (
        <Lobby view={view} onAddBot={addBot} onRemoveBot={removeBot} onStartGame={startGame} />
      ) : (
        <GameTable
          countdown={countdown}
          view={view}
          onCallBullshit={callBullshit}
          onOpenClaimPicker={() => setClaimPickerOpen(true)}
          onOpenLastRound={() => setLastRoundOpen(true)}
        />
      )}

      {claimPickerOpen && (
        <ClaimPicker
          view={view}
          onClose={() => setClaimPickerOpen(false)}
          onSubmit={submitClaim}
        />
      )}

      {lastRoundOpen && view.lastRoundResult && (
        <LastRoundSheet
          view={view}
          onClose={() => setLastRoundOpen(false)}
        />
      )}
    </div>
  );
}

function EntryScreen(props: {
  credential: SeatCredential | null;
  connectionStatus: ConnectionStatus;
  displayName: string;
  entryMode: EntryMode;
  notice: string;
  pin: string;
  roomCode: string;
  onCreate: () => void;
  onJoin: () => void;
  onReconnect: () => void;
  onSetDisplayName: (value: string) => void;
  onSetEntryMode: (value: EntryMode) => void;
  onSetPin: (value: string) => void;
  onSetRoomCode: (value: string) => void;
}) {
  const canSubmit = props.displayName.trim().length > 0 && /^\d{4}$/.test(props.pin);
  const canJoin = canSubmit && normalizedCode(props.roomCode).length > 0;

  return (
    <main className="entry-shell">
      <section className="entry-panel">
        <div className="brand-lockup">
          <span className="brand-mark">BS</span>
          <div>
            <h1>BullShit Poker</h1>
            <p>Bluff hard. Call harder.</p>
          </div>
        </div>

        <div className="entry-toggle" role="tablist" aria-label="Entry mode">
          <button className={props.entryMode === "create" ? "active" : ""} onClick={() => props.onSetEntryMode("create")}>
            Create
          </button>
          <button className={props.entryMode === "join" ? "active" : ""} onClick={() => props.onSetEntryMode("join")}>
            Join
          </button>
        </div>

        <div className="entry-fields">
          {props.entryMode === "join" && (
            <label>
              <span>Room Code</span>
              <input
                inputMode="text"
                maxLength={6}
                value={props.roomCode}
                onChange={(event) => props.onSetRoomCode(normalizedCode(event.target.value))}
                placeholder="ABC123"
              />
            </label>
          )}
          <label>
            <span>Name</span>
            <input
              value={props.displayName}
              onChange={(event) => props.onSetDisplayName(event.target.value)}
              placeholder="Jaswanth"
            />
          </label>
          <label>
            <span>4-Digit PIN</span>
            <input
              inputMode="numeric"
              maxLength={4}
              value={props.pin}
              onChange={(event) => props.onSetPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="1234"
              type="password"
            />
          </label>
        </div>

        <button
          className="primary-action"
          disabled={props.entryMode === "create" ? !canSubmit : !canJoin}
          onClick={props.entryMode === "create" ? props.onCreate : props.onJoin}
        >
          <LogIn size={18} />
          {props.entryMode === "create" ? "Create Room" : "Join Room"}
        </button>

        {props.credential && (
          <button className="secondary-action" onClick={props.onReconnect}>
            <RefreshCw size={18} />
            Reconnect {props.credential.code}
          </button>
        )}

        {props.notice && <div className="entry-error">{props.notice}</div>}
        {props.connectionStatus !== "idle" && (
          <div className={`connection-pill ${props.connectionStatus}`}>
            {connectionLabel(props.connectionStatus)}
          </div>
        )}
      </section>
    </main>
  );
}

function TopBar(props: {
  countdown: number;
  status: ConnectionStatus;
  view: PrivateGameView;
  onLeave: () => void;
  onReconnect: () => void;
}) {
  const activeCardTotal = props.view.players
    .filter((player) => !player.eliminated && player.leftAt === undefined)
    .reduce((sum, player) => sum + player.cardCount, 0);

  return (
    <header className="top-bar">
      <div>
        <span className="room-label">Room</span>
        <strong>{props.view.code}</strong>
      </div>
      <div className="top-actions">
        <span className={`connection-pill ${props.status}`}>
          <Radio size={14} />
          {connectionLabel(props.status)}
        </span>
        <span className="timer-pill">
          <Clock3 size={15} />
          {props.countdown || "--"}s
        </span>
        {props.view.phase !== "Lobby" && (
          <span className="card-count-pill">
            <Layers size={15} />
            Cards {activeCardTotal}
          </span>
        )}
        {canReconnect(props.status) && (
          <button className="secondary-action compact reconnect-action" onClick={props.onReconnect}>
            <RefreshCw size={17} />
            Reconnect
          </button>
        )}
        <button className="icon-button" aria-label="Leave local seat" title="Leave local seat" onClick={props.onLeave}>
          <X size={17} />
        </button>
      </div>
    </header>
  );
}

function Lobby(props: {
  view: PrivateGameView;
  onAddBot: () => void;
  onRemoveBot: (botPlayerId: string) => void;
  onStartGame: () => void;
}) {
  return (
    <main className="lobby-layout">
      <section className="lobby-header">
        <h2>Lobby</h2>
        <div className="lobby-actions">
          {props.view.isViewerHost && (
            <button className="secondary-action compact" onClick={props.onAddBot}>
              <Bot size={18} />
              Add Bot
            </button>
          )}
          {props.view.isViewerHost && (
            <button className="primary-action compact" onClick={props.onStartGame}>
              <Sparkles size={18} />
              Start
            </button>
          )}
        </div>
      </section>

      <section className="seat-grid">
        {props.view.players.map((player) => (
          <PlayerSeat
            key={player.id}
            player={player}
            active={player.id === props.view.viewerPlayerId}
            canRemove={props.view.isViewerHost && player.isBot}
            onRemove={() => props.onRemoveBot(player.id)}
          />
        ))}
      </section>
    </main>
  );
}

function GameTable(props: {
  countdown: number;
  view: PrivateGameView;
  onCallBullshit: () => void;
  onOpenClaimPicker: () => void;
  onOpenLastRound: () => void;
}) {
  const opponents = props.view.players.filter((player) => player.id !== props.view.viewerPlayerId);
  const currentClaimant = playerName(props.view.players, props.view.currentClaim?.playerId);
  const currentTurn = playerName(props.view.players, props.view.currentTurnPlayerId);
  const isFinalDecision = Boolean(
    props.view.currentClaim &&
      props.view.currentTurnPlayerId === props.view.viewerPlayerId &&
      props.view.startingPlayerId === props.view.viewerPlayerId
  );

  return (
    <main className="table-layout">
      <section className="opponent-rail" aria-label="Opponents">
        {opponents.map((player) => (
          <PlayerSeat
            key={player.id}
            player={player}
            active={player.id === props.view.currentTurnPlayerId}
            compact
          />
        ))}
      </section>

      <section className="claim-zone">
        <div className="claim-meta">
          <span>Round {props.view.roundNumber}</span>
          <span>{currentTurn}</span>
          <span>{props.countdown || "--"}s</span>
        </div>
        <h2>{props.view.currentClaim ? formatClaim(props.view.currentClaim) : "Opening Claim"}</h2>
        <div className="claim-byline">
          {props.view.currentClaim ? `by ${currentClaimant}` : `starts with ${currentTurn}`}
        </div>

        <ClaimTimeline view={props.view} />

        <div className="table-actions">
          <button
            className="primary-action compact"
            disabled={!props.view.canViewerAct || props.view.phase !== "RoundActive"}
            onClick={props.onOpenClaimPicker}
          >
            <Plus size={18} />
            {isFinalDecision ? "Final Claim" : "Make Claim"}
          </button>
          <button
            className="danger-action"
            disabled={!props.view.canViewerCallBullShit}
            onClick={props.onCallBullshit}
          >
            <ShieldAlert size={18} />
            BullShit
          </button>
          {props.view.lastRoundResult && (
            <button className="secondary-action compact" onClick={props.onOpenLastRound}>
              <Eye size={18} />
              Last Round
            </button>
          )}
          {props.view.phase === "ResolvingRound" && (
            <div className="auto-next-notice">Next round starts automatically</div>
          )}
        </div>
      </section>

      <section className="hand-dock" aria-label="Your cards">
        <div className="hand-title">
          <span>Your cards</span>
          <strong>{props.view.viewerCards.length}</strong>
        </div>
        <div className="card-row">
          {props.view.viewerCards.map((card) => (
            <div key={card.id} className={`playing-card ${cardTone(card)}`}>
              <span>{card.rank}</span>
              <strong>{formatCard(card).slice(-1)}</strong>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function PlayerSeat(props: {
  player: PublicPlayerView;
  active?: boolean;
  compact?: boolean;
  canRemove?: boolean;
  onRemove?: () => void;
}) {
  return (
    <div className={`player-seat ${props.active ? "active" : ""} ${props.compact ? "compact" : ""}`}>
      <div className="seat-avatar">
        {props.player.isBot ? <Bot size={18} /> : <UsersRound size={18} />}
      </div>
      <div className="seat-copy">
        <strong>{props.player.name}</strong>
        <span>{props.player.cardCount} cards</span>
      </div>
      {!props.player.connected && <span className="seat-flag">offline</span>}
      {props.player.eliminated && <span className="seat-flag">out</span>}
      {props.canRemove && (
        <button className="seat-remove" aria-label={`Remove ${props.player.name}`} onClick={props.onRemove}>
          <Trash2 size={16} />
        </button>
      )}
    </div>
  );
}

function ClaimTimeline(props: { view: PrivateGameView }) {
  const claims = props.view.claimHistory;
  return (
    <div className="claim-timeline">
      {claims.length === 0 ? (
        <span className="timeline-empty">No claims</span>
      ) : (
        claims.map((claim) => (
          <div key={claim.id ?? claimKey(claim)} className="timeline-item">
            <span>{playerName(props.view.players, claim.playerId)}</span>
            <strong>{compactClaim(claim)}</strong>
          </div>
        ))
      )}
    </div>
  );
}

function ClaimPicker(props: {
  view: PrivateGameView;
  onClose: () => void;
  onSubmit: (claim: ClaimTemplate) => void;
}) {
  const groups = useMemo(() => legalClaimsByHandType(props.view.currentClaim), [props.view.currentClaim]);
  const [activeType, setActiveType] = useState(groups[0]?.handType);
  const activeGroup = groups.find((group) => group.handType === activeType) ?? groups[0] ?? null;
  const isFinalDecision = Boolean(
    props.view.currentClaim &&
      props.view.currentTurnPlayerId === props.view.viewerPlayerId &&
      props.view.startingPlayerId === props.view.viewerPlayerId
  );

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true">
      <section className="claim-sheet">
        <header className="sheet-header">
          <div>
            <span>{isFinalDecision ? "Final Claim" : "Make Claim"}</span>
            <h3>{formatClaim(props.view.currentClaim)}</h3>
          </div>
          <button className="icon-button" onClick={props.onClose}>
            <X size={18} />
          </button>
        </header>

        {!activeGroup ? (
          <div className="empty-claim-state">
            <ShieldAlert size={22} />
            <strong>No higher claim</strong>
          </div>
        ) : (
          <>
            <div className="claim-type-tabs">
              {groups.map((group) => (
                <button
                  key={group.handType}
                  className={group.handType === activeGroup.handType ? "active" : ""}
                  onClick={() => setActiveType(group.handType)}
                >
                  {group.label}
                </button>
              ))}
            </div>

            <div className="claim-options">
              {activeGroup.claims.map((claim) => (
                <button key={claimKey(claim)} onClick={() => props.onSubmit(claim)}>
                  <span>{compactClaim(claim)}</span>
                  <strong>{formatClaim(claim)}</strong>
                </button>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function LastRoundSheet(props: {
  view: PrivateGameView;
  onClose: () => void;
}) {
  const result = props.view.lastRoundResult!;
  const proofIds = new Set(result.proofCardIds ?? []);

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true">
      <section className="review-sheet">
        <header className="sheet-header">
          <div>
            <span>Round {result.roundNumber}</span>
            <h3>{result.claim ? formatClaim(result.claim) : result.reason}</h3>
          </div>
          <button className="icon-button" onClick={props.onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="result-summary">
          <ResultLine label="Caller" value={result.callerPlayerId ? playerName(props.view.players, result.callerPlayerId) : "No BullShit caller"} />
          <ResultLine label="Claimant" value={playerName(props.view.players, result.claimantPlayerId)} />
          <ResultLine label="Truth" value={result.claimWasTrue === undefined ? result.reason : result.claimWasTrue ? "True" : "False"} />
          <ResultLine label="Penalty" value={playerName(props.view.players, result.penaltyPlayerId)} />
          <ResultLine label="Next" value={playerName(props.view.players, result.nextStartingPlayerId)} />
        </div>

        <div className="revealed-groups">
          {result.revealedHands.map((hand) => (
            <div key={hand.playerId} className="revealed-group">
              <strong>{playerName(props.view.players, hand.playerId)}</strong>
              <div className="mini-card-row">
                {hand.cards.map((card) => (
                  <span key={card.id} className={`mini-card ${cardTone(card)} ${proofIds.has(card.id) ? "proof" : ""}`}>
                    {formatCard(card)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {props.view.phase === "ResolvingRound" && (
          <div className="auto-next-sheet">Next round starts automatically after this reveal.</div>
        )}
      </section>
    </div>
  );
}

function ResultLine(props: { label: string; value: string }) {
  return (
    <div>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}
