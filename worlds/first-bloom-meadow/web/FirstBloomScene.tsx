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
import type { FirstBloomProjection } from "../../../web/runtime/types";

const STEP_POSITIONS: Record<string, [number, number, number]> = {
  "prepare-soil": [-2.5, 0.65, 1.8],
  "grow-stem": [1, 0.65, 0],
  bloom: [4.3, 0.65, -1.8],
};

const TREE_POSITIONS: Array<[number, number, number]> = [
  [-7, 0, -5],
  [-5.7, 0, 5.3],
  [-2.1, 0, -5.8],
  [2.2, 0, 5.5],
  [6.2, 0, -5],
  [7.1, 0, 3.9],
];

interface FirstBloomSceneProps {
  projection: FirstBloomProjection;
  reducedMotion: boolean;
  selectedStepId?: string;
  onSelectStep: (stepId: string) => void;
}

function seededHeight(x: number, z: number): number {
  const value = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return Math.abs(value % 1);
}

function MeadowTerrain() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const blocks = useMemo(() => {
    const result: Array<{
      position: [number, number, number];
      scale: [number, number, number];
      color: THREE.Color;
    }> = [];

    for (let x = -9; x <= 9; x += 1) {
      for (let z = -7; z <= 7; z += 1) {
        const edge = Math.abs(x) > 7 || Math.abs(z) > 5;
        const variation = seededHeight(x, z);
        const height = edge && variation > 0.52 ? 0.65 : 0.42;
        const isPath = Math.abs(z + x * 0.28) < 0.92 && x > -6;
        const color = isPath
          ? new THREE.Color(variation > 0.5 ? "#d6bc79" : "#c9aa68")
          : new THREE.Color(
              variation > 0.72
                ? "#78a84e"
                : variation > 0.35
                  ? "#6f9e46"
                  : "#628f3f",
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
  scale = 1,
}: {
  position: [number, number, number];
  scale?: number;
}) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 1.25, 0]} castShadow>
        <boxGeometry args={[0.55, 2.5, 0.55]} />
        <meshLambertMaterial color="#76512f" />
      </mesh>
      <mesh position={[0, 2.7, 0]} castShadow>
        <boxGeometry args={[2.15, 1.25, 1.8]} />
        <meshLambertMaterial color="#3f7e42" />
      </mesh>
      <mesh position={[-0.45, 3.45, 0.1]} castShadow>
        <boxGeometry args={[1.15, 0.75, 1.2]} />
        <meshLambertMaterial color="#4d914c" />
      </mesh>
      <mesh position={[0.55, 3.35, -0.2]} castShadow>
        <boxGeometry args={[1.05, 0.8, 1.1]} />
        <meshLambertMaterial color="#559d50" />
      </mesh>
    </group>
  );
}

function EngineShrine({ active }: { active: boolean }) {
  return (
    <group position={[-6, 0.2, 2.9]}>
      <mesh position={[0, 0.32, 0]} receiveShadow castShadow>
        <boxGeometry args={[2.2, 0.65, 2.2]} />
        <meshLambertMaterial color="#8a927f" />
      </mesh>
      <mesh position={[0, 1.25, 0]} castShadow>
        <boxGeometry args={[1.25, 1.25, 1.25]} />
        <meshLambertMaterial color={active ? "#ffe08a" : "#b8c49a"} />
      </mesh>
      <mesh position={[0, 1.25, 0]}>
        <boxGeometry args={[0.72, 0.72, 0.72]} />
        <meshBasicMaterial color={active ? "#fff3ad" : "#75956a"} />
      </mesh>
      <mesh position={[0, 2.12, 0]} castShadow>
        <boxGeometry args={[1.7, 0.25, 1.7]} />
        <meshLambertMaterial color="#d9cf9a" />
      </mesh>
    </group>
  );
}

function TilledSoil({ ready }: { ready: boolean }) {
  return (
    <group>
      <mesh position={[0, 0.12, 0]} receiveShadow>
        <boxGeometry args={[2.25, 0.32, 1.75]} />
        <meshLambertMaterial color={ready ? "#7a4e2f" : "#977253"} />
      </mesh>
      {[-0.62, 0, 0.62].map((z) => (
        <mesh key={z} position={[0, 0.32, z]}>
          <boxGeometry args={[1.8, 0.12, 0.14]} />
          <meshLambertMaterial color="#4f3525" />
        </mesh>
      ))}
    </group>
  );
}

function Sprout({ grown }: { grown: boolean }) {
  const stemHeight = grown ? 1.65 : 0.42;
  return (
    <group position={[0, 0.26, 0]}>
      <mesh position={[0, stemHeight / 2, 0]} castShadow>
        <boxGeometry args={[0.22, stemHeight, 0.22]} />
        <meshLambertMaterial color="#4d923e" />
      </mesh>
      <mesh
        position={[-0.36, grown ? 0.95 : 0.3, 0]}
        rotation={[0, 0, 0.45]}
        castShadow
      >
        <boxGeometry args={[0.62, 0.18, 0.46]} />
        <meshLambertMaterial color="#67ad4f" />
      </mesh>
      {grown && (
        <mesh
          position={[0.38, 1.28, 0]}
          rotation={[0, 0, -0.45]}
          castShadow
        >
          <boxGeometry args={[0.62, 0.18, 0.46]} />
          <meshLambertMaterial color="#74bd57" />
        </mesh>
      )}
    </group>
  );
}

function PixelBloom({ blooming }: { blooming: boolean }) {
  if (!blooming) return <Sprout grown={false} />;
  const petals: Array<[number, number, number]> = [
    [-0.42, 2.02, 0],
    [0.42, 2.02, 0],
    [0, 2.42, 0],
    [0, 1.62, 0],
  ];
  return (
    <group>
      <Sprout grown />
      {petals.map((position, index) => (
        <mesh key={index} position={position} castShadow>
          <boxGeometry args={[0.58, 0.58, 0.38]} />
          <meshLambertMaterial color={index % 2 ? "#fff2a8" : "#f8e585"} />
        </mesh>
      ))}
      <mesh position={[0, 2.02, 0.08]} castShadow>
        <boxGeometry args={[0.52, 0.52, 0.52]} />
        <meshLambertMaterial color="#e49b42" />
      </mesh>
    </group>
  );
}

function StepPlot({
  stepId,
  index,
  projection,
  selected,
  onSelect,
}: {
  stepId: string;
  index: number;
  projection: FirstBloomProjection;
  selected: boolean;
  onSelect: () => void;
}) {
  const position = STEP_POSITIONS[stepId];
  const entered = projection.enteredStepIds.includes(stepId);
  const complete = projection.completedStepIds.includes(stepId);
  const active = projection.currentStepId === stepId;
  const soilReady = projection.flowerStage >= 1;
  const stemReady = projection.flowerStage >= 2;
  const flowerReady = projection.flowerStage >= 3;

  return (
    <group
      position={position}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <mesh position={[0, -0.06, 0]} receiveShadow>
        <boxGeometry args={[2.85, 0.38, 2.35]} />
        <meshLambertMaterial
          color={
            active
              ? "#f6d978"
              : selected
                ? "#d9e7a8"
                : complete
                  ? "#a8c778"
                  : "#91ad6c"
          }
        />
      </mesh>
      <TilledSoil ready={soilReady || index > 0} />
      {index === 1 && <Sprout grown={stemReady} />}
      {index === 2 && <PixelBloom blooming={flowerReady} />}
      <mesh position={[-1.1, 0.58, -0.82]} castShadow>
        <boxGeometry args={[0.2, 0.8, 0.2]} />
        <meshLambertMaterial color="#6b4b2f" />
      </mesh>
      <mesh position={[-1.1, 0.92, -0.82]} castShadow>
        <boxGeometry args={[1.12, 0.48, 0.16]} />
        <meshLambertMaterial color={entered ? "#f7efc2" : "#cdbd85"} />
      </mesh>
      {(active || selected) && (
        <mesh position={[0, 0.14, 0]}>
          <boxGeometry args={[3.02, 0.12, 2.52]} />
          <meshBasicMaterial
            color={active ? "#ffe487" : "#d6f2a9"}
            transparent
            opacity={0.68}
          />
        </mesh>
      )}
    </group>
  );
}

function WorkerBee({
  stepId,
  sequence,
  reducedMotion,
}: {
  stepId?: string;
  sequence: number;
  reducedMotion: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const target = useMemo<[number, number, number]>(() => {
    const stepTarget = stepId ? STEP_POSITIONS[stepId] : undefined;
    if (!stepTarget) return [-5.25, 2.2, 2.9];
    return [stepTarget[0] - 0.95, 2.55, stepTarget[2] + 0.35];
  }, [stepId]);
  const { invalidate } = useThree();

  useEffect(() => {
    invalidate();
  }, [invalidate, sequence, target]);

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
    group.position.y += Math.sin(state.clock.elapsedTime * 5) * 0.0025;
    if (remaining > 0.012) invalidate();
  });

  return (
    <group ref={groupRef} position={[-5.25, 2.2, 2.9]}>
      <mesh castShadow>
        <boxGeometry args={[0.78, 0.56, 0.58]} />
        <meshLambertMaterial color="#f0bd42" />
      </mesh>
      <mesh position={[-0.1, 0, 0]}>
        <boxGeometry args={[0.18, 0.58, 0.6]} />
        <meshLambertMaterial color="#4a4234" />
      </mesh>
      <mesh position={[0.24, 0, 0]}>
        <boxGeometry args={[0.16, 0.58, 0.6]} />
        <meshLambertMaterial color="#4a4234" />
      </mesh>
      <mesh position={[-0.1, 0.42, 0.27]} rotation={[0.2, 0, 0.2]}>
        <boxGeometry args={[0.5, 0.08, 0.42]} />
        <meshLambertMaterial color="#dcead2" transparent opacity={0.85} />
      </mesh>
      <mesh position={[-0.1, 0.42, -0.27]} rotation={[-0.2, 0, 0.2]}>
        <boxGeometry args={[0.5, 0.08, 0.42]} />
        <meshLambertMaterial color="#dcead2" transparent opacity={0.85} />
      </mesh>
    </group>
  );
}

function SceneContents({
  projection,
  reducedMotion,
  selectedStepId,
  onSelectStep,
}: FirstBloomSceneProps) {
  const { invalidate } = useThree();
  useEffect(() => {
    invalidate();
  }, [invalidate, projection.activeEvent?.sequence, selectedStepId]);

  return (
    <>
      <color attach="background" args={["#b8dba4"]} />
      <fog attach="fog" args={["#b8dba4", 16, 34]} />
      <hemisphereLight args={["#fff4ce", "#49623b", 2.25]} />
      <directionalLight
        position={[8, 13, 6]}
        intensity={2.4}
        color="#fff2c6"
        castShadow
        shadow-mapSize-width={512}
        shadow-mapSize-height={512}
        shadow-camera-left={-11}
        shadow-camera-right={11}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
      />
      <MeadowTerrain />
      {TREE_POSITIONS.map((position, index) => (
        <BlockTree
          key={index}
          position={position}
          scale={0.85 + (index % 3) * 0.08}
        />
      ))}
      <EngineShrine active={projection.phase !== "NOT_STARTED"} />
      {(["prepare-soil", "grow-stem", "bloom"] as const).map(
        (stepId, index) => (
          <StepPlot
            key={stepId}
            stepId={stepId}
            index={index}
            projection={projection}
            selected={selectedStepId === stepId}
            onSelect={() => onSelectStep(stepId)}
          />
        ),
      )}
      <WorkerBee
        stepId={projection.currentStepId}
        sequence={projection.activeEvent?.sequence ?? 0}
        reducedMotion={reducedMotion}
      />
    </>
  );
}

export function FirstBloomScene(props: FirstBloomSceneProps) {
  return (
    <Canvas
      className="first-bloom-canvas"
      aria-hidden="true"
      camera={{ position: [12, 11, 15], fov: 40, near: 0.1, far: 80 }}
      dpr={[1, 1.45]}
      frameloop="demand"
      shadows
      gl={{
        antialias: false,
        alpha: false,
        powerPreference: "high-performance",
        stencil: false,
      }}
      onCreated={({ camera, gl }) => {
        camera.lookAt(0, 0.55, 0);
        gl.outputColorSpace = THREE.SRGBColorSpace;
      }}
    >
      <Suspense fallback={null}>
        <SceneContents {...props} />
      </Suspense>
    </Canvas>
  );
}

