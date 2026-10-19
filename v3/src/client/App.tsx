import {
  useCallback,
  useEffect,
  lazy,
  useMemo,
  useRef,
  useState,
  Suspense,
  Component,
  type ReactNode,
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
  ReactionEvent,
  ReactionKind,
  RoomClientMessage,
  RoomServerMessage,
  RoundResult,
  Suit,
} from "../shared/index.ts";
import { MAX_PLAYERS } from "../shared/index.ts";
import { deriveVisualEvents, visualEventBus } from "./visualEvents.ts";

const KineticScene = lazy(() => import("./KineticScene"));
const LivingTableScene = lazy(() => import("./LivingTableScene"));

class SceneBoundary extends Component<
  { children: ReactNode; entry?: boolean },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div
        className={
          this.props.entry ? "kinetic-scene-fallback" : "living-table-fallback"
        }
        data-scene-fallback="true"
        aria-hidden="true"
      />
    ) : (
      this.props.children
    );
  }
}

const STORAGE_KEY = "bullshit-poker-v3-seat";
const PREFERENCES_KEY = "bullshit-poker-v3-preferences";
const REACTION_VISIBLE_MS = 3_000;
const ROUND_RESULT_VISIBLE_MS = 4_500;
const SOCKET_CONNECT_TIMEOUT_MS = 12_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
const RECONNECT_DELAYS_MS = [0, 1_000, 2_000, 4_000, 8_000, 15_000] as const;

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
    const saved = JSON.parse(
      localStorage.getItem(PREFERENCES_KEY) ?? "{}",
    ) as Partial<Preferences>;
    return {
      sound:
        typeof saved.sound === "boolean"
          ? saved.sound
          : DEFAULT_PREFERENCES.sound,
      haptics:
        typeof saved.haptics === "boolean"
          ? saved.haptics
          : DEFAULT_PREFERENCES.haptics,
      reducedEffects:
        typeof saved.reducedEffects === "boolean"
          ? saved.reducedEffects
          : DEFAULT_PREFERENCES.reducedEffects,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function persistPreferences(preferences: Preferences): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // Preferences are enhancement-only when storage is unavailable.
  }
}

type ConnectionStatus =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "offline";
type EntryMode = "create" | "join";
type RoomCodeCopyState = "idle" | "copied" | "selected";
type ActiveOverlay =
  | "claim"
  | "last-round"
  | "leave"
  | "end-game"
  | "share"
  | "settings"
  | "reactions"
  | null;
type PendingMutation = {
  requestId: string;
  stateRevision: number;
};

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
    case "reconnecting":
      return "Reconnecting";
    case "offline":
      return "Offline";
    case "idle":
      return "Not connected";
  }
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(credential));
  } catch {
    // The current tab still owns the live credential when storage is blocked.
  }
}

function loadCredential(): SeatCredential | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<SeatCredential>;
    if (
      typeof parsed.code !== "string" ||
      !/^[A-Z0-9]{6}$/.test(parsed.code) ||
      typeof parsed.playerId !== "string" ||
      parsed.playerId.length === 0 ||
      typeof parsed.reconnectToken !== "string" ||
      parsed.reconnectToken.length === 0 ||
      typeof parsed.name !== "string"
    ) {
      return null;
    }
    return parsed as SeatCredential;
  } catch {
    return null;
  }
}

function removeCredential(ownedCredential: SeatCredential | null): void {
  try {
    if (
      ownedCredential &&
      loadCredential()?.reconnectToken === ownedCredential.reconnectToken
    ) {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // An in-memory reset is still sufficient for this tab.
  }
}

function friendlyError(code: string): string {
  const messages: Record<string, string> = {
    ROOM_NOT_FOUND: "That room could not be found.",
    ROOM_FULL: "That table is full.",
    NOT_ENOUGH_PLAYERS: "At least two players are needed to start.",
    GAME_ALREADY_STARTED: "That game has already started.",
    NAME_TAKEN: "That player name is already seated.",
    PIN_REQUIRED: "Enter your four-digit PIN.",
    INVALID_PIN_FORMAT: "The PIN must contain exactly four digits.",
    PIN_MISMATCH: "That name and PIN do not match.",
    NOT_HOST: "Only the host can do that.",
    NOT_READY: "Every connected human player must be ready.",
    NOT_CURRENT_TURN: "The turn changed before that action arrived.",
    PLAYER_ELIMINATED: "Eliminated players can only observe the table.",
    PLAYER_LEFT_MATCH: "You already left this match.",
    MATCH_CHANGED: "The table has moved to a different match.",
    NO_CURRENT_CLAIM: "There is no claim to challenge.",
    CLAIM_NOT_HIGHER: "Choose a claim that is strictly higher.",
    STALE_TURN: "The turn changed before that action arrived.",
    STALE_STATE_REVISION: "The table changed. Your view is now up to date.",
    STALE_CLAIM_WINDOW: "That claim is no longer open for a challenge.",
    CLAIM_WINDOW_CLOSED: "Another action already closed that claim.",
    CLAIMANT_CANNOT_CALL: "You cannot call BullShit on your own claim.",
    ROUND_ALREADY_RESOLVED: "That round has already finished.",
    REACTION_RATE_LIMITED: "Give the table a moment before reacting again.",
    ROOM_CLOSED: "That room is no longer available.",
    INTERNAL_ERROR: "The table could not complete that action. Try again.",
  };
  return messages[code] ?? code.replaceAll("_", " ").toLowerCase();
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
  const normalizedSharedRoomCode = normalizedCode(sharedRoomCode ?? "");
  const [entryMode, setEntryMode] = useState<EntryMode>(
    sharedRoomCode ? "join" : "create",
  );
  const [displayName, setDisplayName] = useState("");
  const [pin, setPin] = useState("");
  const [roomCode, setRoomCode] = useState(() => normalizedSharedRoomCode);
  const [credential, setCredential] = useState<SeatCredential | null>(() => {
    const saved = loadCredential();
    if (
      saved &&
      normalizedSharedRoomCode &&
      saved.code !== normalizedSharedRoomCode
    ) {
      return null;
    }
    return saved;
  });
  const [view, setView] = useState<PrivateGameView | null>(null);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("idle");
  const [entryPending, setEntryPending] = useState(false);
  const [notice, setNotice] = useState<string>("");
  const [roomCodeCopyState, setRoomCodeCopyState] =
    useState<RoomCodeCopyState>("idle");
  const [activeOverlay, setActiveOverlay] = useState<ActiveOverlay>(null);
  const [leavePending, setLeavePending] = useState(false);
  const [pendingMutation, setPendingMutation] =
    useState<PendingMutation | null>(null);
  const [visibleReaction, setVisibleReaction] = useState<ReactionEvent | null>(
    null,
  );
  const [visibleRoundResult, setVisibleRoundResult] =
    useState<RoundResult | null>(null);
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences);
  const socketRef = useRef<WebSocket | null>(null);
  const socketGenerationRef = useRef(0);
  const acceptedGenerationRef = useRef<number | null>(null);
  const latestViewRef = useRef<PrivateGameView | null>(null);
  const credentialRef = useRef<SeatCredential | null>(credential);
  const preferencesRef = useRef(preferences);
  const entryRequestPendingRef = useRef(false);
  const leaveRequestIdRef = useRef<string | null>(null);
  const leaveMatchIdRef = useRef<string | null>(null);
  const pendingMutationRef = useRef<PendingMutation | null>(null);
  const historyGuardRef = useRef(false);
  const mountedRef = useRef(false);
  const reconnectAllowedRef = useRef(Boolean(credential));
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | undefined>(undefined);
  const connectTimeoutRef = useRef<number | undefined>(undefined);
  const heartbeatTimerRef = useRef<number | undefined>(undefined);
  const pendingHeartbeatRef = useRef<
    | {
        requestId: string;
        sentAt: number;
      }
    | undefined
  >(undefined);
  const connectLiveRef = useRef<(credential: SeatCredential) => void>(
    () => undefined,
  );
  const scheduleReconnectRef = useRef<(immediate?: boolean) => void>(
    () => undefined,
  );
  const isInRoom = view !== null;
  const tableInteractive =
    connectionStatus === "open" && !pendingMutation && !leavePending;
  const hapticsAvailable = supportsHaptics();

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== undefined) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = undefined;
    }
  }, []);

  const clearSocketHealthTimers = useCallback(() => {
    if (connectTimeoutRef.current !== undefined) {
      window.clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = undefined;
    }
    if (heartbeatTimerRef.current !== undefined) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = undefined;
    }
    pendingHeartbeatRef.current = undefined;
  }, []);

  const clearPendingMutation = useCallback(() => {
    pendingMutationRef.current = null;
    setPendingMutation(null);
  }, []);

  const beginMutation = useCallback(
    (requestIdValue: string, stateRevision: number) => {
      const pending = { requestId: requestIdValue, stateRevision };
      pendingMutationRef.current = pending;
      setPendingMutation(pending);
    },
    [],
  );

  useEffect(() => {
    preferencesRef.current = preferences;
    persistPreferences(preferences);
    document.documentElement.dataset.reducedEffects = preferences.reducedEffects
      ? "true"
      : "false";
  }, [preferences]);

  useEffect(() => {
    const reactionId = visibleReaction?.id;
    if (!reactionId) return;
    const timer = window.setTimeout(() => {
      setVisibleReaction((current) =>
        current?.id === reactionId ? null : current,
      );
    }, REACTION_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [visibleReaction?.id]);

  useEffect(() => {
    const resultId = visibleRoundResult?.id;
    if (!resultId) return;
    const timer = window.setTimeout(() => {
      setVisibleRoundResult((current) =>
        current?.id === resultId ? null : current,
      );
    }, ROUND_RESULT_VISIBLE_MS);
    playHaptic(preferencesRef.current.haptics, [18, 35, 28]);
    if (preferencesRef.current.sound) {
      playSignalTone(visibleRoundResult.claimWasTrue ? 520 : 220);
    }
    return () => window.clearTimeout(timer);
  }, [visibleRoundResult?.id]);

  useEffect(() => {
    if (!notice || !view || leavePending) return;
    const timer = window.setTimeout(() => setNotice(""), 5_000);
    return () => window.clearTimeout(timer);
  }, [leavePending, notice, view]);

  useEffect(() => {
    if (!isInRoom || historyGuardRef.current) return;
    historyGuardRef.current = true;
    window.history.pushState(
      { bullshitPokerV3: true },
      "",
      window.location.href,
    );
    const handlePopState = () => {
      setActiveOverlay("leave");
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
    if (!activeOverlay) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const selector =
      activeOverlay === "reactions" ? ".reaction-dock" : ".sheet-backdrop";
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`${selector} button:not(:disabled)`)
        ?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !leavePending) {
        event.preventDefault();
        setActiveOverlay(null);
        return;
      }
      if (event.key !== "Tab") return;
      const root = document.querySelector<HTMLElement>(selector);
      const controls = [
        ...(root?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? []),
      ];
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls.at(-1)!;
      if (!root?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const background = [
      ...document.querySelectorAll<HTMLElement>(".app-shell > *"),
    ].filter((element) => !element.matches(selector));
    const inertStates = background.map((element) => element.inert);
    background.forEach((element) => {
      element.inert = true;
    });
    document.body.dataset.overlayOpen = "true";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      delete document.body.dataset.overlayOpen;
      background.forEach((element, index) => {
        element.inert = inertStates[index];
      });
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [activeOverlay, leavePending]);

  useEffect(() => {
    if (!view) {
      setActiveOverlay(null);
      return;
    }
    if (
      activeOverlay === "claim" &&
      (!view.canViewerAct || view.phase !== "RoundActive" || !tableInteractive)
    ) {
      setActiveOverlay(null);
    } else if (activeOverlay === "last-round" && !view.lastRoundResult) {
      setActiveOverlay(null);
    } else if (
      activeOverlay === "end-game" &&
      (!view.isViewerHost || view.phase === "GameOver" || !tableInteractive)
    ) {
      setActiveOverlay(null);
    } else if (activeOverlay === "reactions" && !tableInteractive) {
      setActiveOverlay(null);
    }
  }, [activeOverlay, tableInteractive, view]);

  const acceptView = useCallback(
    (nextView: PrivateGameView, synchronize = false): boolean => {
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
      const events = deriveVisualEvents(
        synchronize ? null : currentView,
        nextView,
      );
      if (currentView && currentView.matchId !== nextView.matchId) {
        setActiveOverlay(null);
      } else if (
        currentView &&
        (synchronize ||
          currentView.roundNumber !== nextView.roundNumber ||
          currentView.currentTurnId !== nextView.currentTurnId ||
          currentView.activeClaimWindow?.id !== nextView.activeClaimWindow?.id)
      ) {
        setActiveOverlay((current) => (current === "claim" ? null : current));
      }
      if (synchronize || currentView?.matchId !== nextView.matchId) {
        setVisibleReaction(null);
        setVisibleRoundResult(null);
        visualEventBus.reset();
      }
      for (const event of events) {
        if (event.kind === "REACTION") {
          setVisibleReaction(event.reaction);
        }
        if (event.kind === "ROUND_REVEALED" && nextView.lastRoundResult) {
          setVisibleRoundResult(nextView.lastRoundResult);
        }
      }
      latestViewRef.current = nextView;
      setView(nextView);
      visualEventBus.publish(events);
      return true;
    },
    [],
  );

  const clearSeatSession = useCallback(
    (nextNotice = "", keepSavedSeat = false): void => {
      reconnectAllowedRef.current = false;
      clearReconnectTimer();
      clearSocketHealthTimers();
      socketGenerationRef.current += 1;
      acceptedGenerationRef.current = null;
      const ownedCredential = credentialRef.current;
      credentialRef.current = null;
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
      latestViewRef.current = null;
      visualEventBus.reset();
      if (!keepSavedSeat) removeCredential(ownedCredential);
      setCredential(null);
      setView(null);
      setConnectionStatus("idle");
      setLeavePending(false);
      setActiveOverlay(null);
      setVisibleReaction(null);
      setVisibleRoundResult(null);
      clearPendingMutation();
      leaveRequestIdRef.current = null;
      leaveMatchIdRef.current = null;
      setNotice(nextNotice);
    },
    [clearPendingMutation, clearReconnectTimer, clearSocketHealthTimers],
  );

  const handleServerMessage = useCallback(
    (message: RoomServerMessage, generation: number): void => {
      if (generation !== socketGenerationRef.current) return;
      pendingHeartbeatRef.current = undefined;
      if (message.type === "PONG") return;
      if (message.type === "SESSION_ACCEPTED") {
        acceptedGenerationRef.current = generation;
        if (connectTimeoutRef.current !== undefined) {
          window.clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = undefined;
        }
        reconnectAttemptRef.current = 0;
        setConnectionStatus("open");
        clearPendingMutation();
        if (acceptView(message.view, true)) setNotice("");
        const pendingLeaveRequestId = leaveRequestIdRef.current;
        if (
          pendingLeaveRequestId &&
          leaveMatchIdRef.current !== message.view.matchId
        ) {
          leaveRequestIdRef.current = null;
          leaveMatchIdRef.current = null;
          setLeavePending(false);
          setActiveOverlay(null);
          setNotice(
            "The match changed while reconnecting. You are still seated.",
          );
        } else if (pendingLeaveRequestId && leaveMatchIdRef.current) {
          setLeavePending(true);
          setActiveOverlay("leave");
          const sent = sendRoomMessage(socketRef.current, {
            type: "LEAVE_GAME",
            requestId: pendingLeaveRequestId,
            matchId: leaveMatchIdRef.current,
          });
          if (!sent) socketRef.current?.close();
        }
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
        setNotice(friendlyError(message.code));
        setConnectionStatus("reconnecting");
        socketRef.current?.close();
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
        const pending = pendingMutationRef.current;
        if (pending && message.requestId === pending.requestId) {
          clearPendingMutation();
          setNotice("");
        }
        return;
      }
      if (message.type === "ACTION_REJECTED") {
        if (
          message.requestId &&
          message.requestId === pendingMutationRef.current?.requestId
        ) {
          clearPendingMutation();
        }
        if (
          message.requestId &&
          message.requestId === leaveRequestIdRef.current
        ) {
          leaveRequestIdRef.current = null;
          leaveMatchIdRef.current = null;
          setLeavePending(false);
        }
        setNotice(friendlyError(message.code));
        if (message.view) {
          acceptView(message.view);
        }
      }
    },
    [acceptView, clearPendingMutation, clearSeatSession],
  );

  const scheduleReconnect = useCallback(
    (immediate = false): void => {
      const nextCredential = credentialRef.current;
      if (
        !mountedRef.current ||
        !reconnectAllowedRef.current ||
        !nextCredential
      ) {
        return;
      }
      if (navigator.onLine === false) {
        setConnectionStatus("offline");
        return;
      }
      if (reconnectTimerRef.current !== undefined) {
        if (!immediate) return;
        clearReconnectTimer();
      }

      const attempt = reconnectAttemptRef.current;
      const delay = immediate
        ? 0
        : RECONNECT_DELAYS_MS[
            Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)
          ];
      reconnectAttemptRef.current = Math.min(
        attempt + 1,
        RECONNECT_DELAYS_MS.length - 1,
      );
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = undefined;
        const currentCredential = credentialRef.current;
        if (currentCredential && reconnectAllowedRef.current) {
          connectLiveRef.current(currentCredential);
        }
      }, delay);
    },
    [clearReconnectTimer],
  );
  scheduleReconnectRef.current = scheduleReconnect;

  const connectLive = useCallback(
    (nextCredential: SeatCredential): void => {
      if (
        !reconnectAllowedRef.current ||
        credentialRef.current?.reconnectToken !== nextCredential.reconnectToken
      ) {
        return;
      }
      if (navigator.onLine === false) {
        setConnectionStatus("offline");
        return;
      }
      clearReconnectTimer();
      clearSocketHealthTimers();
      acceptedGenerationRef.current = null;
      const generation = socketGenerationRef.current + 1;
      socketGenerationRef.current = generation;
      const priorSocket = socketRef.current;
      socketRef.current = null;
      priorSocket?.close();

      setConnectionStatus(
        latestViewRef.current ? "reconnecting" : "connecting",
      );
      let socket: WebSocket;
      try {
        socket = connectRoomSocket(
          nextCredential,
          (message) => handleServerMessage(message, generation),
          (status) => {
            if (generation !== socketGenerationRef.current) return;
            if (status === "replaced") {
              clearSeatSession("Your seat is active in another tab.", true);
              return;
            }
            if (status === "open") {
              heartbeatTimerRef.current = window.setInterval(() => {
                if (document.hidden) return;
                const liveSocket = socketRef.current;
                if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) {
                  liveSocket?.close();
                  return;
                }
                const pendingPing = pendingHeartbeatRef.current;
                if (
                  pendingPing &&
                  Date.now() - pendingPing.sentAt >= HEARTBEAT_TIMEOUT_MS
                ) {
                  liveSocket.close(4001, "HEARTBEAT_TIMEOUT");
                  return;
                }
                const pingRequestId = requestId("ping");
                if (
                  sendRoomMessage(liveSocket, {
                    type: "PING",
                    requestId: pingRequestId,
                  })
                ) {
                  pendingHeartbeatRef.current = {
                    requestId: pingRequestId,
                    sentAt: Date.now(),
                  };
                }
              }, HEARTBEAT_INTERVAL_MS);
              return;
            }
            if (status === "error") {
              acceptedGenerationRef.current = null;
              setConnectionStatus("reconnecting");
              try {
                socket.close();
              } catch {
                scheduleReconnectRef.current();
              }
              return;
            }
            if (status === "closed") {
              acceptedGenerationRef.current = null;
              if (socketRef.current === socket) socketRef.current = null;
              clearSocketHealthTimers();
              setConnectionStatus(
                navigator.onLine === false ? "offline" : "reconnecting",
              );
              scheduleReconnectRef.current();
            }
          },
        );
      } catch {
        setConnectionStatus("reconnecting");
        scheduleReconnectRef.current();
        return;
      }
      socketRef.current = socket;
      connectTimeoutRef.current = window.setTimeout(() => {
        if (
          generation === socketGenerationRef.current &&
          acceptedGenerationRef.current !== generation
        ) {
          socket.close(4002, "CONNECT_TIMEOUT");
        }
      }, SOCKET_CONNECT_TIMEOUT_MS);
    },
    [
      clearReconnectTimer,
      clearSocketHealthTimers,
      clearSeatSession,
      handleServerMessage,
    ],
  );
  connectLiveRef.current = connectLive;

  useEffect(() => {
    credentialRef.current = credential;
    reconnectAllowedRef.current = Boolean(credential);
    reconnectAttemptRef.current = 0;
    if (credential) scheduleReconnect(true);
    else {
      clearReconnectTimer();
      clearSocketHealthTimers();
    }
  }, [
    clearReconnectTimer,
    clearSocketHealthTimers,
    credential,
    scheduleReconnect,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    reconnectAllowedRef.current = Boolean(credentialRef.current);
    scheduleReconnectRef.current(true);
    const handleOffline = () => {
      if (!credentialRef.current) return;
      acceptedGenerationRef.current = null;
      clearReconnectTimer();
      setConnectionStatus("offline");
      pendingHeartbeatRef.current = undefined;
      socketRef.current?.close(4003, "NETWORK_OFFLINE");
    };
    const reconnectNow = () => {
      if (!reconnectAllowedRef.current || !credentialRef.current) return;
      reconnectAttemptRef.current = 0;
      scheduleReconnectRef.current(true);
    };
    const handleVisibility = () => {
      if (document.hidden) {
        pendingHeartbeatRef.current = undefined;
        return;
      }
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        const pingRequestId = requestId("resume");
        if (
          sendRoomMessage(socketRef.current, {
            type: "PING",
            requestId: pingRequestId,
          })
        ) {
          pendingHeartbeatRef.current = {
            requestId: pingRequestId,
            sentAt: Date.now(),
          };
        }
      } else {
        reconnectNow();
      }
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", reconnectNow);
    window.addEventListener("pageshow", reconnectNow);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      mountedRef.current = false;
      reconnectAllowedRef.current = false;
      clearReconnectTimer();
      clearSocketHealthTimers();
      socketGenerationRef.current += 1;
      socketRef.current?.close();
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", reconnectNow);
      window.removeEventListener("pageshow", reconnectNow);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [clearReconnectTimer, clearSocketHealthTimers]);

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
      acceptView(nextView, true);
    } catch (error) {
      setNotice(
        friendlyError(error instanceof Error ? error.message : "CREATE_FAILED"),
      );
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
      acceptView(nextView, true);
    } catch (error) {
      setNotice(
        friendlyError(error instanceof Error ? error.message : "JOIN_FAILED"),
      );
    } finally {
      entryRequestPendingRef.current = false;
      setEntryPending(false);
    }
  }

  function sendMutation(message: RoomClientMessage): boolean {
    const currentView = latestViewRef.current;
    const currentCredential = credentialRef.current;
    if (
      !currentView ||
      !currentCredential ||
      leaveRequestIdRef.current ||
      pendingMutationRef.current ||
      acceptedGenerationRef.current !== socketGenerationRef.current ||
      currentView.viewerPlayerId !== currentCredential.playerId ||
      currentView.code !== currentCredential.code
    )
      return false;
    const id =
      "envelope" in message ? message.envelope.requestId : message.requestId;
    if (!id) return false;
    beginMutation(id, currentView.stateRevision);
    if (sendRoomMessage(socketRef.current, message)) return true;
    clearPendingMutation();
    acceptedGenerationRef.current = null;
    setConnectionStatus("reconnecting");
    socketRef.current?.close();
    scheduleReconnectRef.current(true);
    return false;
  }

  function requestLeave() {
    setActiveOverlay("leave");
  }

  function confirmLeave() {
    const currentView = latestViewRef.current;
    if (!currentView?.matchId || leaveRequestIdRef.current) return;
    const request = requestId("leave");
    leaveRequestIdRef.current = request;
    leaveMatchIdRef.current = currentView.matchId;
    setLeavePending(true);
    const sent =
      acceptedGenerationRef.current === socketGenerationRef.current &&
      sendRoomMessage(socketRef.current, {
        type: "LEAVE_GAME",
        requestId: request,
        matchId: currentView.matchId,
      });
    if (!sent) {
      setNotice("Reconnecting to confirm your departure…");
      scheduleReconnectRef.current(true);
    }
  }

  function setReady(ready: boolean) {
    if (latestViewRef.current?.phase !== "Lobby") return;
    sendMutation({ type: "SET_READY", requestId: requestId("ready"), ready });
  }

  function endGame() {
    const currentView = latestViewRef.current;
    if (
      !currentView?.matchId ||
      !currentView.isViewerHost ||
      currentView.phase === "GameOver"
    )
      return;
    if (
      sendMutation({
        type: "END_GAME",
        requestId: requestId("end-game"),
        matchId: currentView.matchId,
      })
    )
      setActiveOverlay(null);
  }

  function startRematch() {
    const currentView = latestViewRef.current;
    if (
      !currentView?.matchId ||
      !currentView.isViewerHost ||
      currentView.phase !== "GameOver"
    )
      return;
    sendMutation({
      type: "START_REMATCH",
      requestId: requestId("rematch"),
      matchId: currentView.matchId,
    });
  }

  function sendReaction(kind: ReactionKind) {
    sendMutation({
      type: "SEND_REACTION",
      requestId: requestId("reaction"),
      kind,
    });
    setActiveOverlay(null);
  }

  function updatePreferences(nextPreferences: Preferences) {
    if (!preferences.haptics && nextPreferences.haptics)
      playHaptic(true, [14, 24, 14]);
    setPreferences(nextPreferences);
  }

  function addBot() {
    if (
      !latestViewRef.current?.isViewerHost ||
      latestViewRef.current.phase !== "Lobby"
    )
      return;
    sendMutation({ type: "ADD_BOT", requestId: requestId("add-bot") });
  }

  function removePlayer(targetPlayerId: string) {
    if (
      !latestViewRef.current?.isViewerHost ||
      latestViewRef.current.phase !== "Lobby"
    )
      return;
    sendMutation({
      type: "REMOVE_PLAYER",
      requestId: requestId("remove-player"),
      targetPlayerId,
    });
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

  function startGame() {
    if (
      !latestViewRef.current?.isViewerHost ||
      latestViewRef.current.phase !== "Lobby"
    )
      return;
    sendMutation({ type: "START_GAME", requestId: requestId("start-game") });
  }

  function submitClaim(claim: ClaimTemplate) {
    const currentView = latestViewRef.current;
    if (!currentView?.canViewerAct || currentView.phase !== "RoundActive")
      return;
    const sent = sendMutation({
      type: "SUBMIT_CLAIM",
      envelope: {
        requestId: requestId("claim"),
        roomId: currentView.roomId,
        playerId: currentView.viewerPlayerId,
        stateRevision: currentView.stateRevision,
        turnId: currentView.currentTurnId,
        claimWindowId: currentView.activeClaimWindow?.id,
        payload: { claim },
      },
    });
    if (sent) setActiveOverlay(null);
  }

  function callBullshit() {
    const currentView = latestViewRef.current;
    if (!currentView?.canViewerCallBullShit || !currentView.activeClaimWindow)
      return;
    sendMutation({
      type: "CALL_BULLSHIT",
      envelope: {
        requestId: requestId("bullshit"),
        roomId: currentView.roomId,
        playerId: currentView.viewerPlayerId,
        stateRevision: currentView.stateRevision,
        claimWindowId: currentView.activeClaimWindow.id,
        payload: {},
      },
    });
  }

  if (!view) {
    return (
      <EntryScreen
        connectionStatus={connectionStatus}
        displayName={displayName}
        entryPending={entryPending}
        entryMode={entryMode}
        notice={notice}
        pin={pin}
        roomCode={roomCode}
        onCreate={handleCreateRoom}
        onJoin={handleJoinRoom}
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
        interactive={tableInteractive}
        canCopyRoomCode={view.phase === "Lobby"}
        roomCodeCopyState={roomCodeCopyState}
        status={connectionStatus}
        view={view}
        onCopyRoomCode={copyRoomCode}
        onEndGame={() => setActiveOverlay("end-game")}
        onLeave={requestLeave}
        onSettings={() => setActiveOverlay("settings")}
        onShare={() => setActiveOverlay("share")}
      />

      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {connectionLabel(connectionStatus)}.{" "}
        {view.phase === "Lobby"
          ? "Players assembling."
          : view.phase === "GameOver"
            ? view.matchEndedReason === "HOST_ENDED"
              ? "The host ended the game."
              : `${playerName(view.players, view.winnerPlayerId)} wins.`
            : `Round ${view.roundNumber}. ${playerName(view.players, view.currentTurnPlayerId)}'s turn. ${view.currentClaim ? formatClaim(view.currentClaim) : "No claim yet."}`}
      </div>
      {visibleRoundResult && (
        <div className="round-result-notice" role="status" aria-live="polite">
          <strong>
            Round {visibleRoundResult.roundNumber}:{" "}
            {visibleRoundResult.claimWasTrue === undefined
              ? "Complete"
              : visibleRoundResult.claimWasTrue
                ? "True claim"
                : "False claim"}
          </strong>
          <span>
            {visibleRoundResult.penaltyPlayerId
              ? `${playerName(view.players, visibleRoundResult.penaltyPlayerId)} takes the penalty card.`
              : "No penalty."}
            {visibleRoundResult.eliminatedPlayerIds.length > 0
              ? ` ${visibleRoundResult.eliminatedPlayerIds.map((id) => playerName(view.players, id)).join(", ")} eliminated.`
              : ""}
          </span>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <CircleAlert size={16} />
          <span>{notice}</span>
        </div>
      )}

      {view.phase === "Lobby" ? (
        <Lobby
          interactive={tableInteractive}
          reducedEffects={preferences.reducedEffects}
          view={view}
          onShare={() => setActiveOverlay("share")}
          onAddBot={addBot}
          onRemovePlayer={removePlayer}
          onSetReady={setReady}
          onStartGame={startGame}
        />
      ) : view.phase === "GameOver" ? (
        <WinnerExitPage
          interactive={tableInteractive}
          reducedEffects={preferences.reducedEffects}
          view={view}
          onExit={requestLeave}
          onOpenLastRound={() => setActiveOverlay("last-round")}
          onRematch={startRematch}
        />
      ) : (
        <GameTable
          interactive={tableInteractive}
          reaction={visibleReaction}
          reducedEffects={preferences.reducedEffects}
          view={view}
          onCallBullshit={callBullshit}
          onOpenClaimPicker={() => setActiveOverlay("claim")}
          onOpenLastRound={() => setActiveOverlay("last-round")}
          onOpenReactions={() =>
            setActiveOverlay((current) =>
              current === "reactions" ? null : "reactions",
            )
          }
        />
      )}

      {activeOverlay === "claim" && (
        <ClaimPicker
          view={view}
          onClose={() => setActiveOverlay(null)}
          onSubmit={submitClaim}
        />
      )}

      {activeOverlay === "last-round" && view.lastRoundResult && (
        <LastRoundSheet view={view} onClose={() => setActiveOverlay(null)} />
      )}

      {activeOverlay === "reactions" && (
        <ReactionDock
          onClose={() => setActiveOverlay(null)}
          onReact={sendReaction}
        />
      )}

      {activeOverlay === "share" && (
        <ShareSheet view={view} onClose={() => setActiveOverlay(null)} />
      )}

      {activeOverlay === "settings" && (
        <SettingsSheet
          hapticsAvailable={hapticsAvailable}
          preferences={preferences}
          onChange={updatePreferences}
          onClose={() => setActiveOverlay(null)}
        />
      )}

      {activeOverlay === "leave" && (
        <ConfirmDialog
          busy={leavePending}
          confirmLabel="Yes, leave"
          description="Your departure is permanent for this match. The table will continue for everyone else."
          title="Do you want to leave the game?"
          onCancel={() => !leavePending && setActiveOverlay(null)}
          onConfirm={confirmLeave}
        />
      )}

      {activeOverlay === "end-game" && (
        <ConfirmDialog
          confirmLabel="Yes, end game"
          description="The current match will end for every player. This cannot be undone."
          title="End this game for everyone?"
          confirmDisabled={!tableInteractive}
          tone="danger"
          onCancel={() => setActiveOverlay(null)}
          onConfirm={endGame}
        />
      )}
    </div>
  );
}

function WinnerExitPage(props: {
  interactive: boolean;
  reducedEffects: boolean;
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
      <SceneBoundary>
        <Suspense fallback={null}>
          <LivingTableScene
            reducedEffects={props.reducedEffects}
            variant="game"
            view={props.view}
          />
        </Suspense>
      </SceneBoundary>
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
              disabled={!props.interactive}
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
    <main className="entry-shell classic-entry" data-deal-open={railOpen}>
      <div className="entry-edge-cards" aria-hidden="true">
        {[
          ["A", "♦"],
          ["K", "♠"],
          ["Q", "♥"],
          ["J", "♣"],
        ].map(([rank, suit], index) => (
          <div
            className={`entry-edge-card edge-${index} ${index % 2 === 0 ? "red" : ""}`}
            key={rank}
          >
            <span>
              {rank}
              <small>{suit}</small>
            </span>
            <strong>{suit}</strong>
          </div>
        ))}
      </div>
      <div className="entry-artwork">
        <div className="entry-scene-stage">
          <SceneBoundary entry>
            <Suspense
              fallback={
                <div className="kinetic-scene-fallback" aria-hidden="true" />
              }
            >
              <KineticScene reducedEffects={props.reducedEffects} />
            </Suspense>
          </SceneBoundary>
        </div>
      </div>
      <div className="entry-copy">
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
              <span className="deal-mode-index" aria-hidden="true">
                01
              </span>
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
              <span className="deal-mode-index" aria-hidden="true">
                02
              </span>
              <span className="deal-mode-icon" aria-hidden="true">
                <LogIn size={21} />
              </span>
              <span>
                <small>Lock onto a room</small>
                <strong>Join Room</strong>
              </span>
              <ArrowRight size={20} aria-hidden="true" />
            </button>
            {props.connectionStatus !== "idle" && (
              <div
                className={`connection-pill ${props.connectionStatus}`}
                role="status"
              >
                {connectionLabel(props.connectionStatus)}
              </div>
            )}
            {props.notice && (
              <div className="deal-entry-notice" role="alert">
                {props.notice}
              </div>
            )}
          </section>
        )}
      </div>

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
  interactive: boolean;
  canCopyRoomCode: boolean;
  roomCodeCopyState: RoomCodeCopyState;
  status: ConnectionStatus;
  view: PrivateGameView;
  onCopyRoomCode: () => void;
  onEndGame: () => void;
  onLeave: () => void;
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

  return (
    <header
      className={`top-bar ${props.view.phase === "Lobby" ? "lobby-top-bar" : ""}`}
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
        {props.view.phase !== "Lobby" && (
          <button
            className="icon-button"
            aria-label="Share room"
            title="Share room"
            onClick={props.onShare}
          >
            <Share2 size={17} />
          </button>
        )}
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
            disabled={!props.interactive}
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

function Lobby(props: {
  interactive: boolean;
  reducedEffects: boolean;
  view: PrivateGameView;
  onShare: () => void;
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
    ? "Ready to deal"
    : seatedCount < 2
      ? "Open table"
      : "Players assembling";

  return (
    <main
      className="lobby-layout bluff-lobby"
      data-ready={canStart}
      data-player-count={seatedCount}
    >
      <h2 className="sr-only">Lobby</h2>

      <section className="lobby-world" aria-label="Lobby table">
        <aside className="lobby-story">
          <span className="section-kicker">Table assembling</span>
          <h3>Every seat has a tell.</h3>
          <button className="lobby-invite" onClick={props.onShare}>
            <Share2 size={17} aria-hidden="true" /> Invite friends{" "}
            <ArrowRight size={17} aria-hidden="true" />
          </button>
          <div className="lobby-ready-progress">
            <progress
              aria-label="Players ready"
              max={seatedCount || 1}
              value={readyCount}
            />
            <strong>
              {readyCount} of {seatedCount} ready
            </strong>
          </div>
        </aside>

        <div className="lobby-orbit-zone">
          <div className="lobby-table-orbit">
            <SceneBoundary>
              <Suspense fallback={null}>
                <LivingTableScene
                  reducedEffects={props.reducedEffects}
                  variant="lobby"
                  view={props.view}
                />
              </Suspense>
            </SceneBoundary>
            <div
              className="lobby-table-message"
              role="status"
              aria-live="polite"
            >
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
        </div>

        <aside className="lobby-roster" aria-label="Players at the table">
          <div className="lobby-roster-heading">
            <span>Your table</span>
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
                <div
                  className={`lobby-roster-row lobby-orbit-seat ${isViewer ? "viewer" : ""} ${ready ? "ready" : "waiting"}`}
                  key={player.id}
                >
                  <span
                    className={`lobby-roster-node ${isViewer ? "viewer" : ""} ${player.isBot ? "bot" : ""} ${offline ? "offline" : ""}`}
                    aria-hidden="true"
                  />
                  <div className="lobby-roster-name lobby-orbit-copy">
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
                      disabled={!props.interactive}
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
          <span>
            {readyCount} / {seatedCount} ready
          </span>
          <strong>{canStart ? "All players locked in" : tableHeading}</strong>
        </div>
        <button
          className={`lobby-ready-control ${viewer?.ready ? "active" : ""}`}
          aria-label={viewer?.ready ? "Ready" : "I am ready"}
          aria-pressed={Boolean(viewer?.ready)}
          disabled={!props.interactive}
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
            disabled={!props.interactive || seatedCount >= MAX_PLAYERS}
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
            disabled={!canStart || !props.interactive}
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
  interactive: boolean;
  reaction: ReactionEvent | null;
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
  const latestReaction = props.reaction;

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

      {latestReaction && (
        <div className="reaction-toast" role="status">
          <span>{reactionSymbol(latestReaction.kind)}</span>
          <strong>
            {playerName(props.view.players, latestReaction.playerId)}
          </strong>
          <small>{reactionLabel(latestReaction.kind)}</small>
        </div>
      )}

      <section className={`claim-zone ${props.view.phase.toLowerCase()}`}>
        <div className="game-scene-stage">
          <SceneBoundary>
            <Suspense fallback={null}>
              <LivingTableScene
                reducedEffects={props.reducedEffects}
                variant="game"
                view={props.view}
              />
            </Suspense>
          </SceneBoundary>
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
          <span className="claim-core-label">Turn signal</span>
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
                  !props.interactive ||
                  !props.view.canViewerAct ||
                  props.view.phase !== "RoundActive"
                }
                onClick={props.onOpenClaimPicker}
              >
                <Plus size={18} />
                {isFinalDecision ? "Final Claim" : "Make Claim"}
              </button>
              <button
                className="danger-action"
                disabled={
                  !props.interactive || !props.view.canViewerCallBullShit
                }
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
            disabled={!props.interactive}
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
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Claim builder"
    >
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
  const [reviewView] = useState(props.view);
  const result = reviewView.lastRoundResult!;
  const proofIds = new Set(result.proofCardIds ?? []);
  const truthTone =
    result.claimWasTrue === undefined
      ? "neutral"
      : result.claimWasTrue
        ? "true"
        : "false";
  const truthLabel =
    result.claimWasTrue === undefined
      ? "Round complete"
      : result.claimWasTrue
        ? "True Claim"
        : "False Claim";

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Last round"
    >
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
              ? `${playerName(reviewView.players, result.penaltyPlayerId)} takes the card`
              : "No penalty this round"}
          </small>
        </div>

        <div className="result-summary">
          <ResultLine
            label={
              result.reason === "BULLSHIT_CALL"
                ? "BullShit called by"
                : "Resolution"
            }
            value={
              result.callerPlayerId
                ? playerName(reviewView.players, result.callerPlayerId)
                : result.reason === "FINAL_CLAIM"
                  ? "Final claim · automatic review"
                  : "Automatic review"
            }
          />
          <ResultLine
            label="Claimed by"
            value={playerName(reviewView.players, result.claimantPlayerId)}
          />
          <ResultLine
            label="Next starter"
            value={
              reviewView.phase === "GameOver"
                ? "Match complete"
                : playerName(reviewView.players, reviewView.startingPlayerId)
            }
          />
          {result.eliminatedPlayerIds.length > 0 && (
            <ResultLine
              label="Eliminated"
              value={result.eliminatedPlayerIds
                .map((id) => playerName(reviewView.players, id))
                .join(", ")}
            />
          )}
        </div>

        <div className="revealed-groups">
          {result.revealedHands.map((hand) => (
            <div
              key={hand.playerId}
              className={`revealed-group ${hand.playerId === result.penaltyPlayerId ? "penalty" : ""}`}
            >
              <strong>{playerName(reviewView.players, hand.playerId)}</strong>
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
    <aside
      className="reaction-dock"
      role="dialog"
      aria-modal="true"
      aria-label="Table reactions"
    >
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
  confirmDisabled?: boolean;
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
            disabled={props.busy || props.confirmDisabled}
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
        <button
          className="setting-row"
          aria-pressed={props.preferences.sound}
          onClick={() => toggle("sound")}
        >
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
          aria-pressed={props.preferences.haptics && props.hapticsAvailable}
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
          aria-pressed={props.preferences.reducedEffects}
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
    })
      .then((value) => active && setQrCode(value))
      .catch(() => {
        /* The share link remains usable without a QR code. */
      });
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
