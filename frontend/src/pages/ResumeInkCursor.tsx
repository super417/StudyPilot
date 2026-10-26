import { useEffect } from 'react';
import * as THREE from 'three';

const SIMULATION_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const SIMULATION_FRAGMENT = `
  precision highp float;
  uniform sampler2D inputTexture;
  uniform sampler2D noiseTexture;
  uniform vec2 tipPosOld;
  uniform vec2 tipPosNew;
  uniform float speed;
  uniform float persistence;
  uniform float thickness;
  uniform float time;
  uniform float waterQuantity;
  uniform float waterDiffusion;
  uniform float gravity;
  uniform vec3 inkColor;
  varying vec2 vUv;

  float lineSegment(vec2 p, vec2 a, vec2 b, float thickness) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float distanceToLine = length(pa - ba * h);
    return smoothstep(thickness, thickness * 0.5, distanceToLine);
  }

  vec4 blur(sampler2D image, vec2 uv, vec2 resolution, vec2 direction) {
    vec4 color = vec4(0.0);
    vec2 off1 = vec2(0.013846153846) * direction;
    vec2 off2 = vec2(0.032307692308) * direction;
    color += texture2D(image, uv) * 0.2270270270;
    color += texture2D(image, uv + vec2(off1 * resolution)) * 0.3162162162;
    color += texture2D(image, uv - vec2(off1 * resolution)) * 0.3162162162;
    color += texture2D(image, uv + vec2(off2 * resolution)) * 0.0702702703;
    color += texture2D(image, uv - vec2(off2 * resolution)) * 0.0702702703;
    return color;
  }

  void main() {
    vec4 noise1 = texture2D(noiseTexture, vUv * 4.0 + vec2(time * 0.1, 0.0));
    vec4 noise2 = texture2D(noiseTexture, vUv * 8.0 + vec2(0.0, time * 0.1) + noise1.rg * 0.5);
    vec4 noise3 = texture2D(noiseTexture, vUv * 16.0 + vec2(-time * 0.05, 0.0) + noise2.rg * 0.5);
    vec4 noise = (noise1 + noise2 * 0.5 + noise3 * 0.25) / 1.75;
    float dirX = (-0.5 + noise.g) * noise.r * 10.0;
    float dirY = (-0.5 + noise.b) * noise.r * 10.0;

    vec4 oldTexture = texture2D(inputTexture, vUv);
    float brightness = 1.0 - (oldTexture.r + oldTexture.g + oldTexture.b) / 3.0;
    vec4 color = oldTexture * (1.0 - waterDiffusion);
    float blurWeight = waterDiffusion * 0.25;
    vec2 stretchedUv = vUv * vec2(1.0, 1.0 + gravity);
    vec2 blurScale = vec2(waterQuantity * brightness);
    color += blur(inputTexture, stretchedUv, blurScale, vec2(dirX, dirY)) * blurWeight;
    color += blur(inputTexture, stretchedUv, blurScale, vec2(dirY, dirX)) * blurWeight;
    color += blur(inputTexture, stretchedUv, blurScale, vec2(-dirX, -dirY)) * blurWeight;
    color += blur(inputTexture, stretchedUv, blurScale, vec2(-dirY, -dirX)) * blurWeight;
    color.rgb *= persistence;

    if (speed > 0.0) {
      float lineValue = lineSegment(vUv, tipPosOld, tipPosNew, clamp(thickness + speed * 0.12, 0.0001, 0.1));
      color.rgb = mix(color.rgb, inkColor, lineValue);
      color.rgb = clamp(color.rgb, vec3(0.0), vec3(1.0));
    }

    gl_FragColor = color;
  }
`;

const DISPLAY_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const DISPLAY_FRAGMENT = `
  uniform sampler2D inkTexture;
  varying vec2 vUv;
  void main() {
    vec4 ink = texture2D(inkTexture, vUv);
    float intensity = max(max(ink.r, ink.g), ink.b);
    gl_FragColor = vec4(ink.rgb, smoothstep(0.16, 0.38, intensity));
  }
`;

function makeNoiseTexture(): THREE.DataTexture {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  let seed = 20261025;
  for (let index = 0; index < size * size; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const value = Math.round((seed / 4294967296) * 255);
    const offset = index * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Full-page shader ink trail. Its transparent canvas never captures page input. */
export default function ResumeInkCursor() {
  useEffect(() => {
    const site = document.querySelector<HTMLElement>('.jack-site');
    if (!site || window.matchMedia('(pointer: coarse)').matches) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    } catch {
      return;
    }

    renderer.setPixelRatio(1);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = 'jack-ink-canvas';
    renderer.domElement.setAttribute('aria-hidden', 'true');
    site.prepend(renderer.domElement);
    site.classList.add('jack-ink-pencil-cursor');

    const simulationScene = new THREE.Scene();
    const displayScene = new THREE.Scene();
    const camera = new THREE.Camera();
    const targetA = new THREE.WebGLRenderTarget(1024, 1024, {
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    const targetB = targetA.clone();
    let inputTarget = targetA;
    let outputTarget = targetB;
    const noiseTexture = makeNoiseTexture();
    const simulationMaterial = new THREE.ShaderMaterial({
      vertexShader: SIMULATION_VERTEX,
      fragmentShader: SIMULATION_FRAGMENT,
      uniforms: {
        inputTexture: { value: inputTarget.texture },
        noiseTexture: { value: noiseTexture },
        tipPosOld: { value: new THREE.Vector2(0.5, 0.5) },
        tipPosNew: { value: new THREE.Vector2(0.5, 0.5) },
        speed: { value: 0 },
        // Original: 0.98. A smaller value makes the ink fade sooner.
        persistence: { value: 0.9 },
        thickness: { value: 0.002 },
        time: { value: 0 },
        // Original: 0.3. A smaller value keeps the spread nearer the cursor.
        waterQuantity: { value: 0.08 },
        waterDiffusion: { value: 0.1 },
        gravity: { value: 0.5 },
        inkColor: { value: new THREE.Color(0x7beeff) },
      },
      depthTest: false,
      depthWrite: false,
    });
    const simulationQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), simulationMaterial);
    simulationScene.add(simulationQuad);

    const displayMaterial = new THREE.ShaderMaterial({
      vertexShader: DISPLAY_VERTEX,
      fragmentShader: DISPLAY_FRAGMENT,
      uniforms: { inkTexture: { value: inputTarget.texture } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false,
    });
    displayScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), displayMaterial));

    const pencilGeometry = new THREE.CylinderGeometry(0.05, 0.2, 1, 16, 1);
    pencilGeometry.rotateX(Math.PI);
    pencilGeometry.translate(0, 0.5, 0);
    const pencilMaterial = new THREE.MeshStandardMaterial({
      color: 0xd8d2ca,
      roughness: 1,
      side: THREE.DoubleSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const pencil = new THREE.Mesh(pencilGeometry, pencilMaterial);
    pencil.position.z = 0.1;
    pencil.renderOrder = 1;
    pencil.frustumCulled = false;
    displayScene.add(pencil);
    displayScene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const pencilLight = new THREE.DirectionalLight(0xffffff, 1);
    pencilLight.position.set(2, 3, 4);
    displayScene.add(pencilLight);

    const targetPoint = new THREE.Vector2(0.5, 0.5);
    const oldPoint = new THREE.Vector2(0.5, 0.5);
    const newPoint = new THREE.Vector2(0.5, 0.5);
    const pencilSpeed = new THREE.Vector2();
    const pencilRotation = new THREE.Vector2();
    const inkColor = new THREE.Color();
    let inkActive = false;
    let lastPointerAt = 0;
    let pressed = false;
    let pressure = 0;
    let frame = 0;
    let lastFrameAt = 0;
    let lastTime = performance.now();
    let disposed = false;
    let loadedNoiseTexture: THREE.Texture | null = null;
    const clearInk = () => {
      renderer.setRenderTarget(targetA);
      renderer.clear();
      renderer.setRenderTarget(targetB);
      renderer.clear();
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(displayScene, camera);
    };
    const resize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      const pencilScale = 0.08;
      pencil.scale.set(pencilScale * window.innerHeight / window.innerWidth, pencilScale, pencilScale);
      clearInk();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.jack-site')) return;
      const x = event.clientX / Math.max(1, window.innerWidth);
      const y = 1 - event.clientY / Math.max(1, window.innerHeight);
      targetPoint.set(x, y);
      inkActive = true;
      lastPointerAt = performance.now();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.jack-site')) pressed = true;
    };
    const onPointerUp = () => { pressed = false; };
    const onVisibilityChange = () => {
      if (!document.hidden) return;
      clearInk();
      inkActive = false;
      pressed = false;
      pressure = 0;
    };
    const animate = (now: number) => {
      frame = window.requestAnimationFrame(animate);
      if (now - lastFrameAt < 1000 / 30) return;
      lastFrameAt = now;
      const delta = Math.min((now - lastTime) * 0.001, 0.1);
      lastTime = now;
      if (!inkActive || (now - lastPointerAt > 6000 && pressure < 0.001)) {
        if (inkActive) clearInk();
        inkActive = false;
        return;
      }
      newPoint.lerp(targetPoint, Math.min(1, delta * 5));
      const speed = oldPoint.distanceTo(newPoint);
      pencilSpeed.subVectors(newPoint, oldPoint);
      pencilRotation.lerp(pencilSpeed.multiplyScalar(90), Math.min(1, delta * 30));
      if (pressed && pressure < 0.02) pressure += delta * 0.02;
      else if (!pressed) pressure *= Math.pow(0.9, delta * 30);
      const time = now * 0.001;
      inkColor.setRGB(
        Math.abs(Math.sin(time * 0.61)),
        Math.abs(Math.sin(time * 0.43 + 2.09)),
        Math.abs(Math.sin(time * 0.36 + 4.18)),
      );
      simulationMaterial.uniforms.time.value = now * 0.001;
      simulationMaterial.uniforms.inputTexture.value = inputTarget.texture;
      simulationMaterial.uniforms.tipPosOld.value.copy(oldPoint);
      simulationMaterial.uniforms.tipPosNew.value.copy(newPoint);
      simulationMaterial.uniforms.speed.value = speed;
      simulationMaterial.uniforms.persistence.value = Math.pow(0.9, delta * 10);
      simulationMaterial.uniforms.gravity.value = 0.5 * delta;
      simulationMaterial.uniforms.thickness.value = 0.002 + pressure;
      simulationMaterial.uniforms.inkColor.value.copy(inkColor);
      pencil.position.set(newPoint.x * 2 - 1, newPoint.y * 2 - 1, 0.1);
      pencil.rotation.z = Math.max(-0.7, Math.min(0.7, pencilRotation.x)) - 0.2;
      pencil.rotation.x = Math.max(-0.4, Math.min(0.4, pencilRotation.y)) + 0.15;
      const pencilScale = 0.08;
      const pressureScale = 1 + pressure * 40;
      pencil.scale.set(
        pencilScale * window.innerHeight / window.innerWidth * pressureScale,
        pencilScale * (1 - pressure * 10),
        pencilScale * pressureScale,
      );

      renderer.setRenderTarget(outputTarget);
      renderer.render(simulationScene, camera);
      [inputTarget, outputTarget] = [outputTarget, inputTarget];
      displayMaterial.uniforms.inkTexture.value = inputTarget.texture;
      renderer.setRenderTarget(null);
      renderer.render(displayScene, camera);
      oldPoint.copy(newPoint);
    };

    resize();
    new THREE.TextureLoader().load(
      'https://assets.codepen.io/264161/noise_1.jpg',
      (texture) => {
        if (disposed) {
          texture.dispose();
          return;
        }
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        loadedNoiseTexture = texture;
        simulationMaterial.uniforms.noiseTexture.value = texture;
      },
    );
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('blur', onPointerUp);
    document.addEventListener('visibilitychange', onVisibilityChange);
    frame = window.requestAnimationFrame(animate);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('blur', onPointerUp);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      targetA.dispose();
      targetB.dispose();
      noiseTexture.dispose();
      loadedNoiseTexture?.dispose();
      simulationQuad.geometry.dispose();
      simulationMaterial.dispose();
      displayScene.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      displayMaterial.dispose();
      pencilMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      site.classList.remove('jack-ink-pencil-cursor');
    };
  }, []);

  return <div className="jack-ink-instructions" aria-hidden="true">移动鼠标绘制 · 按住加粗</div>;
}
