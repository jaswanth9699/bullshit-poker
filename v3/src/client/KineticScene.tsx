import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { ENTRY_SCENE_BOUNDS, fitSceneCamera } from "./sceneFraming.ts";
import {
  entryChoreography,
  entryLayerPose,
  entrySatellitePose,
  entryTrailPose,
} from "./entryChoreography.ts";
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
    setSceneStatus("initializing");
    if (!host || !window.WebGLRenderingContext) {
      setSceneStatus("fallback");
      return;
    }

    const qualityConfig = VISUAL_QUALITY_CONFIG[quality];
    const scene = new THREE.Scene();
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
    reactor.scale.setScalar(1.4);
    world.add(reactor);

    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const textures: THREE.Texture[] = [];
    const cardBackTexture = reactorTexture(qualityConfig.textureAnisotropy);
    textures.push(cardBackTexture);
    const cardBackMaterial = new THREE.MeshBasicMaterial({
      map: cardBackTexture,
    });
    materials.push(cardBackMaterial);
    const cardBackGeometry = new THREE.PlaneGeometry(1.58, 2.3);
    geometries.push(cardBackGeometry);
    const fanFaces = [
      glyphTexture("A", "♥", "#e32929", qualityConfig.textureAnisotropy),
      glyphTexture("K", "♠", "#111318", qualityConfig.textureAnisotropy),
      glyphTexture("Q", "♦", "#e32929", qualityConfig.textureAnisotropy),
      glyphTexture("J", "♣", "#111318", qualityConfig.textureAnisotropy),
    ];
    textures.push(...fanFaces);
    const fanMaterials = fanFaces.map(
      (map) => new THREE.MeshBasicMaterial({ map }),
    );
    materials.push(...fanMaterials);

    const deckGeometry = new THREE.BoxGeometry(1.72, 2.46, 0.07);
    geometries.push(deckGeometry);
    const deckMaterials = [0x111318, 0xf7f8f4, 0x4169ff, 0xff5a36].map(
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
      if (index % 3 === 0) {
        const material =
          index === 6
            ? cardBackMaterial
            : fanMaterials[index < 6 ? index / 3 : index / 3 - 1];
        const back = new THREE.Mesh(cardBackGeometry, material);
        back.position.z = 0.04;
        card.add(back);
      }
      reactor.add(card);
      return card;
    });

    const faceTexture = reactorTexture(qualityConfig.textureAnisotropy);
    textures.push(faceTexture);
    const faceGeometry = new THREE.PlaneGeometry(1.58, 2.3);
    geometries.push(faceGeometry);
    const faceMaterial = new THREE.MeshBasicMaterial({
      map: faceTexture,
    });
    materials.push(faceMaterial);
    const face = new THREE.Mesh(faceGeometry, faceMaterial);
    face.position.set(0.22, -0.13, 0.47);
    face.rotation.z = 0.055;
    reactor.add(face);

    const ringSpecs = [
      { radius: 2.15, tube: 0.04, color: 0x94a8d9, tilt: 0.12 },
      { radius: 2.82, tube: 0.038, color: 0x4169ff, tilt: -0.34 },
      { radius: 3.5, tube: 0.032, color: 0xff5a36, tilt: 0.5 },
    ] as const;
    const rings = ringSpecs.map((spec, index) => {
      const geometry = new THREE.TorusGeometry(
        spec.radius,
        spec.tube,
        8,
        96,
        Math.PI * 1.65,
      );
      const material = new THREE.MeshBasicMaterial({
        color: spec.color,
        transparent: true,
        opacity: index === 0 ? 0.75 : 1,
      });
      geometries.push(geometry);
      materials.push(material);
      const ring = new THREE.Mesh(geometry, material);
      ring.scale.setScalar(0.78);
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
      bar.position.set(Math.cos(angle) * 2.52, Math.sin(angle) * 2.52, -0.8);
      bar.rotation.z = angle;
      world.add(bar);
      return bar;
    });

    const satelliteGeometry = new THREE.PlaneGeometry(1.12, 1.58);
    geometries.push(satelliteGeometry);
    const satelliteTextures = [
      glyphTexture("A", "♦", "#e32929", qualityConfig.textureAnisotropy),
      glyphTexture("K", "♠", "#111318", qualityConfig.textureAnisotropy),
      glyphTexture("Q", "♥", "#e32929", qualityConfig.textureAnisotropy),
      glyphTexture("J", "♣", "#111318", qualityConfig.textureAnisotropy),
    ];
    textures.push(...satelliteTextures);
    const satellites = satelliteTextures.map((texture, index) => {
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
      });
      materials.push(material);
      const card = new THREE.Mesh(satelliteGeometry, material);
      card.userData.index = index;
      world.add(card);
      return card;
    });

    const grid = new THREE.GridHelper(26, 34, 0x4169ff, 0x4169ff);
    grid.position.set(0, -4.1, -2.6);
    grid.rotation.x = Math.PI * 0.08;
    const gridMaterials = Array.isArray(grid.material)
      ? grid.material
      : [grid.material];
    gridMaterials.forEach((material) => {
      material.transparent = true;
      material.opacity = 0.11;
      materials.push(material);
    });
    geometries.push(grid.geometry);
    scene.add(grid);

    // Four tapered wakes follow the actual cards in one instanced draw.
    const sparkGeometry = new THREE.OctahedronGeometry(0.065);
    const sparkMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    geometries.push(sparkGeometry);
    materials.push(sparkMaterial);
    const trailLength = quality === "full" ? 6 : 3;
    const sparkCount = trailLength * 4;
    const sparks = new THREE.InstancedMesh(
      sparkGeometry,
      sparkMaterial,
      sparkCount,
    );
    const sparkPose = new THREE.Object3D();
    for (let index = 0; index < sparkCount; index++) {
      sparks.setColorAt(
        index,
        new THREE.Color(
          Math.floor(index / trailLength) % 2 ? 0x8ba5ff : 0xff8b68,
        ),
      );
    }
    world.add(sparks);

    let inView = true;
    let pointerX = 0;
    let pointerY = 0;
    let contextAvailable = true;
    const loop = new VisualFrameLoop({ maxDeltaMs: 50 });
    const failScene = () => {
      contextAvailable = false;
      loop.stop();
      host.dataset.motionPlaying = "false";
      setSceneStatus("fallback");
    };
    loop.subscribe(VISUAL_FRAME_PRIORITY.view, ({ elapsedMs, deltaMs }) => {
      const pose = entryChoreography(elapsedMs / 1_000, quality === "reduced");
      const orbit = pose.orbit;
      if (host.dataset.motionPhase !== pose.label)
        host.dataset.motionPhase = pose.label;
      const follow = 1 - Math.exp(-deltaMs / 180);
      world.rotation.y +=
        (pointerX * qualityConfig.pointerInfluence * 0.12 - world.rotation.y) *
        follow;
      world.rotation.x +=
        (-pointerY * qualityConfig.pointerInfluence * 0.06 - world.rotation.x) *
        follow;
      reactor.position.y = pose.lift;
      reactor.rotation.z = pose.lift * 0.35;
      deckLayers.forEach((card, index) => {
        const layer = entryLayerPose(index, pose.fan, orbit);
        card.position.set(layer.x, layer.y, layer.z);
        card.rotation.set(0, 0, layer.roll);
      });
      face.position.z = 0.47 + pose.fan * 0.12;
      face.rotation.z = 0.055 - pose.fan * 0.11;
      rings.forEach((ring, index) => {
        ring.rotation.z = orbit * (index % 2 === 0 ? 1 : -1) + index * 2.1;
      });
      bars.forEach((bar, index) => {
        bar.scale.y = 0.65 + Math.sin(orbit * 2 + index * 0.45) * 0.25;
      });
      satellites.forEach((card, index) => {
        const satellite = entrySatellitePose(index, orbit);
        card.position.set(satellite.x, satellite.y, satellite.z);
        card.rotation.set(0, 0, satellite.roll);
      });
      for (let index = 0; index < sparkCount; index++) {
        const trail = entryTrailPose(
          Math.floor(index / trailLength),
          index % trailLength,
          trailLength,
          orbit,
        );
        sparkPose.position.set(trail.x, trail.y, trail.z);
        sparkPose.rotation.set(0, 0, trail.roll);
        sparkPose.scale.setScalar(trail.scale);
        sparkPose.updateMatrix();
        sparks.setMatrixAt(index, sparkPose.matrix);
      }
      sparks.instanceMatrix.needsUpdate = true;
      // Slow complementary lighting reveals the layered edges without flashes.
      cobaltLight.intensity = 30 + Math.sin(orbit) * 5;
      orangeLight.intensity = 26 - Math.sin(orbit) * 4;
      cobaltLight.position.y = 0.8 + Math.sin(orbit) * 0.6;
      orangeLight.position.y = -1.5 + Math.cos(orbit) * 0.5;
    });
    loop.subscribe(VISUAL_FRAME_PRIORITY.render, () => {
      if (!contextAvailable) return;
      try {
        renderer.render(scene, camera);
      } catch {
        failScene();
      }
    });

    const resize = () => {
      if (!contextAvailable) return;
      try {
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        const mobile = window.matchMedia("(max-width: 760px)").matches;
        host.dataset.sceneLayout = mobile ? "mobile" : "desktop";
        world.scale.setScalar(1);
        world.position.set(0, 0, 0);
        const bounds = ENTRY_SCENE_BOUNDS.clone();
        bounds.min.multiply(world.scale).add(world.position);
        bounds.max.multiply(world.scale).add(world.position);
        const projected = fitSceneCamera(
          camera,
          bounds,
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, 0, 1),
          width,
          height,
        );
        renderer.setSize(width, height, false);
        host.dataset.sceneFraming = "contain";
        host.dataset.sceneProjectedBounds = JSON.stringify(projected);
        loop.runFrame(quality === "reduced" ? 0 : performance.now());
      } catch {
        failScene();
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const onPointerMove = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      pointerX = inside
        ? ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1
        : 0;
      pointerY = inside
        ? ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1
        : 0;
    };
    const canAnimate = () =>
      contextAvailable && !document.hidden && inView && quality !== "reduced";
    const onVisibility = () => {
      if (canAnimate()) loop.start();
      else loop.stop();
      host.dataset.motionPlaying = String(canAnimate());
    };
    const intersection = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      onVisibility();
    });
    intersection.observe(host);
    const onContextLost = (event: Event) => {
      event.preventDefault();
      failScene();
    };
    const onContextRestored = () => {
      contextAvailable = true;
      resize();
      if (contextAvailable) {
        setSceneStatus("ready");
        onVisibility();
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
    resize();
    onVisibility();
    if (contextAvailable) setSceneStatus("ready");

    return () => {
      intersection.disconnect();
      loop.dispose();
      sparks.dispose();
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
