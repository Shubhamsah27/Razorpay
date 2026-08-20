import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const COLUMNS = 34;
const ROWS = 16;
const SPACING = 0.85;
const COUNT = COLUMNS * ROWS;

/**
 * Colour is the case's fate, not decoration. Muted on purpose: the recovered
 * band is the only thing allowed to glow.
 */
const RECOVERED = new THREE.Color("#7ea0ff");
const ORGANIC = new THREE.Color("#40566d");
const AT_RISK = new THREE.Color("#a08a4c");
const LOST = new THREE.Color("#192839");

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

  const { positions, colors, phases, kinds } = useMemo(() => {
    const positions = new Float32Array(COUNT * 2);
    const colors = new Float32Array(COUNT * 3);
    const phases = new Float32Array(COUNT);
    const kinds = new Uint8Array(COUNT);

    for (let index = 0; index < COUNT; index += 1) {
      const column = index % COLUMNS;
      const row = Math.floor(index / COLUMNS);
      const x = (column - (COLUMNS - 1) / 2) * SPACING;
      const z = (row - (ROWS - 1) / 2) * SPACING;
      positions[index * 2] = x;
      positions[index * 2 + 1] = z;
      phases[index] = Math.hypot(x, z * 1.35);

      const value = cellValue(index);
      let color = LOST;
      let kind = 0;
      if (value < organicRate) {
        color = ORGANIC;
        kind = 1;
      } else if (value < recoveryRate) {
        color = RECOVERED;
        kind = 2;
      } else if (value < recoveryRate + 0.18) {
        color = AT_RISK;
        kind = 3;
      }
      kinds[index] = kind;
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
    return { positions, colors, phases, kinds };
  }, [recoveryRate, organicRate]);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (mesh === null) return;
    const time = clock.getElapsedTime();

    for (let index = 0; index < COUNT; index += 1) {
      const x = positions[index * 2]!;
      const z = positions[index * 2 + 1]!;
      const wave = Math.sin(phases[index]! * 0.42 - time * 0.85);
      const recovered = kinds[index] === 2;
      // Recovered cases ride the crest, so the motion reads as value returning.
      const lift = wave * 0.34 + (recovered ? 0.34 : 0);

      dummy.position.set(x, lift, z);
      // Thin tiles read as a surface; towers read as a skyline.
      dummy.scale.set(0.52, 0.07 + (recovered ? 0.05 : 0), 0.52);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, COUNT]} rotation={[0, -0.22, 0]}>
      <boxGeometry args={[1, 1, 1]}>
        <instancedBufferAttribute attach="attributes-color" args={[colors, 3]} />
      </boxGeometry>
      <meshStandardMaterial vertexColors roughness={0.62} metalness={0.08} />
    </instancedMesh>
  );
}

function Rig() {
  useFrame(({ camera, pointer }) => {
    camera.position.x += (pointer.x * 1.1 - camera.position.x) * 0.02;
    camera.position.y += (4.6 - pointer.y * 0.35 - camera.position.y) * 0.02;
    camera.lookAt(0, -0.3, 0);
  });
  return null;
}

export function Hero3D({ recoveryRate, organicRate }: FieldProps) {
  return (
    <div className="field-canvas" aria-hidden="true">
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [0, 4.6, 11.5], fov: 38 }}
        gl={{ antialias: true, alpha: true }}
      >
        <fog attach="fog" args={["#070a11", 10, 21]} />
        <ambientLight intensity={0.85} />
        <directionalLight position={[3, 9, 5]} intensity={1.35} color="#e8eeff" />
        <pointLight position={[-7, 3, 2]} intensity={14} color="#305eff" distance={18} />
        <Field recoveryRate={recoveryRate} organicRate={organicRate} />
        <Rig />
      </Canvas>
    </div>
  );
}
