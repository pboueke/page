// Inline the avatar SVG and animate random polygon groups
(function () {
  var container = document.querySelector(".avatar-overlay[data-src]");
  if (!container) return;

  function teardown() {
    if (container.parentNode) container.parentNode.removeChild(container);
  }

  container.classList.add("active");

  fetch(container.dataset.src)
    .then(function (res) { return res.text(); })
    .then(function (svgText) {
      try {
        var tmp = document.createElement("div");
        tmp.innerHTML = svgText.trim();
        var svg = tmp.querySelector("svg");
        if (!svg) return;

        svg.removeAttribute("width");
        svg.removeAttribute("height");
        container.appendChild(svg);

        var vb = svg.viewBox.baseVal;
        var centerX = vb.x + vb.width / 2;
        // Adjust this value to shift the radial opacity center upward (negative) or downward (positive).
        // The unit is a fraction of the SVG height. Examples: -0.1 = 10% up, -0.2 = 20% up, 0 = true center.
        var RADIAL_CENTER_Y_OFFSET = -0.05;
        var centerY = vb.y + vb.height / 2 + vb.height * RADIAL_CENTER_Y_OFFSET;
        var maxDist = Math.min(vb.width, vb.height) / 2;

        // --- Precompute HSL(h, 90%, 55%) look-up (avoids per-frame trig) ---
        var HUE_R = new Uint8Array(360);
        var HUE_G = new Uint8Array(360);
        var HUE_B = new Uint8Array(360);
        (function () {
          var s = 0.9, l = 0.55;
          var q = l + s - l * s, p = 2 * l - q;
          function h2r(p, q, t) {
            if (t < 0) t += 1; if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
          }
          for (var h = 0; h < 360; h++) {
            var n = h / 360;
            HUE_R[h] = (h2r(p, q, n + 1 / 3) * 255 + 0.5) | 0;
            HUE_G[h] = (h2r(p, q, n)         * 255 + 0.5) | 0;
            HUE_B[h] = (h2r(p, q, n - 1 / 3) * 255 + 0.5) | 0;
          }
        })();

        // --- Parse polygons into flat typed arrays (cache-friendly) ---
        var polyEls = svg.querySelectorAll("polygon");
        var N = 0;
        var _cx = [], _cy = [], _base = [], _oR = [], _oG = [], _oB = [],
            _els = [], _fills = [];

        for (var pi = 0; pi < polyEls.length; pi++) {
          var poly = polyEls[pi];
          var pts = poly.getAttribute("points").split(/\s+/);
          var sx = 0, sy = 0, pn = 0;
          for (var j = 0; j < pts.length; j++) {
            var ci = pts[j].indexOf(",");
            if (ci > 0) { sx += +pts[j].substring(0, ci); sy += +pts[j].substring(ci + 1); pn++; }
          }
          if (pn === 0) continue;
          var cx = sx / pn, cy = sy / pn;
          var dx = cx - centerX, dy = cy - centerY;
          var base = Math.min(Math.sqrt(dx * dx + dy * dy) * 1.25 / maxDist, 1);
          poly.style.opacity = base;
          var fill = poly.style.fill;
          var m = fill.match(/(\d+)/g);
          _cx.push(cx); _cy.push(cy); _base.push(base);
          _oR.push(m ? +m[0] : 0); _oG.push(m ? +m[1] : 0); _oB.push(m ? +m[2] : 0);
          _els.push(poly); _fills.push(fill);
        }

        N = _cx.length;
        var cxA  = new Float32Array(_cx),  cyA  = new Float32Array(_cy);
        var baseA = new Float32Array(_base);
        var oR = new Uint8Array(_oR), oG = new Uint8Array(_oG), oB = new Uint8Array(_oB);
        var els = _els, fills = _fills;
        _cx = _cy = _base = _oR = _oG = _oB = _els = _fills = null;

        // --- Spatial grid (cell = hoverRadius → check 3x3 neighbourhood) ---
        var hoverRadius   = maxDist * 1.2;
        var hoverRadiusSq = hoverRadius * hoverRadius;
        var invRadius     = 1 / hoverRadius;
        var cellSize      = hoverRadius;
        var invCell       = 1 / cellSize;
        var gCols = ((vb.width  * invCell) | 0) + 2;
        var gRows = ((vb.height * invCell) | 0) + 2;
        var grid  = new Array(gCols * gRows);
        for (var g = 0; g < grid.length; g++) grid[g] = [];
        for (var i = 0; i < N; i++) {
          var c = ((cxA[i] - vb.x) * invCell) | 0;
          var r = ((cyA[i] - vb.y) * invCell) | 0;
          if (c >= 0 && c < gCols && r >= 0 && r < gRows) grid[r * gCols + c].push(i);
        }

        // --- Hover flag (needed by pulse to skip hovered polygons) ---
        var isHovFlag = new Uint8Array(N);

        // --- Ambient pulse (unchanged logic, flat-array version) ---
        var PULSE_SIZE = 15;
        var pulseTimer;

        function pulseGroup() {
          var batch = [];
          for (var k = 0; k < PULSE_SIZE; k++) {
            var idx = (Math.random() * N) | 0;
            if (isHovFlag[idx]) continue;
            var el = els[idx], b = baseA[idx];
            el.style.opacity = b + (1 - b) * 0.9;
            el.style.transform = "scale(1.3)";
            batch.push(idx);
          }
          setTimeout(function () {
            for (var k = 0; k < batch.length; k++) {
              var idx = batch[k];
              if (isHovFlag[idx]) continue;
              els[idx].style.opacity = baseA[idx];
              els[idx].style.transform = "scale(1)";
            }
          }, 900);
        }

        pulseTimer = setInterval(pulseGroup, 50);
        pulseGroup();

        // --- Hover bookkeeping ---
        var avatarEl   = document.querySelector(".avatar");
        var ptrX = 0, ptrY = 0, hasPtr = false;
        var isHovering = false, hoverRAF = null;
        var hovList    = [];                  // indices touched last frame

        // Cached inverse CTM (avoids getScreenCTM + inverse per mouse event)
        var mA, mB, mC, mD, mE, mF, ctmOk = false, ctmDirty = true;
        function refreshCTM() {
          var ct = svg.getScreenCTM();
          if (!ct) { ctmOk = false; return; }
          var inv = ct.inverse();
          mA = inv.a; mB = inv.b; mC = inv.c;
          mD = inv.d; mE = inv.e; mF = inv.f;
          ctmOk = true;
        }
        new ResizeObserver(function () { ctmDirty = true; }).observe(avatarEl);
        window.addEventListener("scroll", function () { ctmDirty = true; }, { passive: true, capture: true });

        function updatePointer(cx, cy) {
          if (ctmDirty) { refreshCTM(); ctmDirty = false; }
          if (!ctmOk) return;
          ptrX = mA * cx + mC * cy + mE;
          ptrY = mB * cx + mD * cy + mF;
          hasPtr = true;
        }

        // --- Restore helper (one DOM write per polygon) ---
        var RESTORE_STYLE_SUFFIX =
          ";stroke:none;transform:scale(1)" +
          ";transition:opacity 2s ease-in-out,transform 2s ease-in-out,fill 1s ease-in-out";

        function restore(idx) {
          els[idx].style.cssText = "fill:" + fills[idx] + ";opacity:" + baseA[idx] + RESTORE_STYLE_SUFFIX;
        }

        // --- Core hover loop (wrapped for safety) ---
        function hoverLoop(time) {
          try {
            if (!isHovering) return;
            if (!hasPtr) { hoverRAF = requestAnimationFrame(hoverLoop); return; }

            // 1. Clear flags from previous frame
            for (var k = 0, hl = hovList.length; k < hl; k++) isHovFlag[hovList[k]] = 0;

            // 2. Walk 3×3 grid neighbourhood, apply effect to polygons in radius
            var newList = [];
            var mc = ((ptrX - vb.x) * invCell) | 0;
            var mr = ((ptrY - vb.y) * invCell) | 0;
            var r0 = mr - 1, r1 = mr + 1, c0 = mc - 1, c1 = mc + 1;
            if (r0 < 0) r0 = 0; if (c0 < 0) c0 = 0;
            if (r1 >= gRows) r1 = gRows - 1; if (c1 >= gCols) c1 = gCols - 1;

            var t02 = time * 0.2;

            for (var row = r0; row <= r1; row++) {
              var rowOff = row * gCols;
              for (var col = c0; col <= c1; col++) {
                var cell = grid[rowOff + col];
                for (var j = 0, cl = cell.length; j < cl; j++) {
                  var idx = cell[j];
                  var dx = cxA[idx] - ptrX;
                  var dy = cyA[idx] - ptrY;
                  var dSq = dx * dx + dy * dy;
                  if (dSq >= hoverRadiusSq) continue;

                  var dist = Math.sqrt(dSq);
                  var raw  = 1 - dist * invRadius;
                  var intn = raw * raw;                       // quadratic falloff
                  var mix  = intn * 0.9;
                  var hue  = ((t02 + dist * 2 + idx * 13) % 360 + 360) % 360 | 0;

                  var ir = oR[idx], ig = oG[idx], ib = oB[idx];
                  var fr = (ir + (HUE_R[hue] - ir) * mix + 0.5) | 0;
                  var fg = (ig + (HUE_G[hue] - ig) * mix + 0.5) | 0;
                  var fb = (ib + (HUE_B[hue] - ib) * mix + 0.5) | 0;

                  var jit = intn * 2;
                  els[idx].style.cssText =
                    "fill:rgb(" + fr + "," + fg + "," + fb +
                    ");stroke:none;opacity:" + (baseA[idx] + intn * 0.15) +
                    ";transition:none;transform:scale(" + (1 + intn * 0.15) +
                    ") translate(" + ((Math.random() - 0.5) * jit) +
                    "px," + ((Math.random() - 0.5) * jit) + "px)";

                  isHovFlag[idx] = 1;
                  newList.push(idx);
                }
              }
            }

            // 3. Restore polygons that left the hover zone
            for (var k = 0, hl = hovList.length; k < hl; k++) {
              var idx = hovList[k];
              if (!isHovFlag[idx]) restore(idx);
            }

            hovList = newList;
            hoverRAF = requestAnimationFrame(hoverLoop);
          } catch (err) {
            teardown();
          }
        }

        // --- Pause pulse while hovering (eliminates competing DOM writes) ---
        function startHover() {
          if (isHovering) return;
          isHovering = true;
          clearInterval(pulseTimer);
          hoverRAF = requestAnimationFrame(hoverLoop);
        }

        function stopHover() {
          isHovering = false;
          if (hoverRAF) { cancelAnimationFrame(hoverRAF); hoverRAF = null; }
          for (var k = 0; k < hovList.length; k++) {
            isHovFlag[hovList[k]] = 0;
            restore(hovList[k]);
          }
          hovList = [];
          pulseTimer = setInterval(pulseGroup, 50);
        }

        // Mouse
        avatarEl.addEventListener("mouseenter", startHover);
        avatarEl.addEventListener("mouseleave", stopHover);
        avatarEl.addEventListener("mousemove", function (e) { updatePointer(e.clientX, e.clientY); });

        // Touch
        avatarEl.addEventListener("touchstart", function (e) {
          var t = e.touches[0]; updatePointer(t.clientX, t.clientY); startHover();
        }, { passive: true });
        avatarEl.addEventListener("touchmove", function (e) {
          var t = e.touches[0]; updatePointer(t.clientX, t.clientY);
        }, { passive: true });
        avatarEl.addEventListener("touchend", stopHover, { passive: true });
        avatarEl.addEventListener("touchcancel", stopHover, { passive: true });
      } catch (err) {
        teardown();
      }
    })
    .catch(teardown);
})();
