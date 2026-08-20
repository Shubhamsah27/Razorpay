import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const COLUMNS = 44;
const ROWS = 20;
const SPACING = 0.62;
const COUNT = COLUMNS * ROWS;

const RECOVERED = new THREE.Color("#6e79f2");
const ORGANIC = new THREE.Color("#34d399");
const AT_RISK = new THREE.Color("#f4b942");
const LOST = new THREE.Color("#2a2e3a");

/** Deterministic per-cell value, so the field looks identical on every load. */
function cellValue(index: number): number {
  const x = Math.sin(index * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

interface FieldProps {
  recoveryRate: number;
  organicRate: number;
}

function Field({ recoveryRate, organicRate }: FieldProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const { positions, colors, phases } = useMemo(() => {
    const positions = new Float32Array(COUNT * 2);
    const colors = new Float32Array(COUNT * 3);
    const phases = new Float32Array(COUNT);

    for (let index = 0; index < COUNT; index += 1) {
      const column = index % COLUMNS;
      const row = Math.floor(index / COLUMNS);
      const x = (column - COLUMNS / 2) * SPACING;
      const z = (row - ROWS / 2) * SPACING;
      positions[index * 2] = x;
      positions[index * 2 + 1] = z;
      phases[index] = Math.hypot(x, z);

      // Each cell is one payment; its colour is its fate under Recoup.
      const value = cellValue(index);
      const color =
        value < organicRate
          ? ORGANIC
          : value < recoveryRate
            ? RECOVERED
            : value < recoveryRate + 0.22
              ? AT_RISK
              : LOST;
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
    return { positions, colors, phases };
  }, [recoveryRate, organicRate]);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (mesh === null) return;
    const time = clock.getElapsedTime();

    for (let index = 0; index < COUNT; index += 1) {
      const x = positions[index * 2]!;
      const z = positions[index * 2 + 1]!;
      const wave = Math.sin(phases[index]! * 0.55 - time * 1.15);
      const lift = wave * 0.42;
      const value = cellValue(index);
      // Recovered cells ride higher, so the wave reads as value coming back.
      const bias = value < recoveryRate ? 0.42 : 0;

      dummy.position.set(x, lift + bias, z);
      dummy.scale.setScalar(0.2 + Math.max(0, wave) * 0.11 + bias * 0.16);
      dummy.rotation.y = time * 0.12 + value * 3;
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.rotation.y = Math.sin(time * 0.055) * 0.09;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, COUNT]}>
      <boxGeometry args={[1, 1, 1]}>
        <instancedBufferAttribute attach="attributes-color" args={[colors, 3]} />
      </boxGeometry>
      <meshStandardMaterial
        vertexColors
        roughness={0.34}
        metalness={0.62}
        emissiveIntensity={0.5}
      />
    </instancedMesh>
  );
}

function Rig() {
  useFrame(({ camera, pointer, clock }) => {
    const time = clock.getElapsedTime();
    camera.position.x += (pointer.x * 2.2 - camera.position.x) * 0.025;
    camera.position.y += (7.4 + pointer.y * 1.1 - camera.position.y) * 0.025;
    camera.position.z = 12.5 + Math.sin(time * 0.09) * 0.7;
    camera.lookAt(0, 0, 0);
  });
  return null;
}

export function Hero3D({ recoveryRate, organicRate }: FieldProps) {
  return (
    <div className="hero-canvas" aria-hidden="true">
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [0, 7.4, 12.5], fov: 42 }}
        gl={{ antialias: true, alpha: true }}
      >
        <fog attach="fog" args={["#08090c", 14, 30]} />
        <ambientLight intensity={0.42} />
        <directionalLight position={[6, 12, 6]} intensity={1.5} color="#c9d1ff" />
        <pointLight position={[-8, 4, -4]} intensity={45} color="#a78bfa" distance={26} />
        <pointLight position={[9, 3, 5]} intensity={32} color="#6e79f2" distance={24} />
        <Field recoveryRate={recoveryRate} organicRate={organicRate} />
        <Rig />
      </Canvas>
    </div>
  );
}
