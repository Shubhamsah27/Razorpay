import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { caseStatus, STATUS_COLOR } from "../lib/caseStatus";
import { rupees } from "../lib/format";
import type { CaseAudit } from "../types";

const SPACING = 0.62;
const TILE = 0.46;

export interface FieldTile {
  caseId: string;
  x: number;
  z: number;
  /** Normalised amount at risk, 0..1. */
  height: number;
  color: THREE.Color;
  status: string;
  /** Reconciled or selected tiles pulse. */
  pulses: boolean;
}

/**
 * One tile per real case. Position is grid order, colour is the case's actual
 * status, and height is its actual amount at risk — nothing here is invented.
 */
export function buildTiles(cases: CaseAudit[]): FieldTile[] {
  const columns = Math.ceil(Math.sqrt(cases.length * 2.1));
  const rows = Math.ceil(cases.length / columns);
  const maxAmount = Math.max(...cases.map((audit) => audit.amountPaise), 1);

  return cases.map((audit, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const status = caseStatus(audit);
    return {
      caseId: audit.caseId,
      x: (column - (columns - 1) / 2) * SPACING,
      z: (row - (rows - 1) / 2) * SPACING,
      // Square-root so a few very large cases don't flatten everything else.
      height: Math.sqrt(audit.amountPaise / maxAmount),
      color: new THREE.Color(STATUS_COLOR[status]),
      status,
      pulses: status === "reconciled",
    };
  });
}

interface TilesProps {
  tiles: FieldTile[];
  selectedId: string;
  hoveredId: string | null;
  onSelect(caseId: string): void;
  onHover(caseId: string | null): void;
  reduced: boolean;
}

function Tiles({ tiles, selectedId, hoveredId, onSelect, onHover, reduced }: TilesProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const revealRef = useRef(0);

  const colors = useMemo(() => {
    const array = new Float32Array(tiles.length * 3);
    tiles.forEach((tile, index) => {
      array[index * 3] = tile.color.r;
      array[index * 3 + 1] = tile.color.g;
      array[index * 3 + 2] = tile.color.b;
    });
    return array;
  }, [tiles]);

  const selectedIndex = tiles.findIndex((tile) => tile.caseId === selectedId);

  useFrame(({ clock }, delta) => {
    const mesh = meshRef.current;
    if (mesh === null) return;
    const time = clock.getElapsedTime();

    // Cinematic reveal: tiles rise once, then settle. Not a looping animation.
    revealRef.current = reduced ? 1 : Math.min(1, revealRef.current + delta * 0.65);
    const reveal = revealRef.current;
    const eased = 1 - Math.pow(1 - reveal, 3);

    for (let index = 0; index < tiles.length; index += 1) {
      const tile = tiles[index]!;
      const isSelected = index === selectedIndex;
      const isHovered = tile.caseId === hoveredId;

      // Only reconciled and selected tiles move at rest; everything else is still.
      const pulse =
        reduced || !(tile.pulses || isSelected)
          ? 0
          : (Math.sin(time * 2.1 + index) * 0.5 + 0.5) * 0.14;

      const lift = tile.height * 0.9 * eased;
      const raise = isSelected ? 0.34 : isHovered ? 0.16 : 0;

      dummy.position.set(tile.x, lift / 2 + raise + pulse, tile.z);
      dummy.scale.set(
        TILE * (isSelected ? 1.25 : isHovered ? 1.1 : 1),
        Math.max(0.04, lift),
        TILE * (isSelected ? 1.25 : isHovered ? 1.1 : 1),
      );
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, tiles.length]}
      rotation={[0, -0.2, 0]}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        const id = event.instanceId;
        onHover(id === undefined ? null : (tiles[id]?.caseId ?? null));
      }}
      onPointerOut={() => onHover(null)}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation();
        const id = event.instanceId;
        if (id !== undefined && tiles[id] !== undefined) onSelect(tiles[id]!.caseId);
      }}
    >
      <boxGeometry args={[1, 1, 1]}>
        <instancedBufferAttribute attach="attributes-color" args={[colors, 3]} />
      </boxGeometry>
      <meshStandardMaterial vertexColors roughness={0.55} metalness={0.14} />
    </instancedMesh>
  );
}

function Rig({ focus, reduced }: { focus: { x: number; z: number } | null; reduced: boolean }) {
  const target = useRef(new THREE.Vector3(0, -0.3, 0));
  const started = useRef(false);
  const { camera } = useThree();

  useFrame((_, delta) => {
    if (!started.current) {
      // Start pulled back, settle into the working view.
      camera.position.set(0, 11, 20);
      started.current = true;
    }
    const wantX = focus === null ? 0 : focus.x * 0.55;
    const wantZ = focus === null ? 12.4 : 9.6 + focus.z * 0.3;
    const wantY = focus === null ? 5.2 : 4.4;
    const speed = reduced ? 1 : Math.min(1, delta * 1.8);

    camera.position.x += (wantX - camera.position.x) * speed;
    camera.position.y += (wantY - camera.position.y) * speed;
    camera.position.z += (wantZ - camera.position.z) * speed;

    const wantTarget = focus === null ? [0, -0.3, 0] : [focus.x * 0.5, 0, focus.z * 0.5];
    target.current.x += (wantTarget[0]! - target.current.x) * speed;
    target.current.y += (wantTarget[1]! - target.current.y) * speed;
    target.current.z += (wantTarget[2]! - target.current.z) * speed;
    camera.lookAt(target.current);
  });
  return null;
}

export interface CaseFieldProps {
  cases: CaseAudit[];
  selectedId: string;
  onSelect(caseId: string): void;
}

export default function CaseField({ cases, selectedId, onSelect }: CaseFieldProps) {
  const tiles = useMemo(() => buildTiles(cases), [cases]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const listener = () => setReduced(query.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  const focus = useMemo(() => {
    const tile = tiles.find((entry) => entry.caseId === selectedId);
    return tile === undefined ? null : { x: tile.x, z: tile.z };
  }, [tiles, selectedId]);

  const inspected = cases.find((audit) => audit.caseId === (hoveredId ?? selectedId));

  return (
    <>
      <Canvas
        className="field-canvas"
        dpr={[1, 1.75]}
        camera={{ position: [0, 11, 20], fov: 40 }}
        gl={{ antialias: true, alpha: true }}
      >
        <fog attach="fog" args={["#070a11", 11, 26]} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[3, 10, 6]} intensity={1.25} color="#e8eeff" />
        <pointLight position={[-8, 4, 3]} intensity={22} color="#305eff" distance={22} />
        <pointLight position={[8, 3, -2]} intensity={10} color="#c6f076" distance={18} />
        <Tiles
          tiles={tiles}
          selectedId={selectedId}
          hoveredId={hoveredId}
          onSelect={onSelect}
          onHover={setHoveredId}
          reduced={reduced}
        />
        <Rig focus={focus} reduced={reduced} />
      </Canvas>

      {/* Text lives outside the canvas so it stays selectable and crisp. */}
      {inspected !== undefined && (
        <div className="field-inspect" aria-live="polite">
          <span className="field-inspect-id">{inspected.caseId.replace("case_", "#")}</span>
          <span className="field-inspect-amount">{rupees(inspected.amountPaise)}</span>
          <span className="field-inspect-status">{caseStatus(inspected).replace("_", " ")}</span>
        </div>
      )}
    </>
  );
}
