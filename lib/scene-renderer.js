// Scene drawing only: frame snapshots are read, never changed.
export function createSceneRenderer(g, readFrame, document) {
  let frame;
  // ---------- rendering ----------
  // Bend in projected depth: fixed at the hit line, bounded at the horizon.
  function P(x, dt) {
    const s = frame.F / (frame.F + Math.max(dt, -0.35)),
      c = Math.max(0, 1 - s) ** 2;
    return [
      frame.W / 2 + (x - frame.camX) * s + frame.bendX * c,
      frame.HZ + (frame.HIT_Y - frame.HZ) * s - frame.bendY * c,
    ];
  }
  const steps = (d0, d1) => Math.max(1, Math.ceil(Math.abs(d1 - d0) / 0.2)); // long spans are drawn in pieces so they curve
  function quad(x0, x1, d0, d1) {
    const n = steps(d0, d1);
    g.beginPath();
    for (let k = 0; k <= n; k++) g.lineTo(...P(x0, d0 + ((d1 - d0) * k) / n));
    for (let k = n; k >= 0; k--) g.lineTo(...P(x1, d0 + ((d1 - d0) * k) / n));
    g.closePath();
  }
  function seg(x0, d0, x1, d1) {
    const n = steps(d0, d1);
    g.beginPath();
    for (let k = 0; k <= n; k++)
      g.lineTo(...P(x0 + ((x1 - x0) * k) / n, d0 + ((d1 - d0) * k) / n));
    g.stroke();
  }
  const fade = (d) => Math.max(0, Math.min(1, (frame.LOOK - d) / 1.2));
  const sx = (x) => frame.W / 2 + x - frame.camX;
  function text(s, x, y, font, color, align = "center", glow = 0) {
    g.font = font;
    g.textAlign = align;
    g.fillStyle = color;
    g.shadowColor = color;
    g.shadowBlur = glow;
    g.fillText(s, x, y);
    g.shadowBlur = 0;
  }
  // One small, deterministic material per theme; never generate grain in the frame loop.
  const materialCache = new Map();
  function materialTexture(style = frame.theme) {
    if (materialCache.has(style)) return materialCache.get(style);
    if (!document.createElement) return null;
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 300;
    const c = canvas.getContext("2d");
    if (!c) return null;
    let seed = 73;
    const random = () =>
      (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    if (style === frame.THEMES.paper) {
      for (let i = 0; i < 6500; i++) {
        c.fillStyle = i % 3 ? "#e5cfaa" : "#172331";
        c.globalAlpha = 0.08 + random() * 0.18;
        c.fillRect(random() * 400, random() * 300, 1 + random() * 2, 0.5);
      }
      for (let i = 0; i < 9; i++) {
        const x = i * 57 - 30;
        c.globalAlpha = 0.12;
        c.fillStyle = "#dfc9a4";
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x + 75, 300);
        c.lineTo(x + 95, 300);
        c.closePath();
        c.fill();
        c.globalAlpha = 0.3;
        c.strokeStyle = "#101521";
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x + 75, 300);
        c.stroke();
      }
    } else if (style === frame.THEMES.liquid) {
      c.strokeStyle = "#a8ffe9";
      c.lineWidth = 1;
      for (let row = 0; row < 11; row++)
        for (let ribbon = 0; ribbon < 2; ribbon++) {
          c.globalAlpha = ribbon ? 0.09 : 0.25;
          c.beginPath();
          for (let x = -10; x <= 410; x += 5) {
            const y =
              row * 31 +
              Math.sin(x / 32 + row * 1.7) * 11 +
              Math.cos(x / 61 - row) * 15 +
              ribbon * 3;
            if (x === -10) c.moveTo(x, y);
            else c.lineTo(x, y);
          }
          c.stroke();
        }
    } else if (style === frame.THEMES.circuit) {
      for (let i = 0; i < 32; i++) {
        const x = random() * 400,
          y = random() * 300,
          length = 12 + random() * 60;
        c.strokeStyle = style.colors[i % 4];
        c.fillStyle = c.strokeStyle;
        c.globalAlpha = 0.22;
        c.lineWidth = 0.6;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + length, y);
        c.lineTo(x + length + 12, y + 12);
        c.lineTo(x + length + 12, y + 36);
        c.stroke();
        c.fillRect(x - 1, y - 1, 2, 2);
      }
      for (let i = 0; i < 16; i++) {
        const x = (i % 8) * 56,
          y = Math.floor(i / 8) * 180;
        c.globalAlpha = 0.09;
        c.fillStyle = style.colors[i % 4];
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + 48, y + 60);
        c.lineTo(x + 20, y + 155);
        c.closePath();
        c.fill();
      }
    } else {
      c.fillStyle = "#a2cfff";
      c.globalAlpha = 0.12;
      for (let y = 0; y < 300; y += 3) c.fillRect(0, y, 400, 0.5);
      for (let i = 0; i < 18; i++) {
        const x = i * 25 - 15;
        const reflection = c.createLinearGradient(x, 80, x, 300);
        reflection.addColorStop(0, "transparent");
        reflection.addColorStop(0.6, style.colors[i % 4]);
        reflection.addColorStop(1, "transparent");
        c.fillStyle = reflection;
        c.globalAlpha = 0.15;
        c.fillRect(x, 80, 2 + (i % 3), 220);
      }
    }
    materialCache.set(style, canvas);
    return canvas;
  }
  const shaderCaptures = new Float32Array(4);
  function drawMaterial(vx, vy, t = 0, playing = false) {
    let surface = null;
    if (frame.themeShader) {
      let energy = 0;
      frame.tracks.forEach((tr, i) => {
        const active = playing && tr.notes.length && frame.locked(tr, t);
        shaderCaptures[i] = active ? frame.rt - tr.capAt : -1;
        if (active) energy += captureLight(tr, t) / 4;
      });
      surface = frame.themeShader.render(
        Object.keys(frame.THEMES).find((k) => frame.THEMES[k] === frame.theme),
        frame.rt,
        shaderCaptures,
        energy,
        !!frame.reducedMotion?.matches,
      );
    }
    const shaded = !!surface;
    surface ||= materialTexture();
    if (!surface) return;
    g.save();
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = frame.isPaper() ? 0.75 : 0.65;
    const drift =
      !shaded && frame.isLiquid() && !frame.reducedMotion?.matches
        ? Math.sin(frame.barF(t) * 0.3) * 18
        : 0;
    g.drawImage(
      surface,
      -100 + drift,
      -100 + drift * 0.4,
      frame.W + 200,
      frame.H + 200,
    );
    g.restore();
  }
  // Capture timestamps already reset with the song: effects need no particle queues or timers.
  function drawCaptureMaterial(t, playing, vx, vy) {
    if (!playing || frame.reducedMotion?.matches) return;
    g.save();
    g.globalCompositeOperation = frame.isPaper() ? "source-over" : "lighter";
    frame.tracks.forEach((tr, i) => {
      const age = frame.rt - tr.capAt;
      if (!tr.notes.length || !frame.locked(tr, t) || age < 0 || age >= 1.6)
        return;
      const q = age / 1.6,
        x = vx + (i - 1.5) * 100,
        y = vy - 30;
      g.strokeStyle = tr.color;
      g.fillStyle = tr.color;
      g.globalAlpha = (1 - q) * 0.5;
      g.lineWidth = 2;
      if (frame.isLiquid()) {
        for (let ring = 0; ring < 2; ring++) {
          const radius = 12 + q * 210 + ring * 22;
          g.beginPath();
          g.ellipse(
            x,
            y,
            radius,
            radius * 0.28,
            -0.15 + i * 0.1,
            0,
            Math.PI * 2,
          );
          g.stroke();
        }
      } else if (frame.isPaper()) {
        // An irregular ink bloom, deterministic for each instrument rather than noisy each frame.
        g.globalAlpha *= 0.45;
        g.beginPath();
        for (let point = 0; point < 18; point++) {
          const a = (point / 18) * Math.PI * 2,
            radius =
              (12 + Math.sqrt(q) * 100) *
              (0.8 + Math.sin(point * 7 + i) * 0.16);
          const px = x + Math.cos(a) * radius,
            py = y + Math.sin(a) * radius * 0.6;
          if (!point) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.fill();
      } else if (frame.isCircuit()) {
        const width = 100 + i * 85,
          top = vy - 55 - i * 32;
        for (const side of [-1, 1]) {
          g.beginPath();
          g.moveTo(vx + side * width, vy + 40);
          g.lineTo(vx + side * width, top + 35);
          g.lineTo(vx, top);
          g.stroke();
          const distance = q * 2;
          const px =
            distance < 1
              ? vx + side * width
              : vx + side * width * (2 - distance);
          const py =
            distance < 1
              ? vy + 40 + (top - vy - 5) * distance
              : top + 35 * (2 - distance);
          g.fillRect(px - 3, py - 3, 6, 6);
        }
      } else {
        // A light sweep reflected in the verges, leaving the timing lanes unfiltered.
        const radius = 24 + q * 240;
        for (const sign of [-1, 1]) {
          g.beginPath();
          g.moveTo(x - radius, y + sign * q * 65);
          g.lineTo(x + radius, y + sign * q * 65);
          g.stroke();
        }
      }
    });
    g.restore();
  }
  // Capture strength follows the existing lock lifetime; scenery never outlives its instrument.
  function captureLight(tr, t) {
    if (!tr.notes.length || !frame.locked(tr, t)) return 0;
    return Math.max(
      0,
      Math.min(1, (frame.rt - tr.capAt) / 0.65, tr.capTo - frame.barF(t)),
    );
  }
  function drawLiquidWorld(t, playing, vx, vy) {
    const motion = frame.reducedMotion?.matches ? 0 : frame.barF(t);
    g.save();
    const water = g.createLinearGradient(0, vy, 0, frame.H);
    water.addColorStop(0, "#123c48");
    water.addColorStop(1, "#020f1b");
    g.fillStyle = water;
    g.globalAlpha = 0.8;
    g.fillRect(-200, vy, frame.W + 400, frame.H);
    frame.tracks.forEach((tr, i) => {
      const light = playing ? captureLight(tr, t) : 0.2;
      g.strokeStyle = tr.color;
      for (let ribbon = 0; ribbon < 3; ribbon++) {
        g.globalAlpha = 0.04 + light * 0.18;
        g.lineWidth = 1 + light * 2;
        g.beginPath();
        for (let x = -100; x <= frame.W + 100; x += 20) {
          const y =
            vy -
            50 +
            i * 31 +
            ribbon * 13 +
            Math.sin(x / (100 + i * 23) + motion * 0.3 + ribbon + i) *
              (12 + light * 10);
          if (x === -100) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
      }
      if (light > 0) {
        g.globalAlpha = light * 0.16;
        g.beginPath();
        g.ellipse(
          vx + (i - 1.5) * 85,
          vy + 35,
          42 + light * 25,
          9,
          0,
          0,
          Math.PI * 2,
        );
        g.stroke();
      }
    });
    if (playing && frame.inSync) {
      const glow = g.createRadialGradient(vx, vy, 0, vx, vy, 220);
      glow.addColorStop(0, "#b9fff1");
      glow.addColorStop(1, "transparent");
      g.globalAlpha = 0.25;
      g.fillStyle = glow;
      g.fillRect(vx - 220, vy - 220, 440, 440);
    }
    g.restore();
  }
  function drawBuiltWorld(t, playing, vx, vy) {
    g.save();
    if (frame.isPaper()) {
      g.fillStyle = "#171b25";
      g.fillRect(-200, vy, frame.W + 400, frame.H);
      // Folded skyline: each captured instrument raises its own layer of buildings.
      frame.tracks.forEach((tr, i) => {
        const light = playing ? captureLight(tr, t) : 0.2;
        g.fillStyle = tr.color;
        g.strokeStyle = "#151c29";
        g.lineWidth = 2;
        for (let k = 0; k < 6; k++) {
          const x = vx - 430 + k * 150 + i * 19,
            h = 18 + ((k * 17 + i * 31) % 55) * (0.35 + light);
          g.globalAlpha = 0.13 + light * 0.2;
          g.beginPath();
          g.moveTo(x, vy);
          g.lineTo(x, vy - h);
          g.lineTo(x + 22, vy - h - 12);
          g.lineTo(x + 48, vy - h);
          g.lineTo(x + 48, vy);
          g.closePath();
          g.fill();
          g.stroke();
          g.globalAlpha *= 0.5;
          g.fillStyle = "#f4e5bf";
          g.beginPath();
          g.moveTo(x + 22, vy - h - 12);
          g.lineTo(x + 48, vy - h);
          g.lineTo(x + 48, vy);
          g.lineTo(x + 22, vy);
          g.closePath();
          g.fill();
          g.fillStyle = tr.color;
        }
      });
    } else {
      frame.tracks.forEach((tr, i) => {
        const light = playing ? captureLight(tr, t) : 0.15,
          w = 100 + i * 85,
          top = vy - 55 - i * 32;
        g.strokeStyle = tr.color;
        g.globalAlpha = 0.15 + light * 0.5;
        g.lineWidth = 2 + light * 2;
        g.beginPath();
        g.moveTo(vx - w, vy + 40);
        g.lineTo(vx - w, top + 35);
        g.lineTo(vx, top);
        g.lineTo(vx + w, top + 35);
        g.lineTo(vx + w, vy + 40);
        g.stroke();
        for (const side of [-1, 1])
          for (let k = 0; k < 4; k++) {
            const x = vx + side * (w + k * 8),
              y = top + 45 + k * 15;
            g.globalAlpha = 0.08 + light * 0.35;
            g.beginPath();
            g.moveTo(x, vy + 40);
            g.lineTo(x, y);
            g.lineTo(x + side * 14, y - 12);
            g.stroke();
            g.fillStyle = tr.color;
            g.fillRect(x + side * 14 - 2, y - 14, 4, 4);
          }
      });
    }
    if (playing && frame.inSync) {
      g.globalAlpha = 0.2;
      g.strokeStyle = "#fff3c4";
      g.lineWidth = 5;
      g.beginPath();
      g.arc(vx, vy - 40, 30, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }
  function drawWorld(t, playing, vx, vy) {
    if (frame.isPaper() || frame.isCircuit())
      return drawBuiltWorld(t, playing, vx, vy);
    if (frame.isLiquid()) return drawLiquidWorld(t, playing, vx, vy);
    const energy = frame.tracks.map((tr) =>
      playing ? captureLight(tr, t) : 0,
    );
    const motion = frame.reducedMotion?.matches ? 0 : frame.barF(t),
      beat = frame.reducedMotion?.matches ? 0.3 : frame.pulse;
    g.save();
    g.globalCompositeOperation = "lighter";
    // Leave the note highway dark: sky details stop above the horizon, bass sits beneath it.
    frame.tracks.forEach((tr, i) => {
      const e = energy[i];
      if (!e) return;
      g.strokeStyle = tr.color;
      g.fillStyle = tr.color;
      g.lineWidth = 1.5;
      g.globalAlpha = e * (0.2 + beat * 0.1);
      if (i === 0) {
        for (const side of [-1, 1])
          for (let k = 0; k < 9; k++) {
            const x = vx + side * (100 + k * 44),
              h = 18 + (1 + Math.sin(k * 1.7)) * 28 + beat * 22;
            g.fillRect(x, vy - h, 8, h);
            g.strokeRect(x - 5, vy - h - 8, 18, h + 8);
          }
      } else if (i === 1) {
        for (let k = 0; k < 5; k++) {
          g.beginPath();
          for (let x = -100; x <= frame.W + 100; x += 12) {
            const y =
              vy +
              30 +
              k * 38 +
              Math.sin(x / 100 - motion * 2 + k * 0.7) * (9 + beat * 7);
            if (x === -100) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.stroke();
        }
      } else if (i === 2) {
        for (let k = 0; k < 3; k++) {
          g.beginPath();
          for (let x = -100; x <= frame.W + 100; x += 10) {
            const y =
              vy -
              65 -
              k * 22 +
              Math.sin(x / 145 + motion * 0.7 + k * 0.6) * 24;
            if (x === -100) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.stroke();
        }
      } else {
        for (let k = 0; k < 5; k++) {
          const x = vx + (k - 2) * 100,
            y = vy - 38 - Math.abs(k - 2) * 15,
            r = 20 + beat * 5;
          g.beginPath();
          g.moveTo(x, y - r);
          g.lineTo(x + r, y);
          g.lineTo(x, y + r);
          g.lineTo(x - r, y);
          g.closePath();
          g.stroke();
        }
      }
    });
    const together =
      playing && frame.inSync
        ? 1
        : Math.max(0, energy.reduce((a, b) => a + b, 0) - 1) /
          Math.max(1, frame.tracks.filter((tr) => tr.notes.length).length - 1);
    if (together > 0) {
      const glow = g.createRadialGradient(vx, vy, 0, vx, vy, 230);
      glow.addColorStop(0, "#e5faff");
      glow.addColorStop(0.25, `hsla(${frame.hue},90%,70%,.5)`);
      glow.addColorStop(1, "transparent");
      g.globalAlpha = together * (0.35 + beat * 0.15);
      g.fillStyle = glow;
      g.fillRect(vx - 230, vy - 230, 460, 460);
    }
    g.restore();
  }
  // Keep the craft below the judgement line and above the keyboard hints.
  function craftX() {
    if (!frame.dash || frame.reducedMotion?.matches)
      return frame.trackX(frame.run.currentTrack);
    const q = Math.max(0, Math.min(1, (frame.rt - frame.dash.at) / 0.16));
    return (
      frame.dash.from + (frame.dash.to - frame.dash.from) * (1 - (1 - q) ** 3)
    );
  }
  function drawCraft() {
    const x = sx(craftX()),
      y = frame.HIT_Y + 7,
      age = frame.dash ? frame.rt - frame.dash.at : 1;
    const charge = frame.flash
      ? Math.max(0, 1 - (frame.rt - frame.flash.born) / 1.2)
      : 0;
    const color = charge
      ? frame.flash.color
      : frame.tracks[frame.run.currentTrack].color;
    g.save();
    if (frame.dash && age >= 0 && age < 0.24 && !frame.reducedMotion?.matches) {
      g.globalAlpha = (1 - age / 0.24) * 0.45;
      g.strokeStyle = color;
      for (const dy of [2, 7]) {
        g.lineWidth = dy === 2 ? 3 : 1;
        g.beginPath();
        g.moveTo(sx(frame.dash.from), y + dy);
        g.lineTo(x, y + dy);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    g.fillStyle = "#243548";
    g.strokeStyle = color;
    g.lineWidth = 1.5;
    g.beginPath();
    if (frame.isPaper()) {
      g.fillStyle = "#e7d6b4";
      g.moveTo(x, y - 5);
      g.lineTo(x + 34, y + 12);
      g.lineTo(x + 7, y + 9);
      g.lineTo(x, y + 15);
      g.lineTo(x - 7, y + 9);
      g.lineTo(x - 34, y + 12);
    } else if (frame.isCircuit()) {
      g.fillStyle = "#1b2240";
      g.moveTo(x, y - 5);
      g.lineTo(x + 8, y + 7);
      g.lineTo(x + 24, y - 1);
      g.lineTo(x + 30, y + 13);
      g.lineTo(x + 8, y + 11);
      g.lineTo(x, y + 15);
      g.lineTo(x - 8, y + 11);
      g.lineTo(x - 30, y + 13);
      g.lineTo(x - 24, y - 1);
      g.lineTo(x - 8, y + 7);
    } else if (frame.isLiquid()) {
      g.fillStyle = "#163c4b";
      g.moveTo(x, y - 5);
      g.quadraticCurveTo(x + 10, y + 6, x + 35, y + 2);
      g.quadraticCurveTo(x + 28, y + 16, x + 7, y + 10);
      g.lineTo(x, y + 16);
      g.lineTo(x - 7, y + 10);
      g.quadraticCurveTo(x - 28, y + 16, x - 35, y + 2);
      g.quadraticCurveTo(x - 10, y + 6, x, y - 5);
    } else {
      g.moveTo(x, y - 5);
      g.lineTo(x + 8, y + 4);
      g.lineTo(x + 32, y + 12);
      g.lineTo(x + 20, y + 14);
      g.lineTo(x + 8, y + 10);
      g.lineTo(x + 6, y + 14);
      g.lineTo(x - 6, y + 14);
      g.lineTo(x - 8, y + 10);
      g.lineTo(x - 20, y + 14);
      g.lineTo(x - 32, y + 12);
      g.lineTo(x - 8, y + 4);
    }
    g.closePath();
    g.fill();
    g.stroke();
    if (charge) {
      g.globalAlpha = charge * 0.55;
      g.fillStyle = color;
      g.fill();
    }
    // A lit fuselage and dark wing facets give the small silhouette a readable nose and tail.
    g.globalAlpha = 1;
    g.fillStyle = "#8397ab";
    g.beginPath();
    g.moveTo(x, y - 4);
    g.lineTo(x + 6, y + 13);
    g.lineTo(x, y + 10);
    g.closePath();
    g.fill();
    g.fillStyle = "#101b2b";
    for (const side of [-1, 1]) {
      g.beginPath();
      g.moveTo(x + side * 10, y + 7);
      g.lineTo(x + side * 27, y + 12);
      g.lineTo(x + side * 20, y + 12);
      g.closePath();
      g.fill();
    }
    g.fillStyle = "#d8faff";
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 3, y + 6);
    g.lineTo(x, y + 8);
    g.lineTo(x - 3, y + 6);
    g.closePath();
    g.fill();
    if (frame.inSync && frame.rt - frame.syncAt < 1.2) {
      g.globalAlpha = frame.reducedMotion?.matches
        ? 0.7
        : Math.max(0, 1 - (frame.rt - frame.syncAt) / 1.2);
      frame.theme.colors.forEach((color, i) => {
        g.fillStyle = color;
        g.fillRect(x - 14 + i * 7, y + 9, 6, 3);
      });
    }
    for (let lane = 0; lane < 3; lane++) {
      const hit = Math.max(
          0,
          1 -
            (frame.rt - frame.laneHit[frame.run.currentTrack * 3 + lane]) /
              0.18,
        ),
        ex = x + (lane - 1) * 22;
      g.globalAlpha = 0.4 + hit * 0.6;
      g.fillStyle = hit ? "#fff" : color;
      g.fillRect(ex - 3, y + 13, 6, 2);
      g.globalAlpha = 0.25 + hit * 0.6;
      g.beginPath();
      g.moveTo(ex - 2, y + 15);
      g.lineTo(ex, y + 17 + hit * 4);
      g.lineTo(ex + 2, y + 15);
      g.closePath();
      g.fill();
    }
    g.restore();
  }
  function drawBackdrop(t, playing) {
    const vx = frame.W / 2 + frame.bendX,
      vy = frame.HZ - frame.bendY; // where the road vanishes
    g.setTransform(frame.DPR, 0, 0, frame.DPR, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    const sky = g.createLinearGradient(0, 0, 0, frame.H);
    sky.addColorStop(0, `hsl(${frame.hue},60%,4%)`);
    sky.addColorStop(
      frame.HZ / frame.H,
      `hsl(${frame.hue},70%,${(13 + frame.pulse * 7) * (playing ? 0.35 + (frame.run.groove / 100) * 0.65 : 1)}%)`,
    );
    sky.addColorStop(1, "#030206");
    g.fillStyle = sky;
    g.fillRect(0, 0, frame.W, frame.H);
    // camera: shake + roll that leans into track switches
    const cameraShake = frame.reducedMotion?.matches ? 0 : frame.shake;
    g.translate(
      frame.W / 2 + (Math.random() - 0.5) * cameraShake,
      frame.H / 2 + (Math.random() - 0.5) * cameraShake,
    );
    g.rotate(
      frame.reducedMotion?.matches
        ? 0
        : (frame.camX - frame.camTo) * 0.0005 - frame.bendX * 0.0003,
    );
    g.translate(-frame.W / 2, -frame.H / 2); // bank into the curve
    g.globalCompositeOperation = "lighter";
    g.lineWidth = 1.5;
    for (
      let i = 0;
      i <
      (frame.isPaper() || frame.isCircuit()
        ? 0
        : frame.isLiquid()
          ? 45
          : frame.stars.length);
      i++
    ) {
      const s = frame.stars[i],
        k = 260,
        z1 = s.z,
        z0 = s.z + 0.03 + frame.pulse * 0.06;
      g.strokeStyle = `hsla(${frame.hue + 60},80%,80%,${Math.min(1, (1 - z1) * 1.4)})`;
      g.beginPath();
      if (frame.isLiquid())
        g.arc(
          vx + (s.x / z1) * k,
          vy + (s.y / z1) * k,
          Math.min(4, 1 / z1),
          0,
          Math.PI * 2,
        );
      else {
        g.moveTo(vx + (s.x / z0) * k, vy + (s.y / z0) * k);
        g.lineTo(vx + (s.x / z1) * k, vy + (s.y / z1) * k);
      }
      g.stroke();
    }
    const core = g.createRadialGradient(
      vx,
      vy,
      0,
      vx,
      vy,
      150 + frame.pulse * 50,
    );
    core.addColorStop(
      0,
      `hsla(${frame.hue},90%,70%,${0.4 + frame.run.multiplier * 0.03})`,
    );
    core.addColorStop(1, "hsla(0,0%,0%,0)");
    g.fillStyle = core;
    g.fillRect(vx - 220, vy - 220, 440, 440);
    g.strokeStyle = `hsla(${frame.hue},90%,75%,${(1 - frame.phase) * 0.45})`;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(vx, vy, 20 + frame.phase * 280, 0, 7);
    g.stroke();
    g.globalCompositeOperation = "source-over";
    const ground = g.createLinearGradient(0, vy, 0, frame.H);
    ground.addColorStop(0, `hsla(${frame.hue},60%,12%,.3)`);
    ground.addColorStop(0.12, "rgba(4,3,10,.94)");
    ground.addColorStop(1, "#020205");
    g.fillStyle = ground;
    g.fillRect(-200, vy, frame.W + 400, frame.H + 200);
    g.fillStyle = `hsla(${frame.hue},90%,72%,${0.45 + frame.pulse * 0.55})`;
    g.fillRect(-200, vy - 1, frame.W + 400, 2);
    drawMaterial(vx, vy, t, playing);
    drawWorld(t, playing, vx, vy);
    drawCaptureMaterial(t, playing, vx, vy);
  }
  function drawHighway(t, playing) {
    const roadShade = g.createLinearGradient(
      0,
      P(0, frame.LOOK)[1],
      0,
      frame.HIT_Y,
    );
    roadShade.addColorStop(0, "rgba(3,7,16,0)");
    roadShade.addColorStop(0.25, "#030710");
    roadShade.addColorStop(1, "#030710");
    const b = frame.bar(t);
    const ph = Math.floor(b / 2);
    frame.tracks.forEach((tr, i) => {
      const cx = frame.trackX(i),
        x0 = cx - frame.TW / 2,
        x1 = cx + frame.TW / 2,
        capd = frame.locked(tr, t),
        me = i === frame.run.currentTrack && playing,
        since = frame.rt - tr.capAt;
      // Shade the actual curved road, rather than cutting a straight wedge out of the scenery.
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      g.fillStyle = roadShade;
      quad(x0, x1, -0.35, frame.LOOK);
      g.fill();
      const fl = g.createLinearGradient(0, frame.HZ, 0, frame.HIT_Y);
      fl.addColorStop(0, "rgba(0,0,0,0)");
      fl.addColorStop(1, tr.color);
      g.globalAlpha = me
        ? frame.isPaper()
          ? 0.32
          : 0.24
        : capd
          ? 0.1 + 0.08 * frame.pulse
          : 0.07;
      g.fillStyle = fl;
      quad(x0, x1, -0.35, frame.LOOK);
      g.fill();
      if (frame.isPaper()) {
        g.globalAlpha = me ? 0.12 : 0.04;
        g.fillStyle = "#f1dfb7";
        quad(x0, cx, -0.35, frame.LOOK);
        g.fill();
        g.globalAlpha = 0.3;
        g.strokeStyle = "#141c29";
        g.lineWidth = 2;
        seg(cx, -0.35, cx, frame.LOOK);
      }
      g.globalCompositeOperation = "lighter";
      if (playing && capd) {
        const light = captureLight(tr, t);
        const remaining = frame.captureRemaining(tr, t),
          ending = tr.capTo - frame.barF(t) <= 1;
        g.globalAlpha =
          light *
          (ending && !frame.reducedMotion?.matches
            ? 0.35 + frame.pulse * 0.6
            : 0.5);
        g.fillStyle = tr.color;
        quad(x0, x0 + 5, 0, frame.LOOK * remaining);
        g.fill();
        quad(x1 - 5, x1, 0, frame.LOOK * remaining);
        g.fill();
        if (!frame.reducedMotion?.matches && since >= 0 && since < 0.65) {
          const d = (since / 0.65) * frame.LOOK;
          g.globalAlpha = 1 - since / 0.65;
          g.fillStyle = "#fff";
          quad(x0, x1, d - 0.045, d + 0.045);
          g.fill();
        }
      }
      if (
        playing &&
        frame.inSync &&
        frame.rt - frame.syncAt < 0.8 &&
        !frame.reducedMotion?.matches
      ) {
        const q = Math.max(0, (frame.rt - frame.syncAt) / 0.8),
          d = q * frame.LOOK;
        g.globalAlpha = (1 - q) * 0.45;
        g.fillStyle = "#e5faff";
        quad(x0, x1, d - 0.04, d + 0.04);
        g.fill();
      }
      // rails, lane dividers, beat lines
      g.strokeStyle = tr.color;
      g.globalAlpha = me ? (frame.isLiquid() ? 0.6 : 0.95) : 0.35;
      g.lineWidth = frame.isLiquid() ? (me ? 7 : 3) : me ? 3 : 1.5;
      seg(x0, -0.35, x0, frame.LOOK);
      seg(x1, -0.35, x1, frame.LOOK);
      g.globalAlpha = 0.14;
      g.lineWidth = 1;
      seg(x0 + frame.LW, -0.35, x0 + frame.LW, frame.LOOK);
      seg(x0 + 2 * frame.LW, -0.35, x0 + 2 * frame.LW, frame.LOOK);
      for (
        let k = Math.max(0, frame.idx(frame.beats, t - 0.35) + 1);
        k < frame.beats.length && frame.beats[k] < t + frame.LOOK;
        k++
      ) {
        const d = frame.beats[k] - t,
          j = (((k - frame.gridDown) % 8) + 8) % 8,
          phr = j === 0,
          br = j % 4 === 0;
        g.globalAlpha =
          (phr ? 0.85 : br ? 0.35 : 0.12) * (me ? 1 : 0.55) * fade(d);
        g.lineWidth = phr ? 3 : 1;
        seg(x0, d, x1, d);
      }
      // notes
      for (
        let k = frame.noteIndex(tr.notes, t - 0.3);
        k < tr.notes.length && tr.notes[k].t <= t + frame.LOOK;
        k++
      ) {
        const n = tr.notes[k],
          d = n.t - t;
        if (n.hit) continue;
        const lx = x0 + n.lane * frame.LW,
          au = frame.auto(tr, n);
        g.fillStyle = tr.color;
        if (au && d < 0) {
          if (d > -0.15) {
            g.globalAlpha = (1 + d / 0.15) * 0.7;
            quad(lx + 3, lx + frame.LW - 3, -0.05, 0.6);
            g.fill();
          }
          continue;
        }
        const a = (au ? 0.22 : n.missed ? 0.15 : me ? 1 : 0.45) * fade(d);
        if (frame.isPaper() || frame.isCircuit()) {
          const [nx, ny] = P(lx + frame.LW / 2, d),
            scale = frame.F / (frame.F + Math.max(d, -0.35));
          g.globalAlpha = a;
          g.strokeStyle = frame.isPaper() ? "#151c29" : "#eff6ff";
          g.lineWidth = Math.max(1, 2 * scale);
          if (frame.isPaper()) {
            g.beginPath();
            g.moveTo(nx - 17 * scale, ny - 4 * scale);
            g.lineTo(nx + 15 * scale, ny - 5 * scale);
            g.lineTo(nx + 18 * scale, ny + 4 * scale);
            g.lineTo(nx - 15 * scale, ny + 5 * scale);
            g.closePath();
          } else {
            g.beginPath();
            g.moveTo(nx, ny - 7 * scale);
            g.lineTo(nx + 17 * scale, ny);
            g.lineTo(nx, ny + 7 * scale);
            g.lineTo(nx - 17 * scale, ny);
            g.closePath();
          }
          g.fill();
          g.stroke();
          if (!au && !n.missed) {
            g.fillStyle = "#fff5da";
            g.fillRect(nx - 6 * scale, ny - scale, 12 * scale, 2 * scale);
          }
          continue;
        }
        if (frame.isLiquid()) {
          const [nx, ny] = P(lx + frame.LW / 2, d),
            scale = frame.F / (frame.F + Math.max(d, -0.35));
          g.globalAlpha = a * 0.28;
          g.beginPath();
          g.ellipse(nx, ny, 18 * scale, 7 * scale, 0, 0, Math.PI * 2);
          g.fill();
          g.globalAlpha = a;
          g.beginPath();
          g.ellipse(nx, ny, 11 * scale, 4 * scale, 0, 0, Math.PI * 2);
          g.fill();
          if (!au && !n.missed) {
            g.fillStyle = "#effffb";
            g.beginPath();
            g.ellipse(
              nx,
              ny - scale,
              5 * scale,
              1.5 * scale,
              0,
              0,
              Math.PI * 2,
            );
            g.fill();
          }
          continue;
        }
        g.globalAlpha = a * 0.35;
        quad(lx + 3, lx + frame.LW - 3, d - 0.06, d + 0.06);
        g.fill();
        g.globalAlpha = a;
        quad(lx + 8, lx + frame.LW - 8, d - 0.03, d + 0.03);
        g.fill();
        if (!au && !n.missed) {
          g.globalAlpha = a * 0.8;
          g.fillStyle = "#fff";
          quad(lx + 16, lx + frame.LW - 16, d - 0.01, d + 0.01);
          g.fill();
        }
      }
      // player hit flashes
      for (let l = 0; l < 3; l++) {
        const age = frame.rt - frame.laneHit[i * 3 + l];
        if (age > 0.25) continue;
        const lx = x0 + l * frame.LW;
        g.globalAlpha = (1 - age / 0.25) * 0.55;
        g.fillStyle = tr.color;
        quad(lx, lx + frame.LW, -0.1, 1.6);
        g.fill();
      }
      // hit line
      if (me) {
        g.globalAlpha = 0.25 + 0.25 * frame.pulse;
        g.lineWidth = 14;
        seg(x0, 0, x1, 0);
      }
      g.strokeStyle = me ? "#fff" : tr.color;
      g.globalAlpha = me ? 1 : 0.3;
      g.lineWidth = me ? 3 : 2;
      seg(x0, 0, x1, 0);
      if (me && frame.rt - frame.missAt < 0.3) {
        g.globalAlpha = 1 - (frame.rt - frame.missAt) / 0.3;
        g.fillStyle = "#ff2244";
        quad(x0, x1, -0.06, 0.06);
        g.fill();
      }
      if (me)
        for (let l = 0; l < 3; l++) {
          const lx = x0 + l * frame.LW,
            on = frame.rt - frame.press[l] < 0.1;
          g.globalAlpha = on ? 0.9 : 0.35;
          g.strokeStyle = "#fff";
          g.lineWidth = 1.5;
          quad(lx + 6, lx + frame.LW - 6, -0.035, 0.035);
          g.stroke();
          if (on) {
            g.fillStyle = "#fff";
            g.globalAlpha = 0.35;
            g.fill();
          }
        }
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      if (me) {
        for (let l = 0; l < 3; l++)
          text(
            (frame.touchEnabled ? "LMR" : "JKL")[l],
            sx(x0 + l * frame.LW + frame.LW / 2),
            frame.HIT_Y + 30,
            `600 13px ${frame.MONO}`,
            "rgba(255,255,255,.5)",
          );
        const ns = capd
          ? []
          : frame.phraseNotes(tr, ph).filter((n) => !frame.auto(tr, n));
        ns.forEach((n, k) => {
          g.fillStyle = n.hit
            ? tr.color
            : n.missed
              ? "#ff2244"
              : "rgba(255,255,255,.22)";
          g.fillRect(
            sx(cx) + (k - (ns.length - 1) / 2) * 9 - 3,
            frame.HIT_Y + 44,
            6,
            6,
          );
        });
      }
    });
    if (
      playing &&
      frame.locked(frame.tracks[frame.run.currentTrack], t) &&
      !frame.reducedMotion?.matches
    ) {
      const age = frame.rt - frame.tracks[frame.run.currentTrack].capAt,
        right = frame.next(1),
        target = right >= 0 ? right : frame.next(-1);
      if (target >= 0 && age >= 0.65 && age < 1.35) {
        const q = (age - 0.65) / 0.7,
          from = sx(frame.trackX(frame.run.currentTrack)),
          to = sx(frame.trackX(target)),
          x = from + (to - from) * (1 - (1 - q) ** 3);
        g.globalAlpha = Math.sin(q * Math.PI) * 0.8;
        g.strokeStyle = frame.tracks[target].color;
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(from, frame.HIT_Y - 16);
        g.lineTo(x, frame.HIT_Y - 16);
        g.stroke();
        const dir = Math.sign(to - from);
        g.beginPath();
        g.moveTo(x - dir * 8, frame.HIT_Y - 22);
        g.lineTo(x, frame.HIT_Y - 16);
        g.lineTo(x - dir * 8, frame.HIT_Y - 10);
        g.stroke();
        g.globalAlpha = 1;
      }
    }
    g.globalCompositeOperation = "lighter";
    for (const r of frame.rings) {
      const a = (frame.rt - r.born) / 0.7;
      g.globalAlpha = 1 - a;
      g.strokeStyle = r.color;
      g.lineWidth = 8 * (1 - a);
      g.beginPath();
      g.ellipse(
        sx(r.x),
        frame.HIT_Y,
        30 + a * 520,
        (30 + a * 520) * 0.35,
        0,
        0,
        7,
      );
      g.stroke();
    }
    for (const p of frame.parts) {
      g.globalAlpha = 1 - (frame.rt - p.born) / p.life;
      g.fillStyle = p.color;
      if (frame.isLiquid()) {
        g.beginPath();
        g.arc(sx(p.x), p.y, p.size / 2, 0, Math.PI * 2);
        g.fill();
      } else g.fillRect(sx(p.x) - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    g.globalCompositeOperation = "source-over";
    for (const p of frame.pops) {
      const age = frame.rt - p.born;
      g.globalAlpha = Math.min(1, 2 * (1 - age / p.life));
      text(
        p.text,
        sx(p.x),
        p.y - age * 50,
        `italic 900 ${p.size * (1 + Math.max(0, 0.12 - age) * 4)}px ${frame.SANS}`,
        p.color,
        "center",
        12,
      );
    }
    g.globalAlpha = 1;
  }
  function drawHud(t, playing) {
    // ---------- HUD (no camera transform) ----------
    g.setTransform(frame.DPR, 0, 0, frame.DPR, 0, 0);
    if (frame.mode === "play") drawCraft();
    if (
      frame.mode === "play" &&
      frame.inSync &&
      frame.rt - frame.syncAt < 1.6
    ) {
      text(
        "IN SYNC",
        frame.W / 2,
        120,
        `italic 900 26px ${frame.SANS}`,
        "#e5faff",
        "center",
        frame.reducedMotion?.matches ? 0 : 12,
      );
    }
    if (frame.flash && frame.rt - frame.flash.born < 0.35) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 0.3 * (1 - (frame.rt - frame.flash.born) / 0.35);
      g.fillStyle = frame.flash.color;
      g.fillRect(0, 0, frame.W, frame.H);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
    }
    if (frame.rt - frame.offsetAt < 1.5)
      text(
        `audio offset ${frame.offset >= 0 ? "+" : ""}${Math.round(frame.offset * 1000)} ms`,
        frame.W / 2,
        545,
        `700 13px ${frame.MONO}`,
        "#fff",
      );
    if (!playing) return frame.drawTitle();
    const arrival = frame.entrance
      ? Math.max(0, frame.rt - frame.entrance.at)
      : 1;
    g.globalAlpha =
      frame.entrance && t < 0
        ? Math.max(0, Math.min(1, (arrival - 0.4) / 0.35))
        : 1;
    text(
      "SCORE",
      24,
      30,
      `700 11px ${frame.SANS}`,
      "rgba(255,255,255,.55)",
      "left",
    );
    text(
      String(Math.round(frame.shown)).padStart(6, "0"),
      24,
      62,
      `700 32px ${frame.MONO}`,
      "#fff",
      "left",
      10,
    );
    const mc =
      frame.run.multiplier === 1
        ? "#bbb"
        : `hsl(${210 - frame.run.multiplier * 25},100%,65%)`;
    text(
      `×${frame.run.multiplier}`,
      frame.W - 24,
      62,
      `italic 900 ${40 + frame.pulse * frame.run.multiplier}px ${frame.SANS}`,
      mc,
      "right",
      frame.run.multiplier * 3,
    );
    for (let k = 0; k < 8; k++) {
      g.fillStyle = k < frame.run.multiplier ? mc : "rgba(255,255,255,.15)";
      g.fillRect(frame.W - 24 - (8 - k) * 11, 74, 8, 4);
    }
    const end = frame.song.duration,
      pw = 300,
      px = frame.W / 2 - pw / 2;
    g.fillStyle = "rgba(255,255,255,.12)";
    g.fillRect(px, 22, pw, 4);
    g.fillStyle = `hsl(${frame.hue},90%,70%)`;
    g.fillRect(px, 22, pw * Math.max(0, Math.min(1, t / end)), 4);
    g.fillStyle = "rgba(0,0,0,.6)";
    for (let p = 2; p < frame.bars.length && frame.bars[p] < end; p += 2)
      g.fillRect(px + (pw * frame.bars[p]) / end, 22, 1, 4);
    text(
      `${frame.song.title} · ${frame.LEVELS[frame.level].name}`,
      frame.W / 2,
      44,
      `600 11px ${frame.SANS}`,
      "rgba(255,255,255,.5)",
    );
    const grooveColor = frame.run.groove < 40 ? "#ff4d6d" : "#3ddc97";
    g.fillStyle = "rgba(255,255,255,.12)";
    g.fillRect(px + 50, 65, 200, 5);
    g.fillStyle = grooveColor;
    g.fillRect(px + 50, 65, frame.run.groove * 2, 5);
    text(
      `GROOVE ${Math.ceil(frame.run.groove)}%${frame.run.groove < 40 ? " · KEEP THE SONG ALIVE" : ""}`,
      frame.W / 2,
      88,
      `700 10px ${frame.MONO}`,
      grooveColor,
    );
    frame.tracks.forEach((tr, i) => {
      const x = 30 + i * 190,
        y = 560,
        capd = frame.locked(tr, t),
        me = i === frame.run.currentTrack;
      g.fillStyle = capd ? tr.color + "40" : "rgba(255,255,255,.05)";
      g.beginPath();
      g.roundRect(x, y, 170, 26, 6);
      g.fill();
      if (capd) {
        g.fillStyle = tr.color;
        g.fillRect(x + 6, y + 21, 158 * frame.captureRemaining(tr, t), 2);
      }
      if (me) {
        g.strokeStyle = "#fff";
        g.lineWidth = 2;
        g.stroke();
      }
      text(
        capd
          ? `${tr.name}  ${tr.capTo - frame.barF(t) <= 1 ? "ENDING" : "AUTO"}`
          : tr.notes.length
            ? tr.name
            : `${tr.name} · SILENT`,
        x + 85,
        y + 17,
        `800 12px ${frame.SANS}`,
        me ? "#fff" : tr.notes.length ? tr.color : "rgba(255,255,255,.3)",
      );
    });
    g.globalAlpha = 1;
    if (
      !frame.playable(frame.tracks[frame.run.currentTrack], t) &&
      frame.mode === "play"
    ) {
      // this track is on autopilot: point at the tracks you can move to
      const a = 0.55 + 0.45 * frame.pulse,
        l = frame.next(-1),
        r = frame.next(1);
      if (l >= 0)
        text(
          `◀ A  ${frame.tracks[l].name}`,
          24,
          430,
          `900 20px ${frame.SANS}`,
          frame.tracks[l].color,
          "left",
          16 * a,
        );
      if (r >= 0)
        text(
          `${frame.tracks[r].name}  D ▶`,
          frame.W - 24,
          430,
          `900 20px ${frame.SANS}`,
          frame.tracks[r].color,
          "right",
          16 * a,
        );
    }
    if (t < 0) {
      const f = -t % 1;
      text(
        String(Math.ceil(-t)),
        frame.W / 2,
        330,
        `italic 900 ${90 + f * 60}px ${frame.SANS}`,
        `rgba(255,255,255,${f})`,
        "center",
        30,
      );
    } else if (t < 0.6)
      text(
        "GO!",
        frame.W / 2,
        330,
        `italic 900 ${110 + t * 80}px ${frame.SANS}`,
        `rgba(255,255,255,${1 - t / 0.6})`,
        "center",
        30,
      );
    if (frame.mode === "over") frame.drawResults();
    if (frame.mode === "failed") frame.drawFailure();
    if (frame.entrance) {
      // Composite the last menu frame, so its many independent alpha values fade together.
      if (arrival < 0.4 && t < 0) {
        g.globalAlpha = 1 - arrival / 0.4;
        g.drawImage(frame.entrance.image, 0, 0, frame.W, frame.H);
        g.globalAlpha = 1;
      }
    }
  }
  function renderScene(t, playing) {
    drawBackdrop(t, playing);
    drawHighway(t, playing);
    drawHud(t, playing);
  }

  return {
    P: (...args) => {
      frame = readFrame();
      return P(...args);
    },
    text: (...args) => {
      frame = readFrame();
      return text(...args);
    },
    renderScene: (...args) => {
      frame = readFrame();
      return renderScene(...args);
    },
    craftX: (...args) => {
      frame = readFrame();
      return craftX(...args);
    },
    materialTexture: (...args) => {
      frame = readFrame();
      return materialTexture(...args);
    },
    drawMaterial: (...args) => {
      frame = readFrame();
      return drawMaterial(...args);
    },
    drawCaptureMaterial: (...args) => {
      frame = readFrame();
      return drawCaptureMaterial(...args);
    },
    captureLight: (...args) => {
      frame = readFrame();
      return captureLight(...args);
    },
    drawLiquidWorld: (...args) => {
      frame = readFrame();
      return drawLiquidWorld(...args);
    },
    drawBuiltWorld: (...args) => {
      frame = readFrame();
      return drawBuiltWorld(...args);
    },
    drawWorld: (...args) => {
      frame = readFrame();
      return drawWorld(...args);
    },
    drawCraft: (...args) => {
      frame = readFrame();
      return drawCraft(...args);
    },
  };
}
