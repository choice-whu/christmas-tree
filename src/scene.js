const GOLD = 0xffd591;
const POINTER_SLOP = 7;
const BRANCH_TIERS = [
  { y: -2.91, radius: 2.99, rise: 1.49, branches: 13 },
  { y: -1.96, radius: 2.63, rise: 1.48, branches: 12 },
  { y: -1.00, radius: 2.20, rise: 1.42, branches: 11 },
  { y: -.04, radius: 1.75, rise: 1.38, branches: 10 },
  { y: .92, radius: 1.26, rise: 1.32, branches: 9 },
  { y: 1.87, radius: .83, rise: 1.45, branches: 8 },
];

function randomSequence(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function spherePoint(random, radius) {
  const y = random() * 2 - 1;
  const angle = random() * Math.PI * 2;
  const horizontal = Math.sqrt(1 - y * y) * radius;
  return [Math.cos(angle) * horizontal, y * radius, Math.sin(angle) * horizontal];
}

function branchRim(tier, angle) {
  const needleFan = (.5 + .5 * Math.cos(angle * tier.branches + tier.y * 1.8)) ** 1.6;
  return .84 + .16 * needleFan + .035 * Math.sin(angle * 3 + tier.y);
}

function pointCloud(THREE, treePositions, nebulaPositions, colors, sizes, phases, scale) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, values, width] of [
    ['position', treePositions, 3], ['aNebula', nebulaPositions, 3],
    ['aTint', colors, 3], ['aSize', sizes, 1], ['aPhase', phases, 1],
  ]) {
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, width));
  }
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uShape: { value: 0 }, uTime: { value: 0 }, uScale: { value: scale }, uSpread: { value: 1 },
    },
    vertexShader: [
      'attribute vec3 aNebula; attribute vec3 aTint; attribute float aSize; attribute float aPhase;',
      'uniform float uShape; uniform float uTime; uniform float uScale; uniform float uSpread;',
      'varying vec3 vTint; varying float vPulse;',
      'void main() {',
      '  float stagger = fract(aPhase * 0.15915494 + position.y * 0.085);',
      '  float local = clamp((uShape - stagger * 0.24) / 0.76, 0.0, 1.0);',
      '  float t = local * local * (3.0 - 2.0 * local);',
      '  vec3 targetPos = aNebula * vec3(uSpread, 1.0, uSpread);',
      '  vec3 point = mix(position, targetPos, t);',
      '  float swirl = sin(t * 3.14159265) * (0.95 + stagger * 0.55);',
      '  float cs = cos(swirl);',
      '  float sn = sin(swirl);',
      '  point.xz = mat2(cs, -sn, sn, cs) * point.xz;',
      '  point.y += sin(t * 3.14159265) * 0.16 * (stagger - 0.5);',
      '  float shimmer = sin(uTime * 1.2 + aPhase);',
      '  point.x += sin(uTime * .62 + aPhase) * .035 * t;',
      '  vec4 eyePoint = modelViewMatrix * vec4(point, 1.);',
      '  gl_Position = projectionMatrix * eyePoint;',
      '  gl_PointSize = clamp(aSize * uScale * 14. / -eyePoint.z, 1., 56.);',
      '  vTint = aTint; vPulse = (.77 + .23 * shimmer) * (1.0 + 0.18 * sin(t * 3.14159265));',
      '}',
    ].join('\n'),
    fragmentShader: [
      'varying vec3 vTint; varying float vPulse;',
      'void main() {',
      '  vec2 d = gl_PointCoord * 2.0 - 1.0;',
      '  float d2 = dot(d, d);',
      '  if (d2 > 1.0) discard;',
      '  float inv = 1.0 - d2;',
      '  float inv2 = inv * inv;',
      '  float halo = inv2 * inv2 * inv;',
      '  float core = smoothstep(0.09, 0.0036, d2);',
      '  gl_FragColor = vec4(vTint, (core * 0.84 + halo * 0.48) * vPulse);',
      '}',
    ].join('\n'),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

function makeTree(THREE, density, pixelRatio) {
  const random = randomSequence(1832);
  const tree = [], nebula = [], colors = [], sizes = [], phases = [];
  const green = [0x24563f, 0x367b4e, 0x459663, 0x79aa66];
  const warm = [0xd69544, 0xf4b96b, 0xffd49b, 0xffe9bc];
  const red = [0xbe332e, 0xd34c41, 0xef6756];
  const ink = new THREE.Color();
  const add = (x, y, z, tint, size) => {
    tree.push(x, y, z);
    const cloud = spherePoint(random, 1.35 + Math.pow(random(), .64) * 4.15);
    nebula.push(cloud[0] * 1.09, cloud[1] * .74 + cloud[0] * .16, cloud[2] * .77);
    ink.setHex(tint);
    colors.push(ink.r, ink.g, ink.b);
    sizes.push(size * 1.08);
    phases.push(random() * Math.PI * 2);
  };

  for (const [index, tier] of BRANCH_TIERS.entries()) {
    const needles = Math.round((650 + tier.radius * 790) * density);
    for (let i = 0; i < needles; i++) {
      const angle = random() * Math.PI * 2;
      const outward = Math.pow(random(), .49);
      const rim = branchRim(tier, angle);
      const radius = tier.radius * outward * rim;
      const droop = outward ** 3 * (.18 - .08 * Math.sin(angle * tier.branches));
      const y = tier.y + tier.rise * (1 - outward ** .78) - droop
        + (random() - .5) * (.12 + .48 * (1 - outward));
      const tone = random();
      const palette = tone < .026 ? red : tone < .23 ? warm : green;
      const size = tone < .026 ? 4 + random() * 4.7 : 2.8 + random() * 4.5;
      add(Math.cos(angle) * radius, y, Math.sin(angle) * radius,
        palette[Math.floor(random() * palette.length)], size);
    }

    const lamps = Math.round((137 + tier.radius * 108) * density);
    for (let i = 0; i < lamps; i++) {
      const progress = i / lamps;
      const angle = progress * Math.PI * 1.84 + index * 1.1 + .21;
      const rim = branchRim(tier, angle);
      const radius = tier.radius * rim * (.89 + .075 * (1 - progress)) + random() * .09;
      const y = tier.y + .012 + progress * .32 + Math.sin(angle * 2) * .13 + (random() - .5) * .13;
      const bright = random() < .16;
      add(Math.cos(angle) * radius, y, Math.sin(angle) * radius,
        bright ? 0xffe6b1 : warm[i % warm.length], bright ? 7 + random() * 4.3 : 3.2 + random() * 4);
    }
  }

  for (let i = 0; i < 340 * density; i++) {
    const angle = random() * Math.PI * 2;
    const radius = 2.64 + random() * .54;
    add(Math.cos(angle) * radius, -3.44 + (random() - .5) * .13, Math.sin(angle) * radius,
      warm[i % warm.length], 2.8 + random() * 4.2);
  }
  for (let i = 0; i < 60 * density; i++) {
    const angle = random() * Math.PI * 2;
    const radius = random() * .39;
    add(Math.cos(angle) * radius, 3.51 + Math.sin(angle) * radius, (random() - .5) * .25,
      warm[i % warm.length], 2.1 + random() * 5);
  }
  return pointCloud(THREE, tree, nebula, colors, sizes, phases, pixelRatio);
}

function makeStars(THREE, pixelRatio) {
  const random = randomSequence(38769);
  const positions = [], colors = [], sizes = [], phases = [];
  for (let i = 0; i < 450; i++) {
    positions.push((random() - .5) * 19, (random() - .5) * 13, -2.4 - random() * 4.7);
    colors.push(.55, .66, .78);
    sizes.push(.9 + Math.pow(random(), 5) * 4.8);
    phases.push(random() * 6.28);
  }
  return pointCloud(THREE, positions, positions, colors, sizes, phases, pixelRatio);
}

function makeFinial(THREE) {
  const group = new THREE.Group();
  const path = new THREE.Shape();
  for (let i = 0; i < 8; i++) {
    const angle = Math.PI / 2 + Math.PI * i / 4;
    const radius = i % 2 ? .115 : .41;
    const x = Math.cos(angle) * radius * .83;
    const y = Math.sin(angle) * radius;
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();
  const face = new THREE.Mesh(new THREE.ShapeGeometry(path), new THREE.MeshBasicMaterial({ color: 0xffe9b5, side: THREE.DoubleSide, transparent: true }));
  group.add(face);
  group.position.set(0, 3.53, .15);
  return group;
}

const FRONT_POSITIONS = [
  [-.49, 1.92, .72], [.77, 1.20, .86], [-.96, .71, 1.16], [.54, .14, 1.55],
  [-1.57, -.55, 1.43], [1.57, -.84, 1.51], [-1.46, -1.76, 2.10],
  [.64, -2.48, 2.67],
];

const NEBULA_FRONT = [
  [-4.28, 1.52, .95], [3.54, 2.01, 1.18], [-1.54, 2.95, .70], [1.64, -2.89, 1.03],
  [-3.30, -1.75, 1.43], [4.24, -1.29, 1.04], [-.79, -.60, 2.11], [1.27, 1.02, 2.08],
];

function locatePhoto(THREE, index) {
  const random = randomSequence(7327 + index * 719);
  const sideIndex = Math.max(0, index - FRONT_POSITIONS.length);
  const tier = BRANCH_TIERS[sideIndex % BRANCH_TIERS.length];
  const rearFraction = (sideIndex * .61803398875 + .21) % 1;
  const angle = 1.35 + rearFraction * 3.58;
  const radius = tier.radius * branchRim(tier, angle) + .20;
  const tree = FRONT_POSITIONS[index] || [Math.sin(angle) * radius, tier.y + .23 + random() * .33, Math.cos(angle) * radius];
  const cloud = spherePoint(random, 2.8 + random() * 2.13);
  const nebula = NEBULA_FRONT[index] || [cloud[0] * 1.06, cloud[1] * .72 + cloud[0] * .13, cloud[2] * .80];
  return {
    tree: new THREE.Vector3(...tree),
    nebula: new THREE.Vector3(...nebula),
    outward: new THREE.Vector3(tree[0], 0, tree[2]).normalize(),
    tilt: (random() - .5) * .22,
  };
}

export async function loadScene(options) {
  const THREE = await import('./vendor/three.module.js');
  if (!options.isCurrent()) return null;
  return createScene(THREE, options);
}

function createScene(THREE, { mount, photos, reducedMotion, onPhoto, onFailure }) {
  const DEFAULT_TILT_X = -.02;
  const MAX_TILT_X = 1.05;
  const MIN_ZOOM = .68;
  const MAX_ZOOM = 1.42;
  const clampX = value => THREE.MathUtils.clamp(value, -MAX_TILT_X, MAX_TILT_X);
  const compact = matchMedia('(max-width: 690px)').matches || matchMedia('(pointer: coarse)').matches;
  let pixelRatio = Math.min(window.devicePixelRatio || 1, compact ? 1.25 : 1.5);
  const renderer = new THREE.WebGLRenderer({
    alpha: false,
    antialias: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x080d16, 1);
  renderer.outputEncoding = THREE.sRGBEncoding;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, .1, 90);
  const root = new THREE.Group();
  scene.add(root);
  const treePoints = makeTree(THREE, compact ? .50 : .72, pixelRatio);
  const stars = makeStars(THREE, pixelRatio);
  const finial = makeFinial(THREE);
  root.add(treePoints, finial);
  scene.add(stars);
  const photoPlane = new THREE.PlaneGeometry(1, 1);
  const raycaster = new THREE.Raycaster();
  const coordinates = new THREE.Vector2();
  const projected = new THREE.Vector3();
  const world = new THREE.Vector3();
  const spreadPosition = new THREE.Vector3();
  const outward = new THREE.Vector3();
  const axisZ = new THREE.Vector3(0, 0, 1);
  const tiltRotation = new THREE.Quaternion();
  const cameraFacing = new THREE.Quaternion();
  const data = new Map();
  const textureLoader = new THREE.TextureLoader();
  const textureJobs = [];
  const events = new AbortController();
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  let activeJobs = 0;
  let raf = 0;
  let previousTime = 0;
  let elapsed = 0;
  let running = false;
  let dirty = true;
  let disposed = false;
  let targetShape = 0;
  let shapeProgress = 0;
  let shape = 0;
  let aiming = false;
  let highlight = null;
  let hoverId = null;
  let pendingHover = null;
  let targetX = DEFAULT_TILT_X;
  let targetY = .04;
  let targetZoom = 1;
  let zoom = 1;
  let inertiaX = 0;
  let inertiaY = 0;
  let dprSteps = 0;
  let frameSampleSum = 0;
  let frameSampleCount = 0;
  let pointer = null;
  let pinchDistance = 0;
  const activePointers = new Map();
  let viewing = false;
  let floatingPhoto = null;
  let nebulaSpread = 1;

  function resize() {
    const width = mount.clientWidth;
    const height = mount.clientHeight;
    if (!width || !height || disposed) return;
    camera.aspect = width / height;
    nebulaSpread = THREE.MathUtils.clamp(camera.aspect / .97, .68, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    dirty = true;
    if (!running) draw(0);
  }

  function applyEntryScale(entry) {
    if (!entry.image) return;
    const widthPx = entry.image.image?.width || 1;
    const heightPx = entry.image.image?.height || 1;
    const aspect = widthPx / heightPx;
    const size = entry.order < 8 ? .61 : .44;
    const width = size * Math.min(1, aspect);
    const height = size * Math.min(1, 1 / aspect);
    entry.mesh.scale.set(width, height, 1);
    entry.border.scale.set(width + .042, height + .042, 1);
  }

  function removeEntry(id) {
    const entry = data.get(id);
    if (!entry) return;
    entry.disposed = true;
    root.remove(entry.holder);
    entry.image?.dispose();
    entry.mesh.material.dispose();
    entry.border.material.dispose();
    data.delete(id);
  }

  function queuePhoto(photo, order = data.size) {
    if (data.has(photo.id)) return;
    const position = locatePhoto(THREE, order);
    const holder = new THREE.Group();
    const bevel = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const border = new THREE.Mesh(photoPlane, bevel);
    border.position.z = -.014;
    const mesh = new THREE.Mesh(photoPlane, material);
    mesh.userData.photoId = photo.id;
    holder.add(border, mesh);
    holder.position.copy(position.tree);
    holder.visible = false;
    root.add(holder);
    data.set(photo.id, {
      ...position,
      order,
      thumbnail: photo.thumbnail,
      holder,
      mesh,
      border,
      image: null,
      id: photo.id,
      scale: 1,
      hotTint: false,
      lastOpacity: 1,
      disposed: false,
    });
    textureJobs.push(photo);
  }

  function loadNextTextures() {
    while (activeJobs < 4 && textureJobs.length && !disposed) {
      const photo = textureJobs.shift();
      const entry = data.get(photo.id);
      if (!entry || entry.disposed || entry.thumbnail !== photo.thumbnail) continue;
      activeJobs++;
      const done = () => {
        activeJobs--;
        loadNextTextures();
      };
      textureLoader.load(photo.thumbnail, texture => {
        if (disposed || entry.disposed || data.get(photo.id) !== entry) {
          texture.dispose();
          done();
          return;
        }
        texture.encoding = THREE.sRGBEncoding;
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        entry.mesh.material.map = texture;
        entry.mesh.material.needsUpdate = true;
        entry.image = texture;
        applyEntryScale(entry);
        entry.holder.visible = photo.id !== floatingPhoto;
        dirty = true;
        if (!running) draw(0);
        done();
      }, undefined, done);
    }
  }

  function updatePhotos(dt) {
    root.updateWorldMatrix(false, false);
    cameraFacing.copy(root.quaternion).invert();
    const scaleAlpha = (reducedMotion || dt === 0) ? 1 : 1 - Math.exp(-dt / .075);
    for (const entry of data.values()) {
      if (!entry.image) continue;
      spreadPosition.copy(entry.nebula);
      spreadPosition.x *= nebulaSpread;
      spreadPosition.z *= nebulaSpread;
      const photoStagger = (entry.order % 8) / 8 * .22;
      const local = THREE.MathUtils.clamp((shapeProgress - photoStagger) / .78, 0, 1);
      const eased = local * local * (3 - 2 * local);
      entry.holder.position.copy(entry.tree).lerp(spreadPosition, eased);
      const arc = Math.sin(eased * Math.PI) * .55;
      if (arc) {
        const cs = Math.cos(arc);
        const sn = Math.sin(arc);
        const px = entry.holder.position.x;
        const pz = entry.holder.position.z;
        entry.holder.position.x = px * cs - pz * sn;
        entry.holder.position.z = px * sn + pz * cs;
      }
      tiltRotation.setFromAxisAngle(axisZ, entry.tilt);
      entry.holder.quaternion.copy(cameraFacing).multiply(tiltRotation);
      world.copy(entry.holder.position).applyMatrix4(root.matrixWorld);
      const front = THREE.MathUtils.smoothstep(world.z, -.62, 1.05);
      const isPinchHot = highlight === entry.id;
      const isHoverHot = hoverId === entry.id;
      const isHot = isPinchHot || isHoverHot;
      const facing = outward.copy(entry.outward).applyQuaternion(root.quaternion).z;
      const treeVisibility = THREE.MathUtils.smoothstep(facing, .28, .71);
      const opacity = THREE.MathUtils.lerp(treeVisibility * .99, .58 + front * .38, eased);
      entry.lastOpacity = opacity;
      entry.holder.visible = floatingPhoto !== entry.id && (isHot || opacity >= .06);
      entry.mesh.material.opacity = isHot ? 1 : opacity;
      entry.border.material.opacity = isHot ? 1 : opacity * .79;
      if (isHot !== entry.hotTint) {
        entry.hotTint = isHot;
        entry.border.material.color.setHex(isHot ? 0xfff4cc : GOLD);
      }
      const targetScale = isPinchHot ? 1.20 : isHoverHot ? 1.13 : 1;
      entry.scale = THREE.MathUtils.lerp(entry.scale, targetScale, scaleAlpha);
      if (Math.abs(entry.scale - targetScale) < .002) entry.scale = targetScale;
      entry.holder.scale.setScalar(entry.scale);
    }
  }

  function draw(dt) {
    if (!aiming && !viewing) {
      if (reducedMotion) {
        shapeProgress = targetShape;
      } else if (shapeProgress !== targetShape) {
        const delta = dt / 1.05;
        shapeProgress = shapeProgress < targetShape
          ? Math.min(targetShape, shapeProgress + delta)
          : Math.max(targetShape, shapeProgress - delta);
      }
      shape = shapeProgress * shapeProgress * (3 - 2 * shapeProgress);

      if (!reducedMotion && !pointer) {
        if (inertiaX || inertiaY) {
          targetY += inertiaY * dt;
          targetX = clampX(targetX + inertiaX * dt);
          const decay = Math.exp(-dt * 3.8);
          inertiaX *= decay;
          inertiaY *= decay;
          if (Math.abs(inertiaX) < .002) inertiaX = 0;
          if (Math.abs(inertiaY) < .002) inertiaY = 0;
        }
        if (Math.abs(inertiaX) < .08 && targetX !== DEFAULT_TILT_X) {
          targetX = THREE.MathUtils.lerp(targetX, DEFAULT_TILT_X, 1 - Math.exp(-dt * 1.35));
          if (Math.abs(targetX - DEFAULT_TILT_X) < .0008) targetX = DEFAULT_TILT_X;
        }
        if (hoverId === null) targetY += dt * .075;
      }
      const rotSmoothing = reducedMotion ? 1 : 1 - Math.exp(-dt / (pointer ? .032 : .105));
      root.rotation.x = THREE.MathUtils.lerp(root.rotation.x, targetX, rotSmoothing);
      root.rotation.y = THREE.MathUtils.lerp(root.rotation.y, targetY, rotSmoothing);
    }
    const zoomAlpha = (reducedMotion || dt === 0) ? 1 : 1 - Math.exp(-dt / .095);
    zoom = THREE.MathUtils.lerp(zoom, targetZoom, zoomAlpha);
    if (Math.abs(zoom - targetZoom) < .0008) zoom = targetZoom;

    const treeDistance = Math.max(14.25, 10.65 / camera.aspect);
    const nebulaDistance = Math.max(15.7, 12.8 / camera.aspect);
    const baseDistance = THREE.MathUtils.lerp(treeDistance, nebulaDistance, shape);
    camera.position.set(
      0,
      THREE.MathUtils.lerp(-.14, 0, shape),
      baseDistance * zoom + Math.sin(shape * Math.PI) * .85
    );
    treePoints.material.uniforms.uShape.value = shapeProgress;
    treePoints.material.uniforms.uSpread.value = nebulaSpread;
    treePoints.material.uniforms.uTime.value = elapsed;
    stars.material.uniforms.uTime.value = elapsed * .58;
    finial.visible = shape < .94;
    finial.children[0].material.opacity = 1 - shape;
    finial.quaternion.copy(root.quaternion).invert();
    if (!reducedMotion) finial.scale.setScalar(1 + Math.sin(elapsed * 1.8) * .048);
    updatePhotos(dt);
    renderer.render(scene, camera);
  }

  function step(now) {
    raf = 0;
    if (!running || disposed) return;
    if (previousTime && !reducedMotion && !viewing) {
      const frameMs = now - previousTime;
      if (frameMs < 150) {
        frameSampleSum += frameMs;
        frameSampleCount++;
        if (frameSampleCount >= 24) {
          const avgFrameMs = frameSampleSum / frameSampleCount;
          frameSampleSum = 0;
          frameSampleCount = 0;
          if (avgFrameMs > 23 && pixelRatio > 1 && dprSteps < 2) {
            pixelRatio = Math.max(1, +(pixelRatio * .8).toFixed(2));
            dprSteps++;
            renderer.setPixelRatio(pixelRatio);
            treePoints.material.uniforms.uScale.value = pixelRatio;
            stars.material.uniforms.uScale.value = pixelRatio;
            resize();
          }
        }
      }
    }
    if (pendingHover && !pointer && !aiming && !viewing) {
      const { x, y } = pendingHover;
      pendingHover = null;
      const nextHover = pick(x, y, 10);
      if (nextHover !== hoverId) {
        hoverId = nextHover;
        canvas.toggleAttribute('data-hover', hoverId !== null);
        dirty = true;
      }
    }
    const dt = previousTime ? Math.min(.05, (now - previousTime) / 1000) : 1 / 60;
    previousTime = now;
    if (!reducedMotion && !viewing) elapsed += dt;
    if ((!reducedMotion && !viewing) || dirty) {
      dirty = false;
      draw(dt);
    }
    raf = requestAnimationFrame(step);
  }

  function setRunning(enabled) {
    if (disposed || running === enabled) return;
    running = enabled;
    previousTime = 0;
    frameSampleSum = 0;
    frameSampleCount = 0;
    if (enabled) {
      dirty = true;
      raf = requestAnimationFrame(step);
    }
    else if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  function rotate(dx, dy) {
    if (aiming || viewing) return;
    targetY += dx;
    targetX = clampX(targetX + dy);
    dirty = true;
  }

  function pick(clientX, clientY, range = compact ? 19 : 12) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    coordinates.set((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2);
    raycaster.setFromCamera(coordinates, camera);
    const meshes = Array.from(data.values(), entry => entry.mesh).filter(mesh => mesh.parent.visible);
    return raycaster.intersectObjects(meshes)[0]?.object.userData.photoId
      ?? photoNear(clientX, clientY, range, rect);
  }

  function photoNear(clientX, clientY, range, rect) {
    let bestScore = Infinity;
    let bestId = null;
    for (const entry of data.values()) {
      if (!entry.holder.visible) continue;
      world.copy(entry.holder.position).applyMatrix4(root.matrixWorld);
      projected.copy(world).project(camera);
      if (projected.z > 1 || projected.z < -1) continue;
      const x = rect.left + (projected.x + 1) * rect.width / 2;
      const y = rect.top + (1 - projected.y) * rect.height / 2;
      const distance = Math.hypot(x - clientX, y - clientY);
      if (distance > range) continue;
      const score = distance + Math.max(0, 1.1 - world.z) * 3.5;
      if (score < bestScore) {
        bestScore = score;
        bestId = entry.id;
      }
    }
    return bestId;
  }

  function photoBounds(id, { ignoreFloating = false } = {}) {
    const entry = data.get(id);
    if (!entry?.image) return null;
    const isVisible = entry.holder.visible || (ignoreFloating && floatingPhoto === id && entry.lastOpacity >= .06);
    if (!isVisible) return null;
    const rect = canvas.getBoundingClientRect();
    entry.mesh.updateWorldMatrix(true, false);
    const project = (x, y) => {
      world.set(x, y, 0).applyMatrix4(entry.mesh.matrixWorld);
      projected.copy(world).project(camera);
      return {
        x: rect.left + (projected.x + 1) * rect.width / 2,
        y: rect.top + (1 - projected.y) * rect.height / 2,
      };
    };
    const center = project(0, 0);
    const left = project(-.5, 0);
    const right = project(.5, 0);
    const top = project(0, .5);
    const bottom = project(0, -.5);
    return {
      ...center,
      width: Math.hypot(right.x - left.x, right.y - left.y),
      height: Math.hypot(bottom.x - top.x, bottom.y - top.y),
      angle: Math.atan2(right.y - left.y, right.x - left.x),
      aspect: entry.image.image.width / entry.image.image.height,
    };
  }

  function pairDistance(points) {
    const [a, b] = Array.from(points.values());
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  function clearHover() {
    pendingHover = null;
    if (hoverId !== null) {
      hoverId = null;
      canvas.removeAttribute('data-hover');
      dirty = true;
    }
  }

  canvas.addEventListener('pointerdown', event => {
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.size === 2) {
      pointer = null;
      inertiaX = 0;
      inertiaY = 0;
      clearHover();
      pinchDistance = pairDistance(activePointers);
      return;
    }
    if (pointer || !event.isPrimary || event.button !== 0) return;
    clearHover();
    inertiaX = 0;
    inertiaY = 0;
    pointer = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      lastTime: performance.now(),
      dragged: false,
    };
    try { canvas.setPointerCapture(event.pointerId); } catch {}
  }, { signal: events.signal });
  canvas.addEventListener('pointermove', event => {
    if (activePointers.has(event.pointerId)) {
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (activePointers.size >= 2) {
      const currDist = pairDistance(activePointers);
      if (pinchDistance > 0 && currDist > 0 && !aiming && !viewing) {
        targetZoom = THREE.MathUtils.clamp(targetZoom * (pinchDistance / currDist), MIN_ZOOM, MAX_ZOOM);
        dirty = true;
      }
      pinchDistance = currDist;
      return;
    }
    if (pointer?.id === event.pointerId) {
      const now = performance.now();
      if (!pointer.dragged) {
        if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) < POINTER_SLOP) return;
        pointer.dragged = true;
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        pointer.lastTime = now;
        return;
      }
      const dx = (event.clientX - pointer.x) * .0072;
      const dy = (event.clientY - pointer.y) * .0058;
      const segDt = Math.max(.008, (now - pointer.lastTime) / 1000);
      const vx = THREE.MathUtils.clamp(dx / segDt, -3.8, 3.8);
      const vy = THREE.MathUtils.clamp(dy / segDt, -2.2, 2.2);
      inertiaY += (vx - inertiaY) * .45;
      inertiaX += (vy - inertiaX) * .45;
      rotate(dx, dy);
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.lastTime = now;
      return;
    }
    if (event.pointerType === 'mouse' && !pointer && !aiming && !viewing) {
      pendingHover = { x: event.clientX, y: event.clientY };
      dirty = true;
    }
  }, { signal: events.signal });
  canvas.addEventListener('pointerup', event => {
    activePointers.delete(event.pointerId);
    if (activePointers.size < 2) pinchDistance = 0;
    if (pointer?.id !== event.pointerId) return;
    const wasDrag = pointer.dragged;
    const stale = performance.now() - pointer.lastTime > 80;
    pointer = null;
    if (!wasDrag || stale) {
      inertiaX = 0;
      inertiaY = 0;
    }
    if (!wasDrag) {
      const id = pick(event.clientX, event.clientY);
      if (id !== null) onPhoto(id, photoBounds(id));
    }
  }, { signal: events.signal });
  function dropPointer(event) {
    activePointers.delete(event.pointerId);
    if (activePointers.size < 2) pinchDistance = 0;
    if (pointer?.id === event.pointerId) {
      pointer = null;
      inertiaX = 0;
      inertiaY = 0;
    }
  }
  canvas.addEventListener('pointerleave', clearHover, { signal: events.signal });
  canvas.addEventListener('wheel', event => {
    if (viewing || aiming) return;
    event.preventDefault();
    const raw = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    const delta = THREE.MathUtils.clamp(raw, -120, 120);
    targetZoom = THREE.MathUtils.clamp(targetZoom * Math.exp(delta * .0014), MIN_ZOOM, MAX_ZOOM);
    dirty = true;
  }, { passive: false, signal: events.signal });
  canvas.addEventListener('dblclick', event => {
    if (viewing || aiming) return;
    if (pick(event.clientX, event.clientY) !== null) return;
    targetZoom = 1;
    targetX = DEFAULT_TILT_X;
    inertiaX = 0;
    inertiaY = 0;
    dirty = true;
  }, { signal: events.signal });
  canvas.addEventListener('lostpointercapture', dropPointer, { signal: events.signal });
  canvas.addEventListener('pointercancel', dropPointer, { signal: events.signal });
  canvas.addEventListener('webglcontextlost', onFailure, { signal: events.signal });

  photos.forEach((photo, order) => queuePhoto(photo, order));
  mount.append(canvas);
  const observer = new ResizeObserver(resize);
  observer.observe(mount);
  resize();
  loadNextTextures();

  return {
    addPhotos(newPhotos) {
      newPhotos.forEach(photo => queuePhoto(photo, photo.order ?? data.size));
      loadNextTextures();
      dirty = true;
    },
    setPhotos(nextPhotos) {
      if (disposed) return;
      const nextList = Array.from(nextPhotos || []);
      const nextById = new Map(nextList.map((photo, order) => [photo.id, { photo, order }]));

      for (let i = textureJobs.length - 1; i >= 0; i--) {
        const queued = textureJobs[i];
        const match = nextById.get(queued.id);
        if (!match || match.photo.thumbnail !== queued.thumbnail) {
          textureJobs.splice(i, 1);
        }
      }

      for (const [id, entry] of Array.from(data.entries())) {
        const match = nextById.get(id);
        if (!match || match.photo.thumbnail !== entry.thumbnail) {
          removeEntry(id);
        }
      }

      if (highlight !== null && !nextById.has(highlight)) highlight = null;
      if (hoverId !== null && !nextById.has(hoverId)) {
        hoverId = null;
        canvas.removeAttribute('data-hover');
      }
      if (floatingPhoto !== null && !nextById.has(floatingPhoto)) floatingPhoto = null;

      for (let order = 0; order < nextList.length; order++) {
        const photo = nextList[order];
        const existing = data.get(photo.id);
        if (existing) {
          const position = locatePhoto(THREE, order);
          existing.tree.copy(position.tree);
          existing.nebula.copy(position.nebula);
          existing.outward.copy(position.outward);
          existing.tilt = position.tilt;
          existing.order = order;
          applyEntryScale(existing);
        } else {
          queuePhoto(photo, order);
        }
      }

      loadNextTextures();
      dirty = true;
      if (!running) draw(0);
    },
    pick,
    photoBounds,
    rotate,
    getZoom() { return zoom; },
    resetView() {
      targetZoom = 1;
      targetX = DEFAULT_TILT_X;
      inertiaX = 0;
      inertiaY = 0;
      dirty = true;
    },
    setAiming(value) {
      if (value === aiming) return;
      if (value) {
        clearHover();
        inertiaX = 0;
        inertiaY = 0;
        targetX = clampX(root.rotation.x);
        targetY = root.rotation.y;
      }
      aiming = value;
      dirty = true;
    },
    setFloatingPhoto(id) {
      const previous = data.get(floatingPhoto);
      if (previous?.image) previous.holder.visible = true;
      floatingPhoto = id;
      const current = data.get(id);
      if (current) current.holder.visible = false;
      dirty = true;
    },
    setHighlight(id) {
      if (id === highlight) return;
      highlight = id;
      dirty = true;
    },
    setReducedMotion(value) { reducedMotion = value; dirty = true; },
    setRunning,
    setShape(value) { targetShape = value === 'nebula' ? 1 : 0; dirty = true; },
    setViewing(value) {
      if (value) {
        clearHover();
        inertiaX = 0;
        inertiaY = 0;
      }
      viewing = value;
      dirty = true;
    },
    dispose() {
      if (disposed) return;
      setRunning(false);
      disposed = true;
      events.abort();
      observer.disconnect();
      for (const entry of data.values()) entry.image?.dispose();
      const geometries = new Set();
      const materials = new Set();
      scene.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) materials.add(object.material);
      });
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      renderer.dispose();
      canvas.remove();
    },
  };
}
