// Heart-monitor style sweep chart on a <canvas>: the trace is written left to
// right and wraps around, with a small gap erasing the oldest data.

export class EcgChart {
  constructor(canvas, { sampleRate = 250, seconds = 5, min = -0.6, max = 1.3 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.n = sampleRate * seconds;
    this.seconds = seconds;
    this.buf = new Float32Array(this.n).fill(NaN);
    this.pos = 0;
    this.min = min;
    this.max = max;
    this.dirty = true;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.dirty = true;
  }

  push(samples) {
    for (const v of samples) {
      this.buf[this.pos] = v;
      this.pos = (this.pos + 1) % this.n;
    }
    // blank a short gap ahead of the write head
    const gap = Math.round(this.n * 0.03);
    for (let i = 0; i < gap; i++) this.buf[(this.pos + i) % this.n] = NaN;
    this.dirty = true;
  }

  clear() {
    this.buf.fill(NaN);
    this.pos = 0;
    this.dirty = true;
  }

  draw() {
    if (!this.dirty) return;
    this.dirty = false;
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    const css = getComputedStyle(canvas);
    const grid = css.getPropertyValue("--grid").trim() || "#f3d4da";
    const trace = css.getPropertyValue("--trace").trim() || "#9b1c2d";

    ctx.clearRect(0, 0, w, h);

    // ECG paper grid: a major line every 0.2 s
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const majors = this.seconds * 5;
    for (let i = 1; i < majors; i++) {
      const x = Math.round((i / majors) * w) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    const rows = 8;
    for (let i = 1; i < rows; i++) {
      const y = Math.round((i / rows) * h) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    // trace
    const yOf = (v) => h - ((v - this.min) / (this.max - this.min)) * h;
    ctx.strokeStyle = trace;
    ctx.lineWidth = Math.max(1.5, (window.devicePixelRatio || 1) * 1.6);
    ctx.lineJoin = "round";
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < this.n; i++) {
      const v = this.buf[i];
      if (Number.isNaN(v)) {
        pen = false;
        continue;
      }
      const x = (i / (this.n - 1)) * w;
      const y = yOf(v);
      if (pen) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      pen = true;
    }
    ctx.stroke();
  }
}
