// Canvas-based low-poly avatar animation.
// Parses SVG polygon data into typed arrays and renders via canvas 2D API,
// completely avoiding per-polygon DOM writes that cripple mobile browsers.
(function () {
  var container = document.querySelector('.avatar-overlay[data-src]');
  if (!container) return;

  var rafId = null;

  function teardown() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    if (container.parentNode) container.parentNode.removeChild(container);
  }

  container.classList.add('active');

  fetch(container.dataset.src)
    .then(function (res) { return res.text(); })
    .then(function (svgText) {
      try {
        // ── Parse SVG ────────────────────────────────────────────────────────
        var tmp = document.createElement('div');
        tmp.innerHTML = svgText.trim();
        var svg = tmp.querySelector('svg');
        if (!svg) return;

        var vb = svg.viewBox.baseVal;
        var VW = vb.width, VH = vb.height;   // typically 1024 × 1024

        // ── Create canvas ─────────────────────────────────────────────────────
        var canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
        container.appendChild(canvas);
        var ctx = canvas.getContext('2d');

        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        function resizeCanvas() {
          var r = canvas.getBoundingClientRect();
          var w = (r.width  * dpr + 0.5) | 0;
          var h = (r.height * dpr + 0.5) | 0;
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w; canvas.height = h;
          }
        }
        resizeCanvas();
        new ResizeObserver(resizeCanvas).observe(container);

        // ── Parse polygons → typed arrays ─────────────────────────────────────
        var RADIAL_Y_OFFSET = -0.05;
        var centerX = vb.x + VW / 2;
        var centerY = vb.y + VH / 2 + VH * RADIAL_Y_OFFSET;
        var maxDist  = Math.min(VW, VH) / 2;

        var polyEls  = svg.querySelectorAll('polygon');
        var _ptsArr  = [], _ptCount = [], _ptOff = [];
        var _oR = [], _oG = [], _oB = [], _base = [], _cx = [], _cy = [];
        var totalPts = 0;

        for (var pi = 0; pi < polyEls.length; pi++) {
          var poly    = polyEls[pi];
          var tokens  = poly.getAttribute('points').split(/\s+/);
          var pn = 0, sx = 0, sy = 0, tmp_pts = [];

          for (var j = 0; j < tokens.length; j++) {
            var ci = tokens[j].indexOf(',');
            if (ci <= 0) continue;
            var x = +tokens[j].substring(0, ci);
            var y = +tokens[j].substring(ci + 1);
            tmp_pts.push(x, y);
            sx += x; sy += y;
            pn++;
          }
          if (pn < 2) continue;

          var cx = sx / pn, cy = sy / pn;
          var dx = cx - centerX, dy = cy - centerY;
          var base = Math.min(Math.sqrt(dx * dx + dy * dy) * 1.35 / maxDist, 1);
          var fill = poly.style.fill;
          var m    = fill.match(/(\d+)/g);

          _ptsArr.push(tmp_pts);
          _ptCount.push(pn);
          _ptOff.push(totalPts);
          totalPts += pn * 2;
          _oR.push(m ? +m[0] : 0);
          _oG.push(m ? +m[1] : 0);
          _oB.push(m ? +m[2] : 0);
          _base.push(base);
          _cx.push(cx); _cy.push(cy);
        }

        var N = _ptCount.length;

        // Allocate typed arrays
        var flatPts = new Float32Array(totalPts);
        var ptCount = new Uint8Array(N);
        var ptOff   = new Uint32Array(N);
        var oR = new Uint8Array(N), oG = new Uint8Array(N), oB = new Uint8Array(N);
        var baseA   = new Float32Array(N);
        var cxA     = new Float32Array(N);
        var cyA     = new Float32Array(N);

        for (var i = 0; i < N; i++) {
          var src = _ptsArr[i], off = _ptOff[i];
          for (var k = 0; k < src.length; k++) flatPts[off + k] = src[k];
          ptCount[i] = _ptCount[i];
          ptOff[i]   = _ptOff[i];
          oR[i]      = _oR[i];
          oG[i]      = _oG[i];
          oB[i]      = _oB[i];
          baseA[i]   = _base[i];
          cxA[i]     = _cx[i];
          cyA[i]     = _cy[i];
        }
        _ptsArr = _ptCount = _ptOff = _oR = _oG = _oB = _base = _cx = _cy = null;

        // Pre-compute base fill strings (avoids per-frame string allocation for static polygons)
        var baseColors = new Array(N);
        for (var i = 0; i < N; i++) {
          baseColors[i] = 'rgb(' + oR[i] + ',' + oG[i] + ',' + oB[i] + ')';
        }

        // ── HSL colour LUT ────────────────────────────────────────────────────
        var HUE_R = new Uint8Array(360), HUE_G = new Uint8Array(360), HUE_B = new Uint8Array(360);
        (function () {
          var s = 0.9, l = 0.55;
          var q = l + s - l * s, p = 2 * l - q;
          function h2r(p, q, t) {
            if (t < 0) t += 1; if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 0.5) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
          }
          for (var h = 0; h < 360; h++) {
            var n = h / 360;
            HUE_R[h] = (h2r(p, q, n + 1/3) * 255 + 0.5) | 0;
            HUE_G[h] = (h2r(p, q, n      ) * 255 + 0.5) | 0;
            HUE_B[h] = (h2r(p, q, n - 1/3) * 255 + 0.5) | 0;
          }
        })();

        // ── Spatial grid for hover ────────────────────────────────────────────
        var hoverRadius   = maxDist * 1.2;
        var hoverRadiusSq = hoverRadius * hoverRadius;
        var invRadius     = 1 / hoverRadius;
        var cellSize      = hoverRadius;
        var invCell       = 1 / cellSize;
        var gCols = ((VW * invCell) | 0) + 2;
        var gRows = ((VH * invCell) | 0) + 2;
        var grid  = new Array(gCols * gRows);
        for (var g = 0; g < grid.length; g++) grid[g] = [];
        for (var i = 0; i < N; i++) {
          var c = ((cxA[i] - vb.x) * invCell) | 0;
          var r = ((cyA[i] - vb.y) * invCell) | 0;
          if (c >= 0 && c < gCols && r >= 0 && r < gRows) grid[r * gCols + c].push(i);
        }

        // ── Animation state ───────────────────────────────────────────────────
        // Per-polygon pulse start time. -1e15 = never pulsed.
        var pulseStart  = new Float64Array(N);
        var hoverIntn   = new Float32Array(N);   // 0..1 hover intensity
        var hoverHueArr = new Int16Array(N);      // hue per polygon during hover
        for (var i = 0; i < N; i++) pulseStart[i] = -1e15;

        // ── Environment detection ─────────────────────────────────────────────
        var isMobile = window.matchMedia('(pointer:coarse)').matches;
        var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        var PULSE_DURATION = 3000;
        var PULSE_RISE     = 1500;
        var PULSE_INTERVAL = isMobile ? 200 : 200;
        var PULSE_SIZE     = isMobile ? 25   : 25;

        // Cap frame rate on mobile/coarse-pointer devices to save battery
        var FPS_INTERVAL = 0;
        var lastFrameTime = -1;
        var lastPulseSpawn = 0;

        // ── Pointer state ─────────────────────────────────────────────────────
        var ptrX = 0, ptrY = 0, hasPtr = false, isHovering = false;
        var avatarEl = document.querySelector('.avatar');

        function updatePointer(clientX, clientY) {
          var r = canvas.getBoundingClientRect();
          ptrX = (clientX - r.left) / r.width  * VW;
          ptrY = (clientY - r.top)  / r.height * VH;
          hasPtr = true;
        }

        // ── Main RAF loop ─────────────────────────────────────────────────────
        function frame(time) {
          rafId = requestAnimationFrame(frame);

          // Throttle frame rate on mobile
          if (FPS_INTERVAL > 0) {
            if (lastFrameTime >= 0 && time - lastFrameTime < FPS_INTERVAL) return;
          }
          lastFrameTime = time;

          // Spawn new pulses using timestamps — no setInterval/setTimeout
          if (!prefersReducedMotion && time - lastPulseSpawn > PULSE_INTERVAL) {
            lastPulseSpawn = time;
            var spawned = 0, tries = 0, maxTries = PULSE_SIZE * 5;
            while (spawned < PULSE_SIZE && tries < maxTries) {
              var idx = (Math.random() * N) | 0;
              if (time - pulseStart[idx] < PULSE_DURATION) { tries++; continue; }
              if (hoverIntn[idx] > 0.05)                   { tries++; continue; }
              pulseStart[idx] = time;
              spawned++; tries++;
            }
          }

          // Update hover intensities — all JS array ops, zero DOM writes
          if (isHovering && hasPtr) {
            hoverIntn.fill(0);
            var mc = ((ptrX - vb.x) * invCell) | 0;
            var mr = ((ptrY - vb.y) * invCell) | 0;
            var r0 = Math.max(mr - 1, 0), r1 = Math.min(mr + 1, gRows - 1);
            var c0 = Math.max(mc - 1, 0), c1 = Math.min(mc + 1, gCols - 1);
            var t02 = time * 0.2;
            for (var row = r0; row <= r1; row++) {
              var rowOff = row * gCols;
              for (var col = c0; col <= c1; col++) {
                var cell = grid[rowOff + col];
                for (var j = 0, cl = cell.length; j < cl; j++) {
                  var idx = cell[j];
                  var dx = cxA[idx] - ptrX, dy = cyA[idx] - ptrY;
                  var dSq = dx * dx + dy * dy;
                  if (dSq >= hoverRadiusSq) continue;
                  var dist = Math.sqrt(dSq);
                  var raw  = 1 - dist * invRadius;
                  hoverIntn[idx]   = raw * raw;
                  hoverHueArr[idx] = ((t02 + dist * 2 + idx * 13) % 360 + 360) % 360 | 0;
                }
              }
            }
          } else {
            // Smooth fade-out — replaces the CSS transition that was on SVG polygons
            for (var i = 0; i < N; i++) {
              if (hoverIntn[i] > 0.001) hoverIntn[i] *= 0.85;
              else hoverIntn[i] = 0;
            }
          }

          // Draw — single canvas pass, no DOM writes
          var cw = canvas.width, ch = canvas.height;
          var scX = cw / VW, scY = ch / VH;

          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, cw, ch);
          ctx.setTransform(scX, 0, 0, scY, 0, 0);

          for (var i = 0; i < N; i++) {
            var hI  = hoverIntn[i];
            var pEl = time - pulseStart[i];
            var pI  = 0;
            if (pEl >= 0 && pEl < PULSE_DURATION) {
              pI = pEl < PULSE_RISE
                ? pEl / PULSE_RISE
                : 1 - (pEl - PULSE_RISE) / (PULSE_DURATION - PULSE_RISE);
            }

            var opacity, fillStr, scale;
            if (hI > 0.001) {
              // Hover drives colour; pulse stacks brightness + scale on top
              var hue = hoverHueArr[i];
              var mix = hI * 0.9;
              var fr  = (oR[i] + (HUE_R[hue] - oR[i]) * mix + 0.5) | 0;
              var fg  = (oG[i] + (HUE_G[hue] - oG[i]) * mix + 0.5) | 0;
              var fb  = (oB[i] + (HUE_B[hue] - oB[i]) * mix + 0.5) | 0;
              fillStr = 'rgb(' + fr + ',' + fg + ',' + fb + ')';
              opacity = Math.min(baseA[i] + hI * hI * 0.25 + baseA[i] * pI * 0.7, 1);
              scale   = 1 + hI * hI * 0.12 + pI * 0.25;
            } else if (pI > 0.001) {
              fillStr = baseColors[i];
              opacity = Math.min(baseA[i] * (1 + pI * 0.5), 1);
              scale   = 1 + pI * 0.25;
            } else {
              fillStr = baseColors[i];
              opacity = baseA[i];
              scale   = 1;
            }

            ctx.globalAlpha = opacity > 1 ? 1 : opacity;
            ctx.fillStyle   = fillStr;

            var off = ptOff[i];
            var cnt = ptCount[i] * 2;
            var px  = cxA[i], py = cyA[i];

            ctx.beginPath();
            if (scale > 1.0001) {
              // Scale polygon vertices around their centroid
              ctx.moveTo(px + (flatPts[off]     - px) * scale,
                         py + (flatPts[off + 1] - py) * scale);
              for (var j = 2; j < cnt; j += 2) {
                ctx.lineTo(px + (flatPts[off + j]     - px) * scale,
                           py + (flatPts[off + j + 1] - py) * scale);
              }
            } else {
              ctx.moveTo(flatPts[off], flatPts[off + 1]);
              for (var j = 2; j < cnt; j += 2) {
                ctx.lineTo(flatPts[off + j], flatPts[off + j + 1]);
              }
            }
            ctx.closePath();
            ctx.fill();
          }
        }

        rafId = requestAnimationFrame(frame);

        // ── Event listeners ───────────────────────────────────────────────────
        avatarEl.addEventListener('mouseenter', function () { isHovering = true; });
        avatarEl.addEventListener('mouseleave', function () { isHovering = false; hasPtr = false; });
        avatarEl.addEventListener('mousemove',  function (e) { updatePointer(e.clientX, e.clientY); });

        avatarEl.addEventListener('touchstart', function (e) {
          var t = e.touches[0]; updatePointer(t.clientX, t.clientY); isHovering = true;
        }, { passive: true });
        avatarEl.addEventListener('touchmove', function (e) {
          var t = e.touches[0]; updatePointer(t.clientX, t.clientY);
        }, { passive: true });
        avatarEl.addEventListener('touchend',    function () { isHovering = false; }, { passive: true });
        avatarEl.addEventListener('touchcancel', function () { isHovering = false; }, { passive: true });

      } catch (err) { teardown(); }
    })
    .catch(teardown);
})();
