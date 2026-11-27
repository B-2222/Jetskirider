// Extra show for special wraps (the admin's Barsa Edition): the gold trim
// pulses, and a gold underglow lights the water under the ski like neon
// under a car. Works the same on your ski and on other riders'.

import * as THREE from 'three';

let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

export function addFlair(model, look, spec, scene) {
  if (!look || look.flair !== 'barsa') return null;
  const trim = look.cw.trim;
  const glowMats = [];
  model.group.traverse((o) => {
    const m = o.material;
    if (m && m.emissive && m.color && m.color.getHex() === trim && !glowMats.includes(m)) glowMats.push(m);
  });
  const mat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xff8a00, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(spec.L * 2.4, spec.B * 4.2), mat);
  glow.rotation.order = 'YXZ';
  glow.renderOrder = 2;
  scene.add(glow);
  return {
    // t: seconds; x, z: the ski; water: the water height there; y: the
    // ski's height; yaw: its heading (radians, about +Y)
    update(t, x, water, z, y, yaw) {
      const k = 0.5 + 0.5 * Math.sin(t * 3.2);
      for (const m of glowMats) m.emissiveIntensity = 0.6 + 1.1 * k;
      const lift = Math.max(0, y - water - 0.3);
      glow.position.set(x, water + 0.06, z);
      glow.rotation.set(-Math.PI / 2, yaw, 0);
      mat.opacity = (0.7 + 0.3 * k) * Math.max(0, 1 - lift / 6);
      glow.visible = mat.opacity > 0.02;
    },
    hide() {
      glow.visible = false;
    },
    dispose() {
      glow.removeFromParent();
      glow.geometry.dispose();
      mat.dispose();
    },
  };
}
