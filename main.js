(() => {
    const CHANNEL = {
        electrodeHeightFrac: 0.01,
        electrodeCount: 10,
        fieldRes: 128,
        particleRadiusPx: 2.5,
        captureThreshold: 0.006,
        releaseVoltageThreshold: 0.5,
        flowRelaxation: 0.35,
        transverseDampingY: 0.55,
        transverseDampingZ: 0.55,
        depForceScale: 0.00008,
        maxDepDriftY: 0.006,
        maxDepDriftZ: 0.0,
        depInfluenceHeight: 1.0,
        captureDistance2: 0.0012,
        electrodeWidthUm: 40,
        electrodeGapUm: 30,
        channelHeightUm: 35,
        frontVerticalExaggeration: 7,
        channelLengthUm: 0,
        frontFieldBoost: 3.4,
        detachStrengthThreshold: 0.12,
        detachProbPerSecondAtZero: 1.8,
        detachSettlingKickY: 0.0018,
    };

    const frontCanvas = document.getElementById('front-canvas');
    const topCanvas = document.getElementById('top-canvas');
    const frontCtx = frontCanvas.getContext('2d');
    const topCtx = topCanvas.getContext('2d');

    const ui = {
        flowRate: document.getElementById('flow-rate'),
        flowRateValue: document.getElementById('flow-rate-value'),
        captureBtn: document.getElementById('capture-btn'),
        voltage: document.getElementById('voltage'),
        voltageValue: document.getElementById('voltage-value'),
        frequency: document.getElementById('frequency'),
        frequencyValue: document.getElementById('frequency-value'),
        particleCount: document.getElementById('particle-count'),
        particleCountValue: document.getElementById('particle-count-value'),
        spawnRate: document.getElementById('spawn-rate'),
        spawnRateValue: document.getElementById('spawn-rate-value'),
        resetBtn: document.getElementById('reset-btn'),
        trimBtn: document.getElementById('trim-btn'),
        showField: document.getElementById('show-field'),
        populationList: document.getElementById('population-list'),
        addPopBtn: document.getElementById('add-pop-btn'),
        popName: document.getElementById('pop-name'),
        popColor: document.getElementById('pop-color'),
        popPeak: document.getElementById('pop-peak'),
        popWidth: document.getElementById('pop-width'),
        popShare: document.getElementById('pop-share'),
        statusbar: document.getElementById('statusbar'),
    };

    const state = {
        captureOn: false,
        voltage: Number(ui.voltage.value),
        frequency: Number(ui.frequency.value),
        targetParticles: Number(ui.particleCount.value),
        flowRate: Number(ui.flowRate.value),
        spawnRate: Number(ui.spawnRate.value),
        lastTime: performance.now(),
        spawnAccumulator: 0,
        frameCounter: 0,
        fps: 0,
        fpsTime: performance.now(),
        particles: [],
        frontField: null,
        topField: null,
        electrodeXs: [],
        populations: [
            { id: crypto.randomUUID(), name: 'Example A', color: '#60a5fa', peak: 350, width: 100, share: 0.33 },
            { id: crypto.randomUUID(), name: 'Example B', color: '#f59e0b', peak: 900, width: 180, share: 0.33 },
            { id: crypto.randomUUID(), name: 'Example C', color: '#34d399', peak: 150, width: 50, share: 0.33 },
        ],
        outputHistory: [],
        outputAccumulator: {},
        lastOutputSample: performance.now(),
    };

    function gaussianResponse(freq, peak, width) {
        const sigma = Math.max(1, width);
        const d = freq - peak;
        return Math.exp(-Math.min(50, (d * d) / (2 * sigma * sigma)));
    }

    function clamp(v, lo, hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function normaliseShares() {
        const total = d3.sum(state.populations, d => Math.max(0, d.share));
        if (total <= 0) {
            const equal = 1 / Math.max(1, state.populations.length);
            state.populations.forEach(p => { p.share = equal; });
            return;
        }
        state.populations.forEach(p => { p.share = Math.max(0, p.share) / total; });
    }

    function cumulativePopulationShares() {
        normaliseShares();
        let acc = 0;
        return state.populations.map(p => {
            acc += p.share;
            return { ...p, threshold: acc };
        });
    }

    function pickPopulation() {
        const r = Math.random();
        const cumulative = cumulativePopulationShares();
        for (const p of cumulative) {
            if (r <= p.threshold) return p;
        }
        return cumulative[cumulative.length - 1];
    }

    function computeElectrodeXs() {
        const ew = CHANNEL.electrodeWidthUm;
        const gap = CHANNEL.electrodeGapUm;
        const totalLength = CHANNEL.electrodeCount * ew + (CHANNEL.electrodeCount + 1) * gap;
        CHANNEL.channelLengthUm = totalLength;

        const xs = [];
        let x = gap;
        for (let i = 0; i < CHANNEL.electrodeCount; i++) {
            xs.push({
                x0: x / totalLength,
                x1: (x + ew) / totalLength,
                xc: (x + ew / 2) / totalLength,
                polarity: i % 2 === 0 ? 1 : -1,
            });
            x += ew + gap;
        }
        state.electrodeXs = xs;
    }

    function buildField(mode) {

        const n = CHANNEL.fieldRes;
        const arr = new Float32Array(n * n * 3);
        const xs = state.electrodeXs;
        const electrodeY = CHANNEL.electrodeHeightFrac;

        const SOFTENING = 0.0015;
        const LONG_HW2 = 0.07
        const NSAMP = 9

        let maxMag = 0;

        for (let j = 0; j < n; j++) {
            for (let i = 0; i < n; i++) {

                const px = (i + 0.5) / n;
                const py = mode === 'front' ? 1 - (j + 0.5) / n : (j + 0.5) / n;

                let fx = 0;
                let fy = 0;

                for (const el of xs) {
                    for (let s = 0; s < NSAMP; s++) {
                        const t = s / (NSAMP - 1);
                        const ex = lerp(el.x0, el.x1, t);

                        const dx = px - ex;
                        const dy = mode === 'front' ? py - electrodeY : 0;

                        const r2 =
                            dx * dx +
                            dy * dy +
                            SOFTENING;

                        const r = Math.pow(r2, -1.5);
                        const longAtt = Math.exp(-(dx * dx) / LONG_HW2);
                        fx += -dx * r2 * longAtt;
                        if (mode === 'front') {
                            fy += -dy * r2 * longAtt;
                        }
                    }
                }

                // Strong vertical bias
                if (mode === 'front') {
                    fy *= 1.8;
                }

                const mag = Math.hypot(fx, fy);
                if (mag > maxMag) maxMag = mag;

                const idx = (j * n + i) * 3;
                arr[idx] = fx;
                arr[idx + 1] = fy;
                arr[idx + 2] = mag;
            }
        }

        // Normalise
        const invMax = maxMag > 1e-9 ? 1 / maxMag : 1;
        for (let k = 0; k < arr.length; k += 3) {
            arr[k] *= invMax;
            arr[k + 1] *= invMax;
            arr[k + 2] *= invMax;
        }

        return {
            data: arr,
            n
        };
    }

    function sampleField(field, x, y) {
        const n = field.n;
        const px = clamp(x, 0, 0.999999) * (n - 1);
        const py = clamp(y, 0, 0.999999) * (n - 1);
        const x0 = Math.floor(px);
        const y0 = Math.floor(py);
        const x1 = Math.min(n - 1, x0 + 1);
        const y1 = Math.min(n - 1, y0 + 1);
        const tx = px - x0;
        const ty = py - y0;

        function get(ix, iy) {
            const idx = (iy * n + ix) * 3;
            return {
                fx: field.data[idx],
                fy: field.data[idx + 1],
                mag: field.data[idx + 2],
            };
        }

        const a = get(x0, y0);
        const b = get(x1, y0);
        const c = get(x0, y1);
        const d = get(x1, y1);

        return {
            fx: lerp(lerp(a.fx, b.fx, tx), lerp(c.fx, d.fx, tx), ty),
            fy: lerp(lerp(a.fy, b.fy, tx), lerp(c.fy, d.fy, tx), ty),
            mag: lerp(lerp(a.mag, b.mag, tx), lerp(c.mag, d.mag, tx), ty),
        };
    }

    function laminarFlowTarget(_y, _z, meanFlow) { // Parabolic profile would be more realistic, but would need significant tweaking to make it feel "right" in this toy simulation.
        return meanFlow;
    }

    function updateFields() {
        computeElectrodeXs();
        state.frontField = buildField('front');
        state.topField = buildField('top');
    }

    function spawnParticle() {
        const pop = pickPopulation();
        const y = Math.random();
        const z = Math.random();
        state.particles.push({
            id: crypto.randomUUID(),
            x: -Math.random(),
            y,
            z,
            vx: laminarFlowTarget(y, z, state.flowRate),
            vy: 0,
            vz: 0,
            captured: false,
            captureX: null,
            captureZ: null,
            captureY: null,
            color: pop.color,
            populationId: pop.id,
            populationName: pop.name,
            peak: pop.peak,
            width: pop.width,
        });
    }

    function findCaptureTarget(p) {
        let best = null;
        for (const el of state.electrodeXs) {
            const ez = clamp(p.z, 0, 1);
            const candidates = [
                { x: el.x0, y: CHANNEL.electrodeHeightFrac, z: ez },
                { x: el.x1, y: CHANNEL.electrodeHeightFrac, z: ez },
            ];
            for (const c of candidates) {
                const dx = c.x - p.x, dy = c.y - p.y, dz = c.z - p.z;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (!best || d2 < best.d2) best = { ...c, d2 };
            }
        }
        return best;
    }

    function maybeCapture(p, depStrength) {
        if (!state.captureOn || state.voltage <= CHANNEL.releaseVoltageThreshold) return;
        if (p.captured) return;
        if (depStrength < CHANNEL.captureThreshold) return;
        if (p.y > CHANNEL.captureMaxY) return;

        const target = findCaptureTarget(p);
        if (!target || target.d2 > CHANNEL.captureDistance2) return;

        p.captured = true;
        p.captureX = target.x;
        p.captureY = target.y;
        p.captureZ = target.z;
        p.vx = p.vy = p.vz = 0;
    }

    function maybeDetach(p, depStrength, dt) {
        if (!p.captured) return false;

        // Hard release: voltage dropped or capture toggled off
        if (!state.captureOn || state.voltage <= CHANNEL.releaseVoltageThreshold) {
            releaseParticle(p);
            return true;
        }

        // Weakly held particles escape with some probability
        const retention = clamp(depStrength / CHANNEL.detachStrengthThreshold, 0, 1);
        const detachRate = CHANNEL.detachProbPerSecondAtZero * (1 - retention);

        const detachProb = 1 - Math.exp(-detachRate * dt / 60);
        if (Math.random() < detachProb) {
            releaseParticle(p);
            return true;
        }
        return false;
    }

    function releaseParticle(p) {
        p.captured = false;
        p.captureX = p.captureY = p.captureZ = null;
        p.vx = state.flowRate;
        p.vy = CHANNEL.detachSettlingKickY;
        p.vz = 0;
    }

    function updateParticles(dt) {
        const vScale = state.voltage / 100;
        const freq = state.frequency;
        const depEnabled = state.captureOn && state.voltage > CHANNEL.releaseVoltageThreshold;

        if (!depEnabled) {
            for (const p of state.particles) {
                if (p.captured) releaseParticle(p);
            }
        }

        const alive = [];

        for (const p of state.particles) {
            if (p.captured) {
                const capturedResponse = depEnabled ? gaussianResponse(freq, p.peak, p.width) : 0;
                const capturedSample = depEnabled ? sampleField(state.frontField, p.captureX, p.captureY) : { fx: 0, fy: 0, mag: 0 };
                const capturedStrength = CHANNEL.frontFieldBoost * capturedResponse * vScale * capturedSample.mag;
                if (!maybeDetach(p, capturedStrength, dt)) {
                    p.x = p.captureX;
                    p.y = p.captureY;
                    p.z = p.captureZ;
                    alive.push(p);
                    continue;
                }
            }

            const response = depEnabled ? gaussianResponse(freq, p.peak, p.width) : 0;
            const frontSample = depEnabled ? sampleField(state.frontField, p.x, p.y) : { fx: 0, fy: 0, mag: 0 };
            const topSample = depEnabled ? sampleField(state.topField, p.x, p.z) : { fx: 0, fy: 0, mag: 0 };
            const depScale = depEnabled ? CHANNEL.depForceScale * CHANNEL.frontFieldBoost * vScale * response : 0;

            const ax =
                depScale *
                0.35 *
                (
                    0.9 * frontSample.fx +
                    0.1 * topSample.fx
                );
            const ay =
                depScale *
                1.2 *
                frontSample.fy;

            const targetFlow = laminarFlowTarget(p.y, p.z, state.flowRate);
            p.vx += (targetFlow + ax - p.vx) * Math.min(1, CHANNEL.flowRelaxation * dt);
            p.vx = Math.max(0, p.vx);

            p.vy += ay * dt;
            p.vy = clamp(p.vy, -CHANNEL.maxDepDriftY, CHANNEL.maxDepDriftY);
            p.vy *= Math.pow(CHANNEL.transverseDampingY, dt);

            p.vz = 0;
            if (!depEnabled) p.vy = 0;

            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.z += p.vz * dt;

            p.y = clamp(p.y, CHANNEL.electrodeHeightFrac, 1);
            p.z = clamp(p.z, 0, 1);

            if (p.y <= CHANNEL.electrodeHeightFrac + 0.0005 && p.vy < 0) {
                p.vy = 0;
            }

            const depStrength = CHANNEL.frontFieldBoost * response * vScale * frontSample.mag;
            maybeCapture(p, depStrength);

            if (p.x <= 1.05) {
                alive.push(p);
            } else {

                if (!state.outputAccumulator[p.populationId]) {
                    state.outputAccumulator[p.populationId] = 0;
                }

                state.outputAccumulator[p.populationId]++;
            }
        }

        state.particles = alive;
    }
    function renderOutputChart() {

        const svg =
            d3.select('#output-chart');

        svg.selectAll('*').remove();

        const width = 640;
        const height = 260;

        const margin = {
            top: 16,
            right: 20,
            bottom: 28,
            left: 42
        };

        const innerW =
            width - margin.left - margin.right;

        const innerH =
            height - margin.top - margin.bottom;

        const history = state.outputHistory;

        if (!history.length) {
            return;
        }

        const maxY =
            Math.max(
                5,
                d3.max(history, d =>
                    d3.max(
                        state.populations,
                        p => d[p.id] || 0
                    )
                )
            );

        const x =
            d3.scaleLinear()
                .domain([0, history.length - 1])
                .range([
                    margin.left,
                    margin.left + innerW
                ]);

        const y =
            d3.scaleLinear()
                .domain([0, maxY])
                .nice()
                .range([
                    margin.top + innerH,
                    margin.top
                ]);

        // grid
        for (let i = 0; i <= 5; i++) {

            const gy = i / 5 * maxY;

            svg.append('line')
                .attr('x1', margin.left)
                .attr('x2', margin.left + innerW)
                .attr('y1', y(gy))
                .attr('y2', y(gy))
                .attr(
                    'stroke',
                    'rgba(148,163,184,0.12)'
                );
        }

        svg.append('g')
            .attr(
                'transform',
                `translate(0,${margin.top + innerH})`
            )
            .call(
                d3.axisBottom(x)
                    .ticks(6)
            )
            .call(axis =>
                axis.selectAll('text')
                    .attr('fill', '#94a3b8')
            )
            .call(axis =>
                axis.selectAll('line,path')
                    .attr(
                        'stroke',
                        'rgba(148,163,184,0.35)'
                    )
            );

        svg.append('g')
            .attr(
                'transform',
                `translate(${margin.left},0)`
            )
            .call(
                d3.axisLeft(y)
                    .ticks(5)
            )
            .call(axis =>
                axis.selectAll('text')
                    .attr('fill', '#94a3b8')
            )
            .call(axis =>
                axis.selectAll('line,path')
                    .attr(
                        'stroke',
                        'rgba(148,163,184,0.35)'
                    )
            );

        const line =
            d3.line()
                .x((d, i) => x(i))
                .y(d => y(d.value))
                .curve(d3.curveMonotoneX);

        for (const pop of state.populations) {

            const data =
                history.map(h => ({
                    value: h[pop.id] || 0
                }));

            svg.append('path')
                .datum(data)
                .attr('fill', 'none')
                .attr('stroke', pop.color)
                .attr('stroke-width', 2.5)
                .attr('d', line);
        }
    }
    function updateOutputHistory(now) {

        const SAMPLE_INTERVAL = 250;

        if (
            now - state.lastOutputSample <
            SAMPLE_INTERVAL
        ) {
            return;
        }

        const point = {
            time: now
        };

        for (const pop of state.populations) {

            const raw =
                state.outputAccumulator[pop.id] || 0;

            const prev =
                state.outputHistory.length
                    ? (
                        state.outputHistory[
                        state.outputHistory.length - 1
                        ][pop.id] || 0
                    )
                    : 0;

            // EMA smoothing
            const smoothed =
                prev * 0.7 +
                raw * 0.3;

            point[pop.id] = smoothed;

            state.outputAccumulator[pop.id] = 0;
        }

        state.outputHistory.push(point);

        if (state.outputHistory.length > 120) {
            state.outputHistory.shift();
        }

        state.lastOutputSample = now;
    }
    function resizeCanvas(canvas, ctx) {
        const dpr = window.devicePixelRatio || 1;
        const cssW = Math.max(200, Math.round(canvas.getBoundingClientRect().width));
        const cssH = Math.max(200, Math.round(canvas.getBoundingClientRect().height));
        const pixW = Math.round(cssW * dpr);
        const pixH = Math.round(cssH * dpr);
        if (canvas.width !== pixW || canvas.height !== pixH) {
            canvas.width = pixW;
            canvas.height = pixH;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
    }

    function getFrontViewport(canvas) {
        const pad = 12;
        return { x: 0, y: pad, w: canvas.clientWidth, h: canvas.clientHeight - pad * 2 };
    }

    function drawFieldOverlay(ctx, canvas, mode) {
        const selected = ui.showField.value;
        if (selected !== mode) return;

        const field = mode === 'front' ? state.frontField : state.topField;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        const rect = mode === 'front' ? getFrontViewport(canvas) : { x: 0, y: 0, w, h };
        const step = Math.max(18, Math.floor(rect.w / 18));

        ctx.save();
        for (let py = rect.y + step / 2; py < rect.y + rect.h; py += step) {
            for (let px = rect.x + step / 2; px < rect.x + rect.w; px += step) {
                const sx = (px - rect.x) / rect.w;
                const sy = mode === 'front' ? 1 - ((py - rect.y) / rect.h) : ((py - rect.y) / rect.h);
                const sample = sampleField(field, sx, sy);
                const len = 10 + 12 * sample.mag;
                const mag = Math.hypot(sample.fx, sample.fy) || 1;
                const dx = (sample.fx / mag) * len;
                const dy = mode === 'front' ? (-(sample.fy / mag) * len) : ((sample.fy / mag) * len);
                const alpha = 0.08 + 0.35 * sample.mag;
                ctx.strokeStyle = `rgba(147, 197, 253, ${alpha})`;
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(px + dx, py + dy);
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    function drawChannelBase(ctx, canvas, mode) {
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        ctx.clearRect(0, 0, w, h);

        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#071426');
        grad.addColorStop(1, '#030712');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        if (mode === 'front') {
            const rect = getFrontViewport(canvas);
            ctx.fillStyle = 'rgba(148,163,184,0.04)';
            ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
            ctx.strokeStyle = 'rgba(148,163,184,0.22)';
            ctx.lineWidth = 1;
            ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);

            ctx.strokeStyle = 'rgba(96,165,250,0.08)';
            for (let i = 1; i < 8; i++) {
                const x = rect.x + (i / 8) * rect.w;
                ctx.beginPath();
                ctx.moveTo(x, rect.y);
                ctx.lineTo(x, rect.y + rect.h);
                ctx.stroke();
            }

            const eh = CHANNEL.electrodeHeightFrac * rect.h;
            state.electrodeXs.forEach((el, i) => {
                const x = rect.x + el.x0 * rect.w;
                const ew = (el.x1 - el.x0) * rect.w;
                ctx.fillStyle = i % 2 === 0 ? 'rgba(156,163,175,0.9)' : 'rgba(107,114,128,0.9)';
                ctx.fillRect(x, rect.y + rect.h - eh, ew, eh);
            });
        } else {
            ctx.strokeStyle = 'rgba(148,163,184,0.22)';
            ctx.lineWidth = 1;
            ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

            ctx.strokeStyle = 'rgba(96,165,250,0.08)';
            for (let i = 1; i < 8; i++) {
                const x = (i / 8) * w;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, h);
                ctx.stroke();
            }

            state.electrodeXs.forEach((el, i) => {
                const x = el.x0 * w;
                const ew = (el.x1 - el.x0) * w;
                ctx.fillStyle = i % 2 === 0 ? 'rgba(156,163,175,0.85)' : 'rgba(107,114,128,0.85)';
                ctx.fillRect(x, 0, ew, h);
            });
        }

        drawFieldOverlay(ctx, canvas, mode);
    }

    function drawParticles() {
        drawChannelBase(frontCtx, frontCanvas, 'front');
        drawChannelBase(topCtx, topCanvas, 'top');

        const frontRect = getFrontViewport(frontCanvas);
        const fw = frontRect.w;
        const fh = frontRect.h;
        const tw = topCanvas.clientWidth;
        const th = topCanvas.clientHeight;
        const r = CHANNEL.particleRadiusPx;

        for (const p of state.particles) {
            const fx = frontRect.x + p.x * fw;
            const fy = frontRect.y + (1 - p.y) * fh;
            const tx = p.x * tw;
            const tz = p.z * th;
            const alpha = p.captured ? 1 : 0.82;
            const glow = p.captured ? 'rgba(52,211,153,0.55)' : p.color;

            frontCtx.save();
            frontCtx.globalAlpha = alpha;
            frontCtx.shadowBlur = p.captured ? 10 : 4;
            frontCtx.shadowColor = glow;
            frontCtx.fillStyle = p.color;
            frontCtx.beginPath();
            frontCtx.arc(fx, fy, r, 0, Math.PI * 2);
            frontCtx.fill();
            if (p.captured) {
                frontCtx.strokeStyle = 'rgba(52,211,153,0.9)';
                frontCtx.lineWidth = 1;
                frontCtx.beginPath();
                frontCtx.arc(fx, fy, r + 1.5, 0, Math.PI * 2);
                frontCtx.stroke();
            }
            frontCtx.restore();

            topCtx.save();
            topCtx.globalAlpha = alpha;
            topCtx.shadowBlur = p.captured ? 10 : 4;
            topCtx.shadowColor = glow;
            topCtx.fillStyle = p.color;
            topCtx.beginPath();
            topCtx.arc(tx, tz, r, 0, Math.PI * 2);
            topCtx.fill();
            if (p.captured) {
                topCtx.strokeStyle = 'rgba(52,211,153,0.9)';
                topCtx.lineWidth = 1;
                topCtx.beginPath();
                topCtx.arc(tx, tz, r + 1.5, 0, Math.PI * 2);
                topCtx.stroke();
            }
            topCtx.restore();
        }
    }

    function renderResponseChart() {
        const legend = d3.select('#response-legend');
        legend.selectAll('*').remove();
        const svg = d3.select('#response-chart');
        const width = 520;
        const height = 360;
        const margin = { top: 18, right: 18, bottom: 34, left: 42 };
        const innerW = width - margin.left - margin.right;
        const innerH = height - margin.top - margin.bottom;

        svg.selectAll('*').remove();

        const x = d3.scaleLinear().domain([0, 1000]).range([margin.left, margin.left + innerW]);
        const y = d3.scaleLinear().domain([0, 1.02]).range([margin.top + innerH, margin.top]);
        const g = svg.append('g');

        for (let i = 0; i <= 5; i++) {
            const gy = i / 5;
            g.append('line')
                .attr('x1', margin.left)
                .attr('x2', margin.left + innerW)
                .attr('y1', y(gy))
                .attr('y2', y(gy))
                .attr('stroke', 'rgba(148,163,184,0.12)');
        }

        for (let i = 0; i <= 10; i++) {
            const gx = i * 100;
            g.append('line')
                .attr('x1', x(gx))
                .attr('x2', x(gx))
                .attr('y1', margin.top)
                .attr('y2', margin.top + innerH)
                .attr('stroke', 'rgba(148,163,184,0.08)');
        }

        g.append('g')
            .attr('transform', `translate(0,${margin.top + innerH})`)
            .call(d3.axisBottom(x).ticks(5))
            .call(axis => axis.selectAll('text').attr('fill', '#94a3b8'))
            .call(axis => axis.selectAll('line,path').attr('stroke', 'rgba(148,163,184,0.35)'));

        g.append('g')
            .attr('transform', `translate(${margin.left},0)`)
            .call(d3.axisLeft(y).ticks(5))
            .call(axis => axis.selectAll('text').attr('fill', '#94a3b8'))
            .call(axis => axis.selectAll('line,path').attr('stroke', 'rgba(148,163,184,0.35)'));

        const line = d3.line()
            .x(d => x(d.freq))
            .y(d => y(d.value))
            .curve(d3.curveMonotoneX);

        state.populations.forEach(pop => {
            legend.append('div')
                .attr('class', 'legend-item')
                .html(`<span class="swatch" style="background:${pop.color}"></span>${pop.name}`);
            const data = d3.range(0, 1001, 4).map(freq => ({
                freq,
                value: gaussianResponse(freq, pop.peak, pop.width),
            }));

            g.append('path')
                .datum(data)
                .attr('fill', 'none')
                .attr('stroke', pop.color)
                .attr('stroke-width', 2.5)
                .attr('d', line);
        });

        g.append('line')
            .attr('x1', x(state.frequency))
            .attr('x2', x(state.frequency))
            .attr('y1', margin.top)
            .attr('y2', margin.top + innerH)
            .attr('stroke', '#e5e7eb')
            .attr('stroke-dasharray', '5,5')
            .attr('stroke-width', 1.5);

        g.append('text')
            .attr('x', x(state.frequency) + 6)
            .attr('y', margin.top + 14)
            .attr('fill', '#e5e7eb')
            .attr('font-size', 12)
            .text(`f = ${state.frequency}`);

        g.append('text')
            .attr('x', margin.left + innerW / 2)
            .attr('y', height - 4)
            .attr('text-anchor', 'middle')
            .attr('fill', '#94a3b8')
            .attr('font-size', 12)
            .text('Frequency');

        g.append('text')
            .attr('transform', `translate(14,${margin.top + innerH / 2}) rotate(-90)`)
            .attr('text-anchor', 'middle')
            .attr('fill', '#94a3b8')
            .attr('font-size', 12)
            .text('Normalised response');
    }

    function renderPopulationList() {
        normaliseShares();
        const items = d3.select(ui.populationList)
            .selectAll('.population-item')
            .data(state.populations, d => d.id);

        const enter = items.enter()
            .append('div')
            .attr('class', 'population-item');

        enter.html(`
          <div class="population-head">
            <div class="population-title"></div>
            <button class="secondary remove-btn" style="width:auto;padding:8px 10px;">Remove</button>
          </div>
          <div class="control-row">
            <label>Peak <span class="peak-value"></span></label>
            <input class="peak-input" type="range" min="0" max="1000" step="1" />
          </div>
          <div class="control-row">
            <label>Width <span class="width-value"></span></label>
            <input class="width-input" type="range" min="5" max="300" step="1" />
          </div>
          <div class="control-row">
            <label>Share <span class="share-value"></span></label>
            <input class="share-input" type="range" min="0.01" max="1" step="0.01" />
          </div>
        `);

        const merged = enter.merge(items);

        merged.each(function (d) {
            const root = d3.select(this);
            root.select('.population-title').html(`<span class="swatch" style="background:${d.color}"></span>${d.name}`);
            root.select('.peak-input').property('value', d.peak);
            root.select('.width-input').property('value', d.width);
            root.select('.share-input').property('value', d.share);
            root.select('.peak-value').text(`${Math.round(d.peak)}`);
            root.select('.width-value').text(`${Math.round(d.width)}`);
            root.select('.share-value').text(`${(d.share * 100).toFixed(1)}%`);

            root.select('.peak-input').on('input', (event) => {
                d.peak = Number(event.target.value);
                renderPopulationList();
                renderResponseChart();
            });

            root.select('.width-input').on('input', (event) => {
                d.width = Number(event.target.value);
                renderPopulationList();
                renderResponseChart();
            });

            root.select('.share-input').on('input', (event) => {
                d.share = Number(event.target.value);
                renderPopulationList();
            });

            root.select('.remove-btn').on('click', () => {
                if (state.populations.length <= 1) return;
                state.populations = state.populations.filter(p => p.id !== d.id);
                renderPopulationList();
                renderResponseChart();
            });
        });

        items.exit().remove();
    }

    function updateUiText() {
        ui.flowRateValue.textContent = `${state.flowRate.toFixed(3)}`;
        ui.voltageValue.textContent = `${state.voltage}`;
        ui.frequencyValue.textContent = `${state.frequency}`;
        ui.particleCountValue.textContent = `${state.targetParticles}`;
        ui.spawnRateValue.textContent = `${state.spawnRate}/s`;
        ui.captureBtn.textContent = state.captureOn ? 'Capture ON' : 'Capture OFF';
        ui.captureBtn.classList.toggle('active', state.captureOn);
    }

    function renderStatus() {
        const captured = state.particles.filter(p => p.captured).length;
        const popCounts = d3.rollups(state.particles, values => values.length, d => d.populationName)
            .sort((a, b) => b[1] - a[1]);

        const chips = [
            `FPS: ${state.fps.toFixed(0)}`,
            `Particles: ${state.particles.length}`,
            `Captured: ${captured}`,
        ];

        const popSummary = popCounts
            .map(([name, count]) => `${name}: ${count}`)
            .join(' · ');

        ui.statusbar.innerHTML = chips.map(c => `<div class="chip">${c}</div>`).join('');
    }


    document
        .querySelectorAll('.tab-btn')
        .forEach(btn => {

            btn.addEventListener('click', () => {

                document
                    .querySelectorAll('.tab-btn')
                    .forEach(b => b.classList.remove('active'));

                document
                    .querySelectorAll('.tab-panel')
                    .forEach(p => p.classList.remove('active'));

                btn.classList.add('active');

                document
                    .getElementById(btn.dataset.tab)
                    .classList.add('active');
            });
        });

    function bindUi() {
        d3.select(ui.voltage).on('input', (event) => {
            state.voltage = Number(event.target.value);
            updateUiText();
        });

        d3.select(ui.frequency).on('input', (event) => {
            state.frequency = Number(event.target.value);
            updateUiText();
            renderResponseChart();
        });

        d3.select(ui.flowRate).on('input', (event) => {
            state.flowRate = Number(event.target.value);
            updateUiText();
        });

        d3.select(ui.particleCount).on('input', (event) => {
            state.targetParticles = Number(event.target.value);
            updateUiText();
        });

        d3.select(ui.spawnRate).on('input', (event) => {
            state.spawnRate = Number(event.target.value);
            updateUiText();
        });

        d3.select(ui.captureBtn).on('click', () => {
            state.captureOn = !state.captureOn;
            updateUiText();
        });

        d3.select(ui.resetBtn).on('click', () => {
            state.particles = [];
        });

        d3.select(ui.trimBtn).on('click', () => {
            trimOverflow();
        });

        d3.select(ui.addPopBtn).on('click', () => {
            const name = ui.popName.value.trim() || `Population ${state.populations.length + 1}`;
            const color = ui.popColor.value.trim() || '#ffffff';
            const peak = clamp(Number(ui.popPeak.value) || 300, 0, 1000);
            const width = clamp(Number(ui.popWidth.value) || 100, 5, 300);
            const share = clamp(Number(ui.popShare.value) || 0.1, 0.01, 1);
            state.populations.push({ id: crypto.randomUUID(), name, color, peak, width, share });
            renderPopulationList();
            renderResponseChart();
        });

        new ResizeObserver(() => {
            resizeCanvas(frontCanvas, frontCtx);
            resizeCanvas(topCanvas, topCtx);
            drawParticles();
        }).observe(document.body);
    }

    function animate(now) {
        const dt = Math.min(1.8, (now - state.lastTime) / 16.6667);
        state.lastTime = now;

        resizeCanvas(frontCanvas, frontCtx);
        resizeCanvas(topCanvas, topCtx);

        state.spawnAccumulator += (state.spawnRate / 60) * dt;
        while (state.spawnAccumulator >= 1 && state.particles.length < state.targetParticles) {
            spawnParticle();
            state.spawnAccumulator -= 1;
        }

        updateParticles(dt);
        drawParticles();

        state.frameCounter += 1;
        if (now - state.fpsTime > 500) {
            state.fps = (state.frameCounter * 1000) / (now - state.fpsTime);
            state.frameCounter = 0;
            state.fpsTime = now;
            renderStatus();
        }
        updateOutputHistory(now);
        renderOutputChart();
        requestAnimationFrame(animate);
    }

    function init() {
        updateFields();
        bindUi();
        renderPopulationList();
        renderResponseChart();
        updateUiText();
        renderStatus();
        requestAnimationFrame(animate);

        for (const pop of state.populations) {
            state.outputAccumulator[pop.id] = 0;
        }
    }

    init();
})();
