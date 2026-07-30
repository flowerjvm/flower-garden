"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import * as THREE from "three";
import type { VerdantProjection } from "./types";
import styles from "./VerdantSignalGarden.module.css";

export type VerdantFocus = "wait" | "signal" | "timeout" | "routes";

interface VerdantSignalSceneProps {
  projection: VerdantProjection;
  reducedMotion: boolean;
  focus: VerdantFocus;
  onFocus: (focus: VerdantFocus) => void;
}

const TREE_POSITIONS: Array<[number, number, number]> = [
  [-8, 0, -5.6],
  [-7.4, 0, 5.2],
  [-4.2, 0, -6.2],
  [-1, 0, 6.1],
  [3.4, 0, -6.2],
  [6.8, 0, 5.2],
  [8.1, 0, -3.6],
];

function seededVariation(x: number, z: number): number {
  const value = Math.sin(x * 10.731 + z * 61.913) * 29483.1257;
  return Math.abs(value % 1);
}

function GardenTerrain() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const blocks = useMemo(() => {
    const result: Array<{
      position: [number, number, number];
      scale: [number, number, number];
      color: THREE.Color;
    }> = [];

    for (let x = -9; x <= 9; x += 1) {
      for (let z = -7; z <= 7; z += 1) {
        const variation = seededVariation(x, z);
        const isMainPath = Math.abs(z) < 0.72;
        const isBranch =
          x > 0 && Math.abs(z - (x - 1) * 0.45) < 0.58
            ? true
            : x < 0 && Math.abs(z + (x + 1) * 0.45) < 0.58;
        const isPath = isMainPath || isBranch;
        const edge = Math.abs(x) > 7 || Math.abs(z) > 5;
        const height = edge && variation > 0.54 ? 0.58 : 0.38;
        const color = isPath
          ? new THREE.Color(variation > 0.5 ? "#d6bd78" : "#c9a968")
          : new THREE.Color(
              variation > 0.72
                ? "#78a94d"
                : variation > 0.34
                  ? "#669b45"
                  : "#588c3d",
            );
        result.push({
          position: [x, -height / 2, z],
          scale: [0.98, height, 0.98],
          color,
        });
      }
    }
    return result;
  }, []);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const helper = new THREE.Object3D();
    blocks.forEach((block, index) => {
      helper.position.set(...block.position);
      helper.scale.set(...block.scale);
      helper.updateMatrix();
      mesh.setMatrixAt(index, helper.matrix);
      mesh.setColorAt(index, block.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [blocks]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, blocks.length]}
      receiveShadow
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial vertexColors />
    </instancedMesh>
  );
}

function BlockTree({
  position,
  scale,
}: {
  position: [number, number, number];
  scale: number;
}) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 1.15, 0]} castShadow>
        <boxGeometry args={[0.52, 2.3, 0.52]} />
        <meshLambertMaterial color="#735033" />
      </mesh>
      <mesh position={[0, 2.55, 0]} castShadow>
        <boxGeometry args={[2, 1.15, 1.72]} />
        <meshLambertMaterial color="#397a43" />
      </mesh>
      <mesh position={[-0.42, 3.24, 0.1]} castShadow>
        <boxGeometry args={[1.1, 0.72, 1.08]} />
        <meshLambertMaterial color="#4d904c" />
      </mesh>
      <mesh position={[0.48, 3.17, -0.12]} castShadow>
        <boxGeometry args={[1.02, 0.74, 1.02]} />
        <meshLambertMaterial color="#58a052" />
      </mesh>
    </group>
  );
}

function FocusBase({
  active,
  color = "#f5de81",
}: {
  active: boolean;
  color?: string;
}) {
  if (!active) return null;
  return (
    <mesh position={[0, 0.08, 0]}>
      <boxGeometry args={[2.9, 0.1, 2.9]} />
      <meshBasicMaterial color={color} transparent opacity={0.68} />
    </mesh>
  );
}

function WaitPavilion({
  projection,
  focused,
  onFocus,
}: {
  projection: VerdantProjection;
  focused: boolean;
  onFocus: () => void;
}) {
  const waiting =
    projection.waitStatus === "WAITING" ||
    projection.currentStepId === "wait-for-yard-assignment";
  const decided =
    projection.waitStatus === "DECIDED" ||
    projection.waitStatus === "EXITED";

  return (
    <group
      position={[0, 0.05, 0]}
      onPointerDown={(event) => {
        event.stopPropagation();
        onFocus();
      }}
    >
      <mesh position={[0, 0.16, 0]} receiveShadow castShadow>
        <boxGeometry args={[3.6, 0.36, 3.2]} />
        <meshLambertMaterial
          color={decided ? "#bfd27d" : waiting ? "#ebd67b" : "#b4c58c"}
        />
      </mesh>
      {[
        [-1.38, 1.15, -1.18],
        [1.38, 1.15, -1.18],
        [-1.38, 1.15, 1.18],
        [1.38, 1.15, 1.18],
      ].map((position, index) => (
        <mesh key={index} position={position as [number, number, number]} castShadow>
          <boxGeometry args={[0.22, 2.15, 0.22]} />
          <meshLambertMaterial color="#6c5432" />
        </mesh>
      ))}
      <mesh position={[0, 2.28, 0]} castShadow>
        <boxGeometry args={[3.4, 0.28, 3]} />
        <meshLambertMaterial color={waiting ? "#5b8f43" : "#709260"} />
      </mesh>
      <mesh position={[0, 0.74, 0]} castShadow>
        <boxGeometry args={[1.7, 0.82, 1.22]} />
        <meshLambertMaterial
          color={
            projection.winner === "SIGNAL"
              ? "#7dba5a"
              : projection.winner === "TIMEOUT"
                ? "#c89355"
                : "#88a975"
          }
        />
      </mesh>
      <mesh position={[0, 0.75, 0.62]}>
        <boxGeometry args={[1.3, 0.18, 0.06]} />
        <meshBasicMaterial color={waiting ? "#fff1a1" : "#e9e7be"} />
      </mesh>
      <FocusBase active={focused} />
    </group>
  );
}

function SignalLantern({
  projection,
  focused,
  onFocus,
}: {
  projection: VerdantProjection;
  focused: boolean;
  onFocus: () => void;
}) {
  const lit =
    projection.signalStatus === "RECEIVED" ||
    projection.signalStatus === "PRESENT" ||
    projection.signalStatus === "SENT";
  const ignored = projection.signalStatus === "IGNORED";

  return (
    <group
      position={[-4.9, 0.08, 2.35]}
      onPointerDown={(event) => {
        event.stopPropagation();
        onFocus();
      }}
    >
      <mesh position={[0, 0.15, 0]} receiveShadow>
        <boxGeometry args={[2.5, 0.3, 2.5]} />
        <meshLambertMaterial color="#85a967" />
      </mesh>
      <mesh position={[0, 1.4, 0]} castShadow>
        <boxGeometry args={[0.28, 2.55, 0.28]} />
        <meshLambertMaterial color="#5b4a32" />
      </mesh>
      <mesh position={[0, 2.65, 0]} castShadow>
        <boxGeometry args={[1.15, 1.08, 1.15]} />
        <meshLambertMaterial
          color={ignored ? "#9a8f73" : lit ? "#83d7ae" : "#89a893"}
        />
      </mesh>
      <mesh position={[0, 2.65, 0.59]}>
        <boxGeometry args={[0.72, 0.66, 0.08]} />
        <meshBasicMaterial
          color={ignored ? "#c8b99b" : lit ? "#d8fff0" : "#b8d0bf"}
        />
      </mesh>
      <mesh position={[0, 3.34, 0]} castShadow>
        <boxGeometry args={[1.48, 0.22, 1.48]} />
        <meshLambertMaterial color="#3f7047" />
      </mesh>
      <FocusBase active={focused} color="#9be4c1" />
    </group>
  );
}

function TimeoutClock({
  projection,
  focused,
  onFocus,
}: {
  projection: VerdantProjection;
  focused: boolean;
  onFocus: () => void;
}) {
  const deadline = projection.deadlineMillis ?? 30_000;
  const progress = Math.min(1, Math.max(0, projection.clockMillis / deadline));
  const angle = -Math.PI * 0.75 + progress * Math.PI * 1.5;
  const reached =
    projection.timeoutStatus === "REACHED" ||
    projection.timeoutStatus === "SELECTED";
  const rejected = projection.timeoutStatus === "REJECTED";

  return (
    <group
      position={[4.9, 0.08, -2.35]}
      onPointerDown={(event) => {
        event.stopPropagation();
        onFocus();
      }}
    >
      <mesh position={[0, 0.15, 0]} receiveShadow>
        <boxGeometry args={[2.5, 0.3, 2.5]} />
        <meshLambertMaterial color="#9cad69" />
      </mesh>
      <mesh position={[0, 1.25, 0]} castShadow>
        <boxGeometry args={[1.52, 2.12, 0.62]} />
        <meshLambertMaterial
          color={rejected ? "#8cac72" : reached ? "#c99558" : "#a9a778"}
        />
      </mesh>
      <mesh position={[0, 1.42, 0.34]}>
        <boxGeometry args={[1.16, 1.16, 0.08]} />
        <meshBasicMaterial
          color={rejected ? "#d8e9c3" : reached ? "#ffe0a2" : "#f1e8bd"}
        />
      </mesh>
      <group position={[0, 1.42, 0.42]} rotation={[0, 0, angle]}>
        <mesh position={[0, 0.31, 0]}>
          <boxGeometry args={[0.1, 0.7, 0.09]} />
          <meshLambertMaterial color="#5a4e39" />
        </mesh>
      </group>
      <mesh position={[0, 2.55, 0]} castShadow>
        <boxGeometry args={[1.85, 0.24, 0.86]} />
        <meshLambertMaterial color="#6f774e" />
      </mesh>
      <FocusBase active={focused} color="#f1c982" />
    </group>
  );
}

function RouteGate({
  position,
  color,
  active,
}: {
  position: [number, number, number];
  color: string;
  active: boolean;
}) {
  return (
    <group position={position}>
      <mesh position={[-0.8, 1.1, 0]} castShadow>
        <boxGeometry args={[0.3, 2.2, 0.3]} />
        <meshLambertMaterial color="#665037" />
      </mesh>
      <mesh position={[0.8, 1.1, 0]} castShadow>
        <boxGeometry args={[0.3, 2.2, 0.3]} />
        <meshLambertMaterial color="#665037" />
      </mesh>
      <mesh position={[0, 2.12, 0]} castShadow>
        <boxGeometry args={[1.9, 0.32, 0.38]} />
        <meshLambertMaterial color={active ? color : "#8c9b72"} />
      </mesh>
      <mesh position={[0, 1.42, 0.02]}>
        <boxGeometry args={[1.18, 0.56, 0.08]} />
        <meshBasicMaterial color={active ? color : "#bdc7a5"} />
      </mesh>
    </group>
  );
}

function RouteGarden({
  projection,
  focused,
  onFocus,
}: {
  projection: VerdantProjection;
  focused: boolean;
  onFocus: () => void;
}) {
  return (
    <group
      onPointerDown={(event) => {
        event.stopPropagation();
        onFocus();
      }}
    >
      <RouteGate
        position={[6.25, 0.02, 3.5]}
        color="#a9df78"
        active={
          projection.selectedPath === "yard-move" ||
          projection.currentStepId === "yard-move"
        }
      />
      <RouteGate
        position={[-6.25, 0.02, -3.5]}
        color="#efbd72"
        active={
          projection.selectedPath === "timed-out" ||
          projection.currentStepId === "timed-out"
        }
      />
      {focused && (
        <>
          <mesh position={[6.25, 0.08, 3.5]}>
            <boxGeometry args={[2.5, 0.1, 2.5]} />
            <meshBasicMaterial color="#a9df78" transparent opacity={0.5} />
          </mesh>
          <mesh position={[-6.25, 0.08, -3.5]}>
            <boxGeometry args={[2.5, 0.1, 2.5]} />
            <meshBasicMaterial color="#efbd72" transparent opacity={0.5} />
          </mesh>
        </>
      )}
    </group>
  );
}

function RuntimeBee({
  projection,
  reducedMotion,
}: {
  projection: VerdantProjection;
  reducedMotion: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const { invalidate } = useThree();
  const target = useMemo<[number, number, number]>(() => {
    switch (projection.activeEvent?.kind) {
      case "GARDEN.SIGNAL_SEND_REQUESTED":
      case "FLOWER.SIGNAL_RECEIVED":
      case "GARDEN.SIGNAL_SENT":
      case "GARDEN.SIGNAL_IGNORED":
        return [-4.1, 2.35, 2.35];
      case "GARDEN.TIME_ADVANCE_REQUESTED":
      case "GARDEN.TIME_ADVANCED":
      case "VERDANT.TIMEOUT_REJECTED":
        return [4.05, 2.35, -2.35];
    }

    if (
      projection.currentStepId === "yard-move" ||
      projection.selectedPath === "yard-move"
    ) {
      return [5.45, 2.6, 3.5];
    }
    if (
      projection.currentStepId === "timed-out" ||
      projection.selectedPath === "timed-out"
    ) {
      return [-5.45, 2.6, -3.5];
    }
    return [-0.8, 3.15, 0.25];
  }, [
    projection.activeEvent?.kind,
    projection.currentStepId,
    projection.selectedPath,
  ]);

  useEffect(() => {
    invalidate();
  }, [invalidate, projection.activeEvent?.sequence, target]);

  useFrame((state, delta) => {
    const group = groupRef.current;
    if (!group) return;
    if (reducedMotion) {
      group.position.set(...target);
      return;
    }
    const destination = new THREE.Vector3(...target);
    const remaining = group.position.distanceTo(destination);
    group.position.lerp(destination, 1 - Math.exp(-delta * 4.8));
    group.rotation.y = Math.sin(state.clock.elapsedTime * 4) * 0.05;
    if (remaining > 0.012) invalidate();
  });

  return (
    <group ref={groupRef} position={[-0.8, 3.15, 0.25]}>
      <mesh castShadow>
        <boxGeometry args={[0.78, 0.55, 0.58]} />
        <meshLambertMaterial color="#f0bf45" />
      </mesh>
      <mesh position={[-0.1, 0, 0]}>
        <boxGeometry args={[0.18, 0.57, 0.6]} />
        <meshLambertMaterial color="#443d31" />
      </mesh>
      <mesh position={[0.24, 0, 0]}>
        <boxGeometry args={[0.16, 0.57, 0.6]} />
        <meshLambertMaterial color="#443d31" />
      </mesh>
      <mesh position={[-0.1, 0.41, 0.28]} rotation={[0.18, 0, 0.18]}>
        <boxGeometry args={[0.5, 0.08, 0.4]} />
        <meshLambertMaterial color="#dcead3" transparent opacity={0.84} />
      </mesh>
      <mesh position={[-0.1, 0.41, -0.28]} rotation={[-0.18, 0, 0.18]}>
        <boxGeometry args={[0.5, 0.08, 0.4]} />
        <meshLambertMaterial color="#dcead3" transparent opacity={0.84} />
      </mesh>
    </group>
  );
}

function SceneContents(props: VerdantSignalSceneProps) {
  const { projection, focus, onFocus } = props;
  const { invalidate } = useThree();

  useEffect(() => {
    invalidate();
  }, [focus, invalidate, projection.activeEvent?.sequence]);

  return (
    <>
      <color attach="background" args={["#aed59f"]} />
      <fog attach="fog" args={["#aed59f", 16, 36]} />
      <hemisphereLight args={["#fff5cf", "#425f37", 2.15]} />
      <directionalLight
        position={[8, 13, 7]}
        intensity={2.35}
        color="#fff0bf"
        castShadow
        shadow-mapSize-width={512}
        shadow-mapSize-height={512}
        shadow-camera-left={-11}
        shadow-camera-right={11}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
      />
      <GardenTerrain />
      {TREE_POSITIONS.map((position, index) => (
        <BlockTree
          key={`${position.join(":")}`}
          position={position}
          scale={0.82 + (index % 3) * 0.08}
        />
      ))}
      <WaitPavilion
        projection={projection}
        focused={focus === "wait"}
        onFocus={() => onFocus("wait")}
      />
      <SignalLantern
        projection={projection}
        focused={focus === "signal"}
        onFocus={() => onFocus("signal")}
      />
      <TimeoutClock
        projection={projection}
        focused={focus === "timeout"}
        onFocus={() => onFocus("timeout")}
      />
      <RouteGarden
        projection={projection}
        focused={focus === "routes"}
        onFocus={() => onFocus("routes")}
      />
      <RuntimeBee {...props} />
    </>
  );
}

export function VerdantSignalScene(props: VerdantSignalSceneProps) {
  return (
    <Canvas
      className={styles.canvas}
      aria-hidden="true"
      camera={{ position: [12, 11, 15], fov: 40, near: 0.1, far: 80 }}
      dpr={[1, 1.4]}
      frameloop="demand"
      shadows
      gl={{
        antialias: false,
        alpha: false,
        powerPreference: "high-performance",
        stencil: false,
      }}
      onCreated={({ camera, gl }) => {
        camera.lookAt(0, 0.7, 0);
        gl.outputColorSpace = THREE.SRGBColorSpace;
      }}
    >
      <Suspense fallback={null}>
        <SceneContents {...props} />
      </Suspense>
    </Canvas>
  );
}
