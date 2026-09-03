import {
  useCallback,
  useEffect,
  lazy,
  useMemo,
  useRef,
  useState,
  Suspense,
  type CSSProperties,
} from "react";
import QRCode from "qrcode";
import {
  ArrowRight,
  Bot,
  Check,
  ChevronLeft,
  CircleAlert,
  Copy,
  DoorOpen,
  Eye,
  Layers,
  Flag,
  LogIn,
  Plus,
  RotateCcw,
  RefreshCw,
  ShieldAlert,
  Share2,
  SlidersHorizontal,
  SmilePlus,
  Sparkles,
  Star,
  Trash2,
  Trophy,
  UserRoundCheck,
  UsersRound,
  Vibrate,
  Volume2,
  X,
} from "lucide-react";
import {
  connectRoomSocket,
  createRoom,
  joinRoom,
  sendRoomMessage,
  type LifecycleWireResult,
  type SeatCredential,
} from "./api";
import {
  cardTone,
  claimKey,
  compactClaim,
  formatCard,
  formatClaim,
  legalClaimsByHandType,
  playerName,
  RANK_SHORT,
  RANK_WORDS,
} from "./claimUi";
import type {
  ClaimTemplate,
  HandType,
  PrivateGameView,
  PublicPlayerView,
  Rank,
  ReactionKind,
  RoomServerMessage,
  Suit,
} from "../shared/index.ts";
import { MAX_PLAYERS } from "../shared/index.ts";
import { deriveVisualEvents, visualEventBus } from "./visualEvents.ts";

const KineticScene = lazy(() => import("./KineticScene"));
const LivingTableScene = lazy(() => import("./LivingTableScene"));

const STORAGE_KEY = "bullshit-poker-v3-seat";
const PREFERENCES_KEY = "bullshit-poker-v3-preferences";

type Preferences = {
  sound: boolean;
  haptics: boolean;
  reducedEffects: boolean;
};

const DEFAULT_PREFERENCES: Preferences = {
  sound: true,
  haptics: true,
  reducedEffects: false,
};

function loadPreferences(): Preferences {
  try {
    return {
      ...DEFAULT_PREFERENCES,
      ...(JSON.parse(
        localStorage.getItem(PREFERENCES_KEY) ?? "{}",
      ) as Partial<Preferences>),
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function persistPreferences(preferences: Preferences): void {
  localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
}

type ConnectionStatus = "idle" | "connecting" | "open" | "closed" | "error";
type EntryMode = "create" | "join";
type RoomCodeCopyState = "idle" | "copied" | "selected";

function requestId(prefix: string): string {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function normalizedCode(code: string): string {
  return code.trim().toUpperCase();
}

function cardCountLabel(count: number): string {
  return `${count} ${count === 1 ? "card" : "cards"}`;
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

function playSignalTone(frequency: number): void {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.17);
    oscillator.addEventListener("ended", () => void context.close());
  } catch {
    // Audio is enhancement-only and may be blocked until a browser gesture.
  }
}

function supportsHaptics(): boolean {
  return (
    typeof navigator !== "undefined" && typeof navigator.vibrate === "function"
  );
}

function playHaptic(enabled: boolean, pattern: number | number[]): boolean {
  if (!enabled || !supportsHaptics()) return false;
  try {
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea fallback for browsers that expose
    // clipboard APIs but block them in the current context.
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "-9999px";
  textArea.style.opacity = "0";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  textArea.setSelectionRange(0, text.length);

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textArea);
  }
}

function selectVisibleRoomCode(): boolean {
  const roomCodeElement =
    document.querySelector<HTMLElement>("[data-room-code]");
  const selection = window.getSelection();
  if (!roomCodeElement || !selection) return false;

  const range = document.createRange();
  range.selectNodeContents(roomCodeElement);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
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

export function App() {
  const sharedRoomCode = new URLSearchParams(window.location.search).get(
    "room",
  );
  const [entryMode, setEntryMode] = useState<EntryMode>(
    sharedRoomCode ? "join" : "create",
  );
  const [displayName, setDisplayName] = useState("");
  const [pin, setPin] = useState("");
  const [roomCode, setRoomCode] = useState(() =>
    normalizedCode(sharedRoomCode ?? ""),
  );
  const [credential, setCredential] = useState<SeatCredential | null>(() =>
    loadCredential(),
  );
  const [view, setView] = useState<PrivateGameView | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("idle");
  const [entryPending, setEntryPending] = useState(false);
  const [notice, setNotice] = useState<string>("");
  const [roomCodeCopyState, setRoomCodeCopyState] =
    useState<RoomCodeCopyState>("idle");
  const [claimPickerOpen, setClaimPickerOpen] = useState(false);
  const [lastRoundOpen, setLastRoundOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leavePending, setLeavePending] = useState(false);
  const [endGameOpen, setEndGameOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reactionOpen, setReactionOpen] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences);
  const socketRef = useRef<WebSocket | null>(null);
  const socketGenerationRef = useRef(0);
  const latestViewRef = useRef<PrivateGameView | null>(null);
  const entryRequestPendingRef = useRef(false);
  const autoReconnectKeyRef = useRef<string | null>(null);
  const leaveRequestIdRef = useRef<string | null>(null);
  const historyGuardRef = useRef(false);
  const lastRoundResultIdRef = useRef<string | null>(null);
  const isInRoom = view !== null;
  const hapticsAvailable = supportsHaptics();

  useEffect(() => {
    return () => {
      socketGenerationRef.current += 1;
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    persistPreferences(preferences);
    document.documentElement.dataset.reducedEffects = preferences.reducedEffects
      ? "true"
      : "false";
  }, [preferences]);

  useEffect(() => {
    if (!isInRoom || historyGuardRef.current) return;
    historyGuardRef.current = true;
    window.history.pushState(
      { bullshitPokerV3: true },
      "",
      window.location.href,
    );
    const handlePopState = () => {
      setLeaveOpen(true);
      window.history.pushState(
        { bullshitPokerV3: true },
        "",
        window.location.href,
      );
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      historyGuardRef.current = false;
    };
  }, [isInRoom]);

  useEffect(() => {
    const resultId = view?.lastRoundResult?.id;
    if (!resultId || lastRoundResultIdRef.current === resultId) return;
    lastRoundResultIdRef.current = resultId;
    playHaptic(preferences.haptics, [18, 35, 28]);
    if (preferences.sound)
      playSignalTone(view.lastRoundResult?.claimWasTrue ? 520 : 220);
  }, [preferences.haptics, preferences.sound, view?.lastRoundResult]);

  const acceptView = useCallback((nextView: PrivateGameView): boolean => {
    const currentView = latestViewRef.current;
    if (currentView?.roomId === nextView.roomId) {
      if (nextView.stateRevision < currentView.stateRevision) return false;
      if (
        nextView.stateRevision === currentView.stateRevision &&
        (nextView.socialRevision ?? 0) < (currentView.socialRevision ?? 0)
      ) {
        return false;
      }
    }
    visualEventBus.publish(deriveVisualEvents(currentView, nextView));
    latestViewRef.current = nextView;
    setView(nextView);
    return true;
  }, []);

  const clearSeatSession = useCallback((nextNotice = ""): void => {
    socketGenerationRef.current += 1;
    const socket = socketRef.current;
    socketRef.current = null;
    socket?.close();
    autoReconnectKeyRef.current = null;
    latestViewRef.current = null;
    visualEventBus.reset();
    removeCredential();
    setCredential(null);
    setView(null);
    setConnectionStatus("idle");
    setLeavePending(false);
    setLeaveOpen(false);
    leaveRequestIdRef.current = null;
    setNotice(nextNotice);
  }, []);

  const handleServerMessage = useCallback(
    (message: RoomServerMessage, generation: number): void => {
      if (generation !== socketGenerationRef.current) return;
      if (message.type === "SESSION_ACCEPTED") {
        if (acceptView(message.view)) setNotice("");
        return;
      }
      if (message.type === "SESSION_REJECTED") {
        if (message.code === "PLAYER_LEFT_MATCH") {
          clearSeatSession("You already left this match.");
          return;
        }
        if (
          message.code === "ROOM_NOT_FOUND" ||
          message.code === "ROOM_CLOSED"
        ) {
          clearSeatSession("That room is no longer available.");
          return;
        }
        if (message.code === "RECONNECT_TOKEN_INVALID") {
          clearSeatSession(
            "This saved session expired. Join again with your name and PIN.",
          );
          return;
        }
        setNotice(message.code);
        setConnectionStatus("error");
        return;
      }
      if (message.type === "LEAVE_ACCEPTED") {
        clearSeatSession();
        return;
      }
      if (message.type === "SEAT_REMOVED") {
        clearSeatSession("The host removed your seat from the lobby.");
        return;
      }
      if (message.type === "ROOM_UPDATED") {
        const accepted = acceptView(message.view);
        if (!accepted) return;
        setNotice("");
        if (message.roundResult) {
          setLastRoundOpen(message.view.phase !== "GameOver");
        }
        return;
      }
      if (message.type === "ACTION_REJECTED") {
        setNotice(message.code);
        if (message.view) {
          acceptView(message.view);
        }
      }
    },
    [acceptView, clearSeatSession],
  );

  const connectLive = useCallback(
    (nextCredential: SeatCredential): void => {
      const generation = socketGenerationRef.current + 1;
      socketGenerationRef.current = generation;
      const priorSocket = socketRef.current;
      socketRef.current = null;
      priorSocket?.close();

      const socket = connectRoomSocket(
        nextCredential,
        (message) => handleServerMessage(message, generation),
        (status) => {
          if (generation !== socketGenerationRef.current) return;
          setConnectionStatus(status);
          if (
            (status === "closed" || status === "error") &&
            leaveRequestIdRef.current
          ) {
            setLeavePending(false);
            setNotice(
              "The leave confirmation was interrupted. Reconnect and try again safely.",
            );
          }
        },
      );
      socketRef.current = socket;
    },
    [handleServerMessage],
  );

  useEffect(() => {
    if (!credential || view) return;
    const reconnectKey = `${credential.code}:${credential.playerId}:${credential.reconnectToken}`;
    if (autoReconnectKeyRef.current === reconnectKey) return;
    autoReconnectKeyRef.current = reconnectKey;
    setNotice("");
    connectLive(credential);
  }, [connectLive, credential, view]);

  async function handleCreateRoom() {
    if (entryRequestPendingRef.current) return;
    entryRequestPendingRef.current = true;
    setEntryPending(true);
    setNotice("");
    try {
      const result = await createRoom(displayName, pin);
      const okResult = assertOk(result);
      const nextView = okResult.view;
      const nextCredential = {
        code: nextView.code,
        playerId: okResult.playerId!,
        reconnectToken: okResult.reconnectToken!,
        name: displayName.trim(),
      };
      saveCredential(nextCredential);
      setCredential(nextCredential);
      acceptView(nextView);
      connectLive(nextCredential);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "CREATE_FAILED");
    } finally {
      entryRequestPendingRef.current = false;
      setEntryPending(false);
    }
  }

  async function handleJoinRoom() {
    if (entryRequestPendingRef.current) return;
    entryRequestPendingRef.current = true;
    setEntryPending(true);
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
        name: displayName.trim(),
      };
      saveCredential(nextCredential);
      setCredential(nextCredential);
      acceptView(nextView);
      connectLive(nextCredential);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "JOIN_FAILED");
    } finally {
      entryRequestPendingRef.current = false;
      setEntryPending(false);
    }
  }

  function handleReconnect() {
    if (credential) {
      setNotice("");
      connectLive(credential);
    }
  }

  function requestLeave() {
    setReactionOpen(false);
    setSettingsOpen(false);
    setLeaveOpen(true);
  }

  function confirmLeave() {
    if (!view?.matchId || leavePending) return;
    const request = leaveRequestIdRef.current ?? requestId("leave");
    leaveRequestIdRef.current = request;
    setLeavePending(true);
    const sent = sendRoomMessage(socketRef.current, {
      type: "LEAVE_GAME",
      requestId: request,
      matchId: view.matchId,
    });
    if (!sent) {
      setLeavePending(false);
      setNotice("Reconnect before leaving so the table can update safely.");
    }
  }

  function setReady(ready: boolean) {
    const sent = sendRoomMessage(socketRef.current, {
      type: "SET_READY",
      requestId: requestId("ready"),
      ready,
    });
    if (sent) playHaptic(preferences.haptics, 10);
  }

  function endGame() {
    if (!view?.matchId) return;
    sendRoomMessage(socketRef.current, {
      type: "END_GAME",
      requestId: requestId("end-game"),
      matchId: view.matchId,
    });
    setEndGameOpen(false);
  }

  function startRematch() {
    if (!view?.matchId) return;
    sendRoomMessage(socketRef.current, {
      type: "START_REMATCH",
      requestId: requestId("rematch"),
      matchId: view.matchId,
    });
  }

  function sendReaction(kind: ReactionKind) {
    const sent = sendRoomMessage(socketRef.current, {
      type: "SEND_REACTION",
      requestId: requestId("reaction"),
      kind,
    });
    if (sent) playHaptic(preferences.haptics, 12);
    setReactionOpen(false);
  }

  function updatePreferences(nextPreferences: Preferences) {
    if (!preferences.haptics && nextPreferences.haptics) {
      playHaptic(true, [14, 24, 14]);
    }
    setPreferences(nextPreferences);
  }

  async function addBot() {
    if (!credential || !view) return;
    const sent = sendRoomMessage(socketRef.current, {
      type: "ADD_BOT",
      requestId: requestId("add-bot"),
    });
    if (!sent) {
      setNotice("Reconnect to change the table.");
    }
  }

  async function removePlayer(targetPlayerId: string) {
    if (!credential || !view) return;
    const sent = sendRoomMessage(socketRef.current, {
      type: "REMOVE_PLAYER",
      requestId: requestId("remove-player"),
      targetPlayerId,
    });
    if (!sent) {
      setNotice("Reconnect to change the table.");
    }
  }

  async function copyRoomCode() {
    if (!view) return;
    const copied = await copyTextToClipboard(view.code);
    if (copied) {
      setNotice("");
      setRoomCodeCopyState("copied");
    } else {
      setRoomCodeCopyState(selectVisibleRoomCode() ? "selected" : "idle");
    }
    window.setTimeout(() => setRoomCodeCopyState("idle"), 1_500);
  }

  async function startGame() {
    if (!credential || !view) return;
    const sent = sendRoomMessage(socketRef.current, {
      type: "START_GAME",
      requestId: requestId("start-game"),
    });
    if (!sent) {
      setNotice("Reconnect before starting the game.");
    } else {
      playHaptic(preferences.haptics, [12, 20, 24]);
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
        claim,
      },
    };

    setClaimPickerOpen(false);
    const sent = sendRoomMessage(socketRef.current, {
      type: "SUBMIT_CLAIM",
      envelope,
    });
    if (!sent) {
      setNotice("Reconnect before making a claim.");
    } else {
      playHaptic(preferences.haptics, 12);
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
      payload: {},
    };

    const sent = sendRoomMessage(socketRef.current, {
      type: "CALL_BULLSHIT",
      envelope,
    });
    if (!sent) {
      setNotice("Reconnect before calling BullShit.");
    } else {
      playHaptic(preferences.haptics, [24, 28, 42]);
    }
  }

  if (!view) {
    return (
      <EntryScreen
        credential={credential}
        connectionStatus={connectionStatus}
        displayName={displayName}
        entryPending={entryPending}
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
        reducedEffects={preferences.reducedEffects}
      />
    );
  }

  return (
    <div
      className={`app-shell ${view.phase === "GameOver" ? "game-over-shell" : ""} ${view.phase === "Lobby" ? "lobby-shell" : ""}`}
    >
      <TopBar
        canCopyRoomCode={view.phase === "Lobby"}
        roomCodeCopyState={roomCodeCopyState}
        status={connectionStatus}
        view={view}
        onCopyRoomCode={copyRoomCode}
        onEndGame={() => setEndGameOpen(true)}
        onLeave={requestLeave}
        onReconnect={handleReconnect}
        onSettings={() => setSettingsOpen(true)}
        onShare={() => setShareOpen(true)}
      />

      {notice && (
        <div className="toast" role="status">
          <CircleAlert size={16} />
          <span>{notice}</span>
        </div>
      )}

      {view.phase === "Lobby" ? (
        <Lobby
          reducedEffects={preferences.reducedEffects}
          view={view}
          onAddBot={addBot}
          onRemovePlayer={removePlayer}
          onSetReady={setReady}
          onStartGame={startGame}
        />
      ) : view.phase === "GameOver" ? (
        <WinnerExitPage
          view={view}
          onExit={requestLeave}
          onOpenLastRound={() => setLastRoundOpen(true)}
          onRematch={startRematch}
        />
      ) : (
        <GameTable
          reducedEffects={preferences.reducedEffects}
          view={view}
          onCallBullshit={callBullshit}
          onOpenClaimPicker={() => setClaimPickerOpen(true)}
          onOpenLastRound={() => setLastRoundOpen(true)}
          onOpenReactions={() => setReactionOpen((open) => !open)}
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
        <LastRoundSheet view={view} onClose={() => setLastRoundOpen(false)} />
      )}

      {reactionOpen && (
        <ReactionDock
          onClose={() => setReactionOpen(false)}
          onReact={sendReaction}
        />
      )}

      {shareOpen && (
        <ShareSheet view={view} onClose={() => setShareOpen(false)} />
      )}

      {settingsOpen && (
        <SettingsSheet
          hapticsAvailable={hapticsAvailable}
          preferences={preferences}
          onChange={updatePreferences}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {leaveOpen && (
        <ConfirmDialog
          busy={leavePending}
          confirmLabel="Yes, leave"
          description="Your departure is permanent for this match. The table will continue for everyone else."
          title="Do you want to leave the game?"
          onCancel={() => !leavePending && setLeaveOpen(false)}
          onConfirm={confirmLeave}
        />
      )}

      {endGameOpen && (
        <ConfirmDialog
          confirmLabel="Yes, end game"
          description="The current match will end for every player. This cannot be undone."
          title="End this game for everyone?"
          tone="danger"
          onCancel={() => setEndGameOpen(false)}
          onConfirm={endGame}
        />
      )}
    </div>
  );
}

function WinnerExitPage(props: {
  view: PrivateGameView;
  onExit: () => void;
  onOpenLastRound: () => void;
  onRematch: () => void;
}) {
  const winner = props.view.players.find(
    (player) => player.id === props.view.winnerPlayerId,
  );
  const standings = [...props.view.players].sort((left, right) => {
    if (left.id === props.view.winnerPlayerId) return -1;
    if (right.id === props.view.winnerPlayerId) return 1;
    if (left.eliminated !== right.eliminated) return left.eliminated ? 1 : -1;
    return right.cardCount - left.cardCount;
  });
  const hostEnded = props.view.matchEndedReason === "HOST_ENDED";

  return (
    <main className="winner-layout">
      <section className="winner-hero" aria-label="Game over">
        <div className="winner-trophy">
          <span className="winner-orbit" aria-hidden="true" />
          <span className="winner-orbit second" aria-hidden="true" />
          <Trophy size={48} />
        </div>
        <span className="winner-kicker">
          {hostEnded ? "Match Ended" : "Table Closed"}
        </span>
        <h2>
          {hostEnded
            ? "The host ended the game"
            : `${winner?.name ?? "Winner"} wins`}
        </h2>
        <p>
          {hostEnded
            ? "The table is intact and ready for a fresh rematch."
            : "Last player standing at the BullShit Poker table."}
        </p>

        <div className="winner-actions">
          {props.view.lastRoundResult && (
            <button
              className="secondary-action compact"
              onClick={props.onOpenLastRound}
            >
              <Eye size={18} />
              Final Reveal
            </button>
          )}
          {props.view.isViewerHost && (
            <button
              className="primary-action compact"
              onClick={props.onRematch}
            >
              <RotateCcw size={18} />
              Rematch
            </button>
          )}
          <button className="primary-action compact" onClick={props.onExit}>
            <DoorOpen size={18} />
            Exit Table
          </button>
        </div>
      </section>

      <section className="final-standings" aria-label="Final standings">
        {standings.map((player) => (
          <div
            key={player.id}
            className={`standing-row ${player.id === props.view.winnerPlayerId ? "winner" : ""}`}
          >
            <div className="seat-avatar">
              {player.id === props.view.winnerPlayerId ? (
                <Trophy size={18} />
              ) : player.isBot ? (
                <Bot size={18} />
              ) : (
                <UsersRound size={18} />
              )}
            </div>
            <div className="seat-copy">
              <strong>{player.name}</strong>
              <span>{cardCountLabel(player.cardCount)}</span>
            </div>
            <span className="seat-flag">
              {hostEnded
                ? "ended"
                : player.id === props.view.winnerPlayerId
                  ? "winner"
                  : player.leftAt !== undefined
                    ? "left"
                    : "eliminated"}
            </span>
          </div>
        ))}
      </section>
    </main>
  );
}

function EntryScreen(props: {
  credential: SeatCredential | null;
  connectionStatus: ConnectionStatus;
  displayName: string;
  entryPending: boolean;
  entryMode: EntryMode;
  notice: string;
  pin: string;
  reducedEffects: boolean;
  roomCode: string;
  onCreate: () => void;
  onJoin: () => void;
  onReconnect: () => void;
  onSetDisplayName: (value: string) => void;
  onSetEntryMode: (value: EntryMode) => void;
  onSetPin: (value: string) => void;
  onSetRoomCode: (value: string) => void;
}) {
  type EntryField = "room" | "name" | "pin";

  const hasSharedRoomCode =
    props.entryMode === "join" && normalizedCode(props.roomCode).length === 6;
  const [railOpen, setRailOpen] = useState(hasSharedRoomCode);
  const [stepIndex, setStepIndex] = useState(hasSharedRoomCode ? 1 : 0);
  const inputRef = useRef<HTMLInputElement>(null);
  const steps: EntryField[] =
    props.entryMode === "create" ? ["name", "pin"] : ["room", "name", "pin"];
  const boundedStepIndex = Math.min(stepIndex, steps.length - 1);
  const currentField = steps[boundedStepIndex];
  const isFinalStep = boundedStepIndex === steps.length - 1;
  const isConnecting =
    props.entryPending || props.connectionStatus === "connecting";

  const fieldDetails: Record<
    EntryField,
    { label: string; placeholder: string; question: string }
  > = {
    room: {
      label: "Room code",
      placeholder: "Enter room code",
      question: "Which table are you joining?",
    },
    name: {
      label: "Player name",
      placeholder: "Enter your name",
      question: "What should the table call you?",
    },
    pin: {
      label: "4-digit PIN",
      placeholder:
        props.entryMode === "create"
          ? "Choose a 4-digit PIN"
          : "Enter your 4-digit PIN",
      question:
        props.entryMode === "create" ? "Lock your seat" : "Unlock your seat",
    },
  };

  const currentFieldValid =
    currentField === "room"
      ? normalizedCode(props.roomCode).length === 6
      : currentField === "name"
        ? props.displayName.trim().length > 0
        : /^\d{4}$/.test(props.pin);

  function focusRailInput(): void {
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function openRail(mode: EntryMode): void {
    props.onSetEntryMode(mode);
    setStepIndex(
      mode === "join" && normalizedCode(props.roomCode).length === 6 ? 1 : 0,
    );
    setRailOpen(true);
    focusRailInput();
  }

  function switchMode(): void {
    openRail(props.entryMode === "create" ? "join" : "create");
  }

  function goBack(): void {
    if (boundedStepIndex === 0) {
      setRailOpen(false);
      return;
    }

    setStepIndex(boundedStepIndex - 1);
    focusRailInput();
  }

  function advance(): void {
    if (!currentFieldValid || isConnecting) return;

    if (isFinalStep) {
      if (props.entryMode === "create") {
        props.onCreate();
      } else {
        props.onJoin();
      }
      return;
    }

    setStepIndex(boundedStepIndex + 1);
    focusRailInput();
  }

  function updateCurrentField(value: string): void {
    if (currentField === "room") {
      props.onSetRoomCode(normalizedCode(value).slice(0, 6));
      return;
    }
    if (currentField === "name") {
      props.onSetDisplayName(value);
      return;
    }
    props.onSetPin(value.replace(/\D/g, "").slice(0, 4));
  }

  const currentValue =
    currentField === "room"
      ? props.roomCode
      : currentField === "name"
        ? props.displayName
        : props.pin;
  const finalActionLabel =
    props.entryMode === "create" ? "Create Room" : "Join Room";

  return (
    <main className="entry-shell">
      <Suspense
        fallback={<div className="kinetic-scene-fallback" aria-hidden="true" />}
      >
        <KineticScene reducedEffects={props.reducedEffects} />
      </Suspense>
      <section className="launch-brand" aria-labelledby="game-title">
        <span className="launch-kicker">
          <span aria-hidden="true" />
          Live social bluffing
        </span>
        <h1 id="game-title">
          <span>BullShit</span> Poker
        </h1>
        <p>The table remembers. Bluff accordingly.</p>
      </section>

      {!railOpen && (
        <section
          className="deal-launch-actions"
          aria-label="Choose how to play"
        >
          <button
            className="deal-mode-action create"
            onClick={() => openRail("create")}
          >
            <span className="deal-mode-icon" aria-hidden="true">
              <Plus size={22} />
            </span>
            <span>
              <small>Start fresh</small>
              <strong>Create Table</strong>
            </span>
            <ArrowRight size={20} aria-hidden="true" />
          </button>
          <button
            className="deal-mode-action join"
            onClick={() => openRail("join")}
          >
            <span className="deal-mode-icon" aria-hidden="true">
              <LogIn size={21} />
            </span>
            <span>
              <small>Enter a code</small>
              <strong>Join Room</strong>
            </span>
            <ArrowRight size={20} aria-hidden="true" />
          </button>
          {props.credential && (
            <button className="deal-reconnect" onClick={props.onReconnect}>
              <RefreshCw size={17} />
              Reconnect to {props.credential.code}
            </button>
          )}
          {props.notice && (
            <div className="deal-entry-notice" role="alert">
              {props.notice}
            </div>
          )}
        </section>
      )}

      {railOpen && (
        <section className="deal-rail" aria-label="Deal in">
          <header className="deal-rail-header">
            <button
              className="deal-back"
              onClick={goBack}
              aria-label={
                boundedStepIndex === 0 ? "Close deal-in rail" : "Previous step"
              }
            >
              <ChevronLeft size={23} />
            </button>
            <div className="deal-rail-copy">
              <span>
                {props.entryMode === "create" ? "Create table" : "Join room"} ·{" "}
                {boundedStepIndex + 1} of {steps.length}
              </span>
              <strong>{fieldDetails[currentField].question}</strong>
            </div>
            <div
              className="deal-progress"
              aria-label={`Step ${boundedStepIndex + 1} of ${steps.length}`}
            >
              {steps.map((field, index) => (
                <span
                  key={field}
                  className={index <= boundedStepIndex ? "active" : ""}
                />
              ))}
            </div>
          </header>

          <label className="deal-field">
            <span className="sr-only">{fieldDetails[currentField].label}</span>
            <input
              key={currentField}
              ref={inputRef}
              className={currentField === "pin" ? "deal-pin-input" : undefined}
              autoComplete={currentField === "name" ? "nickname" : "off"}
              data-1p-ignore={currentField === "pin" ? "true" : undefined}
              data-bwignore={currentField === "pin" ? "true" : undefined}
              data-lpignore={currentField === "pin" ? "true" : undefined}
              enterKeyHint={isFinalStep ? "done" : "next"}
              inputMode={
                currentField === "pin"
                  ? "numeric"
                  : currentField === "room"
                    ? "text"
                    : undefined
              }
              maxLength={
                currentField === "pin"
                  ? 4
                  : currentField === "room"
                    ? 6
                    : undefined
              }
              value={currentValue}
              onChange={(event) => updateCurrentField(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") advance();
              }}
              pattern={currentField === "pin" ? "[0-9]*" : undefined}
              placeholder={fieldDetails[currentField].placeholder}
              spellCheck={currentField === "name"}
              type="text"
            />
            <button
              className="deal-next"
              disabled={!currentFieldValid || isConnecting}
              onClick={advance}
              aria-label={isFinalStep ? finalActionLabel : "Continue"}
            >
              {isFinalStep ? <LogIn size={22} /> : <ArrowRight size={22} />}
            </button>
          </label>

          <footer className="deal-rail-footer">
            <button className="deal-switch" onClick={switchMode}>
              {props.entryMode === "create"
                ? "Have a room code? Join instead"
                : "Need a table? Create one"}
            </button>
            {props.credential && (
              <button
                className="deal-rail-reconnect"
                onClick={props.onReconnect}
              >
                <RefreshCw size={15} />
                Reconnect {props.credential.code}
              </button>
            )}
          </footer>

          {(props.notice || props.connectionStatus !== "idle") && (
            <div className="deal-rail-status" aria-live="polite">
              {props.notice && <span role="alert">{props.notice}</span>}
              {props.connectionStatus !== "idle" && (
                <span className={`connection-pill ${props.connectionStatus}`}>
                  {connectionLabel(props.connectionStatus)}
                </span>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function TopBar(props: {
  canCopyRoomCode: boolean;
  roomCodeCopyState: RoomCodeCopyState;
  status: ConnectionStatus;
  view: PrivateGameView;
  onCopyRoomCode: () => void;
  onEndGame: () => void;
  onLeave: () => void;
  onReconnect: () => void;
  onSettings: () => void;
  onShare: () => void;
}) {
  const activeCardTotal = currentRoundCardTotal(props.view);
  const copyFeedbackVisible = props.roomCodeCopyState !== "idle";
  const copyLabel =
    props.roomCodeCopyState === "copied"
      ? "Room code copied"
      : props.roomCodeCopyState === "selected"
        ? "Room code selected"
        : "Copy room code";
  const copyTitle =
    props.roomCodeCopyState === "copied"
      ? "Copied"
      : props.roomCodeCopyState === "selected"
        ? "Code selected"
        : "Copy room code";

  const needsReconnect = canReconnect(props.status);

  return (
    <header
      className={`top-bar ${props.view.phase === "Lobby" ? "lobby-top-bar" : ""} ${needsReconnect ? "needs-reconnect" : ""}`}
    >
      <div className="room-code-block">
        <div className="room-meta-row">
          <span className="room-label">Room</span>
          <span
            className={`live-signal ${props.status}`}
            title={connectionLabel(props.status)}
          >
            <span aria-hidden="true" />
            <span className="sr-only">{connectionLabel(props.status)}</span>
          </span>
          {props.view.phase !== "Lobby" && (
            <span
              className="inline-card-total"
              title={`${cardCountLabel(activeCardTotal)} in play`}
            >
              <Layers size={12} />
              {activeCardTotal}
            </span>
          )}
        </div>
        <div className="room-code-row">
          <strong data-room-code>{props.view.code}</strong>
          {props.canCopyRoomCode && (
            <button
              className={`room-code-copy ${props.roomCodeCopyState}`}
              aria-label={copyLabel}
              title={copyTitle}
              onClick={props.onCopyRoomCode}
            >
              {copyFeedbackVisible ? <Check size={16} /> : <Copy size={16} />}
            </button>
          )}
        </div>
      </div>
      <div className="top-actions">
        {needsReconnect && (
          <button
            className="icon-button reconnect-action"
            aria-label="Reconnect"
            title="Reconnect"
            onClick={props.onReconnect}
          >
            <RefreshCw size={17} />
          </button>
        )}
        <button
          className="icon-button"
          aria-label="Share room"
          title="Share room"
          onClick={props.onShare}
        >
          <Share2 size={17} />
        </button>
        <button
          className="icon-button"
          aria-label="Table settings"
          title="Table settings"
          onClick={props.onSettings}
        >
          <SlidersHorizontal size={17} />
        </button>
        {props.view.isViewerHost && props.view.phase !== "GameOver" && (
          <button
            className="icon-button danger-icon"
            aria-label="End game"
            title="End game"
            onClick={props.onEndGame}
          >
            <Flag size={17} />
          </button>
        )}
        <button
          className="icon-button"
          aria-label="Leave game"
          title="Leave game"
          onClick={props.onLeave}
        >
          <DoorOpen size={17} />
        </button>
      </div>
    </header>
  );
}

function currentRoundCardTotal(view: PrivateGameView): number {
  if (
    view.lastRoundResult?.roundNumber === view.roundNumber &&
    (view.phase === "ResolvingRound" || view.phase === "GameOver")
  ) {
    return view.lastRoundResult.revealedHands.reduce(
      (total, hand) => total + hand.cards.length,
      0,
    );
  }

  const participantIds = new Set(view.roundParticipantIds ?? []);
  if (participantIds.size > 0) {
    return view.players
      .filter((player) => participantIds.has(player.id))
      .reduce((total, player) => total + player.cardCount, 0);
  }

  return view.players
    .filter((player) => !player.eliminated && player.leftAt === undefined)
    .reduce((total, player) => total + player.cardCount, 0);
}

const LOBBY_ORBIT_SLOTS: Record<number, readonly number[]> = {
  1: [1],
  2: [1, 6],
  3: [1, 4, 8],
  4: [2, 4, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 5, 6, 8, 10],
  7: [1, 2, 4, 5, 6, 8, 10],
  8: [1, 2, 3, 4, 6, 7, 8, 10],
  9: [1, 2, 3, 4, 5, 6, 7, 8, 9],
  10: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
};

function Lobby(props: {
  reducedEffects: boolean;
  view: PrivateGameView;
  onAddBot: () => void;
  onRemovePlayer: (targetPlayerId: string) => void;
  onSetReady: (ready: boolean) => void;
  onStartGame: () => void;
}) {
  const viewer = props.view.players.find(
    (player) => player.id === props.view.viewerPlayerId,
  );
  const activePlayers = props.view.players.filter(
    (player) => player.leftAt === undefined,
  );
  const seatedCount = activePlayers.length;
  const allHumansReady = activePlayers
    .filter((player) => !player.isBot)
    .every((player) => player.connected && player.ready);
  const orderedPlayers = [...activePlayers].sort(
    (left, right) => left.seatIndex - right.seatIndex,
  );
  const waitingPlayers = orderedPlayers.filter(
    (player) => !player.isBot && (!player.connected || !player.ready),
  );
  const canStart = seatedCount >= 2 && allHumansReady;
  const readyCount = orderedPlayers.filter(
    (player) => player.isBot || (player.connected && player.ready),
  ).length;
  const tableHeading =
    seatedCount < 2
      ? "Waiting for another player"
      : canStart
        ? "Everyone is ready to bluff"
        : waitingPlayers.length === 1
          ? `Waiting on ${waitingPlayers[0].name}`
          : `Waiting on ${waitingPlayers.length} players`;
  const tableLabel = canStart
    ? "Table locked"
    : seatedCount < 2
      ? "Open table"
      : "Players assembling";
  const occupiedSlots = LOBBY_ORBIT_SLOTS[seatedCount] ?? [];
  const openSeats = Array.from(
    { length: MAX_PLAYERS },
    (_, index) => index + 1,
  ).filter((slot) => !occupiedSlots.includes(slot));
  const crowdedOrbit = seatedCount > 6;

  return (
    <main
      className={`lobby-layout bluff-lobby seats-${seatedCount} ${crowdedOrbit ? "crowded" : ""}`}
    >
      <h2 className="sr-only">Lobby</h2>

      <section className="lobby-world" aria-label="Lobby table">
        <aside className="lobby-story">
          <span className="section-kicker">Table assembling</span>
          <h3>Every seat has a tell.</h3>
          <p>
            The room is live. Lock in your seat, read the table, and get ready
            for the first bluff.
          </p>
          <div className="lobby-ready-progress">
            <span aria-hidden="true" />
            <strong>
              {readyCount} of {seatedCount} ready
            </strong>
          </div>
        </aside>

        <div className="lobby-orbit-zone">
          <div className="lobby-mobile-heading">
            <div>
              <span className="section-kicker">Table assembling</span>
              <strong>Every seat has a tell.</strong>
            </div>
            <span className="lobby-capacity-copy">
              {seatedCount} / {MAX_PLAYERS} seated
            </span>
          </div>

          <div className="lobby-table-orbit" aria-hidden="true">
            <Suspense fallback={null}>
              <LivingTableScene
                reducedEffects={props.reducedEffects}
                variant="lobby"
                view={props.view}
              />
            </Suspense>
            <div className="lobby-table-rings" />
            <div className="lobby-table-message">
              <span>{tableLabel}</span>
              <strong>{tableHeading}</strong>
              <small>
                {props.view.isViewerHost
                  ? canStart
                    ? "Deal whenever you are ready"
                    : "The deal unlocks when everyone is ready"
                  : "The host will deal when the table is ready"}
              </small>
            </div>
          </div>

          {orderedPlayers.map((player, index) => {
            const isViewer = player.id === props.view.viewerPlayerId;
            const isHost = player.id === props.view.hostPlayerId;
            const ready = player.isBot || (player.connected && player.ready);
            const seatStatus =
              !player.connected && !player.isBot
                ? "Offline"
                : ready
                  ? "Ready"
                  : "Waiting";

            return (
              <div
                key={player.id}
                className={`lobby-orbit-seat slot-${occupiedSlots[index]} ${isViewer ? "viewer" : ""} ${isHost ? "host" : ""} ${player.isBot ? "bot" : ""} ${ready ? "ready" : "waiting"}`}
                aria-label={`${player.name}, ${seatStatus}`}
              >
                <div className="lobby-orbit-avatar">
                  {player.isBot ? <Bot size={17} /> : <UsersRound size={17} />}
                </div>
                <div className="lobby-orbit-copy">
                  <strong>{player.name}</strong>
                  <span>
                    {isViewer ? "You · " : ""}
                    {isHost ? "Host · " : ""}
                    {seatStatus}
                  </span>
                </div>
              </div>
            );
          })}

          {openSeats.map((slot) => (
            <span
              key={slot}
              className={`lobby-open-seat slot-${slot}`}
              aria-hidden="true"
            >
              <Plus size={9} />
            </span>
          ))}
        </div>

        <aside className="lobby-roster" aria-label="Players at the table">
          <div className="lobby-roster-heading">
            <span>At the table</span>
            <strong>
              {seatedCount} / {MAX_PLAYERS} seated
            </strong>
          </div>
          <div className="lobby-roster-list">
            {orderedPlayers.map((player) => {
              const isViewer = player.id === props.view.viewerPlayerId;
              const isHost = player.id === props.view.hostPlayerId;
              const ready = player.isBot || (player.connected && player.ready);
              const offline = !player.connected && !player.isBot;

              return (
                <div className="lobby-roster-row" key={player.id}>
                  <span
                    className={`lobby-roster-node ${isViewer ? "viewer" : ""} ${player.isBot ? "bot" : ""} ${offline ? "offline" : ""}`}
                    aria-hidden="true"
                  />
                  <div className="lobby-roster-name">
                    <strong>{player.name}</strong>
                    <span>
                      {isViewer
                        ? "You"
                        : player.isBot
                          ? "Adaptive bot"
                          : "Human player"}
                      {isHost ? " · Host" : ""}
                      {offline ? " · Offline" : ""}
                    </span>
                  </div>
                  <span
                    className={`lobby-roster-status ${ready ? "ready" : "waiting"}`}
                  >
                    {offline ? "offline" : ready ? "ready" : "waiting"}
                  </span>
                  {props.view.isViewerHost && !isHost && (
                    <button
                      className="lobby-remove-player"
                      aria-label={`Remove ${player.name}`}
                      title={`Remove ${player.name}`}
                      onClick={() => props.onRemovePlayer(player.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </aside>
      </section>

      <section
        className={`lobby-command-dock ${props.view.isViewerHost ? "host" : "guest"}`}
        aria-label="Lobby controls"
      >
        <div className="lobby-launch-state">
          <span>Launch state</span>
          <strong>{canStart ? "All players locked in" : tableHeading}</strong>
        </div>
        <button
          className={`lobby-ready-control ${viewer?.ready ? "active" : ""}`}
          aria-label={viewer?.ready ? "Ready" : "I am ready"}
          aria-pressed={Boolean(viewer?.ready)}
          onClick={() => props.onSetReady(!viewer?.ready)}
        >
          <UserRoundCheck size={18} />
          <span>{viewer?.ready ? "You are ready" : "I am ready"}</span>
          <span className="lobby-ready-switch" aria-hidden="true" />
        </button>
        {props.view.isViewerHost && (
          <button
            className="lobby-add-bot"
            aria-label="Add Bot"
            title="Add Bot"
            onClick={props.onAddBot}
          >
            <Bot size={18} />
            <span>Add Bot</span>
          </button>
        )}
        {props.view.isViewerHost && (
          <button
            className="lobby-start-game"
            aria-label="Start"
            disabled={!canStart}
            onClick={props.onStartGame}
          >
            <Sparkles size={18} />
            <span>Deal the table</span>
          </button>
        )}
      </section>
    </main>
  );
}

function GameTable(props: {
  reducedEffects: boolean;
  view: PrivateGameView;
  onCallBullshit: () => void;
  onOpenClaimPicker: () => void;
  onOpenLastRound: () => void;
  onOpenReactions: () => void;
}) {
  const tablePlayers = props.view.players
    .filter((player) => player.leftAt === undefined)
    .sort((left, right) => left.seatIndex - right.seatIndex);
  const currentClaimant = playerName(
    props.view.players,
    props.view.currentClaim?.playerId,
  );
  const currentTurn = playerName(
    props.view.players,
    props.view.currentTurnPlayerId,
  );
  const isGameOver = props.view.phase === "GameOver";
  const winnerName = playerName(props.view.players, props.view.winnerPlayerId);
  const turnHeading = isGameOver
    ? `${winnerName} wins`
    : props.view.phase === "RoundActive"
      ? `Waiting for ${currentTurn}'s move`
      : "Revealing the round";
  const previousClaim = props.view.currentClaim
    ? `Previous claim by ${currentClaimant}: ${formatClaim(props.view.currentClaim)}`
    : isGameOver
      ? "Last player standing"
      : "No previous claim yet";
  const phaseLabel =
    props.view.phase === "RoundActive"
      ? "In play"
      : props.view.phase === "ResolvingRound"
        ? "Review"
        : "Game over";
  const isFinalDecision = Boolean(
    props.view.currentClaim &&
    props.view.currentTurnPlayerId === props.view.viewerPlayerId &&
    (props.view.finalDecisionPlayerId ?? props.view.startingPlayerId) ===
      props.view.viewerPlayerId,
  );
  const latestReaction = props.view.reactions?.at(-1);

  return (
    <main className="table-layout">
      <section className="opponent-rail" aria-label="Players">
        {tablePlayers.map((player) => (
          <PlayerSeat
            key={player.id}
            player={player}
            active={player.id === props.view.currentTurnPlayerId}
            isViewer={player.id === props.view.viewerPlayerId}
            isHost={player.id === props.view.hostPlayerId}
            isRoundStarter={player.id === props.view.startingPlayerId}
            compact
          />
        ))}
      </section>

      {latestReaction && Date.now() - latestReaction.createdAt < 12_000 && (
        <div className="reaction-toast" role="status">
          <span>{reactionSymbol(latestReaction.kind)}</span>
          <strong>
            {playerName(props.view.players, latestReaction.playerId)}
          </strong>
          <small>{reactionLabel(latestReaction.kind)}</small>
        </div>
      )}

      <section className={`claim-zone ${props.view.phase.toLowerCase()}`}>
        <Suspense fallback={null}>
          <LivingTableScene
            reducedEffects={props.reducedEffects}
            variant="game"
            view={props.view}
          />
        </Suspense>
        <div className="claim-orbit" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="claim-meta">
          <span>Round {props.view.roundNumber}</span>
          <span>{phaseLabel}</span>
        </div>
        <div className="claim-core-card">
          {isGameOver && (
            <div className="winner-mark" aria-label="Game winner">
              <Trophy size={30} />
            </div>
          )}
          <span className="claim-core-label">Claim Core</span>
          <h2>{turnHeading}</h2>
          <div className="claim-byline">{previousClaim}</div>
        </div>

        <ClaimTimeline view={props.view} />

        <div
          className={`table-actions ${isGameOver ? "game-over-actions" : ""}`}
        >
          {!isGameOver && (
            <>
              <button
                className="primary-action compact"
                disabled={
                  !props.view.canViewerAct || props.view.phase !== "RoundActive"
                }
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
            </>
          )}
          {props.view.lastRoundResult && (
            <button
              className="secondary-action compact"
              onClick={props.onOpenLastRound}
            >
              <Eye size={18} />
              Last Round
            </button>
          )}
          <button
            className="icon-button reaction-trigger"
            aria-label="React"
            title="React"
            onClick={props.onOpenReactions}
          >
            <SmilePlus size={19} />
          </button>
          {props.view.phase === "ResolvingRound" && (
            <div className="auto-next-notice">
              Next round starts automatically
            </div>
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
  isViewer?: boolean;
  isHost?: boolean;
  isRoundStarter?: boolean;
  showReady?: boolean;
  canRemove?: boolean;
  onRemove?: () => void;
}) {
  const statusText =
    props.player.leftAt !== undefined
      ? "Left game"
      : props.player.eliminated
        ? "Eliminated"
        : cardCountLabel(props.player.cardCount);
  const compactStyle = props.compact
    ? compactSeatStyle(
        props.player.name,
        [
          props.isViewer,
          props.isHost,
          !props.player.connected &&
            !props.player.eliminated &&
            props.player.leftAt === undefined,
        ].filter(Boolean).length,
      )
    : undefined;

  return (
    <div
      className={`player-seat ${props.active ? "active" : ""} ${props.compact ? "compact" : ""}`}
      style={compactStyle}
    >
      <div className="seat-avatar">
        {props.player.isBot ? <Bot size={18} /> : <UsersRound size={18} />}
      </div>
      {props.isRoundStarter && props.compact && (
        <Star size={14} className="starter-star" aria-label="Round starter" />
      )}
      <div className="seat-copy">
        <strong className="seat-name-row">
          <span>{props.player.name}</span>
          {props.isRoundStarter && !props.compact && (
            <Star
              size={14}
              className="starter-star"
              aria-label="Round starter"
            />
          )}
        </strong>
        <span>{statusText}</span>
      </div>
      <div className="seat-badges">
        {props.showReady && !props.player.isBot && (
          <span
            className={`seat-flag ${props.player.ready ? "ready" : "waiting"}`}
          >
            {props.player.ready ? "ready" : "waiting"}
          </span>
        )}
        {props.isViewer && <span className="seat-flag you">you</span>}
        {props.isHost && <span className="seat-flag host">host</span>}
        {!props.player.connected &&
          !props.player.eliminated &&
          props.player.leftAt === undefined && (
            <span className="seat-flag">offline</span>
          )}
      </div>
      {props.canRemove && (
        <button
          className="seat-remove"
          aria-label={`Remove ${props.player.name}`}
          onClick={props.onRemove}
        >
          <Trash2 size={16} />
        </button>
      )}
    </div>
  );
}

type CompactSeatStyle = CSSProperties & {
  "--compact-seat-width": string;
  "--compact-badge-padding": string;
};

function compactSeatStyle(name: string, badgeCount: number): CompactSeatStyle {
  const visibleChars = Math.max(3, Array.from(name.trim()).length);
  const badgeLane =
    badgeCount > 0 ? 8 + badgeCount * 18 + (badgeCount - 1) * 3 : 0;
  const preferredWidth = Math.round(
    Math.min(380, Math.max(154, 100 + visibleChars * 8.8 + badgeLane)),
  );

  return {
    "--compact-seat-width": `min(${preferredWidth}px, 86vw)`,
    "--compact-badge-padding": `${badgeLane > 0 ? badgeLane + 8 : 10}px`,
  };
}

function ClaimTimeline(props: { view: PrivateGameView }) {
  const claims = props.view.claimHistory;
  return (
    <div className="claim-timeline">
      {claims.length === 0 ? (
        <span className="timeline-empty">No claims</span>
      ) : (
        claims.map((claim, index) => (
          <div
            key={claim.id ?? claimKey(claim)}
            className="timeline-item"
            style={{ "--timeline-index": index } as CSSProperties}
          >
            <i className="timeline-dot" aria-hidden="true" />
            <span>{playerName(props.view.players, claim.playerId)}</span>
            <strong>{compactClaim(claim)}</strong>
          </div>
        ))
      )}
    </div>
  );
}

type ClaimGroup = {
  handType: HandType;
  label: string;
  claims: ClaimTemplate[];
};

const SUIT_LABELS: Record<Suit, string> = {
  S: "♠ Spades",
  H: "♥ Hearts",
  D: "♦ Diamonds",
  C: "♣ Clubs",
};

function usesStructuredClaimBuilder(handType: HandType): boolean {
  return (
    handType === "HIGH_CARD" ||
    handType === "PAIR" ||
    handType === "TWO_PAIR" ||
    handType === "THREE_OF_A_KIND" ||
    handType === "STRAIGHT" ||
    handType === "FLUSH" ||
    handType === "FULL_HOUSE" ||
    handType === "FOUR_OF_A_KIND" ||
    handType === "STRAIGHT_FLUSH"
  );
}

function usesSecondaryRank(handType: HandType): boolean {
  return handType === "TWO_PAIR" || handType === "FULL_HOUSE";
}

function usesSuit(handType: HandType): boolean {
  return handType === "FLUSH" || handType === "STRAIGHT_FLUSH";
}

function uniqueRanks(
  claims: readonly ClaimTemplate[],
  rankKey: "primaryRank" | "secondaryRank",
): Rank[] {
  const seen = new Set<Rank>();
  const ranks: Rank[] = [];
  for (const claim of claims) {
    const rank = claim[rankKey];
    if (!rank || seen.has(rank)) continue;
    seen.add(rank);
    ranks.push(rank);
  }
  return ranks;
}

function uniqueSuits(claims: readonly ClaimTemplate[]): Suit[] {
  const seen = new Set<Suit>();
  const suits: Suit[] = [];
  for (const claim of claims) {
    if (!claim.suit || seen.has(claim.suit)) continue;
    seen.add(claim.suit);
    suits.push(claim.suit);
  }
  return suits;
}

function rankSelectLabel(handType: HandType, rankKey: "primary" | "secondary") {
  if (handType === "HIGH_CARD") {
    return "Card Rank";
  }
  if (handType === "FULL_HOUSE") {
    return rankKey === "primary" ? "Three Rank" : "Pair Rank";
  }
  if (handType === "TWO_PAIR") {
    return rankKey === "primary" ? "High Pair" : "Low Pair";
  }
  if (handType === "THREE_OF_A_KIND") {
    return "Three Rank";
  }
  if (handType === "STRAIGHT" || handType === "STRAIGHT_FLUSH") {
    return "High Rank";
  }
  if (handType === "FLUSH") {
    return "High Rank";
  }
  if (handType === "FOUR_OF_A_KIND") {
    return "Four Rank";
  }
  return "Pair Rank";
}

function rankOptionLabel(handType: HandType, rank: Rank): string {
  if (handType === "HIGH_CARD") {
    return `${RANK_SHORT[rank]} high`;
  }
  if (handType === "STRAIGHT" || handType === "STRAIGHT_FLUSH") {
    return `${RANK_SHORT[rank]}-high`;
  }
  if (handType === "FLUSH") {
    return `${RANK_SHORT[rank]}-high`;
  }
  return RANK_WORDS[rank];
}

function StructuredClaimBuilder(props: {
  group: ClaimGroup;
  onSubmit: (claim: ClaimTemplate) => void;
}) {
  const primaryRanks = useMemo(
    () => uniqueRanks(props.group.claims, "primaryRank"),
    [props.group.claims],
  );
  const [primaryRank, setPrimaryRank] = useState<Rank | "">(
    primaryRanks[0] ?? "",
  );
  const needsSecondaryRank = usesSecondaryRank(props.group.handType);
  const needsSuit = usesSuit(props.group.handType);
  const secondaryRanks = useMemo(() => {
    if (!needsSecondaryRank) return [];
    return uniqueRanks(
      props.group.claims.filter((claim) => claim.primaryRank === primaryRank),
      "secondaryRank",
    );
  }, [needsSecondaryRank, primaryRank, props.group.claims]);
  const [secondaryRank, setSecondaryRank] = useState<Rank | "">(
    secondaryRanks[0] ?? "",
  );
  const suitOptions = useMemo(() => {
    if (!needsSuit) return [];
    return uniqueSuits(
      props.group.claims.filter((claim) => claim.primaryRank === primaryRank),
    );
  }, [needsSuit, primaryRank, props.group.claims]);
  const [suit, setSuit] = useState<Suit | "">(suitOptions[0] ?? "");

  useEffect(() => {
    if (primaryRank && primaryRanks.includes(primaryRank)) return;
    setPrimaryRank(primaryRanks[0] ?? "");
  }, [primaryRank, primaryRanks]);

  useEffect(() => {
    if (!needsSecondaryRank) {
      setSecondaryRank("");
      return;
    }
    if (secondaryRank && secondaryRanks.includes(secondaryRank)) return;
    setSecondaryRank(secondaryRanks[0] ?? "");
  }, [needsSecondaryRank, secondaryRank, secondaryRanks]);

  useEffect(() => {
    if (!needsSuit) {
      setSuit("");
      return;
    }
    if (suit && suitOptions.includes(suit)) return;
    setSuit(suitOptions[0] ?? "");
  }, [needsSuit, suit, suitOptions]);

  const selectedClaim = props.group.claims.find((claim) => {
    if (claim.primaryRank !== primaryRank) return false;
    if (needsSecondaryRank && claim.secondaryRank !== secondaryRank)
      return false;
    if (needsSuit && claim.suit !== suit) return false;
    return true;
  });

  return (
    <div className="structured-claim-builder">
      <div className="claim-preview-card">
        <span>Claim Preview</span>
        <strong>{selectedClaim ? compactClaim(selectedClaim) : "..."}</strong>
        <small>
          {selectedClaim ? formatClaim(selectedClaim) : "Select a legal claim"}
        </small>
      </div>

      <div className="claim-select-grid">
        <label>
          <span>{rankSelectLabel(props.group.handType, "primary")}</span>
          <select
            value={primaryRank}
            onChange={(event) => setPrimaryRank(event.target.value as Rank)}
          >
            {primaryRanks.map((rank) => (
              <option key={rank} value={rank}>
                {rankOptionLabel(props.group.handType, rank)}
              </option>
            ))}
          </select>
        </label>

        {needsSecondaryRank && (
          <label>
            <span>{rankSelectLabel(props.group.handType, "secondary")}</span>
            <select
              value={secondaryRank}
              onChange={(event) => setSecondaryRank(event.target.value as Rank)}
            >
              {secondaryRanks.map((rank) => (
                <option key={rank} value={rank}>
                  {rankOptionLabel(props.group.handType, rank)}
                </option>
              ))}
            </select>
          </label>
        )}

        {needsSuit && (
          <label>
            <span>Suit</span>
            <select
              value={suit}
              onChange={(event) => setSuit(event.target.value as Suit)}
            >
              {suitOptions.map((option) => (
                <option key={option} value={option}>
                  {SUIT_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <button
        className="primary-action structured-submit"
        disabled={!selectedClaim}
        onClick={() => selectedClaim && props.onSubmit(selectedClaim)}
      >
        <Plus size={18} />
        {selectedClaim ? formatClaim(selectedClaim) : "Select Claim"}
      </button>
    </div>
  );
}

function ClaimPicker(props: {
  view: PrivateGameView;
  onClose: () => void;
  onSubmit: (claim: ClaimTemplate) => void;
}) {
  const groups = useMemo(
    () => legalClaimsByHandType(props.view.currentClaim),
    [props.view.currentClaim],
  );
  const [activeType, setActiveType] = useState(groups[0]?.handType);
  const activeGroup =
    groups.find((group) => group.handType === activeType) ?? groups[0] ?? null;
  const isFinalDecision = Boolean(
    props.view.currentClaim &&
    props.view.currentTurnPlayerId === props.view.viewerPlayerId &&
    (props.view.finalDecisionPlayerId ?? props.view.startingPlayerId) ===
      props.view.viewerPlayerId,
  );

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true">
      <section className="claim-sheet">
        <div className="sheet-scanline" aria-hidden="true" />
        <header className="sheet-header">
          <div>
            <span>{isFinalDecision ? "Final Claim" : "Make Claim"}</span>
            <h3>{formatClaim(props.view.currentClaim)}</h3>
          </div>
          <button
            className="icon-button"
            aria-label="Close claim builder"
            title="Close claim builder"
            onClick={props.onClose}
          >
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
                  className={
                    group.handType === activeGroup.handType ? "active" : ""
                  }
                  onClick={() => setActiveType(group.handType)}
                >
                  {group.label}
                </button>
              ))}
            </div>

            {usesStructuredClaimBuilder(activeGroup.handType) ? (
              <StructuredClaimBuilder
                key={activeGroup.handType}
                group={activeGroup}
                onSubmit={props.onSubmit}
              />
            ) : (
              <div className="claim-options">
                {activeGroup.claims.map((claim) => (
                  <button
                    key={claimKey(claim)}
                    onClick={() => props.onSubmit(claim)}
                  >
                    <span>{compactClaim(claim)}</span>
                    <strong>{formatClaim(claim)}</strong>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function LastRoundSheet(props: { view: PrivateGameView; onClose: () => void }) {
  const result = props.view.lastRoundResult!;
  const proofIds = new Set(result.proofCardIds ?? []);
  const truthTone =
    result.claimWasTrue === undefined
      ? "neutral"
      : result.claimWasTrue
        ? "true"
        : "false";
  const truthLabel =
    result.claimWasTrue === undefined
      ? result.reason
      : result.claimWasTrue
        ? "True Claim"
        : "False Claim";

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true">
      <section className="review-sheet">
        <div className="sheet-scanline" aria-hidden="true" />
        <header className="sheet-header">
          <div>
            <span>Round {result.roundNumber}</span>
            <h3>{result.claim ? formatClaim(result.claim) : result.reason}</h3>
          </div>
          <button
            className="icon-button"
            aria-label="Close last round"
            title="Close last round"
            onClick={props.onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className={`truth-stage ${truthTone}`}>
          <span>Truth Reveal</span>
          <strong>{truthLabel}</strong>
          <small>
            {result.penaltyPlayerId
              ? `${playerName(props.view.players, result.penaltyPlayerId)} takes the card`
              : "No penalty this round"}
          </small>
        </div>

        <div className="result-summary">
          <ResultLine
            label="BullShit called by"
            value={
              result.callerPlayerId
                ? playerName(props.view.players, result.callerPlayerId)
                : "No one"
            }
          />
          <ResultLine
            label="Claimed by"
            value={playerName(props.view.players, result.claimantPlayerId)}
          />
        </div>

        <div className="revealed-groups">
          {result.revealedHands.map((hand) => (
            <div
              key={hand.playerId}
              className={`revealed-group ${hand.playerId === result.penaltyPlayerId ? "penalty" : ""}`}
            >
              <strong>{playerName(props.view.players, hand.playerId)}</strong>
              <div className="mini-card-row">
                {hand.cards.map((card) => (
                  <span
                    key={card.id}
                    className={`mini-card ${cardTone(card)} ${proofIds.has(card.id) ? "proof" : ""}`}
                  >
                    {formatCard(card)}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {props.view.phase === "ResolvingRound" && (
          <div className="auto-next-sheet">
            Next round starts automatically after this reveal.
          </div>
        )}
      </section>
    </div>
  );
}

const REACTION_OPTIONS: ReactionKind[] = [
  "NICE_BLUFF",
  "SUSPICIOUS",
  "BOLD",
  "WOW",
  "GOOD_CALL",
];

function reactionSymbol(kind: ReactionKind): string {
  return {
    NICE_BLUFF: "♠",
    SUSPICIOUS: "?",
    BOLD: "!",
    WOW: "♦",
    GOOD_CALL: "✓",
  }[kind];
}

function reactionLabel(kind: ReactionKind): string {
  return {
    NICE_BLUFF: "Nice bluff",
    SUSPICIOUS: "Suspicious",
    BOLD: "Bold move",
    WOW: "What a claim",
    GOOD_CALL: "Good call",
  }[kind];
}

function ReactionDock(props: {
  onClose: () => void;
  onReact: (kind: ReactionKind) => void;
}) {
  return (
    <aside className="reaction-dock" aria-label="Table reactions">
      <div className="reaction-dock-head">
        <strong>Table reaction</strong>
        <button
          className="icon-button"
          aria-label="Close reactions"
          onClick={props.onClose}
        >
          <X size={16} />
        </button>
      </div>
      <div className="reaction-grid">
        {REACTION_OPTIONS.map((kind) => (
          <button key={kind} onClick={() => props.onReact(kind)}>
            <span>{reactionSymbol(kind)}</span>
            <small>{reactionLabel(kind)}</small>
          </button>
        ))}
      </div>
    </aside>
  );
}

function ConfirmDialog(props: {
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  tone?: "default" | "danger";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="sheet-backdrop centered"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <section
        className={`confirm-card ${props.tone === "danger" ? "danger" : ""}`}
      >
        <div className="confirm-icon" aria-hidden="true">
          {props.tone === "danger" ? (
            <Flag size={24} />
          ) : (
            <DoorOpen size={24} />
          )}
        </div>
        <h3 id="confirm-title">{props.title}</h3>
        <p>{props.description}</p>
        <div className="confirm-actions">
          <button
            className="secondary-action compact"
            disabled={props.busy}
            onClick={props.onCancel}
          >
            No
          </button>
          <button
            className={
              props.tone === "danger"
                ? "danger-action"
                : "primary-action compact"
            }
            disabled={props.busy}
            onClick={props.onConfirm}
          >
            {props.busy ? "Leaving..." : props.confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function SettingsSheet(props: {
  hapticsAvailable: boolean;
  preferences: Preferences;
  onChange: (preferences: Preferences) => void;
  onClose: () => void;
}) {
  function toggle(key: keyof Preferences) {
    props.onChange({
      ...props.preferences,
      [key]: !props.preferences[key],
    });
  }

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Table settings"
    >
      <section className="utility-sheet">
        <header className="sheet-header">
          <div>
            <span>Personal controls</span>
            <h3>Table settings</h3>
          </div>
          <button
            className="icon-button"
            aria-label="Close settings"
            onClick={props.onClose}
          >
            <X size={18} />
          </button>
        </header>
        <button className="setting-row" onClick={() => toggle("sound")}>
          <Volume2 size={20} />
          <span>
            <strong>Sound effects</strong>
            <small>Claims, reveals, and calls</small>
          </span>
          <i
            className={props.preferences.sound ? "on" : ""}
            aria-label={props.preferences.sound ? "On" : "Off"}
          />
        </button>
        <button
          className="setting-row"
          disabled={!props.hapticsAvailable}
          onClick={() => toggle("haptics")}
        >
          <Vibrate size={20} />
          <span>
            <strong>Haptics</strong>
            <small>
              {props.hapticsAvailable
                ? "Short tactile table cues"
                : "Unavailable in this browser"}
            </small>
          </span>
          <i
            className={
              props.preferences.haptics && props.hapticsAvailable ? "on" : ""
            }
            aria-label={
              props.preferences.haptics && props.hapticsAvailable ? "On" : "Off"
            }
          />
        </button>
        <button
          className="setting-row"
          onClick={() => toggle("reducedEffects")}
        >
          <Sparkles size={20} />
          <span>
            <strong>Reduced effects</strong>
            <small>Quieter motion and lighting</small>
          </span>
          <i
            className={props.preferences.reducedEffects ? "on" : ""}
            aria-label={props.preferences.reducedEffects ? "On" : "Off"}
          />
        </button>
      </section>
    </div>
  );
}

function ShareSheet(props: { view: PrivateGameView; onClose: () => void }) {
  const shareUrl = `${window.location.origin}/?room=${encodeURIComponent(props.view.code)}`;
  const [qrCode, setQrCode] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(shareUrl, {
      width: 360,
      margin: 1,
      color: { dark: "#090b18", light: "#f7f8ff" },
    }).then((value) => active && setQrCode(value));
    return () => {
      active = false;
    };
  }, [shareUrl]);

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "BullShit Poker",
          text: `Join room ${props.view.code}`,
          url: shareUrl,
        });
        return;
      } catch {
        // A cancelled native share simply leaves this sheet open.
      }
    }
    setCopied(await copyTextToClipboard(shareUrl));
  }

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Share room"
    >
      <section className="utility-sheet share-sheet">
        <header className="sheet-header">
          <div>
            <span>Invite your table</span>
            <h3>Room {props.view.code}</h3>
          </div>
          <button
            className="icon-button"
            aria-label="Close sharing"
            onClick={props.onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="qr-stage">
          {qrCode ? (
            <img src={qrCode} alt={`QR code for room ${props.view.code}`} />
          ) : (
            <span>Building code...</span>
          )}
        </div>
        <button className="primary-action" onClick={share}>
          {copied ? <Check size={18} /> : <Share2 size={18} />}
          {copied ? "Link copied" : "Share invite"}
        </button>
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
