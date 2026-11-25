// Water on the lens: when someone's jet catches you, the screen gets a hit of
// spray (a white burst at the edges) and drops that run down and dry off.
// A plain 2D canvas over the game; it only draws while there is water on it.

export class WetLens {
  constructor(parent) {
    const c = document.createElement('canvas');
    c.id = 'wetLens';
    c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:3';
    parent.appendChild(c);
    this.canvas = c;
    this.g = c.getContext('2d');
    this.drops = [];
    this.mist = 0;
    this.active = false;
  }

  // k: 0..1, how hard it hit
  splash(k) {
    const c = this.canvas;
    const w = (c.width = c.clientWidth || innerWidth);
    const h = (c.height = c.clientHeight || innerHeight);
    const n = Math.round(10 + 40 * k);
    for (let i = 0; i < n && this.drops.length < 140; i++) {
      this.drops.push({
        x: Math.random() * w,
        y: Math.random() * h * 0.9,
        r: (6 + Math.random() * 22 * (0.6 + k)) * (w / 1280 + 0.4),
        life: 1.4 + Math.random() * 1.6,
        age: 0,
        vy: 8 + Math.random() * 40,
      });
    }
    this.mist = Math.min(1, this.mist + 0.45 * k + 0.15);
    this.active = true;
  }

  update(dt) {
    if (!this.active) return;
    const g = this.g;
    const c = this.canvas;
    const w = c.width;
    const h = c.height;
    g.clearRect(0, 0, w, h);
    // the burst of spray: white fog in from the edges
    if (this.mist > 0.01) {
      const gr = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
      gr.addColorStop(0, 'rgba(235,245,250,0)');
      gr.addColorStop(1, `rgba(235,245,250,${(0.75 * this.mist).toFixed(3)})`);
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
      this.mist *= Math.exp(-dt * 2.2);
    }
    // drops: a darker rim, a lit edge and a bright spot, sliding down
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.age += dt;
      d.y += d.vy * dt;
      d.vy += 6 * dt;
      const t = d.age / d.life;
      if (t >= 1) {
        this.drops.splice(i, 1);
        continue;
      }
      const a = (1 - t) * 0.85;
      const r = d.r * (1 - t * 0.3);
      const rg = g.createRadialGradient(d.x - r * 0.3, d.y - r * 0.35, r * 0.1, d.x, d.y, r);
      rg.addColorStop(0, `rgba(255,255,255,${(0.55 * a).toFixed(3)})`);
      rg.addColorStop(0.55, `rgba(200,225,235,${(0.12 * a).toFixed(3)})`);
      rg.addColorStop(0.85, `rgba(20,40,50,${(0.22 * a).toFixed(3)})`);
      rg.addColorStop(1, 'rgba(20,40,50,0)');
      g.fillStyle = rg;
      g.beginPath();
      g.ellipse(d.x, d.y, r * 0.9, r, 0, 0, Math.PI * 2);
      g.fill();
    }
    if (!this.drops.length && this.mist <= 0.01) {
      g.clearRect(0, 0, w, h);
      this.active = false;
    }
  }
}
