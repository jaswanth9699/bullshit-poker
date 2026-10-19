import { useEffect, useRef } from "react";
import * as THREE from "three";

type CardPose = readonly [
  x: number,
  y: number,
  z: number,
  rotation: number,
  scale: number,
];

function cardTexture(
  rank: string,
  suit: string,
  accent: string,
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 448;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);

  const fill = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  fill.addColorStop(0, "#f9fbff");
  fill.addColorStop(1, "#dbe5f7");
  context.fillStyle = fill;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(45, 72, 112, 0.35)";
  context.lineWidth = 8;
  context.strokeRect(14, 14, canvas.width - 28, canvas.height - 28);
  context.fillStyle = accent;
  context.font = "900 74px system-ui";
  context.textAlign = "left";
  context.fillText(rank, 34, 86);
  context.font = "900 64px system-ui";
  context.fillText(suit, 34, 150);
  context.textAlign = "center";
  context.font = "900 180px system-ui";
  context.fillText(suit, canvas.width / 2, 320);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function cardBackTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 448;
  const context = canvas.getContext("2d");
  if (!context) return new THREE.CanvasTexture(canvas);

  context.fillStyle = "#17143f";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "#77d7ff";
  context.lineWidth = 8;
  context.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);
  context.strokeStyle = "rgba(183, 166, 255, 0.52)";
  context.lineWidth = 3;
  for (let offset = -canvas.height; offset < canvas.width; offset += 28) {
    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(offset + canvas.height, canvas.height);
    context.stroke();
  }
  context.fillStyle = "rgba(8, 9, 20, 0.68)";
  context.beginPath();
  context.arc(canvas.width / 2, canvas.height / 2, 78, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "#ffc857";
  context.lineWidth = 5;
  context.stroke();
  context.fillStyle = "#f7f8ff";
  context.font = "900 108px system-ui";
  context.textAlign = "center";
  context.fillText("?", canvas.width / 2, canvas.height / 2 + 38);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export default function KineticScene() {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !window.WebGLRenderingContext) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x070914, 0.105);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 40);
    camera.position.set(0, 0.2, 8.4);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(renderer.domElement);

    const ambient = new THREE.HemisphereLight(0xa6c8ff, 0x130e26, 2.2);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffd4e8, 4.2);
    key.position.set(-3, 4, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x65d9ff, 3.4);
    rim.position.set(4, -2, 3);
    scene.add(rim);

    const group = new THREE.Group();
    scene.add(group);
    const geometry = new THREE.BoxGeometry(1.45, 2.05, 0.055, 2, 2, 1);
    const backTexture = cardBackTexture();
    const cardFaces = [
      cardTexture("A", "♦", "#cf1734"),
      cardTexture("K", "♠", "#0a1020"),
      cardTexture("Q", "♥", "#cf1734"),
      cardTexture("J", "♣", "#0a1020"),
    ];
    const cards = cardFaces.map((face, index) => {
      const edge = new THREE.MeshStandardMaterial({
        color: 0xbecbe0,
        roughness: 0.5,
        metalness: 0.08,
      });
      const front = new THREE.MeshStandardMaterial({
        map: face,
        roughness: 0.4,
      });
      const back = new THREE.MeshStandardMaterial({
        map: backTexture,
        roughness: 0.4,
      });
      const materials = [edge, edge, edge, edge, front, back];
      const card = new THREE.Mesh(geometry, materials);
      card.userData.materials = materials;
      card.userData.index = index;
      return card;
    });
    const desktopPoses: readonly CardPose[] = [
      [-3.6, 0.7, -0.4, -0.32, 1],
      [3.75, 1.35, -1.15, 0.34, 1],
      [-4.1, -2.2, -1.8, 0.48, 1],
      [3.5, -2.35, -0.8, -0.42, 1],
    ];
    const mobilePoses: readonly CardPose[] = [
      [-1.42, 0.72, -0.45, -0.26, 0.61],
      [1.42, 0.42, -0.95, 0.27, 0.58],
      [-1.34, -1.08, -1.35, 0.31, 0.54],
      [1.36, -1.2, -0.72, -0.29, 0.56],
    ];
    let activePoses = desktopPoses;
    cards.forEach((card) => group.add(card));

    const grid = new THREE.GridHelper(22, 28, 0x345c96, 0x1e294d);
    grid.position.set(0, -3.5, -2.7);
    grid.rotation.x = Math.PI * 0.12;
    const gridMaterials = Array.isArray(grid.material)
      ? grid.material
      : [grid.material];
    gridMaterials.forEach((material) => {
      material.transparent = true;
      material.opacity = 0.22;
    });
    scene.add(grid);

    let pointerX = 0;
    let pointerY = 0;
    let frame = 0;
    let visible = !document.hidden;
    const startedAt = performance.now();

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      activePoses = width <= 760 ? mobilePoses : desktopPoses;
      host.dataset.sceneLayout = width <= 760 ? "mobile" : "desktop";
      cards.forEach((card, index) => {
        const [x, y, z, rotation, scale] = activePoses[index];
        card.position.set(x, y, z);
        card.rotation.set(rotation * 0.38, rotation, rotation * 0.18);
        card.scale.setScalar(scale);
      });
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const onPointerMove = (event: PointerEvent) => {
      pointerX = (event.clientX / window.innerWidth - 0.5) * 0.4;
      pointerY = (event.clientY / window.innerHeight - 0.5) * 0.3;
    };
    const onVisibility = () => {
      visible = !document.hidden;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    const render = () => {
      frame = requestAnimationFrame(render);
      if (!visible) return;
      const elapsed = (performance.now() - startedAt) / 1_000;
      const motion = reducedMotion ? 0 : 1;
      group.rotation.y += (pointerX - group.rotation.y) * 0.025;
      group.rotation.x += (-pointerY - group.rotation.x) * 0.025;
      cards.forEach((card, index) => {
        card.position.y =
          activePoses[index][1] +
          Math.sin(elapsed * 0.52 + index * 1.4) * 0.16 * motion;
        card.rotation.z =
          activePoses[index][3] * 0.18 +
          Math.sin(elapsed * 0.35 + index) * 0.025 * motion;
      });
      renderer.render(scene, camera);
    };
    render();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibility);
      geometry.dispose();
      cards.forEach((card) => {
        const materials = card.userData.materials as THREE.Material[];
        new Set(materials).forEach((material) => material.dispose());
      });
      cardFaces.forEach((texture) => texture.dispose());
      backTexture.dispose();
      grid.geometry.dispose();
      gridMaterials.forEach((material) => material.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={hostRef} className="kinetic-scene" aria-hidden="true" />;
}
