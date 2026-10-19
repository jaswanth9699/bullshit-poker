import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type {
  Claim,
  HandType,
  PrivateGameView,
  PublicPlayerView,
  Rank,
  Suit,
} from "../shared/index.ts";
import { visualEventBus, type VisualEvent } from "./visualEvents.ts";
import { layoutLobbySeatLabels } from "./lobbySeatLabels.ts";
import {
  fitSceneCamera,
  LOBBY_SCENE_BOUNDS,
  TABLE_SCENE_BOUNDS,
} from "./sceneFraming.ts";
import {
  CLAIM_CARD_HEIGHT,
  CLAIM_CARD_SPACING,
  CLAIM_CARD_WIDTH,
  poseClaim,
} from "./sceneMotion.ts";
import {
  browserVisualCapabilities,
  resolveVisualQuality,
  VisualFrameLoop,
  VISUAL_FRAME_PRIORITY,
  VISUAL_QUALITY_CONFIG,
} from "./visualRuntime.ts";

type SceneVariant = "lobby" | "game";
type SceneStatus = "initializing" | "ready" | "fallback";

type SeatRig = {
  group: THREE.Group;
  beacon: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshStandardMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
};

type ClaimRig = {
  group: THREE.Group;
  cards: Array<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>;
  textures: THREE.CanvasTexture[];
};

const HAND_CARD_COUNT: Record<HandType, number> = {
  HIGH_CARD: 1,
  PAIR: 2,
  TWO_PAIR: 4,
  THREE_OF_A_KIND: 3,
  STRAIGHT: 5,
  FLUSH: 5,
  FULL_HOUSE: 5,
  FOUR_OF_A_KIND: 4,
  STRAIGHT_FLUSH: 5,
  ROYAL_FLUSH: 5,
};

const SUIT_SYMBOL: Record<Suit, string> = {
  S: "♠",
  H: "♥",
  D: "♦",
  C: "♣",
};

const RANK_VALUE: Record<Rank, number> = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const VALUE_RANK = Object.fromEntries(
  Object.entries(RANK_VALUE).map(([rank, value]) => [value, rank]),
) as Record<number, Rank>;

function claimRanks(claim: Claim): Rank[] {
  const count = HAND_CARD_COUNT[claim.handType];
  const primary = claim.primaryRank ?? "A";
  if (claim.handType === "ROYAL_FLUSH") return ["10", "J", "Q", "K", "A"];
  if (claim.handType === "STRAIGHT" || claim.handType === "STRAIGHT_FLUSH") {
    const high = RANK_VALUE[primary];
    return Array.from({ length: 5 }, (_, index) => {
      const value = high - 4 + index;
      return value === 1 ? "A" : VALUE_RANK[value];
    });
  }
  if (claim.handType === "FULL_HOUSE") {
    return [
      primary,
      primary,
      primary,
      claim.secondaryRank ?? "2",
      claim.secondaryRank ?? "2",
    ];
  }
  if (claim.handType === "TWO_PAIR") {
    return [
      primary,
      primary,
      claim.secondaryRank ?? "2",
      claim.secondaryRank ?? "2",
    ];
  }
  return Array.from({ length: count }, () => primary);
}

function claimSuits(claim: Claim, count: number): Suit[] {
  if (claim.suit) return Array.from({ length: count }, () => claim.suit!);
  return Array.from(
    { length: count },
    (_, index) => (["S", "H", "D", "C"] as const)[index % 4],
  );
}

function makeCardTexture(
  rank: Rank,
  suit: Suit,
  anisotropy: number,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 356;
  const context = canvas.getContext("2d");
  if (context) {
    const red = suit === "H" || suit === "D";
    context.fillStyle = "#f7f8f4";
    context.fillRect(0, 0, 256, 356);
    context.strokeStyle = "#111318";
    context.lineWidth = 8;
    context.strokeRect(13, 13, 230, 330);
    context.strokeStyle = red ? "#d51f36" : "#4169ff";
    context.lineWidth = 3;
    context.strokeRect(27, 27, 202, 302);
    context.fillStyle = red ? "#d51f36" : "#111318";
    context.font = "900 68px system-ui";
    context.textAlign = "left";
    context.fillText(rank, 26, 65);
    context.font = "900 50px system-ui";
    context.fillText(SUIT_SYMBOL[suit], 27, 116);
    context.textAlign = "center";
    context.font = "900 138px system-ui";
    context.fillText(SUIT_SYMBOL[suit], 128, 258);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

function seatColor(
  player: PublicPlayerView,
  view: PrivateGameView,
): THREE.Color {
  if (player.eliminated) return new THREE.Color(0x6c747d);
  if (!player.connected && !player.isBot) return new THREE.Color(0xd51f36);
  if (view.phase === "Lobby" && (player.isBot || player.ready))
    return new THREE.Color(0x7dd3fc);
  if (view.phase === "Lobby")
    return new THREE.Color(player.id === view.viewerPlayerId ? 0xc4b5fd : 0xff8fb3);
  if (player.id === view.currentTurnPlayerId) return new THREE.Color(0xffd438);
  if (player.id === view.viewerPlayerId) return new THREE.Color(0x4169ff);
  return new THREE.Color(player.isBot ? 0xff5a36 : 0xf7f8f4);
}

function syncSeats(
  rigs: SeatRig[],
  view: PrivateGameView,
  variant: SceneVariant,
): void {
  const players = view.players
    .filter((player) => player.leftAt === undefined)
    .sort((left, right) => left.seatIndex - right.seatIndex);
  rigs.forEach((rig, index) => {
    const player = players[index];
    rig.group.visible = Boolean(player);
    if (!player) return;
    const angle =
      -Math.PI / 2 + (index / Math.max(players.length, 1)) * Math.PI * 2;
    const radiusX = variant === "lobby" ? 3.02 : 3.22;
    const radiusZ = variant === "lobby" ? 2.1 : 2.38;
    rig.group.position.set(
      Math.cos(angle) * radiusX,
      0.02,
      Math.sin(angle) * radiusZ,
    );
    const color = seatColor(player, view);
    rig.beacon.material.color.copy(color);
    rig.beacon.material.emissive.copy(color);
    rig.beacon.material.emissiveIntensity =
      player.id === view.currentTurnPlayerId
        ? 4.2
        : player.eliminated
          ? 0.2
          : 1.8;
    rig.ring.material.color.copy(color);
    rig.ring.material.opacity = player.eliminated ? 0.35 : 1;
    rig.group.scale.setScalar(
      player.id === view.currentTurnPlayerId ? 1.18 : 1,
    );
    rig.group.userData.playerId = player.id;
    rig.group.userData.baseY =
      player.id === view.startingPlayerId ? 0.16 : 0.04;
  });
}

function clearClaimTextures(rig: ClaimRig): void {
  rig.textures.forEach((texture) => texture.dispose());
  rig.textures = [];
}

function syncClaim(
  rig: ClaimRig,
  claim: Claim | undefined,
  anisotropy: number,
): void {
  clearClaimTextures(rig);
  rig.group.visible = Boolean(claim);
  if (!claim) {
    rig.cards.forEach((card) => (card.visible = false));
    return;
  }

  const ranks = claimRanks(claim);
  const suits = claimSuits(claim, ranks.length);
  rig.cards.forEach((card, index) => {
    const visible = index < ranks.length;
    card.visible = visible;
    if (!visible) return;
    const texture = makeCardTexture(ranks[index], suits[index], anisotropy);
    rig.textures.push(texture);
    card.material.map = texture;
    card.material.needsUpdate = true;
    const centered = index - (ranks.length - 1) / 2;
    const isBlock = claim.handType === "FULL_HOUSE";
    card.position.set(
      centered * CLAIM_CARD_SPACING,
      Math.abs(centered) * 0.055,
      index * 0.025,
    );
    card.rotation.set(0, 0, centered * (isBlock ? -0.04 : -0.085));
  });
}

function claimVisualSignature(claim: Claim | undefined): string {
  if (!claim) return "none";
  return [
    claim.id,
    claim.sequence,
    claim.handType,
    claim.primaryRank,
    claim.secondaryRank,
    claim.suit,
  ].join(":");
}

function eventEnergy(event: VisualEvent): {
  pulse?: number;
  shock?: number;
  reveal?: number;
} {
  switch (event.kind) {
    case "CLAIM_ACCEPTED":
      return { pulse: 1 };
    case "BULLSHIT_CALLED":
      return { shock: 1 };
    case "ROUND_REVEALED":
      return { reveal: 1 };
    case "PENALTY_DEALT":
      return { pulse: 0.7 };
    case "PLAYER_ELIMINATED":
      return { shock: 0.45 };
    case "REACTION":
      return { pulse: 0.45 };
    case "MATCH_ENDED":
      return { reveal: 1, pulse: 1 };
    case "ROUND_STARTED":
      return { pulse: 0.55 };
    case "SYNC":
      return {};
  }
}

export default function LivingTableScene(props: {
  view: PrivateGameView;
  variant: SceneVariant;
  reducedEffects: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const syncRef = useRef<(view: PrivateGameView) => void>(() => undefined);
  const renderOnceRef = useRef<() => void>(() => undefined);
  const [sceneStatus, setSceneStatus] = useState<SceneStatus>("initializing");
  const [compactViewport, setCompactViewport] = useState(
    () => window.matchMedia("(max-width: 760px)").matches,
  );
  const [systemReducedMotion, setSystemReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const reducedEffects = props.reducedEffects || systemReducedMotion;
  const quality = useMemo(() => {
    const capabilities = browserVisualCapabilities();
    capabilities.viewportWidth = compactViewport
      ? Math.min(capabilities.viewportWidth, 760)
      : Math.max(capabilities.viewportWidth, 761);
    return resolveVisualQuality({
      preference: "auto",
      reducedEffects,
      capabilities,
    });
  }, [compactViewport, reducedEffects]);
  const [activeQuality, setActiveQuality] = useState(quality);

  useEffect(() => {
    const viewport = window.matchMedia("(max-width: 760px)");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateViewport = () => setCompactViewport(viewport.matches);
    const updateMotion = () => setSystemReducedMotion(motion.matches);
    viewport.addEventListener("change", updateViewport);
    motion.addEventListener("change", updateMotion);
    return () => {
      viewport.removeEventListener("change", updateViewport);
      motion.removeEventListener("change", updateMotion);
    };
  }, []);

  useEffect(() => {
    syncRef.current(props.view);
    renderOnceRef.current();
  }, [props.view, sceneStatus]);

  useEffect(() => {
    const host = hostRef.current;
    setSceneStatus("initializing");
    if (!host || !window.WebGLRenderingContext) {
      setActiveQuality(quality);
      setSceneStatus("fallback");
      return;
    }

    const config = VISUAL_QUALITY_CONFIG[quality];
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 34);
    camera.position.set(0, props.variant === "lobby" ? 5.9 : 5.25, 6.4);
    camera.lookAt(0, 0, 0);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: config.antialias,
        powerPreference: "high-performance",
      });
    } catch {
      setActiveQuality(quality);
      setSceneStatus("fallback");
      return;
    }
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, config.maxDevicePixelRatio),
    );
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(renderer.domElement);

    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x111318, 3.2);
    scene.add(hemisphere);
    const cobaltLight = new THREE.PointLight(props.variant === "lobby" ? 0x7dd3fc : 0x4169ff, 28, 13, 2);
    cobaltLight.position.set(-3.4, 4.5, 2.4);
    scene.add(cobaltLight);
    const orangeLight = new THREE.PointLight(props.variant === "lobby" ? 0xec81cc : 0xff5a36, 24, 12, 2);
    orangeLight.position.set(3.6, 2.2, -2.4);
    scene.add(orangeLight);
    const whiteLight = new THREE.DirectionalLight(0xffffff, 3.6);
    whiteLight.position.set(0, 7, 4);
    scene.add(whiteLight);

    const table = new THREE.Group();
    scene.add(table);
    const tableGeometry = new THREE.CylinderGeometry(
      3.5,
      3.5,
      0.18,
      props.variant === "lobby" ? 96 : 6,
    );
    const tableMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x192339,
      roughness: 0.8,
      metalness: 0.1,
      clearcoat: 0.56,
      clearcoatRoughness: 0.34,
    });
    const tableTop = new THREE.Mesh(tableGeometry, tableMaterial);
    tableTop.position.y = -0.24;
    tableTop.rotation.y = props.variant === "lobby" ? 0 : Math.PI / 6;
    if (props.variant === "lobby") tableTop.scale.z = 0.71;
    table.add(tableTop);

    // Mesh rails retain thickness on high-DPI phones; WebGL lines are one pixel.
    const edgePath = new THREE.CurvePath<THREE.Vector3>();
    const edgeSegments = props.variant === "lobby" ? 96 : 6;
    const edgePoints = Array.from({ length: edgeSegments }, (_, index) => {
      const angle = (index / edgeSegments) * Math.PI * 2;
      return new THREE.Vector3(
        Math.cos(angle) * 3.52,
        -0.13,
        Math.sin(angle) * (props.variant === "lobby" ? 2.5 : 3.52),
      );
    });
    edgePoints.forEach((point, index) =>
      edgePath.add(
        new THREE.LineCurve3(point, edgePoints[(index + 1) % edgeSegments]),
      ),
    );
    const edgeGeometry = new THREE.TubeGeometry(edgePath, 60, 0.045, 6, true);
    const edgeMaterial = new THREE.MeshBasicMaterial({
      color: props.variant === "lobby" ? 0x7dd3fc : 0x648bff,
      transparent: true,
      opacity: 0.82,
    });
    const tableEdge = new THREE.Mesh(edgeGeometry, edgeMaterial);
    table.add(tableEdge);

    const innerGeometry = new THREE.RingGeometry(
      1.55,
      1.6,
      props.variant === "lobby" ? 96 : 6,
    );
    const innerMaterial = new THREE.MeshBasicMaterial({
      color: props.variant === "lobby" ? 0xc4b5fd : 0xff5a36,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    });
    const innerPlatform = new THREE.Mesh(innerGeometry, innerMaterial);
    innerPlatform.position.y = -0.1;
    innerPlatform.rotation.x = -Math.PI / 2;
    if (props.variant === "lobby") innerPlatform.scale.y = 0.71;
    table.add(innerPlatform);

    const networkMaterial = new THREE.LineBasicMaterial({
      color: 0xf7f8f4,
      transparent: true,
      opacity: 0.18,
    });
    const networkGeometry = new THREE.BufferGeometry();
    const networkPoints: THREE.Vector3[] = [];
    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2;
      networkPoints.push(
        new THREE.Vector3(0, -0.075, 0),
        new THREE.Vector3(
          Math.cos(angle) * 3.12,
          -0.075,
          Math.sin(angle) * 2.2,
        ),
      );
    }
    networkGeometry.setFromPoints(networkPoints);
    const network = new THREE.LineSegments(networkGeometry, networkMaterial);
    table.add(network);

    const shockGeometry = new THREE.RingGeometry(0.87, 1.02, 6);
    const shockMaterial = new THREE.MeshBasicMaterial({
      color: 0xff5a36,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const shockRing = new THREE.Mesh(shockGeometry, shockMaterial);
    shockRing.rotation.x = -Math.PI / 2;
    shockRing.position.y = 0.06;
    table.add(shockRing);

    const seatGeometry = new THREE.OctahedronGeometry(0.2, 0);
    const seatRingGeometry = new THREE.RingGeometry(0.25, 0.32, 6);
    const seats: SeatRig[] = Array.from({ length: 10 }, () => {
      const group = new THREE.Group();
      const beaconMaterial = new THREE.MeshStandardMaterial({
        color: 0x4169ff,
        emissive: 0x4169ff,
        emissiveIntensity: 1.8,
        roughness: 0.25,
        metalness: 0.46,
      });
      const beacon = new THREE.Mesh(seatGeometry, beaconMaterial);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0x4169ff,
        transparent: true,
        opacity: 0.6,
      });
      const ring = new THREE.Mesh(seatRingGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      group.add(beacon, ring);
      table.add(group);
      return { group, beacon, ring };
    });

    const claimGroup = new THREE.Group();
    claimGroup.position.set(0, 0.42, props.variant === "game" ? 0.35 : 0);
    table.add(claimGroup);
    const claimGeometry = new THREE.PlaneGeometry(
      CLAIM_CARD_WIDTH,
      CLAIM_CARD_HEIGHT,
    );
    const claimCards = Array.from({ length: 5 }, () => {
      const material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
      });
      const card = new THREE.Mesh(claimGeometry, material);
      claimGroup.add(card);
      return card;
    });
    const claimRig: ClaimRig = {
      group: claimGroup,
      cards: claimCards,
      textures: [],
    };

    const lobbyDeck = new THREE.Group();
    lobbyDeck.visible = props.variant === "lobby";
    const lobbyCardGeometry = new THREE.PlaneGeometry(0.85, 1.2);
    const lobbyCardTextures: THREE.CanvasTexture[] = [];
    const lobbyCardMaterials: THREE.MeshBasicMaterial[] = [];
    if (props.variant === "lobby") {
      (
        [
          ["Q", "C"],
          ["K", "H"],
          ["A", "S"],
        ] as const
      ).forEach(([rank, suit], index) => {
        const texture = makeCardTexture(rank, suit, config.textureAnisotropy);
        const material = new THREE.MeshBasicMaterial({
          map: texture,
          side: THREE.DoubleSide,
        });
        const card = new THREE.Mesh(lobbyCardGeometry, material);
        card.rotation.set(-Math.PI / 2, 0, (index - 1) * -0.16);
        card.position.set((index - 1) * 0.48, 0.04 + index * 0.015, 0);
        lobbyCardTextures.push(texture);
        lobbyCardMaterials.push(material);
        lobbyDeck.add(card);
      });
    }
    table.add(lobbyDeck);
    let labelNodes = new Map<string, HTMLElement>();
    let labelWidth = 1;
    let labelHeight = 1;
    const labelPoint = new THREE.Vector3();
    const updateLabels = () => {
      if (props.variant !== "lobby") return;
      const anchors = seats
        .filter((seat) => seat.group.visible)
        .map((seat) => {
          seat.group.getWorldPosition(labelPoint);
          labelPoint.project(camera);
          const id = String(seat.group.userData.playerId);
          return {
            id,
            nameWidth: Math.max(
              28,
              Array.from(labelNodes.get(id)?.textContent ?? "").length *
                Math.min(8.1, Math.max(6.9, window.innerWidth * 0.0062)) +
                10,
            ),
            x: ((labelPoint.x + 1) * labelWidth) / 2,
            y: ((1 - labelPoint.y) * labelHeight) / 2,
          };
        });
      for (const position of layoutLobbySeatLabels(
        anchors,
        labelWidth,
        labelHeight,
      )) {
        const label = labelNodes.get(position.id);
        if (!label) continue;
        label.style.width = `${position.width}px`;
        label.style.left = `${position.labelX}px`;
        label.style.top = `${position.labelY}px`;
        label.style.visibility = "visible";
      }
    };

    const energy = { pulse: 0, shock: 0, reveal: 0 };
    let pointerX = 0;
    let contextAvailable = true;
    const loop = new VisualFrameLoop({ maxDeltaMs: 50 });
    const failScene = () => {
      contextAvailable = false;
      loop.stop();
      setSceneStatus("fallback");
    };
    loop.subscribe(VISUAL_FRAME_PRIORITY.world, ({ deltaMs, elapsedMs }) => {
      const delta = deltaMs / 1_000;
      if (quality === "reduced") {
        energy.pulse = 0;
        energy.shock = 0;
        energy.reveal = 0;
      } else {
        energy.pulse = Math.max(0, energy.pulse - delta * 1.4);
        energy.shock = Math.max(0, energy.shock - delta * 0.75);
        energy.reveal = Math.max(0, energy.reveal - delta * 0.7);
      }
      const elapsed = elapsedMs / 1_000;
      const motion = quality === "reduced" ? 0 : 1;
      table.rotation.y +=
        (pointerX * 0.035 * config.pointerInfluence - table.rotation.y) * 0.035;
      poseClaim(
        claimGroup,
        camera,
        elapsed,
        energy.pulse,
        quality === "reduced",
      );
      seats.forEach((seat, index) => {
        seat.group.position.y =
          Number(seat.group.userData.baseY ?? 0.02) +
          Math.sin(elapsed * 0.9 + index) * 0.025 * motion;
        seat.ring.rotation.z =
          elapsed * (index % 2 === 0 ? 0.32 : -0.32) * motion;
      });
      shockRing.scale.setScalar(1 + (1 - energy.shock) * 2.5);
      shockMaterial.opacity = Math.sin(energy.shock * Math.PI) * 0.85;
      edgeMaterial.opacity = 0.85 + energy.pulse * 0.15;
      if (props.variant === "lobby") {
        // Slow light travel follows the oval; seats and names keep their anchors.
        const lightAngle = elapsed * 0.22 * motion;
        cobaltLight.position.set(Math.cos(lightAngle) * 3.4, 3.2, Math.sin(lightAngle) * 2.4);
        orangeLight.position.set(-Math.cos(lightAngle) * 3.4, 2.8, -Math.sin(lightAngle) * 2.4);
        innerMaterial.opacity = 0.5 + Math.sin(elapsed * 0.65) * 0.12 * motion;
      }
    });
    loop.subscribe(VISUAL_FRAME_PRIORITY.render, () => {
      if (!contextAvailable) return;
      try {
        renderer.render(scene, camera);
        updateLabels();
      } catch {
        failScene();
      }
    });

    let renderedClaimSignature: string | undefined;
    const sync = (view: PrivateGameView) => {
      try {
        syncSeats(seats, view, props.variant);
        labelNodes = new Map(
          Array.from(
            host.querySelectorAll<HTMLElement>("[data-seat-name]"),
            (label) => [label.dataset.seatName!, label],
          ),
        );
        const nextClaimSignature = claimVisualSignature(view.currentClaim);
        if (nextClaimSignature !== renderedClaimSignature) {
          syncClaim(claimRig, view.currentClaim, config.textureAnisotropy);
          renderedClaimSignature = nextClaimSignature;
        }
      } catch {
        failScene();
      }
    };
    syncRef.current = sync;
    const renderOnce = () =>
      loop.runFrame(quality === "reduced" ? 0 : performance.now());
    renderOnceRef.current = renderOnce;

    const unsubscribe = visualEventBus.subscribe((event) => {
      const next = eventEnergy(event);
      energy.pulse = Math.max(energy.pulse, next.pulse ?? 0);
      energy.shock = Math.max(energy.shock, next.shock ?? 0);
      energy.reveal = Math.max(energy.reveal, next.reveal ?? 0);
      if (quality === "reduced") renderOnce();
    });

    const resize = () => {
      if (!contextAvailable) return;
      try {
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        const projected = fitSceneCamera(
          camera,
          props.variant === "lobby" ? LOBBY_SCENE_BOUNDS : TABLE_SCENE_BOUNDS,
          new THREE.Vector3(0, -0.35, 0),
          new THREE.Vector3(0, props.variant === "lobby" ? 5.9 : 5.25, 6.4),
          width,
          height,
        );
        labelWidth = width;
        labelHeight = height;
        renderer.setSize(width, height, false);
        host.dataset.sceneLayout = compactViewport ? "mobile" : "desktop";
        host.dataset.sceneFraming = "contain";
        host.dataset.sceneProjectedBounds = JSON.stringify(projected);
        renderOnce();
      } catch {
        failScene();
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const onPointerMove = (event: PointerEvent) => {
      pointerX = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2;
    };
    const onVisibility = () => {
      if (!contextAvailable || document.hidden || quality === "reduced")
        loop.stop();
      else loop.start();
      if (!document.hidden) renderOnce();
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      failScene();
    };
    const onContextRestored = () => {
      contextAvailable = true;
      resize();
      if (contextAvailable) {
        setSceneStatus("ready");
        if (quality !== "reduced" && !document.hidden) loop.start();
      }
    };
    if (quality !== "reduced") {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
    }
    document.addEventListener("visibilitychange", onVisibility);
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    renderer.domElement.addEventListener(
      "webglcontextrestored",
      onContextRestored,
    );

    sync(props.view);
    resize();
    if (contextAvailable && quality !== "reduced" && !document.hidden)
      loop.start();
    setActiveQuality(quality);
    if (contextAvailable) setSceneStatus("ready");

    return () => {
      syncRef.current = () => undefined;
      renderOnceRef.current = () => undefined;
      unsubscribe();
      loop.dispose();
      observer.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
      renderer.domElement.removeEventListener(
        "webglcontextlost",
        onContextLost,
      );
      renderer.domElement.removeEventListener(
        "webglcontextrestored",
        onContextRestored,
      );
      clearClaimTextures(claimRig);
      claimCards.forEach((card) => card.material.dispose());
      claimGeometry.dispose();
      lobbyCardGeometry.dispose();
      lobbyCardTextures.forEach((texture) => texture.dispose());
      lobbyCardMaterials.forEach((material) => material.dispose());
      seats.forEach((seat) => {
        seat.beacon.material.dispose();
        seat.ring.material.dispose();
      });
      seatGeometry.dispose();
      seatRingGeometry.dispose();
      shockGeometry.dispose();
      shockMaterial.dispose();
      innerGeometry.dispose();
      innerMaterial.dispose();
      networkGeometry.dispose();
      networkMaterial.dispose();
      edgeGeometry.dispose();
      edgeMaterial.dispose();
      tableGeometry.dispose();
      tableMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [compactViewport, props.variant, quality]);

  return (
    <div
      ref={hostRef}
      className="living-table-scene"
      data-effects={activeQuality === "reduced" ? "reduced" : "full"}
      data-has-claim={props.view.currentClaim ? "true" : "false"}
      data-quality={activeQuality}
      data-scene-status={sceneStatus}
      data-variant={props.variant}
      aria-hidden="true"
    >
      {props.variant === "lobby" && sceneStatus !== "fallback" && (
        <div className="lobby-table-names">
          {props.view.players
            .filter((player) => player.leftAt === undefined)
            .map((player) => (
              <span
                key={player.id}
                data-seat-name={player.id}
                title={player.name}
              >
                {player.name}
              </span>
            ))}
        </div>
      )}
      {sceneStatus === "fallback" && (
        <div className="living-table-fallback" data-scene-fallback="true" />
      )}
    </div>
  );
}
