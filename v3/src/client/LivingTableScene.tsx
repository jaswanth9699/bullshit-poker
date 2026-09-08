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
  cards: Array<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>>;
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
    context.font = "900 58px system-ui";
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
    const radiusZ = variant === "lobby" ? 2.28 : 2.38;
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
    rig.ring.material.opacity = player.eliminated ? 0.18 : 0.62;
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
      centered * (isBlock ? 0.34 : 0.42),
      Math.abs(centered) * 0.035,
      isBlock && index >= 3 ? 0.24 : index * -0.018,
    );
    card.rotation.set(
      -0.2,
      centered * -0.045,
      centered * (isBlock ? -0.04 : -0.085),
    );
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
  }, [props.view]);

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
    const cobaltLight = new THREE.PointLight(0x4169ff, 28, 13, 2);
    cobaltLight.position.set(-3.4, 4.5, 2.4);
    scene.add(cobaltLight);
    const orangeLight = new THREE.PointLight(0xff5a36, 24, 12, 2);
    orangeLight.position.set(3.6, 2.2, -2.4);
    scene.add(orangeLight);
    const whiteLight = new THREE.DirectionalLight(0xffffff, 3.6);
    whiteLight.position.set(0, 7, 4);
    scene.add(whiteLight);

    const table = new THREE.Group();
    scene.add(table);
    const tableGeometry = new THREE.CylinderGeometry(3.5, 3.5, 0.18, 6);
    const tableMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x111318,
      roughness: 0.42,
      metalness: 0.38,
      clearcoat: 0.56,
      clearcoatRoughness: 0.34,
      transparent: true,
      opacity: props.variant === "lobby" ? 0.78 : 0.62,
    });
    const tableTop = new THREE.Mesh(tableGeometry, tableMaterial);
    tableTop.position.y = -0.24;
    tableTop.rotation.y = Math.PI / 6;
    table.add(tableTop);

    const edgeSourceGeometry = new THREE.CylinderGeometry(3.52, 3.52, 0.2, 6);
    const edgeGeometry = new THREE.EdgesGeometry(edgeSourceGeometry, 10);
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0x4169ff,
      transparent: true,
      opacity: 0.82,
    });
    const tableEdge = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    tableEdge.position.y = -0.23;
    tableEdge.rotation.y = Math.PI / 6;
    table.add(tableEdge);

    const innerGeometry = new THREE.CylinderGeometry(1.43, 1.43, 0.025, 6);
    const innerMaterial = new THREE.MeshBasicMaterial({
      color: 0xff5a36,
      transparent: true,
      opacity: 0.2,
      wireframe: true,
    });
    const innerPlatform = new THREE.Mesh(innerGeometry, innerMaterial);
    innerPlatform.position.y = -0.1;
    innerPlatform.rotation.y = Math.PI / 6;
    table.add(innerPlatform);

    const networkMaterial = new THREE.LineBasicMaterial({
      color: 0xf7f8f4,
      transparent: true,
      opacity: 0.13,
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

    const shockGeometry = new THREE.RingGeometry(0.92, 1.02, 6);
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

    const seatGeometry = new THREE.OctahedronGeometry(0.15, 0);
    const seatRingGeometry = new THREE.RingGeometry(0.22, 0.255, 6);
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
    const claimGeometry = new THREE.PlaneGeometry(0.7, 0.98);
    const claimCards = Array.from({ length: 5 }, () => {
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.35,
        metalness: 0.05,
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

    const energy = { pulse: 0, shock: 0, reveal: 0 };
    let pointerX = 0;
    let contextAvailable = true;
    const loop = new VisualFrameLoop({ maxDeltaMs: 50 });
    loop.subscribe(VISUAL_FRAME_PRIORITY.world, ({ deltaMs, elapsedMs }) => {
      const delta = deltaMs / 1_000;
      if (quality === "reduced") {
        energy.pulse = 0;
        energy.shock = 0;
        energy.reveal = 0;
      } else {
        energy.pulse = Math.max(0, energy.pulse - delta * 1.4);
        energy.shock = Math.max(0, energy.shock - delta * 1.05);
        energy.reveal = Math.max(0, energy.reveal - delta * 0.7);
      }
      const elapsed = elapsedMs / 1_000;
      const motion = quality === "reduced" ? 0 : 1;
      innerPlatform.rotation.y = Math.PI / 6 + elapsed * 0.12 * motion;
      table.rotation.y +=
        (pointerX * 0.035 * config.pointerInfluence - table.rotation.y) * 0.035;
      const claimScale = 1 + Math.sin((1 - energy.pulse) * Math.PI) * 0.16;
      claimGroup.scale.setScalar(claimScale);
      claimGroup.position.y =
        0.36 + Math.sin(elapsed * 0.85) * 0.035 * motion + energy.reveal * 0.12;
      claimGroup.rotation.y = elapsed * 0.08 * motion;
      seats.forEach((seat, index) => {
        seat.group.position.y =
          Number(seat.group.userData.baseY ?? 0.02) +
          Math.sin(elapsed * 0.9 + index) * 0.025 * motion;
        seat.ring.rotation.z =
          elapsed * (index % 2 === 0 ? 0.32 : -0.32) * motion;
      });
      shockRing.scale.setScalar(1 + (1 - energy.shock) * 2.6);
      shockMaterial.opacity = energy.shock * 0.62;
      edgeMaterial.opacity = 0.62 + energy.pulse * 0.26 + energy.reveal * 0.12;
    });
    loop.subscribe(VISUAL_FRAME_PRIORITY.render, () => {
      if (contextAvailable) renderer.render(scene, camera);
    });

    let renderedClaimSignature: string | undefined;
    const sync = (view: PrivateGameView) => {
      syncSeats(seats, view, props.variant);
      const nextClaimSignature = claimVisualSignature(view.currentClaim);
      if (nextClaimSignature !== renderedClaimSignature) {
        renderedClaimSignature = nextClaimSignature;
        syncClaim(claimRig, view.currentClaim, config.textureAnisotropy);
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
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      const mobileLayout = compactViewport;
      camera.aspect = width / height;
      camera.position.y = mobileLayout
        ? props.variant === "lobby"
          ? 6.45
          : 5.85
        : props.variant === "lobby"
          ? 5.9
          : 5.25;
      camera.position.z = mobileLayout ? 7.2 : 6.4;
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      host.dataset.sceneLayout = mobileLayout ? "mobile" : "desktop";
      renderOnce();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const onPointerMove = (event: PointerEvent) => {
      pointerX = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2;
    };
    const onVisibility = () => {
      if (document.hidden || quality === "reduced") loop.stop();
      else loop.start();
      if (!document.hidden) renderOnce();
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      contextAvailable = false;
      loop.stop();
      setSceneStatus("fallback");
    };
    const onContextRestored = () => {
      contextAvailable = true;
      setSceneStatus("ready");
      resize();
      if (quality !== "reduced" && !document.hidden) loop.start();
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
    if (quality !== "reduced" && !document.hidden) loop.start();
    setActiveQuality(quality);
    setSceneStatus("ready");

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
      edgeSourceGeometry.dispose();
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
      {sceneStatus === "fallback" && (
        <div className="living-table-fallback" data-scene-fallback="true" />
      )}
    </div>
  );
}
