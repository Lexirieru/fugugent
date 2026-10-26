/**
 * The HelloFugu coin in real 3D: an orange metal disc with the Guardian fish on both
 * faces, lit by a CC0 studio HDRI from Poly Haven (studio_small_09, by Sergej
 * Majboroda) so the metal has something real to reflect.
 *
 * Assets load through delayRender, so no frame is captured before the HDRI and the
 * face texture are on the GPU.
 */
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import { useEffect, useState } from "react";
import { continueRender, delayRender, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import * as THREE from "three";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

function useAsset<T>(load: () => Promise<T>, label: string): T | null {
  const [value, setValue] = useState<T | null>(null);
  const [handle] = useState(() => delayRender(label));
  useEffect(() => {
    load().then((v) => {
      setValue(v);
      continueRender(handle);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}

let envPromise: Promise<THREE.DataTexture> | null = null;
let facePromise: Promise<THREE.Texture> | null = null;
const loadEnv = () =>
  (envPromise ??= new RGBELoader().loadAsync(staticFile("film/studio_small_09_1k.hdr")).then((t) => {
    t.mapping = THREE.EquirectangularReflectionMapping;
    return t;
  }));
const loadFace = () =>
  (facePromise ??= new THREE.TextureLoader().loadAsync(staticFile("film/coin-face.png")).then((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }));

function Environment({ env }: { env: THREE.Texture }) {
  const { scene } = useThree();
  useEffect(() => {
    scene.environment = env;
    scene.environmentIntensity = 1.15;
  }, [env, scene]);
  return null;
}

export type CoinPose = { x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number; scale?: number };

/** One coin. Its axis faces the camera at rx = ry = 0. */
export function CoinMesh({ face, pose }: { face: THREE.Texture; pose: CoinPose }) {
  const { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, scale = 1 } = pose;
  const metal = { color: "#fb923c", metalness: 1, roughness: 0.22 } as const;
  return (
    <group position={[x, y, z]} rotation={[rx, ry, rz]} scale={scale}>
      <group rotation={[Math.PI / 2, 0, 0]}>
        <mesh>
          <cylinderGeometry args={[1, 1, 0.18, 128]} />
          <meshStandardMaterial {...metal} />
        </mesh>
      </group>
      {/* The rim, a rounded lip around the edge, and a thin raised ring inside it. */}
      <mesh>
        <torusGeometry args={[0.96, 0.075, 32, 160]} />
        <meshStandardMaterial {...metal} roughness={0.16} />
      </mesh>
      {[1, -1].map((side) => (
        <mesh key={side} position={[0, 0, side * 0.092]}>
          <ringGeometry args={[0.76, 0.8, 160]} />
          <meshStandardMaterial {...metal} color="#fdba74" roughness={0.2} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {[1, -1].map((side) => (
        <group key={side} position={[0, 0, side * 0.093]} rotation={[0, side === 1 ? 0 : Math.PI, 0]}>
          <mesh>
            <circleGeometry args={[0.74, 128]} />
            <meshStandardMaterial color="#121e29" metalness={0.6} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0, 0.002]}>
            <circleGeometry args={[0.7, 128]} />
            <meshStandardMaterial map={face} transparent metalness={0.15} roughness={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** A transparent canvas holding the coins `poses(t)` returns for the scene's own time `t`. */
export function Coins({ poses, fov = 32 }: { poses: (t: number) => CoinPose[]; fov?: number }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const env = useAsset(loadEnv, "studio HDRI");
  const face = useAsset(loadFace, "coin face");
  return (
    <ThreeCanvas width={width} height={height} camera={{ fov, position: [0, 0, 6] }} gl={{ alpha: true, antialias: true }} style={{ position: "absolute", inset: 0 }}>
      <ambientLight intensity={0.25} />
      <directionalLight position={[3, 4, 5]} intensity={2.2} />
      <directionalLight position={[-4, -2, 2]} intensity={0.8} color="#fdba74" />
      {env && face ? (
        <>
          <Environment env={env} />
          {poses(frame / fps).map((p, i) => (
            <CoinMesh key={i} face={face} pose={p} />
          ))}
        </>
      ) : null}
    </ThreeCanvas>
  );
}
