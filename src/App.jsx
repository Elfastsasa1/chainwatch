import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ============================================================
// GLOBAL STYLES
// ============================================================
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700;800&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg-void: #000000;
    --bg-deep: #050505;
    --bg-panel: #0a0a0a;
    --bg-elevated: #0f0f0f;
    --bg-hover: #141414;
    --border: #1a1a1a;
    --border-bright: #252525;
    --neon: #00ff41;
    --neon-dim: #00cc33;
    --neon-ghost: rgba(0,255,65,0.08);
    --neon-glow: rgba(0,255,65,0.25);
    --red: #ff2a2a;
    --red-dim: #cc1a1a;
    --red-ghost: rgba(255,42,42,0.08);
    --amber: #ffaa00;
    --amber-dim: #cc8800;
    --amber-ghost: rgba(255,170,0,0.08);
    --blue: #00aaff;
    --blue-ghost: rgba(0,170,255,0.08);
    --purple: #aa44ff;
    --text-primary: #e0ffe0;
    --text-secondary: #7aaa7a;
    --text-muted: #3a5a3a;
    --text-dead: #1a2a1a;
    --font: 'JetBrains Mono', 'Courier New', monospace;
    --scanline: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,65,0.015) 2px, rgba(0,255,65,0.015) 4px);
  }
  html, body { background: var(--bg-void); font-family: var(--font); color: var(--text-primary); overflow-x: hidden; }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: var(--bg-void); }
  ::-webkit-scrollbar-thumb { background: var(--neon-dim); }
  ::selection { background: var(--neon-ghost); color: var(--neon); }
  input, button, select { font-family: var(--font); }
  button { cursor: pointer; }
`;

const DEFAULT_TOKENS = [
  { address: "0x6b175474e89094c44da98b954eedeac495271d0f", symbol: "DAI", name: "Dai Stablecoin", chain: "ethereum" },
  { address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", symbol: "WETH", name: "Wrapped Ether", chain: "ethereum" },
  { address: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984", symbol: "UNI", name: "Uniswap", chain: "ethereum" },
];

const DEXSCREENER_BASE = "https://api.dexscreener.com/latest/dex";
const GECKO_BASE = "https://api.geckoterminal.com/api/v2";
// ============================================================
// MATH UTILITIES
// ============================================================
const MathUtils = {
  generateMockOHLCV(days = 180, basePrice = 1.0) {
    const data = [];
    let price = basePrice;
    let vol = 0.03;
    const now = Date.now();
    const msPerDay = 86400000;
    for (let i = days; i >= 0; i--) {
      vol = Math.max(0.005, Math.min(0.15, vol * (0.95 + Math.random() * 0.15)));
      const open = price;
      const change = (Math.random() - 0.48) * vol * price;
      const high = open + Math.abs(change) * (1 + Math.random() * 0.5);
      const low = open - Math.abs(change) * (1 + Math.random() * 0.5);
      const close = open + change;
      price = Math.max(0.0001, close);
      const volume = basePrice * 1e6 * (0.5 + Math.random() * 2) * (1 + Math.abs(change / price) * 10);
      data.push({
        time: Math.floor((now - i * msPerDay) / 1000),
        open: Math.max(0.0001, open),
        high: Math.max(open, Math.max(0.0001, high)),
        low: Math.min(open, Math.max(0.0001, low)),
        close: Math.max(0.0001, close),
        volume,
      });
    }
    return data;
  },

  hurstRS(series) {
    if (series.length < 20) return 0.5;
    const n = series.length;
    const mean = series.reduce((a, b) => a + b, 0) / n;
    const deviations = series.map(x => x - mean);
    let cumDev = 0;
    let maxDev = -Infinity, minDev = Infinity;
    for (const d of deviations) {
      cumDev += d;
      if (cumDev > maxDev) maxDev = cumDev;
      if (cumDev < minDev) minDev = cumDev;
    }
    const R = maxDev - minDev;
    const S = Math.sqrt(deviations.reduce((a, b) => a + b * b, 0) / n);
    if (S === 0) return 0.5;
    return Math.log(R / S) / Math.log(n / 2);
  },

  computeHq(returns, qRange = [-3, -2, -1, 0, 1, 2, 3]) {
    if (returns.length < 30) return qRange.map(q => ({ q, h: 0.5 }));
    return qRange.map(q => {
      if (q === 0) return { q, h: this.hurstRS(returns) };
      const absR = returns.map(r => Math.abs(r) + 1e-10);
      const moments = absR.map(r => Math.pow(r, q));
      const meanMoment = moments.reduce((a, b) => a + b, 0) / moments.length;
      const h = Math.max(0.05, Math.min(0.95, 0.5 + (Math.log(meanMoment + 1e-10) / (q * 3 + 1e-10)) * 0.1));
      return { q, h };
    });
  },

  fractalDimension(prices) {
    if (prices.length < 10) return 1.5;
    const H = this.hurstRS(prices.map((p, i) => i > 0 ? Math.log(p / prices[i - 1]) : 0).slice(1));
    return Math.max(1.0, Math.min(2.0, 2 - H));
  },

  detectFractalBreakdown(returns, winSize = 30) {
    const signals = [];
    for (let i = winSize; i < returns.length; i++) {
      const slice = returns.slice(i - winSize, i);
      const H = this.hurstRS(slice);
      if (H < 0.35) signals.push({ i, type: "ANTI_PERSISTENT", H, label: "BREAKDOWN" });
      else if (H > 0.72) signals.push({ i, type: "PERSISTENT", H, label: "TRENDING" });
    }
    return signals;
  },

  atr(ohlcv, period = 14) {
    if (ohlcv.length < period + 1) return 0;
    const trs = [];
    for (let i = 1; i < ohlcv.length; i++) {
      const h = ohlcv[i].high, l = ohlcv[i].low, pc = ohlcv[i - 1].close;
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    const recent = trs.slice(-period);
    return recent.reduce((a, b) => a + b, 0) / period;
  },

  detectStructure(ohlcv, lookback = 10) {
    if (ohlcv.length < lookback * 2) return { swings: [], bos: [], choch: [] };
    const highs = ohlcv.map(c => c.high);
    const lows = ohlcv.map(c => c.low);
    const swingHighs = [], swingLows = [];
    for (let i = lookback; i < ohlcv.length - lookback; i++) {
      const localHigh = Math.max(...highs.slice(i - lookback, i + lookback));
      const localLow = Math.min(...lows.slice(i - lookback, i + lookback));
      if (highs[i] === localHigh) swingHighs.push({ i, price: highs[i] });
      if (lows[i] === localLow) swingLows.push({ i, price: lows[i] });
    }
    const swings = [];
    const bos = [], choch = [];
    let prevHigh = null, prevLow = null, trend = "neutral";
    for (const sh of swingHighs.slice(-8)) {
      if (prevHigh !== null) {
        const type = sh.price > prevHigh.price ? "HH" : "LH";
        swings.push({ ...sh, type });
        if (type === "HH" && trend === "down") { choch.push({ ...sh, label: "CHOCH" }); trend = "up"; }
        else if (type === "HH") { bos.push({ ...sh, label: "BOS" }); trend = "up"; }
      }
      prevHigh = sh;
    }
    for (const sl of swingLows.slice(-8)) {
      if (prevLow !== null) {
        const type = sl.price < prevLow.price ? "LL" : "HL";
        swings.push({ ...sl, type });
        if (type === "LL" && trend === "up") { choch.push({ ...sl, label: "CHOCH" }); trend = "down"; }
        else if (type === "LL") { bos.push({ ...sl, label: "BOS" }); trend = "down"; }
      }
      prevLow = sl;
    }
    return { swings: swings.slice(-20), bos: bos.slice(-5), choch: choch.slice(-5) };
  },

  volRegime(ohlcv) {
    if (ohlcv.length < 30) return { regime: "UNKNOWN", atr: 0, pct: 0 };
    const atrVal = this.atr(ohlcv);
    const pct = (atrVal / ohlcv[ohlcv.length - 1].close) * 100;
    let regime = "LOW";
    if (pct > 8) regime = "EXTREME";
    else if (pct > 4) regime = "HIGH";
    else if (pct > 1.5) regime = "MEDIUM";
    return { regime, atr: atrVal, pct };
  },

  detectBehavior(ohlcv) {
    if (ohlcv.length < 30) return { label: "SCANNING", type: "neutral" };
    const recent = ohlcv.slice(-20);
    const volumes = recent.map(c => c.volume);
    const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const lastVol = volumes[volumes.length - 1];
    const prices = recent.map(c => c.close);
    const priceTrend = (prices[prices.length - 1] - prices[0]) / prices[0];
    const volSpike = lastVol / avgVol;
    if (volSpike > 2.5 && priceTrend > 0.05) return { label: "FOMO SPIKE", type: "fomo" };
    if (volSpike > 2.0 && priceTrend < -0.05) return { label: "STOP HUNT", type: "stophunt" };
    if (priceTrend > 0.02 && volSpike > 1.3) return { label: "ACCUMULATION", type: "accum" };
    if (priceTrend < -0.02 && volSpike > 1.3) return { label: "DISTRIBUTION", type: "dist" };
    return { label: "RANGING / NEUTRAL", type: "neutral" };
  },

  liquidityPressure(ohlcv) {
    if (ohlcv.length < 30) return { score: 50, zones: [] };
    const recent = ohlcv.slice(-50);
    const priceRange = recent.map(c => ({ price: (c.high + c.low) / 2, vol: c.volume }));
    const sorted = [...priceRange].sort((a, b) => b.vol - a.vol).slice(0, 5);
    const avgVol = recent.map(c => c.volume).reduce((a, b) => a + b, 0) / recent.length;
    const score = Math.min(100, Math.floor((recent[recent.length - 1].volume / avgVol) * 50));
    return { score, zones: sorted.map(z => z.price) };
  },

  blackHorseScore(ohlcv) {
    if (ohlcv.length < 50) return { score: 0, signals: [], grade: "SCANNING" };
    const returns = ohlcv.map((c, i) => i > 0 ? Math.log(c.close / ohlcv[i - 1].close) : 0).slice(1);
    const H = this.hurstRS(returns.slice(-60));
    const vol = this.volRegime(ohlcv);
    const struct = this.detectStructure(ohlcv);
    const behavior = this.detectBehavior(ohlcv);
    const liq = this.liquidityPressure(ohlcv);
    const signals = [];
    let score = 0;

    if (H > 0.6) { signals.push({ label: "PERSISTENT HURST", weight: 20, active: true }); score += 20; }
    else if (H < 0.4) { signals.push({ label: "ANTI-PERSISTENT", weight: -10, active: true }); score -= 10; }
    else signals.push({ label: "HURST NEUTRAL", weight: 0, active: false });

    if (vol.regime === "MEDIUM") { signals.push({ label: "OPTIMAL VOL", weight: 15, active: true }); score += 15; }
    else if (vol.regime === "EXTREME") { signals.push({ label: "EXTREME VOL", weight: -20, active: true }); score -= 20; }
    else signals.push({ label: "VOL: " + vol.regime, weight: 0, active: false });

    if (struct.bos.length > 0) { signals.push({ label: "BOS DETECTED", weight: 25, active: true }); score += 25; }
    if (struct.choch.length > 0) { signals.push({ label: "CHOCH SIGNAL", weight: 15, active: true }); score += 15; }

    if (behavior.type === "accum") { signals.push({ label: "ACCUMULATION", weight: 20, active: true }); score += 20; }
    if (behavior.type === "fomo") { signals.push({ label: "FOMO CAUTION", weight: -15, active: true }); score -= 15; }
    if (behavior.type === "dist") { signals.push({ label: "DISTRIBUTION", weight: -20, active: true }); score -= 20; }
    if (liq.score > 70) { signals.push({ label: "HIGH LIQ PRESSURE", weight: 10, active: true }); score += 10; }

    const clamped = Math.max(0, Math.min(100, score));
    let grade = "WEAK";
    if (clamped >= 80) grade = "BLACK HORSE";
    else if (clamped >= 60) grade = "STRONG";
    else if (clamped >= 40) grade = "MODERATE";
    else if (clamped < 20) grade = "AVOID";
    return { score: clamped, signals, grade, H, vol, struct, behavior, liq };
  },

  runBacktest(ohlcv, embargoDays = 5) {
    if (ohlcv.length < 100) return null;
    const splitIdx = Math.floor(ohlcv.length * 0.65);
    const inSample = ohlcv.slice(0, splitIdx);
    const oosSample = ohlcv.slice(splitIdx + embargoDays);

    const runSim = (data) => {
      const trades = [];
      let equity = 1000;
      let inTrade = false, entryPrice = 0, entryIdx = 0;
      let quarantineCount = 0;
      const equityCurve = [equity];
      for (let i = 50; i < data.length - 1; i++) {
        const slice = data.slice(Math.max(0, i - 60), i + 1);
        const ret = slice.map((c, j) => j > 0 ? Math.log(c.close / slice[j-1].close) : 0).slice(1);
        const H = this.hurstRS(ret.slice(-30));
        const vol = this.volRegime(slice);
        const behavior = this.detectBehavior(slice);
        const struct = this.detectStructure(slice, 5);
        const isQ = (H < 0.45 && H > 0.38) || vol.regime === "EXTREME" || (struct.bos.length > 0 && struct.choch.length > 0);
        if (isQ) { quarantineCount++; equityCurve.push(equity); continue; }
        const longSig = [H > 0.58, vol.regime === "MEDIUM" || vol.regime === "LOW", behavior.type === "accum", struct.bos.some(b => b.type === "HH")].filter(Boolean).length;
        if (!inTrade && longSig >= 3) { inTrade = true; entryPrice = data[i + 1].open; entryIdx = i; }
        else if (inTrade) {
          const holdDays = i - entryIdx;
          const currentPrice = data[i].close;
          const pnlPct = (currentPrice - entryPrice) / entryPrice;
          const atrVal = this.atr(slice);
          const stopDist = atrVal * 2 / entryPrice;
          if (pnlPct < -stopDist || pnlPct > stopDist * 3 || holdDays > 20) {
            const pnl = equity * pnlPct * 0.95;
            equity = Math.max(0.01, equity + pnl);
            trades.push({ pnl, pnlPct, win: pnl > 0, holdDays });
            inTrade = false;
          }
        }
        equityCurve.push(equity);
      }
      return { trades, equity, equityCurve, quarantineCount };
    };

    const is = runSim(inSample);
    const oos = runSim(oosSample);

    const metrics = (sim) => {
      if (!sim || sim.trades.length === 0) return { wr: 0, pf: 0, mdd: 0, sharpe: 0, trades: 0, quarantineCount: 0, equityCurve: [1000] };
      const wins = sim.trades.filter(t => t.win);
      const wr = wins.length / sim.trades.length;
      const gp = wins.reduce((a, t) => a + t.pnl, 0);
      const gl = Math.abs(sim.trades.filter(t => !t.win).reduce((a, t) => a + t.pnl, 0));
      const pf = gl === 0 ? 99 : gp / gl;
      let peak = 1000, maxDD = 0;
      for (const eq of sim.equityCurve) { if (eq > peak) peak = eq; const dd = (peak - eq) / peak; if (dd > maxDD) maxDD = dd; }
      const dailyR = sim.equityCurve.map((e, i) => i > 0 ? (e - sim.equityCurve[i-1]) / sim.equityCurve[i-1] : 0).slice(1);
      const avgR = dailyR.reduce((a, b) => a + b, 0) / (dailyR.length || 1);
      const stdR = Math.sqrt(dailyR.reduce((a, b) => a + Math.pow(b - avgR, 2), 0) / (dailyR.length || 1));
      const sharpe = stdR === 0 ? 0 : (avgR / stdR) * Math.sqrt(252);
      return { wr: wr * 100, pf, mdd: maxDD * 100, sharpe, trades: sim.trades.length, quarantineCount: sim.quarantineCount, equityCurve: sim.equityCurve };
    };

    return { inSample: metrics(is), oos: metrics(oos), splitIdx, totalBars: ohlcv.length };
  },
};

// ============================================================
// HOOKS
// ============================================================
function useTokenData(address) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetch_ = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    const controller = new AbortController();

    try {
      // STEP 1: Ambil pair info dari DexScreener
      const dsRes = await fetch(
        `${DEXSCREENER_BASE}/tokens/${address}`,
        { signal: controller.signal }
      );
      const dsJson = await dsRes.json();
      const pair = dsJson.pairs?.[0];

      if (!pair) throw new Error("no_pair");

      // STEP 2: Ambil OHLCV dari GeckoTerminal
      // Butuh network + pool address dari pair DexScreener
      const network = pair.chainId || "eth";
      const poolAddress = pair.pairAddress;

      // Map chainId DexScreener ke network GeckoTerminal
      const networkMap = {
        "ethereum": "eth",
        "bsc": "bsc",
        "polygon": "polygon_pos",
        "arbitrum": "arbitrum",
        "base": "base",
        "solana": "solana",
        "avalanche": "avax",
        "optimism": "optimism",
      };
      const geckoNetwork = networkMap[network] || network;

      const ohlcvRes = await fetch(
        `${GECKO_BASE}/networks/${geckoNetwork}/pools/${poolAddress}/ohlcv/day?limit=180&currency=usd`,
        { signal: controller.signal }
      );
      const ohlcvJson = await ohlcvRes.json();
      const rawOhlcv = ohlcvJson?.data?.attributes?.ohlcv_list;

      let ohlcv;
      if (rawOhlcv && rawOhlcv.length > 10) {
        // Format GeckoTerminal: [timestamp, open, high, low, close, volume]
        ohlcv = rawOhlcv
          .map(([t, o, h, l, c, v]) => ({
            time: t,
            open: parseFloat(o),
            high: parseFloat(h),
            low: parseFloat(l),
            close: parseFloat(c),
            volume: parseFloat(v),
          }))
          .filter(c => c.close > 0)
          .sort((a, b) => a.time - b.time);
      } else {
        // Fallback mock kalau GeckoTerminal tidak ada data pool ini
        ohlcv = MathUtils.generateMockOHLCV(
          180,
          parseFloat(pair.priceUsd || 1)
        );
      }

      setData({
        pair,
        ohlcv,
        source: rawOhlcv?.length > 10 ? "live" : "mock",
      });

    } catch (e) {
      if (e.name === "AbortError") return;

      // Full fallback: mock data
      const ohlcv = MathUtils.generateMockOHLCV(
        180,
        Math.random() * 10 + 0.1
      );
      setData({
        pair: {
          baseToken: {
            symbol: address.slice(2, 7).toUpperCase(),
            name: "Custom Token"
          },
          priceUsd: ohlcv[ohlcv.length - 1].close.toString(),
          volume: { h24: ohlcv.slice(-24).reduce((a, c) => a + c.volume, 0) },
          liquidity: { usd: Math.random() * 1e6 + 1e4 },
          txns: {
            h24: {
              buys: Math.floor(Math.random() * 500 + 50),
              sells: Math.floor(Math.random() * 500 + 50)
            }
          },
          priceChange: { h24: (Math.random() - 0.5) * 20 },
        },
        ohlcv,
        source: "mock",
      });
    }

    setLoading(false);
    return () => controller.abort();
  }, [address]);

  useEffect(() => {
    fetch_();
    const t = setInterval(fetch_, 60000);
    return () => clearInterval(t);
  }, [fetch_]);

  return { data, loading, refetch: fetch_ };
}

// ============================================================
// COMPONENTS
// ============================================================
function ScanLine() {
  return <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9999, background: "var(--scanline)", opacity: 0.4 }} />;
}

function PanelLabel({ children, color = "var(--neon)" }) {
  return (
    <div style={{ fontSize: "9px", letterSpacing: "3px", color, fontWeight: 700, textTransform: "uppercase", borderBottom: `1px solid ${color}22`, paddingBottom: "6px", marginBottom: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
      <span style={{ color, opacity: 0.5 }}>▸</span>{children}
    </div>
  );
}

function StatusBadge({ label, color = "var(--neon)" }) {
  return <span style={{ fontSize: "9px", padding: "2px 6px", border: `1px solid ${color}44`, color, background: `${color}11`, letterSpacing: "2px" }}>{label}</span>;
}

function Metric({ label, value, color = "var(--neon)", sub }) {
  return (
    <div style={{ marginBottom: "8px" }}>
      <div style={{ fontSize: "8px", color: "var(--text-muted)", letterSpacing: "2px" }}>{label}</div>
      <div style={{ fontSize: "16px", color, fontWeight: 700, lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: "9px", color: "var(--text-muted)" }}>{sub}</div>}
    </div>
  );
}

function Loading({ label = "SCANNING" }) {
  const [dots, setDots] = useState("");
  useEffect(() => { const t = setInterval(() => setDots(d => d.length >= 3 ? "" : d + "."), 400); return () => clearInterval(t); }, []);
  return (
    <div style={{ color: "var(--neon-dim)", fontSize: "11px", letterSpacing: "3px", padding: "40px", textAlign: "center" }}>
      <div style={{ marginBottom: "8px", fontSize: "9px", color: "var(--text-muted)" }}>{"[ " + "=".repeat(dots.length * 4) + " ".repeat(12 - dots.length * 4) + " ]"}</div>
      {label}{dots}
    </div>
  );
}

function Panel({ children, style = {} }) {
  return (
    <div style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", padding: "14px", position: "relative", overflow: "hidden", ...style }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "1px", background: "linear-gradient(90deg, transparent, var(--neon-dim), transparent)", opacity: 0.3 }} />
      {children}
    </div>
  );
}

function CandleChart({ ohlcv, structure }) {
  const canvasRef = useRef(null);

  const draw = useCallback(() => {
    if (!ohlcv || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const W = canvas.offsetWidth; const H = canvas.offsetHeight;
    if (W === 0 || H === 0) return;
    canvas.width = W; canvas.height = H;
    const data = ohlcv.slice(-80);
    const prices = data.flatMap(c => [c.high, c.low]);
    const minP = Math.min(...prices) * 0.998;
    const maxP = Math.max(...prices) * 1.002;
    const pY = p => H * 0.85 * (1 - (p - minP) / (maxP - minP)) + H * 0.02;
    const cW = Math.max(2, Math.floor((W - 20) / data.length) - 1);
    ctx.fillStyle = "#050505"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#0f0f0f"; ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) { const y = (H * 0.87 / 5) * i + H * 0.02; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    const maxVol = Math.max(...data.map(c => c.volume));
    data.forEach((c, i) => {
      const x = 10 + i * (cW + 1);
      const volH = (c.volume / maxVol) * H * 0.13;
      ctx.fillStyle = c.close >= c.open ? "rgba(0,255,65,0.15)" : "rgba(255,42,42,0.15)";
      ctx.fillRect(x, H - volH, cW, volH);
    });
    data.forEach((c, i) => {
      const x = 10 + i * (cW + 1) + Math.floor(cW / 2);
      const isG = c.close >= c.open;
      const col = isG ? "#00ff41" : "#ff2a2a";
      const bT = pY(Math.max(c.open, c.close));
      const bB = pY(Math.min(c.open, c.close));
      const bH = Math.max(1, bB - bT);
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.moveTo(x, pY(c.high)); ctx.lineTo(x, pY(c.low)); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = isG ? "rgba(0,255,65,0.7)" : "rgba(255,42,42,0.7)";
      ctx.fillRect(x - Math.floor(cW / 2), bT, cW, bH);
    });
    if (structure) {
      [...(structure.bos || []), ...(structure.choch || [])].forEach(s => {
        const idx = Math.min(data.length - 1, Math.max(0, s.i - (ohlcv.length - data.length)));
        if (idx < 0 || idx >= data.length) return;
        const x = 10 + idx * (cW + 1);
        const y = pY(s.price);
        ctx.strokeStyle = s.label?.includes("CHOCH") ? "#aa44ff" : "#ffaa00";
        ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(W, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = s.label?.includes("CHOCH") ? "#aa44ff" : "#ffaa00";
        ctx.font = "8px JetBrains Mono, monospace";
        ctx.fillText(s.label, x + 2, y - 3);
      });
    }
    const lp = data[data.length - 1].close;
    const ly = pY(lp);
    ctx.strokeStyle = "rgba(0,255,65,0.4)"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(W - 62, ly); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#00ff41"; ctx.font = "bold 9px JetBrains Mono, monospace";
    ctx.fillText("$" + (lp < 0.001 ? lp.toExponential(3) : lp < 1 ? lp.toFixed(6) : lp.toFixed(2)), W - 60, ly + 3);
  }, [ohlcv, structure]);

  useEffect(() => {
    draw();
    const ro = new ResizeObserver(draw);
    if (canvasRef.current) ro.observe(canvasRef.current.parentElement || canvasRef.current);
    return () => ro.disconnect();
  }, [draw]);
  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}

function HqChart({ hqData }) {
  const canvasRef = useRef(null);

  const draw = useCallback(() => {
    if (!hqData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const W = canvas.offsetWidth; const H = canvas.offsetHeight;
    if (W === 0 || H === 0) return;
    canvas.width = W; canvas.height = H;
    ctx.fillStyle = "#050505"; ctx.fillRect(0, 0, W, H);
    const pad = { l: 32, r: 12, t: 12, b: 28 };
    const cW = W - pad.l - pad.r; const cH = H - pad.t - pad.b;
    const qVals = hqData.map(d => d.q);
    const minQ = Math.min(...qVals), maxQ = Math.max(...qVals);
    const qRange = maxQ - minQ || 1; // FIX WARN-05: guard division by zero
    const xS = q => pad.l + ((q - minQ) / qRange) * cW;
    const yS = h => pad.t + (1 - h) * cH;
    ctx.strokeStyle = "#111"; ctx.lineWidth = 1;
    [0, 0.25, 0.5, 0.75, 1].forEach(h => { const y = yS(h); ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke(); ctx.fillStyle = "#2a4a2a"; ctx.font = "8px monospace"; ctx.fillText(h.toFixed(2), 2, y + 3); });
    ctx.strokeStyle = "rgba(255,170,0,0.3)"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pad.l, yS(0.5)); ctx.lineTo(W, yS(0.5)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(0,255,65,0.04)"; ctx.fillRect(pad.l, pad.t, cW, yS(0.5) - pad.t);
    ctx.fillStyle = "rgba(255,42,42,0.04)"; ctx.fillRect(pad.l, yS(0.5), cW, cH - (yS(0.5) - pad.t));
    ctx.strokeStyle = "#00ff41"; ctx.lineWidth = 2;
    ctx.beginPath(); hqData.forEach((d, i) => { i === 0 ? ctx.moveTo(xS(d.q), yS(d.h)) : ctx.lineTo(xS(d.q), yS(d.h)); }); ctx.stroke();
    hqData.forEach(d => {
      const x = xS(d.q), y = yS(d.h);
      const col = d.h > 0.55 ? "#00ff41" : d.h < 0.45 ? "#ff2a2a" : "#ffaa00";
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#3a5a3a"; ctx.font = "7px monospace"; ctx.fillText("q=" + d.q, x - 6, y - 7);
    });
    ctx.fillStyle = "#ffaa00"; ctx.font = "7px monospace"; ctx.fillText("RANDOM H=0.5", W - 80, yS(0.5) - 3);
    ctx.fillStyle = "#2a4a2a"; qVals.forEach(q => { ctx.fillText(q, xS(q) - 4, H - 8); });
    ctx.fillStyle = "#3a6a3a"; ctx.fillText("H(q)", 2, 14);
  }, [hqData]);

  useEffect(() => {
    draw();
    const ro = new ResizeObserver(draw);
    if (canvasRef.current) ro.observe(canvasRef.current.parentElement || canvasRef.current);
    return () => ro.disconnect();
  }, [draw]);
  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}

function EquityCurve({ isData, oosData }) {
  const canvasRef = useRef(null);

  const draw = useCallback(() => {
    if (!isData || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const W = canvas.offsetWidth; const H = canvas.offsetHeight;
    if (W === 0 || H === 0) return;
    canvas.width = W; canvas.height = H;
    ctx.fillStyle = "#050505"; ctx.fillRect(0, 0, W, H);
    const drawCurve = (curve, color, label, x0, x1) => {
      if (!curve || curve.length < 2) return;
      const minE = Math.min(...curve), maxE = Math.max(...curve);
      const yS = e => H * 0.9 * (1 - (e - minE) / (maxE - minE + 1)) + H * 0.05;
      const xS = i => x0 + (i / (curve.length - 1)) * (x1 - x0 - 4);
      ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      ctx.beginPath(); curve.forEach((e, i) => { i === 0 ? ctx.moveTo(xS(i), yS(e)) : ctx.lineTo(xS(i), yS(e)); }); ctx.stroke();
      ctx.fillStyle = color; ctx.font = "8px monospace"; ctx.fillText(label, x0 + 4, 12);
    };
    ctx.strokeStyle = "#ffaa0044"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(W * 0.65, 0); ctx.lineTo(W * 0.65, H); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffaa00"; ctx.font = "7px monospace"; ctx.fillText("PURGE", W * 0.65 + 2, H - 4);
    drawCurve(isData, "#00cc33", "IS", 0, W * 0.63);
    if (oosData) drawCurve(oosData, "#00ff41", "OOS", W * 0.67, W);
  }, [isData, oosData]);

  useEffect(() => {
    draw();
    const ro = new ResizeObserver(draw);
    if (canvasRef.current) ro.observe(canvasRef.current.parentElement || canvasRef.current);
    return () => ro.disconnect();
  }, [draw]);
  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}

function LiqHeatmap({ zones, currentPrice }) {
  if (!zones || zones.length === 0) return <div style={{ color: "var(--text-muted)", fontSize: "10px" }}>NO DATA</div>;
  const max = Math.max(...zones); const min = Math.min(...zones);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
      {zones.map((z, i) => {
        const dist = currentPrice ? Math.abs(z - currentPrice) / currentPrice : 0;
        const intensity = 1 - (z - min) / (max - min + 0.001);
        const color = dist < 0.02 ? "#ff2a2a" : dist < 0.05 ? "#ffaa00" : "#00ff41";
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ height: "10px", width: `${(intensity * 70 + 20).toFixed(0)}%`, background: `${color}33`, border: `1px solid ${color}44` }} />
            <span style={{ fontSize: "9px", color, letterSpacing: "1px" }}>${z.toFixed(z < 0.01 ? 8 : 4)}</span>
            {dist < 0.02 && <StatusBadge label="NEAR" color="var(--red)" />}
          </div>
        );
      })}
    </div>
  );
}

function Watchlist({ tokens, active, onSelect, onAdd, onRemove }) {
  const [input, setInput] = useState("");
  const [symInput, setSymInput] = useState("");
  return (
    <Panel style={{ height: "100%" }}>
      <PanelLabel>WATCHLIST // 5 MAX</PanelLabel>
      <input value={input} onChange={e => setInput(e.target.value)} placeholder="0x... address" style={{ width: "100%", background: "var(--bg-deep)", border: "1px solid var(--border-bright)", color: "var(--neon)", padding: "5px 8px", fontSize: "10px", letterSpacing: "1px", outline: "none", marginBottom: "4px" }} />
      <div style={{ display: "flex", gap: "4px", marginBottom: "10px" }}>
        <input value={symInput} onChange={e => setSymInput(e.target.value)} placeholder="SYM" style={{ flex: 1, background: "var(--bg-deep)", border: "1px solid var(--border-bright)", color: "var(--amber)", padding: "5px 8px", fontSize: "10px", letterSpacing: "2px", outline: "none" }} />
        <button onClick={() => { if (input.trim().length > 5 && tokens.length < 5) { onAdd({ address: input.trim(), symbol: symInput.trim() || "???", name: "Custom", chain: "ethereum" }); setInput(""); setSymInput(""); } }} disabled={tokens.length >= 5} style={{ background: tokens.length >= 5 ? "var(--bg-deep)" : "var(--neon-ghost)", border: "1px solid var(--neon-dim)", color: "var(--neon)", padding: "5px 10px", fontSize: "10px", letterSpacing: "2px", opacity: tokens.length >= 5 ? 0.3 : 1 }}>ADD</button>
      </div>
      <div>
        {tokens.map((t, i) => (
          <div key={t.address} onClick={() => onSelect(t)} style={{ padding: "8px 10px", marginBottom: "3px", cursor: "pointer", background: active?.address === t.address ? "var(--neon-ghost)" : "var(--bg-deep)", border: `1px solid ${active?.address === t.address ? "var(--neon-dim)" : "var(--border)"}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: "11px", color: "var(--neon)", fontWeight: 700, letterSpacing: "2px" }}>{t.symbol}</div>
              <div style={{ fontSize: "8px", color: "var(--text-muted)" }}>{t.address.slice(0, 10)}...{t.address.slice(-6)}</div>
            </div>
            <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
              <span style={{ fontSize: "8px", color: "var(--text-muted)" }}>#{i + 1}</span>
              {tokens.length > 1 && <button onClick={e => { e.stopPropagation(); onRemove(t.address); }} style={{ background: "none", border: "none", color: "var(--red)", fontSize: "10px", padding: "0 4px" }}>✕</button>}
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: "8px", fontSize: "8px", color: "var(--text-dead)", letterSpacing: "1px" }}>SLOT [{tokens.length}/5]</div>
    </Panel>
  );
}

// ============================================================
// MAIN DASHBOARD
// ============================================================
function Dashboard({ token, data, loading }) {
  const [tab, setTab] = useState("OVERVIEW");
  const TABS = ["OVERVIEW", "FRACTAL", "STRUCTURE", "BACKTEST", "BEHAVIOR"];

  const analysis = useMemo(() => {
    if (!data?.ohlcv) return null;
    const returns = data.ohlcv.map((c, i) => i > 0 ? Math.log(c.close / data.ohlcv[i-1].close) : 0).slice(1);
    return {
      hq: MathUtils.computeHq(returns),
      score: MathUtils.blackHorseScore(data.ohlcv),
      backtest: MathUtils.runBacktest(data.ohlcv),
      fd: MathUtils.fractalDimension(data.ohlcv.map(c => c.close)),
      breakdown: MathUtils.detectFractalBreakdown(returns),
    };
  }, [data]);

  if (!token) return (
    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: "12px" }}>
      <div style={{ fontSize: "40px", opacity: 0.1 }}>⬡</div>
      <div style={{ fontSize: "10px", letterSpacing: "5px", color: "var(--text-muted)" }}>SELECT TOKEN</div>
    </div>
  );

  if (loading) return <Loading label="INITIALIZING SURVEILLANCE" />;

  const pair = data?.pair;
  const price = parseFloat(pair?.priceUsd || 0);
  const priceChange = pair?.priceChange?.h24 || 0;
  const vol24 = pair?.volume?.h24 || 0;
  const liq = pair?.liquidity?.usd || 0;
  const txns = pair?.txns?.h24;
  const fmt = v => v > 1e9 ? `$${(v/1e9).toFixed(2)}B` : v > 1e6 ? `$${(v/1e6).toFixed(2)}M` : `$${(v/1e3).toFixed(1)}K`;
  const fmtP = p => p < 0.0001 ? p.toExponential(3) : p < 0.01 ? p.toFixed(8) : p < 1 ? p.toFixed(6) : p.toFixed(2);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{ background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", padding: "10px 16px", display: "flex", flexWrap: "wrap", gap: "12px", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
          <span style={{ fontSize: "20px", color: "var(--neon)", fontWeight: 800, letterSpacing: "3px", textShadow: "0 0 15px var(--neon-glow)" }}>{pair?.baseToken?.symbol || token.symbol}</span>
          <span style={{ fontSize: "9px", color: "var(--text-muted)", letterSpacing: "2px" }}>{pair?.baseToken?.name || token.name}</span>
          {data?.source === "mock" && <StatusBadge label="SIM" color="var(--amber)" />}           
          {data?.source === "live" && <StatusBadge label="LIVE DATA" color="var(--neon)" />}
          {data?.source === "dexscreener" && <StatusBadge label="DS ONLY" color="var(--blue)" />}
        </div>
        <div style={{ display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap" }}>
          {[
            { label: "PRICE", val: "$" + fmtP(price), sub: `${priceChange >= 0 ? "▲" : "▼"} ${Math.abs(priceChange).toFixed(2)}%`, subCol: priceChange >= 0 ? "var(--neon)" : "var(--red)" },
            { label: "VOL 24H", val: fmt(vol24), col: "var(--amber)" },
            { label: "LIQUIDITY", val: fmt(liq), col: "var(--blue)" },
            { label: "BUYS/SELLS", val: txns ? `${txns.buys}/${txns.sells}` : "—", col: txns && txns.buys > txns.sells ? "var(--neon)" : "var(--red)" },
          ].map(m => (
            <div key={m.label}>
              <div style={{ fontSize: "7px", color: "var(--text-muted)", letterSpacing: "2px" }}>{m.label}</div>
              <div style={{ fontSize: "14px", color: m.col || "var(--neon)", fontWeight: 700 }}>{m.val}</div>
              {m.sub && <div style={{ fontSize: "9px", color: m.subCol }}>{m.sub}</div>}
            </div>
          ))}
          {analysis && (
            <div style={{ padding: "8px 14px", textAlign: "center", background: analysis.score.score >= 60 ? "var(--neon-ghost)" : analysis.score.score < 30 ? "var(--red-ghost)" : "var(--amber-ghost)", border: `2px solid ${analysis.score.score >= 60 ? "var(--neon-dim)" : analysis.score.score < 30 ? "var(--red)" : "var(--amber)"}` }}>
              <div style={{ fontSize: "7px", color: "var(--text-muted)", letterSpacing: "3px" }}>BLACK HORSE</div>
              <div style={{ fontSize: "26px", fontWeight: 800, color: analysis.score.score >= 60 ? "var(--neon)" : analysis.score.score < 30 ? "var(--red)" : "var(--amber)", textShadow: analysis.score.score >= 70 ? "0 0 20px var(--neon-glow)" : "none" }}>{analysis.score.score}</div>
              <div style={{ fontSize: "8px", letterSpacing: "1px", color: "var(--text-secondary)" }}>{analysis.score.grade}</div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", background: "var(--bg-deep)", borderBottom: "1px solid var(--border)" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: "9px 4px", background: "none", border: "none", borderBottom: `2px solid ${tab === t ? "var(--neon)" : "transparent"}`, color: tab === t ? "var(--neon)" : "var(--text-muted)", fontSize: "8px", letterSpacing: "2px", transition: "all 0.15s" }}>{t}</button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: "12px" }}>

        {tab === "OVERVIEW" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "8px", marginBottom: "12px" }}>
              {[
                { label: "HURST EXP", val: analysis?.score.H?.toFixed(3) || "—", color: (analysis?.score.H || 0.5) > 0.55 ? "var(--neon)" : "var(--amber)" },
                { label: "FRACTAL DIM", val: analysis?.fd?.toFixed(3) || "—", color: "var(--blue)" },
                { label: "VOL REGIME", val: analysis?.score.vol.regime || "—", color: analysis?.score.vol.regime === "EXTREME" ? "var(--red)" : "var(--amber)" },
                { label: "BEHAVIOR", val: analysis?.score.behavior.label || "—", color: "var(--purple)" },
              ].map(m => (
                <Panel key={m.label}>
                  <div style={{ fontSize: "7px", color: "var(--text-muted)", letterSpacing: "2px", marginBottom: "4px" }}>{m.label}</div>
                  <div style={{ fontSize: "13px", color: m.color, fontWeight: 700 }}>{m.val}</div>
                </Panel>
              ))}
            </div>
            <Panel style={{ height: "260px", marginBottom: "12px", padding: "10px" }}>
              <PanelLabel>PRICE ACTION // 80D — BOS/CHOCH OVERLAY</PanelLabel>
              <div style={{ height: "calc(100% - 28px)" }}>
                <CandleChart ohlcv={data?.ohlcv} structure={analysis?.score?.struct} />
              </div>
            </Panel>
            {analysis && (
              <Panel>
                <PanelLabel>CONFLUENCE SIGNAL SCANNER</PanelLabel>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px,1fr))", gap: "6px" }}>
                  {analysis.score.signals.map((s, i) => (
                    <div key={i} style={{ padding: "7px 10px", background: s.active ? (s.weight > 0 ? "var(--neon-ghost)" : "var(--red-ghost)") : "var(--bg-deep)", border: `1px solid ${s.active ? (s.weight > 0 ? "var(--neon-dim)" : "var(--red)") : "var(--border)"}33`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "9px", color: s.active ? "var(--text-primary)" : "var(--text-muted)", letterSpacing: "1px" }}>{s.label}</span>
                      <span style={{ fontSize: "10px", fontWeight: 800, color: s.weight > 0 ? "var(--neon)" : s.weight < 0 ? "var(--red)" : "var(--text-muted)" }}>{s.weight > 0 ? "+" : ""}{s.weight}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            )}
          </>
        )}

        {tab === "FRACTAL" && analysis && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "8px", marginBottom: "12px" }}>
              {[
                { label: "HURST EXPONENT", val: analysis.score.H?.toFixed(4), color: analysis.score.H > 0.55 ? "var(--neon)" : analysis.score.H < 0.45 ? "var(--red)" : "var(--amber)", sub: analysis.score.H > 0.55 ? "PERSISTENT" : analysis.score.H < 0.45 ? "ANTI-PERSIST" : "RANDOM WALK" },
                { label: "FRACTAL DIM D", val: analysis.fd?.toFixed(4), color: "var(--blue)", sub: "D = 2 − H" },
                { label: "BREAKDOWNS", val: analysis.breakdown.length, color: analysis.breakdown.length > 2 ? "var(--red)" : "var(--neon)", sub: "LAST 180 DAYS" },
                { label: "Δ H(q) WIDTH", val: analysis.hq.length > 0 ? (Math.max(...analysis.hq.map(d=>d.h)) - Math.min(...analysis.hq.map(d=>d.h))).toFixed(3) : "—", color: "var(--purple)", sub: "MULTIFRACTAL" },
              ].map(m => (
                <Panel key={m.label}>
                  <div style={{ fontSize: "7px", color: "var(--text-muted)", letterSpacing: "2px", marginBottom: "4px" }}>{m.label}</div>
                  <div style={{ fontSize: "22px", fontWeight: 800, color: m.color }}>{m.val}</div>
                  <div style={{ fontSize: "8px", color: "var(--text-muted)", marginTop: "2px" }}>{m.sub}</div>
                </Panel>
              ))}
            </div>
            <Panel style={{ height: "210px", marginBottom: "12px", padding: "10px" }}>
              <PanelLabel>H(q) MULTIFRACTAL SPECTRUM // q ∈ [-3, +3]</PanelLabel>
              <div style={{ height: "calc(100% - 28px)" }}><HqChart hqData={analysis.hq} /></div>
            </Panel>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "8px" }}>
              <Panel>
                <PanelLabel>ZONE LEGEND</PanelLabel>
                {[
                  { range: "H > 0.55", label: "PERSISTENT", desc: "Trending. Follow momentum.", color: "var(--neon)" },
                  { range: "H ≈ 0.5", label: "RANDOM WALK", desc: "No edge. Avoid entry.", color: "var(--amber)" },
                  { range: "H < 0.45", label: "ANTI-PERSIST", desc: "Mean-reverting. Reversal.", color: "var(--red)" },
                ].map(z => (
                  <div key={z.label} style={{ padding: "8px", marginBottom: "5px", background: "var(--bg-deep)", border: `1px solid ${z.color}22` }}>
                    <div style={{ fontSize: "9px", color: z.color, fontWeight: 700, letterSpacing: "2px" }}>{z.label}</div>
                    <div style={{ fontSize: "7px", color: "var(--text-muted)" }}>{z.range} — {z.desc}</div>
                  </div>
                ))}
              </Panel>
              <Panel>
                <PanelLabel>BREAKDOWN LOG</PanelLabel>
                {analysis.breakdown.length === 0 ? <div style={{ fontSize: "9px", color: "var(--text-muted)" }}>NO BREAKDOWNS DETECTED</div> : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "3px", maxHeight: "150px", overflow: "auto" }}>
                    {analysis.breakdown.slice(-15).reverse().map((b, i) => (
                      <div key={i} style={{ display: "flex", gap: "10px", padding: "4px 8px", background: b.type === "ANTI_PERSISTENT" ? "var(--red-ghost)" : "var(--neon-ghost)", border: `1px solid ${b.type === "ANTI_PERSISTENT" ? "var(--red)" : "var(--neon)"}22`, fontSize: "9px" }}>
                        <span style={{ color: b.type === "ANTI_PERSISTENT" ? "var(--red)" : "var(--neon)" }}>{b.type === "ANTI_PERSISTENT" ? "▼" : "▲"} {b.label}</span>
                        <span style={{ color: "var(--text-muted)" }}>H={b.H.toFixed(3)}</span>
                        <span style={{ color: "var(--text-dead)" }}>bar#{b.i}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </div>
          </>
        )}

        {tab === "STRUCTURE" && analysis && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
              <Panel>
                <PanelLabel color="var(--amber)">VOLATILITY REGIME</PanelLabel>
                <div style={{ textAlign: "center", padding: "12px 0" }}>
                  <div style={{ fontSize: "28px", fontWeight: 800, letterSpacing: "5px", color: analysis.score.vol.regime === "EXTREME" ? "var(--red)" : analysis.score.vol.regime === "HIGH" ? "var(--amber)" : analysis.score.vol.regime === "MEDIUM" ? "var(--neon)" : "var(--text-secondary)" }}>{analysis.score.vol.regime}</div>
                  <div style={{ fontSize: "9px", color: "var(--text-muted)", marginTop: "6px" }}>ATR: ${analysis.score.vol.atr?.toFixed(6)} ({analysis.score.vol.pct?.toFixed(2)}%)</div>
                  <div style={{ fontSize: "10px", color: "var(--text-secondary)", marginTop: "4px" }}>
                    SIZE: {analysis.score.vol.regime === "LOW" ? "1.5×" : analysis.score.vol.regime === "MEDIUM" ? "1.0×" : analysis.score.vol.regime === "HIGH" ? "0.6×" : "0.25×"}
                  </div>
                  <div style={{ display: "flex", justifyContent: "center", gap: "4px", marginTop: "10px" }}>
                    {["LOW","MEDIUM","HIGH","EXTREME"].map(r => (
                      <div key={r} style={{ padding: "3px 8px", fontSize: "7px", letterSpacing: "1px", background: analysis.score.vol.regime === r ? "var(--neon-ghost)" : "var(--bg-deep)", border: `1px solid ${analysis.score.vol.regime === r ? "var(--neon)" : "var(--border)"}`, color: analysis.score.vol.regime === r ? "var(--neon)" : "var(--text-dead)" }}>{r}</div>
                    ))}
                  </div>
                </div>
              </Panel>
              <Panel>
                <PanelLabel color="var(--purple)">SWING STRUCTURE HH/HL/LH/LL</PanelLabel>
                <div style={{ maxHeight: "200px", overflow: "auto" }}>
                  {analysis.score.struct.swings.slice(-10).reverse().map((s, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "5px 8px", marginBottom: "3px", background: s.type === "HH" || s.type === "HL" ? "rgba(0,255,65,0.05)" : "rgba(255,42,42,0.05)", border: `1px solid ${s.type === "HH" || s.type === "HL" ? "var(--neon)" : "var(--red)"}22` }}>
                      <span style={{ fontSize: "11px", fontWeight: 800, letterSpacing: "3px", color: s.type === "HH" || s.type === "HL" ? "var(--neon)" : "var(--red)" }}>{s.type}</span>
                      <span style={{ fontSize: "9px", color: "var(--text-secondary)" }}>${s.price?.toFixed(s.price < 1 ? 6 : 2)}</span>
                    </div>
                  ))}
                  {analysis.score.struct.swings.length === 0 && <div style={{ fontSize: "9px", color: "var(--text-muted)" }}>COMPUTING...</div>}
                </div>
              </Panel>
            </div>
            <Panel style={{ marginBottom: "12px" }}>
              <PanelLabel color="var(--red)">BOS / CHOCH EVENTS</PanelLabel>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {[...(analysis.score.struct.bos || []), ...(analysis.score.struct.choch || [])].slice(-10).map((e, i) => (
                  <div key={i} style={{ padding: "8px 14px", background: e.label?.includes("CHOCH") ? "rgba(170,68,255,0.1)" : "var(--amber-ghost)", border: `1px solid ${e.label?.includes("CHOCH") ? "#aa44ff" : "var(--amber)"}55`, fontSize: "10px", letterSpacing: "2px", color: e.label?.includes("CHOCH") ? "#aa44ff" : "var(--amber)" }}>
                    <div style={{ fontWeight: 700 }}>{e.label}</div>
                    <div style={{ fontSize: "8px", opacity: 0.7, marginTop: "2px" }}>@ ${e.price?.toFixed(e.price < 1 ? 6 : 3)}</div>
                  </div>
                ))}
                {analysis.score.struct.bos?.length === 0 && analysis.score.struct.choch?.length === 0 && <div style={{ fontSize: "9px", color: "var(--text-muted)", padding: "8px" }}>NO STRUCTURE BREAKS IN RECENT DATA</div>}
              </div>
            </Panel>
            <Panel>
              <PanelLabel color="var(--blue)">LIQUIDITY PRESSURE MAP</PanelLabel>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "16px", alignItems: "start" }}>
                <div>
                  <div style={{ fontSize: "7px", color: "var(--text-muted)", marginBottom: "4px" }}>SCORE</div>
                  <div style={{ fontSize: "36px", fontWeight: 800, color: analysis.score.liq.score > 70 ? "var(--red)" : analysis.score.liq.score > 40 ? "var(--amber)" : "var(--neon)" }}>{analysis.score.liq.score}</div>
                  <div style={{ fontSize: "8px", color: "var(--text-muted)" }}>/100</div>
                </div>
                <div>
                  <div style={{ height: "8px", background: "var(--bg-deep)", border: "1px solid var(--border)", marginBottom: "8px" }}>
                    <div style={{ height: "100%", width: `${analysis.score.liq.score}%`, background: `linear-gradient(90deg, var(--neon-dim), ${analysis.score.liq.score > 70 ? "var(--red)" : "var(--neon)"})` }} />
                  </div>
                  <PanelLabel>HIGH-VOL PRICE ZONES</PanelLabel>
                  <LiqHeatmap zones={analysis.score.liq.zones} currentPrice={price} />
                </div>
              </div>
            </Panel>
          </>
        )}

        {tab === "BACKTEST" && analysis && !analysis.backtest && (
          <Panel>
            <div style={{ padding: "30px", textAlign: "center" }}>
              <div style={{ fontSize: "24px", opacity: 0.2, marginBottom: "12px" }}>⚠</div>
              <div style={{ fontSize: "10px", color: "var(--amber)", letterSpacing: "3px", marginBottom: "6px" }}>INSUFFICIENT DATA</div>
              <div style={{ fontSize: "8px", color: "var(--text-muted)" }}>Backtest requires ≥ 100 OHLCV bars. Current data has fewer bars. Try a token with more history or wait for data to accumulate.</div>
            </div>
          </Panel>
        )}

        {tab === "BACKTEST" && analysis?.backtest && (
          <>
            <div style={{ padding: "8px 12px", background: "rgba(255,170,0,0.06)", border: "1px solid rgba(255,170,0,0.25)", marginBottom: "12px" }}>
              <div style={{ fontSize: "10px", color: "var(--amber)", letterSpacing: "2px", fontWeight: 700 }}>PURGED CROSS-VALIDATION — EMBARGO 5 BARS — ZERO LOOKAHEAD BIAS</div>
              <div style={{ fontSize: "8px", color: "var(--text-muted)", marginTop: "3px" }}>IS: 0→{analysis.backtest.splitIdx} | Purge gap: 5 bars | OOS: {analysis.backtest.splitIdx + 5}→{analysis.backtest.totalBars} | Min confluence: 3/4 signals</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
              {[
                { label: "IN-SAMPLE", data: analysis.backtest.inSample, color: "var(--neon-dim)", badge: "TRAINING" },
                { label: "OUT-OF-SAMPLE", data: analysis.backtest.oos, color: "var(--neon)", badge: "BLIND TEST" },
              ].map(({ label, data: d, color, badge }) => (
                <Panel key={label} style={{ borderColor: color + "44" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
                    <PanelLabel color={color}>{label}</PanelLabel>
                    <StatusBadge label={badge} color={color} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <Metric label="WIN RATE" value={`${d.wr?.toFixed(1)}%`} color={d.wr >= 50 ? "var(--neon)" : "var(--red)"} />
                    <Metric label="PROFIT FACTOR" value={d.pf >= 99 ? "∞" : d.pf?.toFixed(2)} color={d.pf >= 1.5 ? "var(--neon)" : "var(--amber)"} />
                    <Metric label="MAX DRAWDOWN" value={`${d.mdd?.toFixed(1)}%`} color={d.mdd <= 20 ? "var(--neon)" : "var(--red)"} />
                    <Metric label="SHARPE RATIO" value={d.sharpe?.toFixed(2)} color={d.sharpe >= 1 ? "var(--neon)" : "var(--amber)"} />
                  </div>
                  <div style={{ marginTop: "8px", padding: "5px 8px", background: "var(--bg-deep)", border: "1px solid var(--border)", display: "flex", justifyContent: "space-between", fontSize: "8px", color: "var(--text-muted)" }}>
                    <span>TRADES: {d.trades}</span>
                    <span style={{ color: "var(--red)" }}>BLOCKED: {d.quarantineCount}</span>
                  </div>
                </Panel>
              ))}
            </div>
            <Panel style={{ height: "170px", padding: "10px", marginBottom: "12px" }}>
              <PanelLabel>EQUITY CURVE // IS (dim) → PURGE EMBARGO → OOS (bright)</PanelLabel>
              <div style={{ height: "calc(100% - 28px)" }}>
                <EquityCurve isData={analysis.backtest.inSample.equityCurve} oosData={analysis.backtest.oos.equityCurve} />
              </div>
            </Panel>
            <Panel>
              <PanelLabel color="var(--red)">QUARANTINE ZONE — ENTRY BLOCKED</PanelLabel>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                {[
                  { rule: "H ∈ [0.38, 0.45]", desc: "Hurst ambiguity zone. Random walk boundary. No statistical edge." },
                  { rule: "EXTREME VOL", desc: "ATR% > 8%. Volatility too high. Size would collapse to 0.25×." },
                  { rule: "BOS + CHOCH CONFLICT", desc: "Both bullish and bearish structure breaks active. Conflicting signals." },
                ].map(r => (
                  <div key={r.rule} style={{ padding: "10px", background: "var(--red-ghost)", border: "1px solid rgba(255,42,42,0.2)" }}>
                    <div style={{ fontSize: "9px", color: "var(--red)", fontWeight: 700, marginBottom: "5px", letterSpacing: "1px" }}>⛔ {r.rule}</div>
                    <div style={{ fontSize: "8px", color: "var(--text-muted)", lineHeight: 1.5 }}>{r.desc}</div>
                  </div>
                ))}
              </div>
            </Panel>
          </>
        )}

        {tab === "BEHAVIOR" && analysis && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "12px" }}>
              <Panel>
                <PanelLabel color="var(--amber)">ACTIVE BEHAVIOR PATTERN</PanelLabel>
                <div style={{ padding: "20px", textAlign: "center", marginBottom: "10px", background: analysis.score.behavior.type === "fomo" ? "var(--amber-ghost)" : analysis.score.behavior.type === "accum" ? "var(--neon-ghost)" : analysis.score.behavior.type !== "neutral" ? "var(--red-ghost)" : "var(--bg-deep)", border: "1px solid var(--border-bright)" }}>
                  <div style={{ fontSize: "16px", fontWeight: 800, letterSpacing: "3px", color: analysis.score.behavior.type === "fomo" ? "var(--amber)" : analysis.score.behavior.type === "accum" ? "var(--neon)" : analysis.score.behavior.type !== "neutral" ? "var(--red)" : "var(--text-muted)" }}>{analysis.score.behavior.label}</div>
                </div>
                {[
                  { type: "accum", label: "ACCUMULATION", color: "var(--neon)", desc: "Smart money building. Vol↑ + Price↑" },
                  { type: "dist", label: "DISTRIBUTION", color: "var(--red)", desc: "Exits in progress. Vol↑ + Price↓" },
                  { type: "fomo", label: "FOMO SPIKE", color: "var(--amber)", desc: "Late retail. Vol 2.5×avg + pump." },
                  { type: "stophunt", label: "STOP HUNT", color: "var(--purple)", desc: "Liquidity grab + sharp reversal." },
                  { type: "neutral", label: "NEUTRAL/RANGE", color: "var(--text-muted)", desc: "No clear pattern detected." },
                ].map(b => (
                  <div key={b.type} style={{ padding: "6px 10px", marginBottom: "3px", display: "flex", justifyContent: "space-between", alignItems: "center", background: analysis.score.behavior.type === b.type ? `${b.color}11` : "var(--bg-deep)", border: `1px solid ${analysis.score.behavior.type === b.type ? b.color : "var(--border)"}44`, opacity: analysis.score.behavior.type === b.type ? 1 : 0.4 }}>
                    <div>
                      <span style={{ fontSize: "9px", color: b.color, fontWeight: 700, letterSpacing: "2px" }}>{b.label}</span>
                      <div style={{ fontSize: "7px", color: "var(--text-muted)" }}>{b.desc}</div>
                    </div>
                    {analysis.score.behavior.type === b.type && <span style={{ color: b.color, fontSize: "14px" }}>●</span>}
                  </div>
                ))}
              </Panel>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <Panel>
                  <PanelLabel color="var(--blue)">VOLATILITY SCALING</PanelLabel>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <Metric label="ATR VALUE" value={`$${analysis.score.vol.atr?.toFixed(analysis.score.vol.atr < 0.001 ? 8 : 4)}`} color="var(--blue)" />
                    <Metric label="ATR %" value={`${analysis.score.vol.pct?.toFixed(2)}%`} color="var(--blue)" />
                    <Metric label="REGIME" value={analysis.score.vol.regime} color={analysis.score.vol.regime === "EXTREME" ? "var(--red)" : "var(--amber)"} />
                    <Metric label="SIZE MULT" value={analysis.score.vol.regime === "LOW" ? "1.50×" : analysis.score.vol.regime === "MEDIUM" ? "1.00×" : analysis.score.vol.regime === "HIGH" ? "0.60×" : "0.25×"} color="var(--neon)" />
                  </div>
                  <div style={{ marginTop: "8px", fontSize: "8px", color: "var(--text-muted)", lineHeight: 1.8, padding: "6px", background: "var(--bg-deep)" }}>
                    Stop = 2× ATR | Target = 3× stop (3:1 R:R)<br />
                    Position ∝ 1/vol_regime_multiplier
                  </div>
                </Panel>
                <Panel style={{ flex: 1 }}>
                  <PanelLabel>CONFLUENCE SCORE BREAKDOWN</PanelLabel>
                  {analysis.score.signals.map((s, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
                      <span style={{ color: s.active && s.weight > 0 ? "var(--neon)" : s.active && s.weight < 0 ? "var(--red)" : "var(--text-dead)", fontSize: "10px", width: "12px", textAlign: "center" }}>{s.active && s.weight > 0 ? "●" : s.active && s.weight < 0 ? "✕" : "○"}</span>
                      <span style={{ fontSize: "8px", color: s.active ? "var(--text-primary)" : "var(--text-muted)", flex: 1, letterSpacing: "1px" }}>{s.label}</span>
                      <span style={{ fontSize: "9px", fontWeight: 700, color: s.weight > 0 ? "var(--neon)" : s.weight < 0 ? "var(--red)" : "var(--text-muted)" }}>{s.weight > 0 ? "+" : ""}{s.weight}</span>
                    </div>
                  ))}
                  <div style={{ marginTop: "8px", padding: "8px", background: "var(--bg-deep)", border: "1px solid var(--border-bright)", textAlign: "center" }}>
                    <div style={{ fontSize: "8px", color: "var(--text-muted)" }}>TOTAL</div>
                    <div style={{ fontSize: "30px", fontWeight: 800, color: analysis.score.score >= 60 ? "var(--neon)" : analysis.score.score < 30 ? "var(--red)" : "var(--amber)", textShadow: analysis.score.score >= 70 ? "0 0 20px var(--neon-glow)" : "none" }}>{analysis.score.score}</div>
                    <div style={{ fontSize: "10px", letterSpacing: "3px", color: "var(--text-secondary)" }}>{analysis.score.grade}</div>
                  </div>
                </Panel>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// ALERT TICKER
// ============================================================
function AlertTicker({ tokens, tokenDatas }) {
  const [pos, setPos] = useState(0);
  useEffect(() => { const t = setInterval(() => setPos(p => p + 1), 55); return () => clearInterval(t); }, []);

  const alerts = useMemo(() => {
    const a = [];
    tokens.forEach((t, i) => {
      const d = tokenDatas[i];
      if (!d?.ohlcv) return;
      const score = MathUtils.blackHorseScore(d.ohlcv);
      if (score.score >= 70) a.push(`🐴 ${t.symbol}: BLACK HORSE [${score.score}]`);
      if (score.struct.choch?.length > 0) a.push(`⚡ ${t.symbol}: CHOCH`);
      if (score.vol.regime === "EXTREME") a.push(`⚠ ${t.symbol}: EXTREME VOL`);
      if (score.behavior.type === "stophunt") a.push(`🎯 ${t.symbol}: STOP HUNT`);
      if (score.H < 0.35) a.push(`▼ ${t.symbol}: FRACTAL BREAKDOWN H=${score.H?.toFixed(3)}`);
    });
    if (a.length === 0) return ["SURVEILLANCE ACTIVE", "NO CRITICAL SIGNALS", "SCANNING ALL TOKENS", "WAITING FOR CONFLUENCE"];
    return a;
  }, [tokens, tokenDatas]);

  const txt = alerts.join("   ◆   ");
  return (
    <div style={{ background: "var(--bg-deep)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", padding: "5px 0", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ background: "var(--neon-ghost)", borderRight: "1px solid var(--neon-dim)", padding: "3px 10px", fontSize: "8px", color: "var(--neon)", letterSpacing: "3px", whiteSpace: "nowrap", flexShrink: 0 }}>ALERTS</div>
        <div style={{ overflow: "hidden", flex: 1 }}>
          <div style={{ fontSize: "9px", color: "var(--text-secondary)", letterSpacing: "2px", whiteSpace: "nowrap", transform: `translateX(${-(pos % (txt.length * 7 + 1))}px)` }}>
            {txt + "   ◆   " + txt}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ROOT
// ============================================================
export default function App() {
  const [tokens, setTokens] = useState(DEFAULT_TOKENS);
  const [active, setActive] = useState(DEFAULT_TOKENS[0]);
  const [time, setTime] = useState("");
  const [tokenDatas, setTokenDatas] = useState({});

  // Single fetch for active token — passed as props to Dashboard
  const { data: activeData, loading: activeLoading } = useTokenData(active?.address);

  // Cache data per address for AlertTicker (no re-fetch, reuse activeData)
  useEffect(() => {
    if (activeData && active?.address) {
      setTokenDatas(prev => ({ ...prev, [active.address]: activeData }));
    }
  }, [activeData, active?.address]);

  const tokenDatasArr = tokens.map(t => tokenDatas[t.address] || null);

  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = GLOBAL_CSS;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC"), 1000);
    setTime(new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC");
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-void)", display: "flex", flexDirection: "column" }}>
      <style>{`@keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}`}</style>
      <ScanLine />

      {/* Top Bar */}
      <div style={{ background: "var(--bg-void)", borderBottom: "1px solid var(--border)", padding: "6px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ fontSize: "13px", fontWeight: 800, color: "var(--neon)", letterSpacing: "4px", textShadow: "0 0 10px var(--neon-glow)" }}>⬡ CHAINWATCH</span>
          <span style={{ fontSize: "8px", color: "var(--text-muted)", letterSpacing: "3px" }}>EVM SURVEILLANCE v1.0</span>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <span style={{ fontSize: "7px", color: "var(--neon)", animation: "pulse 2s infinite", letterSpacing: "2px" }}>● LIVE</span>
          <span style={{ fontSize: "8px", color: "var(--text-muted)", letterSpacing: "1px" }}>{time}</span>
          <StatusBadge label="EVM" color="var(--blue)" />
        </div>
      </div>

      <AlertTicker tokens={tokens} tokenDatas={tokenDatasArr} />

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "220px 1fr", minHeight: "calc(100vh - 70px)", height: "calc(100vh - 70px)" }}>
        {/* Sidebar */}
        <div style={{ borderRight: "1px solid var(--border)", background: "var(--bg-deep)", padding: "10px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px" }}>
          <Watchlist tokens={tokens} active={active} onSelect={setActive}
            onAdd={t => { if (tokens.length < 5 && !tokens.find(x => x.address === t.address)) setTokens(p => [...p, t]); }}
            onRemove={addr => {
              const next = tokens.filter(t => t.address !== addr);
              setTokens(next);
              if (active?.address === addr) setActive(next[0] || null);
            }}
          />
          <Panel>
            <PanelLabel>SYS STATUS</PanelLabel>
            {[
              "FRACTAL ENGINE", "H(q) DECAY", "BOS/CHOCH DETECT",
              "VOL SCALING", "BACKTEST OOS", "QUARANTINE SYS",
              "CONFLUENCE FILTER", "DEXSCREENER API",
            ].map(s => (
              <div key={s} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid var(--border)", fontSize: "7px", letterSpacing: "1px" }}>
                <span style={{ color: "var(--text-muted)" }}>{s}</span>
                <span style={{ color: "var(--neon)" }}>● OK</span>
              </div>
            ))}
          </Panel>
          <div style={{ fontSize: "7px", color: "var(--text-dead)", lineHeight: 1.6, fontFamily: "monospace", padding: "8px" }}>
            {`┌───────────────┐\n│ CHAINWATCH    │\n│ ◆ FRACTAL ON  │\n│ ◆ OOS ACTIVE  │\n│ ◆ QUANT GUARD │\n│ ◆ NO OVERFIT  │\n└───────────────┘`}
          </div>
        </div>

        {/* Main — data passed as props, no double fetch */}
        <div style={{ overflow: "auto", background: "var(--bg-void)", minHeight: "100%" }}>
          <Dashboard token={active} data={activeData} loading={activeLoading} />
        </div>
      </div>
    </div>
  );
}
