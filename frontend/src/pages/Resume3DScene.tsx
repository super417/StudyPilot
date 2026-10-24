import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

export interface SceneMotion {
  pointerX: number;
  pointerY: number;
  scroll: number;
}

interface SceneProps {
  motion: React.MutableRefObject<SceneMotion>;
  lowPower: boolean;
  active: boolean;
  onReady: () => void;
}

function textTexture(label: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 320;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '800 228px "Microsoft YaHei", "PingFang SC", sans-serif';
    context.fillStyle = color;
    context.shadowColor = color;
    context.shadowBlur = 26;
    context.fillText(label, canvas.width / 2, canvas.height / 2, 1900);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function FloatingText({
  label,
  color,
  position,
  opacity,
}: {
  label: string;
  color: string;
  position: [number, number, number];
  opacity: number;
}) {
  const texture = useMemo(() => textTexture(label, color), [label, color]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <mesh position={position}>
      <planeGeometry args={[7.8, 1.22]} />
      <meshBasicMaterial map={texture} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

function ParticleField({ lowPower }: { lowPower: boolean }) {
  const count = lowPower ? 100 : 380;
  const positions = useMemo(() => {
    const values = new Float32Array(count * 3);
    let seed = 20261024;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let index = 0; index < count; index += 1) {
      values[index * 3] = (random() - 0.5) * 18;
      values[index * 3 + 1] = (random() - 0.5) * 12;
      values[index * 3 + 2] = (random() - 0.5) * 10;
    }
    return values;
  }, [count]);

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#f6d7b1" size={lowPower ? 0.024 : 0.031} transparent opacity={0.72} sizeAttenuation />
    </points>
  );
}

function SceneContents({ motion, lowPower }: Pick<SceneProps, 'motion' | 'lowPower'>) {
  const group = useRef<THREE.Group>(null);
  const particles = useRef<THREE.Group>(null);
  const { camera } = useThree();

  useFrame((state, delta) => {
    const ease = Math.min(1, delta * 2.3);
    const targetZ = 8.8 - motion.current.scroll * 2.6;
    camera.position.z += (targetZ - camera.position.z) * ease;
    if (group.current) {
      group.current.rotation.y += (motion.current.pointerX * 0.13 - group.current.rotation.y) * ease;
      group.current.rotation.x += (-motion.current.pointerY * 0.075 - group.current.rotation.x) * ease;
      group.current.position.y = Math.sin(state.clock.elapsedTime * 0.55) * 0.08;
    }
    if (particles.current) {
      particles.current.rotation.y += (motion.current.pointerX * 0.06 - particles.current.rotation.y) * ease;
      particles.current.position.y = -motion.current.scroll * 0.8;
    }
  });

  return (
    <>
      <color attach="background" args={['#0c0c0c']} />
      <group ref={particles}><ParticleField lowPower={lowPower} /></group>
      <group ref={group}>
        <FloatingText label="学习能力" color="#f8e7d1" position={[-0.12, 0.72, -0.4]} opacity={0.93} />
        <FloatingText label="有证可循" color="#bda5ff" position={[0.22, -0.64, -1.75]} opacity={0.7} />
        <mesh position={[2.85, 0.04, -2.3]} rotation={[0.5, 0.28, 0.2]}>
          <torusGeometry args={[1.62, 0.018, 8, 90]} />
          <meshBasicMaterial color="#ffb577" transparent opacity={0.48} />
        </mesh>
        <mesh position={[-2.9, -0.12, -2.8]} rotation={[0.25, -0.1, -0.4]}>
          <torusGeometry args={[1.35, 0.014, 8, 90]} />
          <meshBasicMaterial color="#a99af1" transparent opacity={0.34} />
        </mesh>
      </group>
    </>
  );
}

export default function Resume3DScene({ motion, lowPower, active, onReady }: SceneProps) {
  return (
    <Canvas
      camera={{ position: [0, 0, 12], fov: 58, near: 0.1, far: 100 }}
      frameloop={active ? 'always' : 'never'}
      dpr={lowPower ? 1 : [1, 1.5]}
      gl={{ antialias: !lowPower, alpha: false, powerPreference: lowPower ? 'low-power' : 'default' }}
      onCreated={onReady}
      aria-label="漂浮的学习能力文字和粒子背景"
    >
      <SceneContents motion={motion} lowPower={lowPower} />
    </Canvas>
  );
}
