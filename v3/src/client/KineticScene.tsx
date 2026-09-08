import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  browserVisualCapabilities,
  resolveVisualQuality,
  VisualFrameLoop,
  VISUAL_FRAME_PRIORITY,
  VISUAL_QUALITY_CONFIG,
  type VisualQualityPreference,
} from "./visualRuntime.ts";

type SceneStatus = "initializing" | "ready" | "fallback";

function glyphTexture(
  rank: string,
  suit: string,
  accent: string,
  anisotropy: number,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 544;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#f7f8f4";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#111318";
    context.lineWidth = 10;
    context.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);
    context.fillStyle = accent;
    context.font = "900 92px Arial, sans-serif";
    context.textAlign = "left";
    context.fillText(rank, 42, 112);
    context.font = "900 76px Arial, sans-serif";
    context.fillText(suit, 44, 192);
    context.textAlign = "center";
    context.font = "900 222px Arial, sans-serif";
    context.fillText(suit, canvas.width / 2, 390);
    context.fillStyle = "#111318";
    context.font = "800 22px Arial, sans-serif";
    context.fillText("BLUFF / SIGNAL", canvas.width / 2, 492);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

function reactorTexture(anisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 544;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#101217";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#f7f8f4";
    context.lineWidth = 8;
    context.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);
    context.strokeStyle = "#ff5a36";
    context.lineWidth = 4;
    context.strokeRect(36, 36, canvas.width - 72, canvas.height - 72);
    context.fillStyle = "#f7f8f4";
    context.font = "900 34px Arial, sans-serif";
    context.textAlign = "center";
    context.fillText("BULL / SHIT", canvas.width / 2, 104);
    context.beginPath();
    context.arc(canvas.width / 2, canvas.height / 2, 92, 0, Math.PI * 2);
    context.strokeStyle = "#4169ff";
    context.lineWidth = 12;
    context.stroke();
    context.beginPath();
    context.arc(canvas.width / 2, canvas.height / 2, 62, 0, Math.PI * 2);
    context.strokeStyle = "#ffd438";
    context.lineWidth = 5;
    context.stroke();
    context.fillStyle = "#f7f8f4";
    context.font = "900 132px Arial, sans-serif";
    context.fillText("?", canvas.width / 2, canvas.height / 2 + 48);
    context.font = "800 20px Arial, sans-serif";
    context.fillText("TRUTH IS NEGOTIABLE", canvas.width / 2, 472);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  return texture;
}

export default function KineticScene(props: {
  reducedEffects: boolean;
  qualityPreference?: VisualQualityPreference;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [sceneStatus, setSceneStatus] = useState<SceneStatus>("initializing");
  const [systemReducedMotion, setSystemReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [compactViewport, setCompactViewport] = useState(
    () => window.matchMedia("(max-width: 760px)").matches,
  );
  const reducedMotion = props.reducedEffects || systemReducedMotion;
  const quality = useMemo(() => {
    const capabilities = browserVisualCapabilities();
    capabilities.viewportWidth = compactViewport
      ? Math.min(capabilities.viewportWidth, 760)
      : Math.max(capabilities.viewportWidth, 761);
    return resolveVisualQuality({
      preference: props.qualityPreference ?? "auto",
      reducedEffects: reducedMotion,
      capabilities,
    });
  }, [compactViewport, props.qualityPreference, reducedMotion]);

  useEffect(() => {
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const viewportQuery = window.matchMedia("(max-width: 760px)");
    const updateMotion = () => setSystemReducedMotion(motionQuery.matches);
    const updateViewport = () => setCompactViewport(viewportQuery.matches);
    motionQuery.addEventListener("change", updateMotion);
    viewportQuery.addEventListener("change", updateViewport);
    return () => {
      motionQuery.removeEventListener("change", updateMotion);
      viewportQuery.removeEventListener("change", updateViewport);
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !window.WebGLRenderingContext) {
      setSceneStatus("fallback");
      return;
    }

    const qualityConfig = VISUAL_QUALITY_CONFIG[quality];
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xe9edf0, 0.072);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 50);
    camera.position.set(0, 0.1, 9.2);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: qualityConfig.antialias,
        powerPreference: "high-performance",
      });
    } catch {
      setSceneStatus("fallback");
      return;
    }
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, qualityConfig.maxDevicePixelRatio),
    );
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0xe9edf0, 0);
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x4050a0, 3.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 5.5);
    keyLight.position.set(-4, 5, 7);
    scene.add(keyLight);
    const cobaltLight = new THREE.PointLight(0x4169ff, 30, 14, 2);
    cobaltLight.position.set(3.8, 0.8, 3.5);
    scene.add(cobaltLight);
    const orangeLight = new THREE.PointLight(0xff5a36, 26, 12, 2);
    orangeLight.position.set(-4, -1.5, 4);
    scene.add(orangeLight);

    const world = new THREE.Group();
    scene.add(world);
    const reactor = new THREE.Group();
    world.add(reactor);

    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const textures: THREE.Texture[] = [];

    const deckGeometry = new THREE.BoxGeometry(1.72, 2.46, 0.07);
    geometries.push(deckGeometry);
    const deckMaterials = [0x111318, 0x252a32, 0x4169ff, 0xff5a36].map(
      (color) => {
        const material = new THREE.MeshPhysicalMaterial({
          color,
          roughness: 0.32,
          metalness: 0.42,
          clearcoat: 0.65,
          clearcoatRoughness: 0.3,
        });
        materials.push(material);
        return material;
      },
    );
    const deckLayers = Array.from({ length: 13 }, (_, index) => {
      const card = new THREE.Mesh(
        deckGeometry,
        deckMaterials[index % deckMaterials.length],
      );
      const offset = index - 6;
      card.position.set(offset * 0.035, offset * -0.022, offset * -0.06);
      card.rotation.z = offset * 0.014;
      reactor.add(card);
      return card;
    });

    const faceTexture = reactorTexture(qualityConfig.textureAnisotropy);
    textures.push(faceTexture);
    const faceGeometry = new THREE.PlaneGeometry(1.58, 2.3);
    geometries.push(faceGeometry);
    const faceMaterial = new THREE.MeshStandardMaterial({
      map: faceTexture,
      roughness: 0.4,
      metalness: 0.08,
    });
    materials.push(faceMaterial);
    const face = new THREE.Mesh(faceGeometry, faceMaterial);
    face.position.set(0.22, -0.13, 0.47);
    face.rotation.z = 0.055;
    reactor.add(face);

    const ringSpecs = [
      { radius: 2.15, tube: 0.032, color: 0x111318, tilt: 0.12 },
      { radius: 2.82, tube: 0.022, color: 0x4169ff, tilt: -0.34 },
      { radius: 3.5, tube: 0.014, color: 0xff5a36, tilt: 0.5 },
    ] as const;
    const rings = ringSpecs.map((spec, index) => {
      const geometry = new THREE.TorusGeometry(spec.radius, spec.tube, 8, 128);
      const material = new THREE.MeshBasicMaterial({
        color: spec.color,
        transparent: true,
        opacity: index === 0 ? 0.56 : 0.72,
      });
      geometries.push(geometry);
      materials.push(material);
      const ring = new THREE.Mesh(geometry, material);
      ring.rotation.x = spec.tilt;
      ring.rotation.y = spec.tilt * 0.44;
      world.add(ring);
      return ring;
    });

    const barGeometry = new THREE.BoxGeometry(0.045, 0.32, 0.04);
    geometries.push(barGeometry);
    const bars = Array.from({ length: 24 }, (_, index) => {
      const material = new THREE.MeshBasicMaterial({
        color: index % 3 === 0 ? 0xff5a36 : 0x111318,
      });
      materials.push(material);
      const bar = new THREE.Mesh(barGeometry, material);
      const angle = (index / 24) * Math.PI * 2;
      bar.position.set(Math.cos(angle) * 3.22, Math.sin(angle) * 3.22, -0.8);
      bar.rotation.z = angle;
      world.add(bar);
      return bar;
    });

    const satelliteGeometry = new THREE.PlaneGeometry(1.12, 1.58);
    geometries.push(satelliteGeometry);
    const satelliteTextures = [
      glyphTexture("A", "♦", "#e32929", qualityConfig.textureAnisotropy),
      glyphTexture("K", "♠", "#111318", qualityConfig.textureAnisotropy),
    ];
    textures.push(...satelliteTextures);
    const satellites = satelliteTextures.map((texture, index) => {
      const material = new THREE.MeshStandardMaterial({
        map: texture,
        side: THREE.DoubleSide,
        roughness: 0.38,
      });
      materials.push(material);
      const card = new THREE.Mesh(satelliteGeometry, material);
      card.userData.index = index;
      world.add(card);
      return card;
    });

    const grid = new THREE.GridHelper(26, 34, 0x4169ff, 0x9aa2aa);
    grid.position.set(0, -4.1, -2.6);
    grid.rotation.x = Math.PI * 0.08;
    const gridMaterials = Array.isArray(grid.material)
      ? grid.material
      : [grid.material];
    gridMaterials.forEach((material) => {
      material.transparent = true;
      material.opacity = quality === "reduced" ? 0.08 : 0.18;
      materials.push(material);
    });
    geometries.push(grid.geometry);
    scene.add(grid);

    let pointerX = 0;
    let pointerY = 0;
    let contextAvailable = true;
    const loop = new VisualFrameLoop({ maxDeltaMs: 50 });
    loop.subscribe(VISUAL_FRAME_PRIORITY.view, ({ elapsedMs }) => {
      const elapsed = elapsedMs / 1_000;
      const motion = quality === "reduced" ? 0 : 1;
      world.rotation.y +=
        (pointerX * qualityConfig.pointerInfluence * 0.7 - world.rotation.y) *
        0.025;
      world.rotation.x +=
        (-pointerY * qualityConfig.pointerInfluence * 0.34 - world.rotation.x) *
        0.025;
      reactor.position.y =
        Math.sin(elapsed * 0.72) * qualityConfig.floatingAmplitude * motion;
      reactor.rotation.z = Math.sin(elapsed * 0.28) * 0.035 * motion;
      deckLayers.forEach((card, index) => {
        card.rotation.y =
          Math.sin(elapsed * 0.35 + index * 0.16) * 0.018 * motion;
      });
      rings.forEach((ring, index) => {
        ring.rotation.z = elapsed * (index % 2 === 0 ? 0.05 : -0.04) * motion;
      });
      bars.forEach((bar, index) => {
        const pulse = 0.72 + Math.sin(elapsed * 1.1 + index * 0.45) * 0.22;
        bar.scale.y = quality === "reduced" ? 0.8 : pulse;
      });
      satellites[0].position.set(
        -3.35,
        0.8 + Math.sin(elapsed * 0.54) * 0.12 * motion,
        -0.3,
      );
      satellites[0].rotation.set(-0.08, 0.18, -0.2);
      satellites[1].position.set(
        3.45,
        -0.75 + Math.sin(elapsed * 0.48 + 1.4) * 0.12 * motion,
        -0.7,
      );
      satellites[1].rotation.set(0.08, -0.2, 0.22);
    });
    loop.subscribe(VISUAL_FRAME_PRIORITY.render, () => {
      if (contextAvailable) renderer.render(scene, camera);
    });

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      const mobile = width <= 760;
      host.dataset.sceneLayout = mobile ? "mobile" : "desktop";
      world.scale.setScalar(mobile ? 0.69 : 1);
      world.position.set(mobile ? 0.35 : 1.4, mobile ? -0.55 : -0.1, 0);
      camera.aspect = width / height;
      camera.position.z = mobile ? 9.8 : 9.2;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      loop.runFrame(quality === "reduced" ? 0 : performance.now());
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const onPointerMove = (event: PointerEvent) => {
      pointerX = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 0.55;
      pointerY = (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 0.4;
    };
    const onVisibility = () => {
      if (document.hidden || quality === "reduced") loop.stop();
      else loop.start();
      if (!document.hidden) {
        loop.runFrame(quality === "reduced" ? 0 : performance.now());
      }
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
    resize();
    if (quality !== "reduced" && !document.hidden) loop.start();
    setSceneStatus("ready");

    return () => {
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
      new Set(geometries).forEach((geometry) => geometry.dispose());
      new Set(materials).forEach((material) => material.dispose());
      new Set(textures).forEach((texture) => texture.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [quality]);

  return (
    <div
      ref={hostRef}
      className="kinetic-scene"
      data-effects={quality === "reduced" ? "reduced" : "full"}
      data-quality={quality}
      data-scene-status={sceneStatus}
      aria-hidden="true"
    >
      {sceneStatus === "fallback" && (
        <div className="kinetic-scene-fallback" data-scene-fallback="true" />
      )}
    </div>
  );
}
