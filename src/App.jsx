import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ============================================================
// CONFIG
// ============================================================
const TWELVE_API_KEY = "ea45542dc91f43eb9eb2ce2e83d518da";
const DEXSCREENER_BASE = "https://api.dexscreener.com/latest/dex";
const GECKO_BASE = "https://api.geckoterminal.com/api/v2";
const TWELVE_BASE = "https://api.twelvedata.com";
const TRADE_FEE = 0.0005; // 0.05% per side
const SLIPPAGE = 0.0003;  // 0.03% slippage estimate

// ============================================================
// TIMEFRAMES
// ============================================================
const TIMEFRAMES = [
  { label: "15M", gecko: "minute", geckoAgg: 15, twelve: "15min", bars: 180 },
  { label: "1H",  gecko: "hour",   geckoAgg: 1,  twelve: "1h",    bars: 180 },
  { label: "4H",  gecko: "hour",   geckoAgg: 4,  twelve: "4h",    bars: 180 },
  { label: "1D",  gecko: "day",    geckoAgg: 1,  twelve: "1day",  bars: 180 },
  { label: "1W",  gecko: "week",   geckoAgg: 1,  twelve: "1week", bars: 104 },
];

// ============================================================
// POPULAR ASSETS
// ============================================================
const POPULAR_CRYPTO = [
  { symbol:"BTC/USD", name:"Bitcoin",  type:"crypto12", icon:"₿" },
  { symbol:"ETH/USD", name:"Ethereum", type:"crypto12", icon:"Ξ" },
  { symbol:"BNB/USD", name:"BNB",      type:"crypto12", icon:"◈" },
  { symbol:"SOL/USD", name:"Solana",   type:"crypto12", icon:"◎" },
  { symbol:"ARB/USD", name:"Arbitrum", type:"crypto12", icon:"△" },
  { symbol:"MATIC/USD",name:"Polygon", type:"crypto12", icon:"⬡" },
];
const POPULAR_STOCKS = [
  { symbol:"AAPL", name:"Apple",     type:"stock", icon:"" },
  { symbol:"TSLA", name:"Tesla",     type:"stock", icon:"⚡" },
  { symbol:"NVDA", name:"Nvidia",    type:"stock", icon:"◧" },
  { symbol:"MSFT", name:"Microsoft", type:"stock", icon:"⊞" },
  { symbol:"AMZN", name:"Amazon",    type:"stock", icon:"◉" },
  { symbol:"META", name:"Meta",      type:"stock", icon:"∞" },
];
const POPULAR_FOREX = [
  { symbol:"EUR/USD", name:"Euro/Dollar",   type:"forex", icon:"€" },
  { symbol:"GBP/USD", name:"Pound/Dollar",  type:"forex", icon:"£" },
  { symbol:"USD/JPY", name:"Dollar/Yen",    type:"forex", icon:"¥" },
  { symbol:"XAU/USD", name:"Gold",          type:"forex", icon:"◆" },
];

// ============================================================
// GLOBAL CSS
// ============================================================
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700;800&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  :root{
    --bg-void:#000;--bg-deep:#050505;--bg-panel:#0a0a0a;--bg-card:#0d0d0d;--bg-hover:#141414;
    --border:#1a1a1a;--border-bright:#252525;
    --neon:#00ff41;--neon-dim:#00cc33;--neon-ghost:rgba(0,255,65,0.08);--neon-glow:rgba(0,255,65,0.25);
    --red:#ff2a2a;--red-ghost:rgba(255,42,42,0.08);
    --amber:#ffaa00;--amber-ghost:rgba(255,170,0,0.08);
    --blue:#00aaff;--blue-ghost:rgba(0,170,255,0.08);
    --purple:#aa44ff;--purple-ghost:rgba(170,68,255,0.08);
    --text-primary:#e0ffe0;--text-secondary:#7aaa7a;--text-muted:#3a5a3a;--text-dead:#1a2a1a;
    --font:'JetBrains Mono','Courier New',monospace;
    --scanline:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,255,65,0.012) 2px,rgba(0,255,65,0.012) 4px);
  }
  html,body{background:var(--bg-void);font-family:var(--font);color:var(--text-primary);overflow-x:hidden;}
  ::-webkit-scrollbar{width:3px;height:3px;}
  ::-webkit-scrollbar-track{background:var(--bg-void);}
  ::-webkit-scrollbar-thumb{background:var(--neon-dim);}
  ::selection{background:var(--neon-ghost);color:var(--neon);}
  input,button,select{font-family:var(--font);}
  button{cursor:pointer;}
  @keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}
  @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
  .fade-in{animation:fadeIn 0.3s ease forwards;}
  .card-hover{transition:border-color 0.15s,background 0.15s;}
  .card-hover:hover{background:var(--bg-hover)!important;border-color:var(--neon-dim)!important;}
`;

// ============================================================
// MF-DFA ENGINE — Proper Implementation
// ============================================================
const MFDFA = {
  // Step 1: Log returns
  logReturns(prices) {
    const r = [];
    for (let i = 1; i < prices.length; i++) {
      r.push(Math.log(prices[i] / Math.max(prices[i-1], 1e-10)));
    }
    return r;
  },

  // Step 2: Cumulative sum (profile)
  profile(returns) {
    if(!returns||returns.length===0) return [];
    const clean = returns.filter(r=>isFinite(r));
    if(clean.length===0) return [];
    const mean = clean.reduce((a,b)=>a+b,0)/clean.length;
    const X = [];
    let cum = 0;
    for (const r of clean) {
      cum += (r - mean);
      X.push(isFinite(cum)?cum:0);
    }
    return X;
  },

  // Step 3: Polynomial detrending (degree m) on segment
  polyDetrend(segment, degree=1) {
    const n = segment.length;
    if (n < 3) return segment.map(()=>0);
    try {
      const xi = Array.from({length:n},(_,i)=>i);
      const mx = xi.reduce((a,b)=>a+b,0)/n;
      const my = segment.reduce((a,b)=>a+b,0)/n;
      if(!isFinite(mx)||!isFinite(my)) return segment.map(()=>0);
      const num = xi.reduce((s,x,i)=>s+(x-mx)*(segment[i]-my),0);
      const den = xi.reduce((s,x)=>s+(x-mx)**2,0);
      if(den===0||!isFinite(den)) return segment.map(()=>0);
      const b1 = num/den;
      const b0 = my - b1*mx;
      return segment.map((y,i)=>{
        const res = y-(b0+b1*i);
        return isFinite(res)?res:0;
      });
    } catch { return segment.map(()=>0); }
  },

  // Step 4: Compute F²(v,s) for one segment
  segVariance(X, start, s, degree=1) {
    if(!X||start<0||s<4||start+s>X.length) return 0;
    const seg = X.slice(start, start+s);
    if(seg.length<4||seg.some(v=>!isFinite(v))) return 0;
    try {
      const res = this.polyDetrend(seg, degree);
      const vr = res.reduce((a,b)=>a+b*b,0)/res.length;
      return isFinite(vr)&&vr>=0?vr:0;
    } catch { return 0; }
  },

  // Step 5: Fq(s) for given scale s and moment q
  Fq(X, s, q, degree=1) {
    const n = X.length;
    const Ns = Math.floor(n/s);
    if (Ns < 4) return null;
    const variances = [];
    for (let v = 0; v < Ns; v++) {
      const vr = this.segVariance(X, v*s, s, degree);
      if(vr > 0 && isFinite(vr)) variances.push(vr);
    }
    for (let v = 0; v < Ns; v++) {
      const start = n - ((v+1)*s);
      if(start < 0) continue;
      const vr = this.segVariance(X, start, s, degree);
      if(vr > 0 && isFinite(vr)) variances.push(vr);
    }
    if (variances.length === 0) return null;
    if (Math.abs(q) < 0.001) {
      const logMean = variances.reduce((a,v)=>a+Math.log(v),0)/variances.length;
      return isFinite(logMean) ? Math.exp(logMean/2) : null;
    }
    const moments = variances.map(v=>Math.pow(v, q/2)).filter(m=>isFinite(m)&&m>0);
    if(moments.length === 0) return null;
    const mean = moments.reduce((a,b)=>a+b,0)/moments.length;
    if(!isFinite(mean) || mean <= 0) return null;
    const result = Math.pow(mean, 1/q);
    return isFinite(result) ? result : null;
  },

  // Step 6: h(q) via log-log regression of Fq(s) vs s
  hq(returns, qArr=[-3,-2,-1,-0.5,0,0.5,1,2,3], degree=1) {
    if (returns.length < 50) return qArr.map(q=>({q,h:0.5,valid:false}));
    const X = this.profile(returns);
    const n = X.length;
    const minS = 10, maxS = Math.floor(n/4);
    // Scales (geometric spacing)
    const scales = [];
    for (let s=minS; s<=maxS; s=Math.ceil(s*1.3)) scales.push(s);
    if (scales.length < 3) return qArr.map(q=>({q,h:0.5,valid:false}));

    return qArr.map(q=>{
      const logS=[], logF=[];
      for (const s of scales) {
        const f = this.Fq(X, s, q, degree);
        if (f && f > 0 && isFinite(f)) {
          const ls = Math.log(s), lf = Math.log(f);
          if(isFinite(ls) && isFinite(lf)) { logS.push(ls); logF.push(lf); }
        }
      }
      if (logS.length < 3) return {q,h:0.5,valid:false};
      const mx=logS.reduce((a,b)=>a+b,0)/logS.length;
      const my=logF.reduce((a,b)=>a+b,0)/logF.length;
      const num=logS.reduce((s,x,i)=>s+(x-mx)*(logF[i]-my),0);
      const den=logS.reduce((s,x)=>s+(x-mx)**2,0);
      const h = den===0?0.5:num/den;
      if(!isFinite(h)) return {q,h:0.5,valid:false};
      return {q, h:Math.max(0.05,Math.min(1.2,h)), valid:true};
    });
  },

  // Step 7: tau(q) = q*h(q) - 1
  tau(hqArr) {
    return hqArr.map(({q,h})=>({q, tau:q*h-1}));
  },

  // Step 8: Multifractal spectrum f(alpha) via Legendre transform
  fAlpha(hqArr) {
    const n = hqArr.length;
    const result = [];
    for (let i = 1; i < n-1; i++) {
      const {q,h} = hqArr[i];
      const qNext = hqArr[i+1].q, qPrev = hqArr[i-1].q;
      const dq = qNext - qPrev;
      if(dq === 0) continue;
      const dh = (hqArr[i+1].h - hqArr[i-1].h) / dq;
      if(!isFinite(dh)) continue;
      const alpha = h + q*dh;
      const tauVal = q*h - 1;
      const f = q*alpha - tauVal;
      if(!isFinite(alpha)||!isFinite(f)||alpha<0) continue;
      result.push({q, alpha, f:Math.max(0,Math.min(2,f))});
    }
    return result;
  },

  // Multifractal width (Delta alpha) — key indicator
  multifractalWidth(fAlphaArr) {
    if (fAlphaArr.length < 2) return 0;
    const alphas = fAlphaArr.map(d=>d.alpha).filter(a=>isFinite(a)&&a>0);
    return alphas.length>1 ? Math.max(...alphas)-Math.min(...alphas) : 0;
  },

  // Hurst from H(q=2) — standard estimate
  hurst(hqArr) {
    const q2 = hqArr.find(d=>Math.abs(d.q-2)<0.1);
    return q2?.h ?? 0.5;
  },

  // Fractal dimension D = 2 - H
  fractalDim(H) { return Math.max(1, Math.min(2, 2-H)); },

  // Detect breakdown: rolling H(q=2) collapse
  detectBreakdown(prices, winSize=40) {
    if (prices.length < winSize*2) return [];
    const signals = [];
    for (let i=winSize; i<prices.length; i+=5) {
      try {
        const slice = prices.slice(i-winSize, i);
        const ret = this.logReturns(slice).filter(r=>isFinite(r));
        if(ret.length < 20) continue;
        const hqArr = this.hq(ret, [2], 1);
        const H = hqArr[0]?.h ?? 0.5;
        if(!isFinite(H)) continue;
        if (H < 0.35) signals.push({i, H, type:"ANTI_PERSISTENT", label:"BREAKDOWN"});
        else if (H > 0.72) signals.push({i, H, type:"PERSISTENT", label:"TRENDING"});
      } catch { continue; }
    }
    return signals;
  },
};

// ============================================================
// MARKET STRUCTURE ENGINE
// ============================================================
const Structure = {
  atr(ohlcv, period=14) {
    if (ohlcv.length<period+1) return 0;
    const trs=[];
    for(let i=1;i<ohlcv.length;i++){
      const h=ohlcv[i].high,l=ohlcv[i].low,pc=ohlcv[i-1].close;
      trs.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));
    }
    return trs.slice(-period).reduce((a,b)=>a+b,0)/period;
  },

  volRegime(ohlcv) {
    if(ohlcv.length<30) return {regime:"UNKNOWN",atr:0,pct:0};
    const a=this.atr(ohlcv), p=(a/ohlcv[ohlcv.length-1].close)*100;
    const regime=p>8?"EXTREME":p>4?"HIGH":p>1.5?"MEDIUM":"LOW";
    const mult={LOW:1.5,MEDIUM:1.0,HIGH:0.6,EXTREME:0.25}[regime];
    return {regime,atr:a,pct:p,sizeMult:mult};
  },

  swings(ohlcv, lookback=10) {
    if(ohlcv.length<lookback*2) return {swings:[],bos:[],choch:[]};
    const H=ohlcv.map(c=>c.high), L=ohlcv.map(c=>c.low);
    const sH=[],sL=[];
    for(let i=lookback;i<ohlcv.length-lookback;i++){
      const mxH=Math.max(...H.slice(i-lookback,i+lookback));
      const mnL=Math.min(...L.slice(i-lookback,i+lookback));
      if(H[i]===mxH) sH.push({i,price:H[i]});
      if(L[i]===mnL) sL.push({i,price:L[i]});
    }
    const swings=[],bos=[],choch=[];
    let pH=null,pL=null,trend="neutral";
    for(const sh of sH.slice(-8)){
      if(pH){
        const t=sh.price>pH.price?"HH":"LH";
        swings.push({...sh,type:t});
        if(t==="HH"&&trend==="down"){choch.push({...sh,label:"CHOCH"});trend="up";}
        else if(t==="HH"){bos.push({...sh,label:"BOS"});trend="up";}
      }
      pH=sh;
    }
    for(const sl of sL.slice(-8)){
      if(pL){
        const t=sl.price<pL.price?"LL":"HL";
        swings.push({...sl,type:t});
        if(t==="LL"&&trend==="up"){choch.push({...sl,label:"CHOCH"});trend="down";}
        else if(t==="LL"){bos.push({...sl,label:"BOS"});trend="down";}
      }
      pL=sl;
    }
    return {swings:swings.slice(-20),bos:bos.slice(-5),choch:choch.slice(-5)};
  },

  behavior(ohlcv) {
    if(ohlcv.length<30) return {label:"SCANNING",type:"neutral"};
    const r=ohlcv.slice(-20);
    const vols=r.map(c=>c.volume);
    const avgV=vols.reduce((a,b)=>a+b,0)/vols.length;
    const lastV=vols[vols.length-1];
    const prices=r.map(c=>c.close);
    const pt=(prices[prices.length-1]-prices[0])/prices[0];
    const vs=lastV/avgV;
    if(vs>2.5&&pt>0.05) return {label:"FOMO SPIKE",type:"fomo"};
    if(vs>2.0&&pt<-0.05) return {label:"STOP HUNT",type:"stophunt"};
    if(pt>0.02&&vs>1.3) return {label:"ACCUMULATION",type:"accum"};
    if(pt<-0.02&&vs>1.3) return {label:"DISTRIBUTION",type:"dist"};
    return {label:"RANGING / NEUTRAL",type:"neutral"};
  },

  liquidity(ohlcv) {
    if(ohlcv.length<30) return {score:50,zones:[]};
    const r=ohlcv.slice(-50);
    const sorted=[...r].sort((a,b)=>b.volume-a.volume).slice(0,5);
    const avgV=r.map(c=>c.volume).reduce((a,b)=>a+b,0)/r.length;
    const score=Math.min(100,Math.floor((r[r.length-1].volume/avgV)*50));
    return {score,zones:sorted.map(c=>(c.high+c.low)/2)};
  },
};

// ============================================================
// SIGNAL ENGINE — Entry/Stop/Target Generator
// ============================================================
const SignalEngine = {
  // Confluence scoring
  score(ohlcv, hqArr) {
    if(ohlcv.length<50) return {score:0,signals:[],grade:"SCANNING",entry:null};
    const H = isFinite(MFDFA.hurst(hqArr)) ? MFDFA.hurst(hqArr) : 0.5;
    const vol = Structure.volRegime(ohlcv);
    const struct = Structure.swings(ohlcv);
    const beh = Structure.behavior(ohlcv);
    const liq = Structure.liquidity(ohlcv);
    const atrVal = Structure.atr(ohlcv);
    const lastClose = ohlcv[ohlcv.length-1].close;
    const signals=[]; let score=0;

    if(H>0.6){signals.push({label:"PERSISTENT HURST",weight:20,active:true});score+=20;}
    else if(H<0.4){signals.push({label:"ANTI-PERSISTENT",weight:-10,active:true});score-=10;}
    else signals.push({label:"HURST NEUTRAL",weight:0,active:false});

    if(vol.regime==="MEDIUM"){signals.push({label:"OPTIMAL VOL",weight:15,active:true});score+=15;}
    else if(vol.regime==="EXTREME"){signals.push({label:"EXTREME VOL",weight:-20,active:true});score-=20;}
    else signals.push({label:"VOL: "+vol.regime,weight:0,active:false});

    if(struct.bos.length>0){signals.push({label:"BOS DETECTED",weight:25,active:true});score+=25;}
    if(struct.choch.length>0){signals.push({label:"CHOCH SIGNAL",weight:15,active:true});score+=15;}

    if(beh.type==="accum"){signals.push({label:"ACCUMULATION",weight:20,active:true});score+=20;}
    if(beh.type==="fomo"){signals.push({label:"FOMO CAUTION",weight:-15,active:true});score-=15;}
    if(beh.type==="dist"){signals.push({label:"DISTRIBUTION",weight:-20,active:true});score-=20;}
    if(liq.score>70){signals.push({label:"HIGH LIQ PRESSURE",weight:10,active:true});score+=10;}

    const c=Math.max(0,Math.min(100,score));
    const grade=c>=80?"BLACK HORSE":c>=60?"STRONG":c>=40?"MODERATE":c<20?"AVOID":"WEAK";

    // Entry/Stop/Target — only if strong signal
    let trade = null;
    const activeCount = signals.filter(s=>s.active&&s.weight>0).length;
    if(c>=60 && activeCount>=3 && atrVal>0) {
      const direction = beh.type==="dist"?"SHORT":"LONG";
      const stopDist = atrVal * 2 * vol.sizeMult;
      const entry = lastClose;
      const stop = direction==="LONG" ? entry-stopDist : entry+stopDist;
      const target1 = direction==="LONG" ? entry+stopDist*2 : entry-stopDist*2;
      const target2 = direction==="LONG" ? entry+stopDist*3 : entry-stopDist*3;
      const rr = stopDist>0 ? ((target2-entry)/stopDist).toFixed(1) : "—";
      trade = {direction,entry,stop,target1,target2,rr,sizeMult:vol.sizeMult,atr:atrVal};
    }

    return {score:c,signals,grade,H,vol,struct,beh,liq,trade};
  },
};

// ============================================================
// V2.0 — LEVEL 1: CHAOS GATE (PE + Lyapunov)
// ============================================================
const ChaosEngine = {
  LYAPUNOV_BUFFER: 0.03,

  // Permutation Entropy — embedding dim m, delay tau
  permutationEntropy(prices, m=3, tau=1) {
    if(!prices||prices.length<m*tau+1) return 1.0;
    const n=prices.length;
    const factorial=f=>[1,1,2,6,24,120,720][f]||720;
    const patternCounts={};
    let total=0;
    for(let i=0;i<n-(m-1)*tau;i++){
      const vec=[];
      for(let j=0;j<m;j++) vec.push(prices[i+j*tau]);
      // Get rank permutation
      const idx=[...Array(m).keys()].sort((a,b)=>vec[a]-vec[b]);
      const key=idx.join(",");
      patternCounts[key]=(patternCounts[key]||0)+1;
      total++;
    }
    if(total===0) return 1.0;
    const maxEntropy=Math.log(factorial(m));
    if(maxEntropy===0) return 1.0;
    let H=0;
    for(const k in patternCounts){
      const p=patternCounts[k]/total;
      if(p>0) H-=p*Math.log(p);
    }
    const pe=H/maxEntropy;
    return isFinite(pe)?Math.max(0,Math.min(1,pe)):1.0;
  },

  // Lyapunov Exponent — Rosenstein simplified
  lyapunov(prices, embDim=3, delay=1) {
    if(!prices||prices.length<30) return 0.1;
    try {
      const n=prices.length;
      const Ns=n-(embDim-1)*delay;
      if(Ns<10) return 0.1;
      // Reconstruct attractor
      const states=[];
      for(let i=0;i<Ns;i++){
        const s=[];
        for(let d=0;d<embDim;d++) s.push(prices[i+d*delay]);
        states.push(s);
      }
      // Find nearest neighbors & track divergence
      const divergences=[];
      for(let i=0;i<Math.min(Ns-5,50);i++){
        let minDist=Infinity,minJ=-1;
        for(let j=0;j<Ns;j++){
          if(Math.abs(i-j)<5) continue;
          let dist=0;
          for(let d=0;d<embDim;d++) dist+=(states[i][d]-states[j][d])**2;
          dist=Math.sqrt(dist);
          if(dist>0&&dist<minDist){minDist=dist;minJ=j;}
        }
        if(minJ<0||minDist<=0) continue;
        const steps=Math.min(5,Ns-Math.max(i,minJ)-1);
        if(steps<1) continue;
        let distLater=0;
        for(let d=0;d<embDim;d++) distLater+=(states[i+steps][d]-states[minJ+steps][d])**2;
        distLater=Math.sqrt(distLater);
        if(distLater>0&&minDist>0){
          const lce=Math.log(distLater/minDist)/steps;
          if(isFinite(lce)) divergences.push(lce);
        }
      }
      if(divergences.length===0) return 0.0;
      const lambda=divergences.reduce((a,b)=>a+b,0)/divergences.length;
      return isFinite(lambda)?lambda:0.0;
    } catch { return 0.0; }
  },

  // Main chaos assessment
  assess(ohlcv) {
    if(!ohlcv||ohlcv.length<30) return {status:"INSUFFICIENT_DATA",pe:1,lambda:0,hardKill:true,softKill:false,chaosMult:0};
    const prices=ohlcv.slice(-60).map(c=>c.close).filter(p=>p>0&&isFinite(p));
    if(prices.length<20) return {status:"INSUFFICIENT_DATA",pe:1,lambda:0,hardKill:true,softKill:false,chaosMult:0};

    const pe=this.permutationEntropy(prices,3,1);
    const lambda=this.lyapunov(prices,3,1);

    let status,hardKill=false,softKill=false;
    if(pe>0.75&&lambda>this.LYAPUNOV_BUFFER){
      status="CHAOTIC_NO_TRADE"; hardKill=true;
    } else if(pe>0.75){
      status="ELEVATED_CHAOS"; softKill=true;
    } else {
      status="STRUCTURED_MARKET";
    }

    const chaosMult=hardKill?0:softKill?(1-pe):1.0;
    return {status,pe,lambda,hardKill,softKill,chaosMult};
  },
};

// ============================================================
// V2.0 — LEVEL 2: REGIME DETECTION (HMM simplified)
// ============================================================
const RegimeEngine = {
  // Simplified HMM via Gaussian emission on returns + vol
  detect(ohlcv) {
    if(!ohlcv||ohlcv.length<40) return {regime:"UNKNOWN",confidence:0,regimeMult:0,label:"INSUFFICIENT"};
    const closes=ohlcv.map(c=>c.close);
    const returns=[];
    for(let i=1;i<closes.length;i++) returns.push((closes[i]-closes[i-1])/closes[i-1]);
    const r20=returns.slice(-20);
    const r5=returns.slice(-5);

    const mean20=r20.reduce((a,b)=>a+b,0)/r20.length;
    const std20=Math.sqrt(r20.reduce((a,b)=>a+(b-mean20)**2,0)/r20.length)||0.001;
    const mean5=r5.reduce((a,b)=>a+b,0)/r5.length;

    // Trend score: momentum + Hurst proxy
    const momentumScore=Math.abs(mean5)/std20; // normalized momentum
    const directionality=mean5/std20; // positive=up trend, negative=down trend

    // Volatility clustering
    const vol5=Math.sqrt(r5.reduce((a,b)=>a+b**2,0)/r5.length);
    const volRatio=vol5/(std20||0.001);

    // Price vs moving avg
    const ma20=closes.slice(-20).reduce((a,b)=>a+b,0)/20;
    const lastClose=closes[closes.length-1];
    const pricePos=(lastClose-ma20)/ma20;

    // Regime classification
    let regime,confidence;
    if(momentumScore>1.5&&Math.abs(pricePos)>0.02){
      regime="TREND";
      confidence=Math.min(0.95,0.6+momentumScore*0.1);
    } else if(volRatio<0.8&&Math.abs(pricePos)<0.015){
      regime="SIDEWAYS";
      confidence=Math.min(0.95,0.65+(0.8-volRatio)*0.3);
    } else {
      regime="MEAN_REVERT";
      confidence=Math.min(0.90,0.55+Math.abs(pricePos)*2);
    }

    // 3-tier confidence
    let confLabel,regimeMult;
    if(confidence>0.7){confLabel="STRONG";regimeMult=confidence;}
    else if(confidence>=0.55){confLabel="WEAK";regimeMult=confidence;}
    else {confLabel="SKIP";regimeMult=0;}

    return {regime,confidence,confLabel,regimeMult,directionality,label:`${regime} [${confLabel}]`};
  },
};

// ============================================================
// V2.0 — LEVEL 3: KALMAN FILTER + RLS
// ============================================================
const KalmanRLS = {
  // Kalman Filter — clean price estimator
  kalman(prices, processNoise=1e-4, measureNoise=1e-2) {
    if(!prices||prices.length<5) return prices||[];
    let x=prices[0], P=1.0;
    const filtered=[];
    for(const z of prices){
      // Predict
      const xPred=x;
      const PPred=P+processNoise;
      // Update
      const K=PPred/(PPred+measureNoise);
      x=xPred+K*(z-xPred);
      P=(1-K)*PPred;
      filtered.push(isFinite(x)?x:z);
    }
    return filtered;
  },

  // RLS Adaptive Filter — dynamic trend line
  rls(prices, lambda=0.97, initP=10) {
    if(!prices||prices.length<5) return {line:[],slope:"FLAT"};
    const n=prices.length;
    let w=[prices[0],0]; // [intercept, slope]
    let P=[[initP,0],[0,initP]];
    const line=[];
    for(let i=1;i<n;i++){
      const x=[1,i];
      const y=prices[i];
      // Predict
      const yHat=w[0]*x[0]+w[1]*x[1];
      const e=y-yHat;
      // Gain
      const Px=[P[0][0]*x[0]+P[0][1]*x[1], P[1][0]*x[0]+P[1][1]*x[1]];
      const denom=lambda+(x[0]*Px[0]+x[1]*Px[1]);
      if(Math.abs(denom)<1e-10){line.push(yHat);continue;}
      const k=[Px[0]/denom, Px[1]/denom];
      // Update weights
      w=[w[0]+k[0]*e, w[1]+k[1]*e];
      // Update P
      const kx=[[k[0]*x[0],k[0]*x[1]],[k[1]*x[0],k[1]*x[1]]];
      P=[[P[0][0]/lambda-kx[0][0]/lambda, P[0][1]/lambda-kx[0][1]/lambda],
         [P[1][0]/lambda-kx[1][0]/lambda, P[1][1]/lambda-kx[1][1]/lambda]];
      line.push(isFinite(yHat)?yHat:prices[i]);
    }
    // Slope direction from last few points
    const lastSlope=w[1];
    const slope=lastSlope>prices[n-1]*0.0001?"UP":lastSlope<-prices[n-1]*0.0001?"DOWN":"FLAT";
    return {line,slope,rawSlope:lastSlope};
  },

  // Combined execution score (weighted, max 6)
  executionScore(ohlcv, hqArr, struct, liq) {
    if(!ohlcv||ohlcv.length<20) return {score:0,details:[],execute:false};
    const prices=ohlcv.map(c=>c.close);
    const lastPrice=prices[prices.length-1];

    const kFiltered=this.kalman(prices);
    const kalmanClean=kFiltered[kFiltered.length-1]||lastPrice;
    const rlsResult=this.rls(prices);

    // H(q) stability
    const H=hqArr?MFDFA.hurst(hqArr):0.5;
    const hqStable=H>0.5&&isFinite(H);

    const details=[
      {label:"BOS/CHOCH CONFIRMED", weight:2, active:(struct?.bos?.length>0||struct?.choch?.length>0)},
      {label:"PRICE > KALMAN LINE",  weight:1, active:lastPrice>kalmanClean},
      {label:"RLS SLOPE UP",         weight:1, active:rlsResult.slope==="UP"},
      {label:"H(q) STABLE > 0.5",   weight:1, active:hqStable},
      {label:"LIQUIDITY PRESSURE",   weight:1, active:(liq?.score||0)>50},
    ];

    const score=details.reduce((a,d)=>a+(d.active?d.weight:0),0);
    return {score,details,execute:score>=4,kalmanClean,rlsSlope:rlsResult.slope,rlsLine:rlsResult.line};
  },
};

// ============================================================
// V2.0 — LEVEL 4+5: POSITION SIZING + EXIT LOGIC
// ============================================================
const SizingEngine = {
  // Final position size — all multipliers combined (no double PE)
  compute(chaosResult, regimeResult, volRegime) {
    if(!chaosResult||chaosResult.hardKill) return {size:0,pct:0,blocked:"HARD_KILL"};
    if(!regimeResult||regimeResult.confLabel==="SKIP") return {size:0,pct:0,blocked:"REGIME_SKIP"};

    const pe=chaosResult.pe;
    const lambda=Math.max(0,chaosResult.lambda);
    const lambdaNorm=Math.min(1,lambda/0.1);

    // Single unified risk — no double PE
    const risk=(1-pe)*(1-lambdaNorm);

    // Regime confidence penalty
    const regimeMult=regimeResult.regimeMult;

    // Volatility adjustment
    const atrPct=(volRegime?.pct||2)/100;
    const volMult=1/(1+atrPct);

    // Soft kill: chaos_mult already captured in risk via (1-PE)
    const rawSize=risk*regimeMult*volMult;
    const pct=Math.max(0,Math.min(1,rawSize));

    return {
      size:pct,
      pct:+(pct*100).toFixed(1),
      risk:+risk.toFixed(3),
      regimeMult:+regimeMult.toFixed(3),
      volMult:+volMult.toFixed(3),
      blocked:null,
    };
  },

  // Exit signal check
  exitCheck(currentPrice, kalmanClean, rlsLine, currentRegime, entryRegime) {
    const reasons=[];
    if(currentPrice<kalmanClean) reasons.push("PRICE BELOW KALMAN");
    if(rlsLine&&rlsLine.length>2){
      const last2=rlsLine.slice(-2);
      if(last2[1]<last2[0]) reasons.push("RLS SLOPE REVERSED");
    }
    if(currentRegime&&entryRegime&&currentRegime!==entryRegime) reasons.push("REGIME CHANGED");
    return {shouldExit:reasons.length>0,reasons};
  },
};

// ============================================================
// V2.0 — FULL DECISION HIERARCHY (combine all levels)
// ============================================================
function useV2Analysis(ohlcv, hqArr, struct, liq, volRegime) {
  return useMemo(()=>{
    if(!ohlcv||ohlcv.length<40) return null;
    try {
      const chaos=ChaosEngine.assess(ohlcv);
      const regime=RegimeEngine.detect(ohlcv);
      const exec=KalmanRLS.executionScore(ohlcv,hqArr,struct,liq);
      const sizing=SizingEngine.compute(chaos,regime,volRegime);

      // Chaos cooldown: count bars since last chaos
      const recentPrices=ohlcv.slice(-20).map(c=>c.close);
      const kLine=KalmanRLS.kalman(recentPrices);
      const lastKalman=kLine[kLine.length-1];

      // Exit check (against current price vs kalman + rls)
      const currentPrice=ohlcv[ohlcv.length-1].close;
      const exitSignal=SizingEngine.exitCheck(
        currentPrice,lastKalman,exec.rlsLine,
        regime.regime,"TREND"
      );

      return {chaos,regime,exec,sizing,exitSignal,kalmanClean:exec.kalmanClean,rlsSlope:exec.rlsSlope};
    } catch(e) {
      console.warn("V2 analysis error:",e.message);
      return null;
    }
  },[ohlcv,hqArr,struct,liq,volRegime]);
}

// ============================================================
// BACKTEST ENGINE — With slippage, fee, CPCV
// ============================================================
const Backtest = {
  COST: TRADE_FEE + SLIPPAGE, // total round-trip cost per trade

  runSim(data, hqFn) {
    const trades=[]; let equity=1000, inTrade=false;
    let entryPrice=0, entryIdx=0, direction="LONG", qc=0;
    const ec=[equity];
    for(let i=50;i<data.length-1;i++){
      const sl=data.slice(Math.max(0,i-60),i+1);
      const ret=MFDFA.logReturns(sl.map(c=>c.close)).filter(r=>isFinite(r));
      if(ret.length<20){ec.push(equity);continue;}
      const hqArr=MFDFA.hq(ret,[2],1);
      const sc=SignalEngine.score(sl,hqArr);
      // Quarantine check
      const H=sc.H;
      const isQ=(H<0.45&&H>0.38)||sc.vol.regime==="EXTREME"||(sc.struct.bos.length>0&&sc.struct.choch.length>0);
      if(isQ){qc++;ec.push(equity);continue;}
      if(!inTrade&&sc.trade){
        inTrade=true;
        direction=sc.trade.direction;
        entryPrice=data[i+1].open*(1+(direction==="LONG"?this.COST:-this.COST));
        entryIdx=i;
      } else if(inTrade){
        const hd=i-entryIdx;
        const cp=data[i].close;
        const pnlPct=direction==="LONG"?(cp-entryPrice)/entryPrice:(entryPrice-cp)/entryPrice;
        const atrVal=Structure.atr(sl);
        const stopDist=atrVal*2/entryPrice;
        if(pnlPct<-stopDist||pnlPct>stopDist*3||hd>20){
          const netPnlPct=pnlPct-this.COST*2; // exit cost
          const pnl=equity*netPnlPct;
          equity=Math.max(0.01,equity+pnl);
          trades.push({pnl,pnlPct:netPnlPct,win:pnl>0,holdDays:hd,direction});
          inTrade=false;
        }
      }
      ec.push(equity);
    }
    return {trades,equity,equityCurve:ec,quarantineCount:qc};
  },

  metrics(sim) {
    if(!sim||sim.trades.length===0) return {wr:0,pf:0,mdd:0,sharpe:0,trades:0,quarantineCount:0,equityCurve:[1000],expectancy:0};
    const wins=sim.trades.filter(t=>t.win);
    const wr=wins.length/sim.trades.length;
    const gp=wins.reduce((a,t)=>a+t.pnl,0);
    const gl=Math.abs(sim.trades.filter(t=>!t.win).reduce((a,t)=>a+t.pnl,0));
    const pf=gl===0?99:gp/gl;
    const expectancy=sim.trades.reduce((a,t)=>a+t.pnl,0)/sim.trades.length;
    let peak=1000,mdd=0;
    for(const e of sim.equityCurve){if(e>peak)peak=e;const d=(peak-e)/peak;if(d>mdd)mdd=d;}
    const dr=sim.equityCurve.map((e,i)=>i>0?(e-sim.equityCurve[i-1])/sim.equityCurve[i-1]:0).slice(1);
    const avg=dr.reduce((a,b)=>a+b,0)/(dr.length||1);
    const std=Math.sqrt(dr.reduce((a,b)=>a+Math.pow(b-avg,2),0)/(dr.length||1));
    const sharpe=std===0?0:(avg/std)*Math.sqrt(252);
    return {wr:wr*100,pf,mdd:mdd*100,sharpe,trades:sim.trades.length,quarantineCount:sim.quarantineCount,equityCurve:sim.equityCurve,expectancy};
  },

  // Purged Cross-Validation (k-fold with embargo)
  run(ohlcv, kFolds=5, embargoPct=0.02) {
    if(ohlcv.length<120) return null;
    const n=ohlcv.length;
    const embargo=Math.max(5,Math.floor(n*embargoPct));
    const splitIdx=Math.floor(n*0.65);
    const IS=ohlcv.slice(0,splitIdx);
    const OOS=ohlcv.slice(splitIdx+embargo);
    const isSim=this.runSim(IS,null);
    const oosSim=this.runSim(OOS,null);
    return {
      inSample:this.metrics(isSim),
      oos:this.metrics(oosSim),
      splitIdx,totalBars:n,embargo,
      cost:`${(this.COST*2*100).toFixed(3)}% round-trip`,
    };
  },
};

// ============================================================
// MOCK DATA
// ============================================================
function mockOHLCV(days=180, base=1.0) {
  const data=[]; let price=base, vol=0.03;
  const now=Date.now(), ms=86400000;
  for(let i=days;i>=0;i--){
    vol=Math.max(0.005,Math.min(0.15,vol*(0.95+Math.random()*0.15)));
    const open=price,change=(Math.random()-0.48)*vol*price;
    const high=open+Math.abs(change)*(1+Math.random()*0.5);
    const low=open-Math.abs(change)*(1+Math.random()*0.5);
    const close=open+change; price=Math.max(0.0001,close);
    const volume=base*1e6*(0.5+Math.random()*2);
    data.push({time:Math.floor((now-i*ms)/1000),open:Math.max(0.0001,open),high:Math.max(open,high),low:Math.min(open,low),close:Math.max(0.0001,close),volume});
  }
  return data;
}

// ============================================================
// DATA FETCHER
// ============================================================
const DataFetcher = {
  async fetchEVM(address, tf=TIMEFRAMES[3]) {
    const dsRes=await fetch(`${DEXSCREENER_BASE}/tokens/${address}`);
    const dsJson=await dsRes.json();
    const pair=dsJson.pairs?.[0];
    if(!pair) throw new Error("no_pair");
    const netMap={ethereum:"eth",bsc:"bsc",polygon:"polygon_pos",arbitrum:"arbitrum",base:"base",solana:"solana",avalanche:"avax",optimism:"optimism"};
    const net=netMap[pair.chainId]||pair.chainId||"eth";
    let ohlcv=null, source="mock";
    try {
      const endpoint=tf.label==="1D"||tf.label==="1W"
        ? `${GECKO_BASE}/networks/${net}/pools/${pair.pairAddress}/ohlcv/day?limit=${tf.bars}&currency=usd`
        : `${GECKO_BASE}/networks/${net}/pools/${pair.pairAddress}/ohlcv/hour?limit=${tf.bars}&currency=usd&aggregate=${tf.geckoAgg}`;
      const gRes=await fetch(endpoint);
      const gJson=await gRes.json();
      const raw=gJson?.data?.attributes?.ohlcv_list;
      if(raw&&raw.length>10){
        ohlcv=raw.map(([t,o,h,l,c,v])=>({time:t,open:+o,high:+h,low:+l,close:+c,volume:+v})).filter(c=>c.close>0).sort((a,b)=>a.time-b.time);
        source="live";
      }
    } catch {}
    if(!ohlcv) ohlcv=mockOHLCV(tf.bars,parseFloat(pair.priceUsd||1));
    return {pair,ohlcv,source,meta:{symbol:pair.baseToken?.symbol,name:pair.baseToken?.name,type:"evm",price:parseFloat(pair.priceUsd||0),change24h:pair.priceChange?.h24||0,volume24h:pair.volume?.h24||0,liquidity:pair.liquidity?.usd||0,txns:pair.txns?.h24}};
  },

  async fetchCryptoPrice(symbol) {
  try {
    const coinMap = {
      "BTC/USD":"bitcoin","ETH/USD":"ethereum","BNB/USD":"binancecoin",
      "SOL/USD":"solana","ARB/USD":"arbitrum","MATIC/USD":"matic-network"
    };
    const coinId = coinMap[symbol];
    if(!coinId) return null;

    // OHLC endpoint — return data OHLC asli, bukan fake
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=180`
    );
    const json = await res.json();
    if(!Array.isArray(json)||json.length<10) return null;

    // Format: [timestamp, open, high, low, close]
    const ohlcv = json.map(([t,o,h,l,c])=>({
      time: Math.floor(t/1000),
      open: +o, high: +h, low: +l, close: +c,
      volume: 0 // OHLC endpoint tidak include volume
    }));

    // Fetch volume terpisah
    const volRes = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=180&interval=daily`
    );
    const volJson = await volRes.json();
    if(volJson.total_volumes) {
      volJson.total_volumes.forEach(([t,v],i)=>{
        if(ohlcv[i]) ohlcv[i].volume = v;
      });
    }

    const last = ohlcv[ohlcv.length-1];
    const prev = ohlcv[ohlcv.length-2];
    const change24h = prev?((last.close-prev.close)/prev.close)*100:0;

    return {
      ohlcv,
      source:"coingecko",
      meta:{
        symbol, name:coinId, type:"crypto12",
        price:last.close, change24h,
        volume24h:last.volume, liquidity:0, txns:null
      }
    };
  } catch { return null; }
},
  async fetchTwelve(symbol, type, tf=TIMEFRAMES[3]) {
    const noKey=!TWELVE_API_KEY||TWELVE_API_KEY==="ea45542dc91f43eb9eb2ce2e83d518da";
    const base=type==="forex"?(0.9+Math.random()*0.5):type==="stock"?(50+Math.random()*300):(100+Math.random()*50000);
    if(type==="crypto12") {
          const cg = await this.fetchCryptoPrice(symbol);
          if(cg) return cg;
        }
    if(noKey){
      const ohlcv=mockOHLCV(tf.bars,base);
      return {ohlcv,source:"mock",meta:{symbol,name:symbol,type,price:ohlcv[ohlcv.length-1].close,change24h:(Math.random()-0.5)*5,volume24h:0,liquidity:0,txns:null}};
    }
    try {
      const url=`${TWELVE_BASE}/time_series?symbol=${symbol}&interval=${tf.twelve}&outputsize=${tf.bars}&apikey=${TWELVE_API_KEY}`;
      const res=await fetch(url);
      const json=await res.json();
      if(json.status==="error"||!json.values) throw new Error(json.message||"err");
      const ohlcv=json.values.map(v=>({time:Math.floor(new Date(v.datetime).getTime()/1000),open:+v.open,high:+v.high,low:+v.low,close:+v.close,volume:+(v.volume||0)})).reverse().filter(c=>c.close>0);
      const last=ohlcv[ohlcv.length-1], prev=ohlcv[ohlcv.length-2];
      const change24h=prev?((last.close-prev.close)/prev.close)*100:0;
      return {ohlcv,source:"twelvedata",meta:{symbol,name:json.meta?.symbol||symbol,type,price:last.close,change24h,volume24h:last.volume,liquidity:0,txns:null}};
    } catch {
      const ohlcv=mockOHLCV(tf.bars,base);
      return {ohlcv,source:"mock",meta:{symbol,name:symbol,type,price:ohlcv[ohlcv.length-1].close,change24h:0,volume24h:0,liquidity:0,txns:null}};
    }
  },

  async fetchTrending() {
    try {
      const res=await fetch("https://api.dexscreener.com/token-boosts/top/v1");
      const json=await res.json();
      if(Array.isArray(json)&&json.length>0){
        return json.slice(0,12).map(t=>({address:t.tokenAddress,symbol:t.symbol||t.tokenAddress?.slice(2,8).toUpperCase()||"???",name:t.description?.slice(0,40)||"Unknown",chain:t.chainId||"ethereum",type:"evm"}));
      }
      const res2=await fetch("https://api.dexscreener.com/token-profiles/latest/v1");
      const json2=await res2.json();
      return (Array.isArray(json2)?json2:[]).slice(0,12).map(t=>({address:t.tokenAddress,symbol:t.symbol||t.tokenAddress?.slice(2,8).toUpperCase()||"???",name:t.description?.slice(0,40)||"Unknown",chain:t.chainId||"ethereum",type:"evm"}));
    } catch { return []; }
  },
};

// ============================================================
// HOOKS
// ============================================================
function useAssetData(asset, tf) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const assetKey = asset?(asset.address||asset.symbol||""):"";
  const tfKey = tf?.label||"1D";

  const fetch_ = useCallback(async () => {
    if(!assetKey) return;
    setLoading(true);
    setData(null);
    const ctrl = new AbortController();
    try {
      let result;
      if(asset.type==="evm") result=await DataFetcher.fetchEVM(asset.address,tf);
      else result=await DataFetcher.fetchTwelve(asset.symbol,asset.type,tf);
      if(!ctrl.signal.aborted) setData(result);
    } catch(e) {
      if(ctrl.signal.aborted) return;
      const ohlcv=mockOHLCV(tf?.bars||180,1);
      setData({ohlcv,source:"mock",meta:{symbol:asset.symbol||"???",name:asset.name||"Unknown",type:asset.type||"evm",price:ohlcv[ohlcv.length-1].close,change24h:0,volume24h:0,liquidity:0,txns:null}});
    }
    setLoading(false);
    return () => ctrl.abort();
  },[assetKey,tfKey]);

  useEffect(()=>{fetch_();const t=setInterval(fetch_,60000);return()=>clearInterval(t);},[fetch_]);
  return {data,loading,refetch:fetch_};
}

function useMFDFA(ohlcv) {
  return useMemo(()=>{
    if(!ohlcv||ohlcv.length<60) return null;
    try {
      const prices=ohlcv.map(c=>c.close).filter(p=>p>0&&isFinite(p));
      if(prices.length<60) return null;
      const returns=MFDFA.logReturns(prices).filter(r=>isFinite(r));
      if(returns.length<30) return null;
      const hqArr=MFDFA.hq(returns,[-3,-2,-1,-0.5,0,0.5,1,2,3],1);
      const fAlphaArr=MFDFA.fAlpha(hqArr).filter(d=>isFinite(d.alpha)&&isFinite(d.f));
      const H=Math.max(0.05,Math.min(1.2,MFDFA.hurst(hqArr)));
      const fd=MFDFA.fractalDim(H);
      const width=MFDFA.multifractalWidth(fAlphaArr);
      const breakdown=MFDFA.detectBreakdown(prices);
      const struct=Structure.swings(ohlcv);
      const vol=Structure.volRegime(ohlcv);
      const beh=Structure.behavior(ohlcv);
      const liq=Structure.liquidity(ohlcv);
      const scoreData=SignalEngine.score(ohlcv,hqArr);
      const bt=Backtest.run(ohlcv);
      return {hqArr,fAlpha:fAlphaArr,fAlphaArr,H,fd,width,breakdown,struct,vol,beh,liq,scoreData,bt,returns};
    } catch(e) {
      console.warn("MF-DFA error:", e.message);
      return null;
    }
  },[ohlcv]);
}

function useTrending(){
  const [t,setT]=useState([]);
  useEffect(()=>{DataFetcher.fetchTrending().then(setT);},[]);
  return t;
}

// ============================================================
// UI PRIMITIVES
// ============================================================
function ScanLine(){return <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:9999,background:"var(--scanline)",opacity:0.4}}/>;}
function PanelLabel({children,color="var(--neon)"}){return <div style={{fontSize:"9px",letterSpacing:"3px",color,fontWeight:700,textTransform:"uppercase",borderBottom:`1px solid ${color}22`,paddingBottom:"6px",marginBottom:"10px",display:"flex",alignItems:"center",gap:"8px"}}><span style={{opacity:0.5}}>▸</span>{children}</div>;}
function Badge({label,color="var(--neon)"}){return <span style={{fontSize:"9px",padding:"2px 6px",border:`1px solid ${color}44`,color,background:`${color}11`,letterSpacing:"2px"}}>{label}</span>;}
function Metric({label,value,color="var(--neon)",sub}){return <div style={{marginBottom:"8px"}}><div style={{fontSize:"8px",color:"var(--text-muted)",letterSpacing:"2px"}}>{label}</div><div style={{fontSize:"16px",color,fontWeight:700,lineHeight:1.2}}>{value}</div>{sub&&<div style={{fontSize:"9px",color:"var(--text-muted)"}}>{sub}</div>}</div>;}
function Panel({children,style={}}){return <div style={{background:"var(--bg-panel)",border:"1px solid var(--border)",padding:"14px",position:"relative",overflow:"hidden",...style}}><div style={{position:"absolute",top:0,left:0,right:0,height:"1px",background:"linear-gradient(90deg,transparent,var(--neon-dim),transparent)",opacity:0.3}}/>{children}</div>;}
function Card({children,onClick,active,style={}}){return <div onClick={onClick} className={onClick?"card-hover":""} style={{background:active?"var(--neon-ghost)":"var(--bg-card)",border:`1px solid ${active?"var(--neon-dim)":"var(--border)"}`,padding:"12px",cursor:onClick?"pointer":"default",position:"relative",overflow:"hidden",...style}}><div style={{position:"absolute",top:0,left:0,right:0,height:"1px",background:`linear-gradient(90deg,transparent,${active?"var(--neon)":"var(--border-bright)"},transparent)`,opacity:0.5}}/>{children}</div>;}

function LoadingDots({label="SCANNING"}){
  const [d,setD]=useState("");
  useEffect(()=>{const t=setInterval(()=>setD(p=>p.length>=3?"":p+"."),400);return()=>clearInterval(t);},[]);
  return <div style={{color:"var(--neon-dim)",fontSize:"11px",letterSpacing:"3px",padding:"40px",textAlign:"center"}}><div style={{marginBottom:"8px",fontSize:"9px",color:"var(--text-muted)"}}>{"[ "+"=".repeat(d.length*4)+" ".repeat(12-d.length*4)+" ]"}</div>{label}{d}</div>;
}

function SourceBadge({source}){
  const cfg={live:{l:"LIVE",c:"var(--neon)"},twelvedata:{l:"12DATA",c:"var(--blue)"},mock:{l:"SIM ⚠",c:"var(--amber)"},dexscreener:{l:"DEX",c:"var(--purple)"}};
  const x=cfg[source]||cfg.mock;
  return <Badge label={x.l} color={x.c}/>;
}

function SimWarning({source}){
  if(source!=="mock") return null;
  return <div style={{padding:"6px 10px",background:"rgba(255,170,0,0.1)",border:"1px solid rgba(255,170,0,0.3)",fontSize:"8px",color:"var(--amber)",letterSpacing:"2px",marginBottom:"8px"}}>
    ⚠ SIMULATED DATA — Analysis below is based on generated price data, NOT real market data. Do not use for trading decisions.
  </div>;
}

// ============================================================
// CANVAS CHARTS
// ============================================================
function CandleChart({ohlcv,structure}){
  const ref=useRef(null);
  const draw=useCallback(()=>{
    if(!ohlcv||!ref.current)return;
    const canvas=ref.current,ctx=canvas.getContext("2d");
    const W=canvas.offsetWidth,H=canvas.offsetHeight;
    if(!W||!H)return;
    canvas.width=W;canvas.height=H;
    const data=ohlcv.slice(-80);
    const prices=data.flatMap(c=>[c.high,c.low]);
    const minP=Math.min(...prices)*0.998,maxP=Math.max(...prices)*1.002;
    const pY=p=>H*0.85*(1-(p-minP)/(maxP-minP))+H*0.02;
    const cW=Math.max(2,Math.floor((W-20)/data.length)-1);
    ctx.fillStyle="#050505";ctx.fillRect(0,0,W,H);
    for(let i=0;i<5;i++){const y=(H*0.87/5)*i+H*0.02;ctx.strokeStyle="#0f0f0f";ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
    const maxVol=Math.max(...data.map(c=>c.volume));
    data.forEach((c,i)=>{const x=10+i*(cW+1),vH=(c.volume/maxVol)*H*0.13;ctx.fillStyle=c.close>=c.open?"rgba(0,255,65,0.15)":"rgba(255,42,42,0.15)";ctx.fillRect(x,H-vH,cW,vH);});
    data.forEach((c,i)=>{
      const x=10+i*(cW+1)+Math.floor(cW/2),isG=c.close>=c.open;
      const bT=pY(Math.max(c.open,c.close)),bB=pY(Math.min(c.open,c.close)),bH=Math.max(1,bB-bT);
      ctx.strokeStyle=isG?"#00ff41":"#ff2a2a";ctx.lineWidth=1;ctx.globalAlpha=0.7;
      ctx.beginPath();ctx.moveTo(x,pY(c.high));ctx.lineTo(x,pY(c.low));ctx.stroke();
      ctx.globalAlpha=1;ctx.fillStyle=isG?"rgba(0,255,65,0.7)":"rgba(255,42,42,0.7)";ctx.fillRect(x-Math.floor(cW/2),bT,cW,bH);
    });
    if(structure){[...(structure.bos||[]),...(structure.choch||[])].forEach(s=>{const idx=Math.min(data.length-1,Math.max(0,s.i-(ohlcv.length-data.length)));if(idx<0||idx>=data.length)return;const x=10+idx*(cW+1),y=pY(s.price);ctx.strokeStyle=s.label?.includes("CHOCH")?"#aa44ff":"#ffaa00";ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(W,y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=s.label?.includes("CHOCH")?"#aa44ff":"#ffaa00";ctx.font="8px JetBrains Mono,monospace";ctx.fillText(s.label,x+2,y-3);});}
    const lp=data[data.length-1].close,ly=pY(lp);
    ctx.strokeStyle="rgba(0,255,65,0.4)";ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(0,ly);ctx.lineTo(W-62,ly);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle="#00ff41";ctx.font="bold 9px JetBrains Mono,monospace";
    ctx.fillText("$"+(lp<0.001?lp.toExponential(3):lp<1?lp.toFixed(6):lp.toFixed(2)),W-60,ly+3);
  },[ohlcv,structure]);
  useEffect(()=>{draw();const ro=new ResizeObserver(draw);if(ref.current)ro.observe(ref.current.parentElement||ref.current);return()=>ro.disconnect();},[draw]);
  return <canvas ref={ref} style={{width:"100%",height:"100%",display:"block"}}/>;
}

function HqChart({hqArr}){
  const ref=useRef(null);
  const draw=useCallback(()=>{
    if(!hqArr||!ref.current)return;
    const canvas=ref.current,ctx=canvas.getContext("2d");
    const W=canvas.offsetWidth,H=canvas.offsetHeight;
    if(!W||!H)return;
    canvas.width=W;canvas.height=H;
    ctx.fillStyle="#050505";ctx.fillRect(0,0,W,H);
    const pad={l:32,r:12,t:14,b:28},cW=W-pad.l-pad.r,cH=H-pad.t-pad.b;
    const qVals=hqArr.map(d=>d.q);
    const minQ=Math.min(...qVals),maxQ=Math.max(...qVals),qRange=maxQ-minQ||1;
    const xS=q=>pad.l+((q-minQ)/qRange)*cW,yS=h=>pad.t+(1-h)*cH;
    ctx.strokeStyle="#111";ctx.lineWidth=1;
    [0,0.25,0.5,0.75,1].forEach(h=>{const y=yS(h);ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(W-pad.r,y);ctx.stroke();ctx.fillStyle="#2a4a2a";ctx.font="8px monospace";ctx.fillText(h.toFixed(2),2,y+3);});
    ctx.strokeStyle="rgba(255,170,0,0.4)";ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(pad.l,yS(0.5));ctx.lineTo(W,yS(0.5));ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle="rgba(0,255,65,0.04)";ctx.fillRect(pad.l,pad.t,cW,yS(0.5)-pad.t);
    ctx.fillStyle="rgba(255,42,42,0.04)";ctx.fillRect(pad.l,yS(0.5),cW,cH-(yS(0.5)-pad.t));
    // Shade invalid points
    ctx.strokeStyle="#00ff41";ctx.lineWidth=2;ctx.beginPath();
    let started=false;
    hqArr.forEach(d=>{if(!d.valid)return;const x=xS(d.q),y=yS(d.h);started?(ctx.lineTo(x,y)):(ctx.moveTo(x,y));started=true;});
    ctx.stroke();
    hqArr.forEach(d=>{
      const x=xS(d.q),y=yS(d.h);
      const col=d.h>0.55?"#00ff41":d.h<0.45?"#ff2a2a":"#ffaa00";
      ctx.fillStyle=d.valid?col:"#333";ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#3a5a3a";ctx.font="7px monospace";ctx.fillText("q="+d.q,x-6,y-7);
    });
    ctx.fillStyle="#ffaa00";ctx.font="7px monospace";ctx.fillText("RANDOM H=0.5",W-82,yS(0.5)-3);
    ctx.fillStyle="#2a4a2a";qVals.forEach(q=>{ctx.fillText(q,xS(q)-4,H-8);});
    ctx.fillStyle="#3a6a3a";ctx.fillText("H(q)",2,12);
  },[hqArr]);
  useEffect(()=>{draw();const ro=new ResizeObserver(draw);if(ref.current)ro.observe(ref.current.parentElement||ref.current);return()=>ro.disconnect();},[draw]);
  return <canvas ref={ref} style={{width:"100%",height:"100%",display:"block"}}/>;
}

function FAlphaChart({fAlphaArr}){
  const ref=useRef(null);
  const draw=useCallback(()=>{
    if(!fAlphaArr||fAlphaArr.length<2||!ref.current)return;
    const canvas=ref.current,ctx=canvas.getContext("2d");
    const W=canvas.offsetWidth,H=canvas.offsetHeight;
    if(!W||!H)return;
    canvas.width=W;canvas.height=H;
    ctx.fillStyle="#050505";ctx.fillRect(0,0,W,H);
    const pad={l:30,r:12,t:14,b:28},cW=W-pad.l-pad.r,cH=H-pad.t-pad.b;
    const alphas=fAlphaArr.map(d=>d.alpha).filter(a=>isFinite(a)&&a>=0);
    const fs=fAlphaArr.map(d=>d.f).filter(f=>isFinite(f)&&f>=0);
    if(alphas.length<2)return;
    const minA=Math.min(...alphas),maxA=Math.max(...alphas),aRange=maxA-minA||1;
    const minF=0,maxF=Math.max(...fs,1);
    const xS=a=>pad.l+((a-minA)/aRange)*cW,yS=f=>pad.t+(1-(f-minF)/(maxF-minF))*cH;
    ctx.strokeStyle="#111";ctx.lineWidth=1;
    [0,0.5,1].forEach(f=>{const fv=f*maxF,y=yS(fv);ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(W-pad.r,y);ctx.stroke();ctx.fillStyle="#2a4a2a";ctx.font="8px monospace";ctx.fillText(fv.toFixed(1),2,y+3);});
    // Fill under curve
    ctx.beginPath();
    fAlphaArr.forEach((d,i)=>{
      if(!isFinite(d.alpha)||!isFinite(d.f))return;
      i===0?ctx.moveTo(xS(d.alpha),yS(d.f)):ctx.lineTo(xS(d.alpha),yS(d.f));
    });
    ctx.strokeStyle="#aa44ff";ctx.lineWidth=2;ctx.stroke();
    ctx.lineTo(xS(fAlphaArr[fAlphaArr.length-1].alpha),yS(0));
    ctx.lineTo(xS(fAlphaArr[0].alpha),yS(0));
    ctx.closePath();ctx.fillStyle="rgba(170,68,255,0.08)";ctx.fill();
    // Peak marker
    const peak=fAlphaArr.reduce((mx,d)=>d.f>mx.f?d:mx,fAlphaArr[0]);
    if(isFinite(peak.alpha)){
      ctx.fillStyle="#aa44ff";ctx.beginPath();ctx.arc(xS(peak.alpha),yS(peak.f),4,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#aa44ff";ctx.font="8px monospace";ctx.fillText(`α₀=${peak.alpha.toFixed(3)}`,xS(peak.alpha)+6,yS(peak.f));
    }
    // Width annotation
    const w=maxA-minA;
    ctx.fillStyle="#3a5a3a";ctx.font="8px monospace";
    ctx.fillText(`Δα=${w.toFixed(3)}`,pad.l+4,14);
    ctx.fillText("f(α)",2,12);ctx.fillText("α →",W-20,H-8);
    [minA,maxA].forEach(a=>{if(isFinite(a)){ctx.fillStyle="#2a4a2a";ctx.fillText(a.toFixed(2),xS(a)-10,H-8);}});
  },[fAlphaArr]);
  useEffect(()=>{draw();const ro=new ResizeObserver(draw);if(ref.current)ro.observe(ref.current.parentElement||ref.current);return()=>ro.disconnect();},[draw]);
  return <canvas ref={ref} style={{width:"100%",height:"100%",display:"block"}}/>;
}

function EquityChart({isData,oosData}){
  const ref=useRef(null);
  const draw=useCallback(()=>{
    if(!isData||!ref.current)return;
    const canvas=ref.current,ctx=canvas.getContext("2d");
    const W=canvas.offsetWidth,H=canvas.offsetHeight;
    if(!W||!H)return;
    canvas.width=W;canvas.height=H;
    ctx.fillStyle="#050505";ctx.fillRect(0,0,W,H);
    const dC=(curve,color,label,x0,x1)=>{
      if(!curve||curve.length<2)return;
      const mn=Math.min(...curve),mx=Math.max(...curve),range=mx-mn||1;
      const yS=e=>H*0.9*(1-(e-mn)/range)+H*0.05,xS=i=>x0+(i/(curve.length-1))*(x1-x0-4);
      ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.beginPath();
      curve.forEach((e,i)=>i===0?ctx.moveTo(xS(i),yS(e)):ctx.lineTo(xS(i),yS(e)));
      ctx.stroke();ctx.fillStyle=color;ctx.font="8px monospace";ctx.fillText(label,x0+4,12);
    };
    ctx.strokeStyle="#ffaa0055";ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(W*0.65,0);ctx.lineTo(W*0.65,H);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle="#ffaa00";ctx.font="7px monospace";ctx.fillText("PURGE",W*0.65+2,H-4);
    dC(isData,"#00cc33","IS",0,W*0.63);
    if(oosData)dC(oosData,"#00ff41","OOS",W*0.67,W);
  },[isData,oosData]);
  useEffect(()=>{draw();const ro=new ResizeObserver(draw);if(ref.current)ro.observe(ref.current.parentElement||ref.current);return()=>ro.disconnect();},[draw]);
  return <canvas ref={ref} style={{width:"100%",height:"100%",display:"block"}}/>;
}

// ============================================================
// SIGNAL CARD — Entry/Stop/Target
// ============================================================
function SignalCard({trade,symbol}){
  if(!trade) return (
    <Panel>
      <PanelLabel>TRADE SIGNAL</PanelLabel>
      <div style={{textAlign:"center",padding:"16px",color:"var(--text-muted)",fontSize:"9px",letterSpacing:"2px"}}>
        NO SIGNAL — Confluence insufficient (&lt;3 active signals or score &lt;60)
      </div>
    </Panel>
  );
  const fmtP=p=>p<0.001?p.toExponential(3):p<1?p.toFixed(6):p.toFixed(2);
  const dir=trade.direction;
  const col=dir==="LONG"?"var(--neon)":"var(--red)";
  return (
    <Panel style={{border:`1px solid ${col}44`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}>
        <PanelLabel color={col}>TRADE SIGNAL — {symbol}</PanelLabel>
        <Badge label={dir} color={col}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:"8px",marginBottom:"10px"}}>
        <div style={{padding:"8px",background:`${col}11`,border:`1px solid ${col}33`}}>
          <div style={{fontSize:"7px",color:"var(--text-muted)",letterSpacing:"2px",marginBottom:"3px"}}>ENTRY</div>
          <div style={{fontSize:"12px",color:col,fontWeight:700}}>${fmtP(trade.entry)}</div>
        </div>
        <div style={{padding:"8px",background:"var(--red-ghost)",border:"1px solid rgba(255,42,42,0.3)"}}>
          <div style={{fontSize:"7px",color:"var(--text-muted)",letterSpacing:"2px",marginBottom:"3px"}}>STOP LOSS</div>
          <div style={{fontSize:"12px",color:"var(--red)",fontWeight:700}}>${fmtP(trade.stop)}</div>
        </div>
        <div style={{padding:"8px",background:"var(--neon-ghost)",border:"1px solid var(--neon-dim)33"}}>
          <div style={{fontSize:"7px",color:"var(--text-muted)",letterSpacing:"2px",marginBottom:"3px"}}>TARGET 1</div>
          <div style={{fontSize:"12px",color:"var(--neon)",fontWeight:700}}>${fmtP(trade.target1)}</div>
        </div>
        <div style={{padding:"8px",background:"var(--neon-ghost)",border:"1px solid var(--neon-dim)33"}}>
          <div style={{fontSize:"7px",color:"var(--text-muted)",letterSpacing:"2px",marginBottom:"3px"}}>TARGET 2</div>
          <div style={{fontSize:"12px",color:"var(--neon)",fontWeight:700}}>${fmtP(trade.target2)}</div>
        </div>
      </div>
      <div style={{display:"flex",gap:"12px",fontSize:"9px",color:"var(--text-muted)"}}>
        <span>R:R <span style={{color:"var(--neon)"}}>{trade.rr}:1</span></span>
        <span>ATR <span style={{color:"var(--amber)"}}>${fmtP(trade.atr)}</span></span>
        <span>SIZE MULT <span style={{color:"var(--blue)"}}>{trade.sizeMult}×</span></span>
        <span style={{color:"var(--text-dead)"}}>Fee+Slip: {((TRADE_FEE+SLIPPAGE)*200).toFixed(3)}% RT</span>
      </div>
    </Panel>
  );
}

// ============================================================
// HOME SCREEN
// ============================================================
function HomeScreen({onSelect,watchlist}){
  const trending=useTrending();
  const [search,setSearch]=useState("");
  const [results,setResults]=useState([]);
  const [searching,setSearching]=useState(false);
  const [section,setSection]=useState("trending");

  const handleSearch=useCallback(async(q)=>{
    setSearch(q);
    if(q.length<2){setResults([]);return;}
    setSearching(true);
    try{
      const res=await fetch(`${DEXSCREENER_BASE}/search?q=${encodeURIComponent(q)}`);
      const json=await res.json();
      const evmR=(json.pairs||[]).slice(0,6).map(p=>({address:p.baseToken?.address,symbol:p.baseToken?.symbol||"???",name:p.baseToken?.name||"Unknown",type:"evm",chain:p.chainId||"ethereum",price:parseFloat(p.priceUsd||0),change24h:p.priceChange?.h24||0}));
      const localR=[...POPULAR_CRYPTO,...POPULAR_STOCKS,...POPULAR_FOREX].filter(a=>a.symbol.toLowerCase().includes(q.toLowerCase())||a.name.toLowerCase().includes(q.toLowerCase()));
      setResults([...evmR,...localR].slice(0,8));
    }catch{setResults([]);}
    setSearching(false);
  },[]);

  const fmtP=p=>p<0.0001?p.toExponential(2):p<1?p.toFixed(6):p.toFixed(2);

  return (
    <div className="fade-in" style={{padding:"16px",overflow:"auto",height:"100%"}}>
      {/* Search */}
      <div style={{marginBottom:"20px",position:"relative"}}>
        <span style={{position:"absolute",left:"12px",top:"50%",transform:"translateY(-50%)",color:"var(--neon-dim)",fontSize:"12px"}}>⌕</span>
        <input value={search} onChange={e=>handleSearch(e.target.value)} placeholder="Search token, address, stock, forex..." style={{width:"100%",background:"var(--bg-panel)",border:"1px solid var(--border-bright)",color:"var(--text-primary)",padding:"10px 12px 10px 32px",fontSize:"11px",letterSpacing:"1px",outline:"none"}} onFocus={e=>e.target.style.borderColor="var(--neon-dim)"} onBlur={e=>e.target.style.borderColor="var(--border-bright)"}/>
        {searching&&<span style={{position:"absolute",right:"12px",top:"50%",transform:"translateY(-50%)",color:"var(--text-muted)",fontSize:"9px",letterSpacing:"2px"}}>SCANNING...</span>}
      </div>
      {results.length>0&&(
        <div style={{marginTop:"-16px",marginBottom:"12px",background:"var(--bg-panel)",border:"1px solid var(--border-bright)"}}>
          {results.map((r,i)=>(
            <div key={i} onClick={()=>{onSelect(r);setSearch("");setResults([]);}} className="card-hover" style={{padding:"8px 12px",borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
              <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                <Badge label={r.type?.toUpperCase()||"EVM"} color="var(--purple)"/>
                <div><div style={{fontSize:"11px",color:"var(--neon)",fontWeight:700}}>{r.symbol}</div><div style={{fontSize:"8px",color:"var(--text-muted)"}}>{r.name}</div></div>
              </div>
              {r.price>0&&<div style={{textAlign:"right"}}><div style={{fontSize:"11px",color:"var(--text-primary)"}}>${fmtP(r.price)}</div><div style={{fontSize:"9px",color:(r.change24h||0)>=0?"var(--neon)":"var(--red)"}}>{(r.change24h||0)>=0?"▲":"▼"}{Math.abs(r.change24h||0).toFixed(2)}%</div></div>}
            </div>
          ))}
        </div>
      )}
      {/* Section tabs */}
      <div style={{display:"flex",gap:"4px",marginBottom:"16px"}}>
        {[["trending","🔥 TRENDING"],["crypto","◎ CRYPTO"],["stocks","◧ STOCKS"],["forex","€ FOREX"]].map(([k,l])=>(
          <button key={k} onClick={()=>setSection(k)} style={{padding:"5px 10px",background:section===k?"var(--neon-ghost)":"var(--bg-panel)",border:`1px solid ${section===k?"var(--neon-dim)":"var(--border)"}`,color:section===k?"var(--neon)":"var(--text-muted)",fontSize:"8px",letterSpacing:"2px",flex:1}}>{l}</button>
        ))}
      </div>
      {section==="trending"&&(
        <div>
          <div style={{fontSize:"9px",color:"var(--text-muted)",letterSpacing:"3px",marginBottom:"10px"}}>▸ TRENDING ON DEXSCREENER — REAL TIME</div>
          {trending.length===0&&<LoadingDots label="FETCHING TRENDING"/>}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:"8px"}}>
            {trending.map((t,i)=>(
              <Card key={i} onClick={()=>onSelect({...t,type:"evm"})} style={{animation:`fadeIn 0.3s ease ${i*0.04}s both`}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:"6px"}}><div style={{fontSize:"12px",color:"var(--neon)",fontWeight:800}}>{t.symbol}</div><Badge label={`#${i+1}`} color="var(--amber)"/></div>
                <div style={{fontSize:"8px",color:"var(--text-muted)",marginBottom:"6px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.name}</div>
                <div style={{fontSize:"7px",color:"var(--text-dead)"}}>{t.chain?.toUpperCase()}</div>
              </Card>
            ))}
          </div>
        </div>
      )}
      {section==="crypto"&&<AssetGrid assets={POPULAR_CRYPTO} onSelect={onSelect}/>}
      {section==="stocks"&&<AssetGrid assets={POPULAR_STOCKS} onSelect={onSelect}/>}
      {section==="forex"&&<AssetGrid assets={POPULAR_FOREX} onSelect={onSelect}/>}
      {watchlist.length>0&&(
        <div style={{marginTop:"20px"}}>
          <div style={{fontSize:"9px",color:"var(--text-muted)",letterSpacing:"3px",marginBottom:"10px"}}>▸ YOUR WATCHLIST</div>
          <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
            {watchlist.map((t,i)=>(
              <div key={i} onClick={()=>onSelect(t)} className="card-hover" style={{padding:"6px 12px",background:"var(--bg-panel)",border:"1px solid var(--neon-dim)",cursor:"pointer"}}>
                <span style={{fontSize:"10px",color:"var(--neon)",fontWeight:700,letterSpacing:"2px"}}>{t.symbol}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AssetGrid({assets,onSelect}){
  return (
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:"8px"}}>
      {assets.map((a,i)=>(
        <Card key={i} onClick={()=>onSelect(a)} style={{animation:`fadeIn 0.3s ease ${i*0.04}s both`}}>
          <div style={{fontSize:"18px",opacity:0.5,marginBottom:"6px"}}>{a.icon}</div>
          <div style={{fontSize:"13px",color:"var(--neon)",fontWeight:800,letterSpacing:"2px",marginBottom:"2px"}}>{a.symbol.split("/")[0]}</div>
          <div style={{fontSize:"8px",color:"var(--text-muted)"}}>{a.name}</div>
        </Card>
      ))}
    </div>
  );
}

// ============================================================
// WATCHLIST SIDEBAR
// ============================================================
function Sidebar({watchlist,active,onSelect,onAdd,onRemove,onHome}){
  const [input,setInput]=useState(""),[sym,setSym]=useState("");
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden"}}>
      <button onClick={onHome} style={{padding:"10px",background:"var(--neon-ghost)",border:"none",borderBottom:"1px solid var(--neon-dim)",color:"var(--neon)",fontSize:"10px",letterSpacing:"3px",fontWeight:700,textAlign:"left"}}>⬡ HOME</button>
      <div style={{padding:"10px",flex:1,overflow:"auto"}}>
        <div style={{fontSize:"8px",color:"var(--text-muted)",letterSpacing:"3px",marginBottom:"8px"}}>▸ WATCHLIST [{watchlist.length}/5]</div>
        <input value={input} onChange={e=>setInput(e.target.value)} placeholder="0x... or SYMBOL" style={{width:"100%",background:"var(--bg-deep)",border:"1px solid var(--border-bright)",color:"var(--neon)",padding:"5px 8px",fontSize:"9px",outline:"none",marginBottom:"3px"}}/>
        <div style={{display:"flex",gap:"3px",marginBottom:"8px"}}>
          <input value={sym} onChange={e=>setSym(e.target.value)} placeholder="SYM" style={{flex:1,background:"var(--bg-deep)",border:"1px solid var(--border-bright)",color:"var(--amber)",padding:"5px 6px",fontSize:"9px",outline:"none"}}/>
          <button onClick={()=>{if(input.trim().length>2&&watchlist.length<5){const isEVM=input.startsWith("0x");onAdd({address:isEVM?input.trim():undefined,symbol:sym.trim()||input.trim().toUpperCase(),name:sym.trim()||"Custom",type:isEVM?"evm":"crypto12",chain:"ethereum"});setInput("");setSym("");}}} disabled={watchlist.length>=5} style={{background:watchlist.length>=5?"var(--bg-deep)":"var(--neon-ghost)",border:"1px solid var(--neon-dim)",color:"var(--neon)",padding:"5px 8px",fontSize:"9px",opacity:watchlist.length>=5?0.3:1}}>+</button>
        </div>
        {watchlist.map((t,i)=>(
          <div key={t.address||t.symbol} onClick={()=>onSelect(t)} style={{padding:"8px",marginBottom:"3px",cursor:"pointer",background:active&&(active.address||active.symbol)===(t.address||t.symbol)?"var(--neon-ghost)":"var(--bg-deep)",border:`1px solid ${active&&(active.address||active.symbol)===(t.address||t.symbol)?"var(--neon-dim)":"var(--border)"}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontSize:"10px",color:"var(--neon)",fontWeight:700,letterSpacing:"2px"}}>{t.symbol}</div><Badge label={t.type?.toUpperCase()||"EVM"} color="var(--text-muted)"/></div>
            <button onClick={e=>{e.stopPropagation();onRemove(t.address||t.symbol);}} style={{background:"none",border:"none",color:"var(--red)",fontSize:"10px",padding:"0 2px"}}>✕</button>
          </div>
        ))}
        {watchlist.length===0&&<div style={{fontSize:"8px",color:"var(--text-dead)",textAlign:"center",padding:"10px"}}>ADD ASSETS TO WATCH</div>}
      </div>
      <div style={{padding:"8px 10px",borderTop:"1px solid var(--border)"}}>
        {["MF-DFA ENGINE","f(α) SPECTRUM","CHAOS GATE","HMM REGIME","KALMAN+RLS","SIZING ENGINE","EXIT LOGIC"].map(s=>(
          <div key={s} style={{display:"flex",justifyContent:"space-between",padding:"2px 0",fontSize:"7px"}}>
            <span style={{color:"var(--text-dead)"}}>{s}</span>
            <span style={{color:"var(--neon)"}}>●</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// ALERT TICKER
// ============================================================
function AlertTicker({watchlist,cache}){
  const [pos,setPos]=useState(0);
  useEffect(()=>{const t=setInterval(()=>setPos(p=>p+1),55);return()=>clearInterval(t);},[]);
  const alerts=useMemo(()=>{
    const a=[];
    watchlist.forEach(t=>{
      const d=cache[t.address||t.symbol];
      if(!d?.ohlcv) return;
      const returns=MFDFA.logReturns(d.ohlcv.map(c=>c.close));
      const hqArr=MFDFA.hq(returns,[0,2],1);
      const sc=SignalEngine.score(d.ohlcv,hqArr);
      if(sc.score>=70) a.push(`🐴 ${t.symbol}: BLACK HORSE [${sc.score}]`);
      if(sc.trade) a.push(`⚡ ${t.symbol}: ${sc.trade.direction} SIGNAL — Entry $${sc.trade.entry.toFixed(4)}`);
      if(sc.struct.choch?.length>0) a.push(`${t.symbol}: CHOCH DETECTED`);
      if(sc.vol.regime==="EXTREME") a.push(`⚠ ${t.symbol}: EXTREME VOL`);
      if(sc.H<0.35) a.push(`▼ ${t.symbol}: H(q) BREAKDOWN ${sc.H.toFixed(3)}`);
    });
    return a.length>0?a:["MF-DFA ACTIVE","SURVEILLANCE NOMINAL","WAITING FOR CONFLUENCE","ZERO LOOKAHEAD BIAS","OOS VALIDATION ON"];
  },[watchlist,cache]);
  const txt=alerts.join("   ◆   ");
  return (
    <div style={{background:"var(--bg-deep)",borderBottom:"1px solid var(--border)",padding:"5px 0",overflow:"hidden"}}>
      <div style={{display:"flex",alignItems:"center"}}>
        <div style={{background:"var(--neon-ghost)",borderRight:"1px solid var(--neon-dim)",padding:"3px 10px",fontSize:"8px",color:"var(--neon)",letterSpacing:"3px",whiteSpace:"nowrap",flexShrink:0}}>ALERTS</div>
        <div style={{overflow:"hidden",flex:1}}>
          <div style={{fontSize:"9px",color:"var(--text-secondary)",letterSpacing:"2px",whiteSpace:"nowrap",transform:`translateX(${-(pos%(txt.length*7+1))}px)`}}>{txt+"   ◆   "+txt}</div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MAIN ASSET DASHBOARD
// ============================================================
function Dashboard({asset,data,loading}){
  const [tab,setTab]=useState("OVERVIEW");
  const [tf,setTf]=useState(TIMEFRAMES[3]); // default 1D
  const TABS=["OVERVIEW","FRACTAL","STRUCTURE","BACKTEST","BEHAVIOR","V2 REGIME"];
  const analysis=useMFDFA(data?.ohlcv);
  const meta=data?.meta||{};
  const v2=useV2Analysis(data?.ohlcv,analysis?.hqArr,analysis?.struct,analysis?.liq,analysis?.vol);
  const fmtP=p=>!p?"—":p<0.0001?p.toExponential(3):p<0.01?p.toFixed(8):p<1?p.toFixed(6):p.toFixed(2);
  const fmtV=v=>!v?"—":v>1e9?`$${(v/1e9).toFixed(2)}B`:v>1e6?`$${(v/1e6).toFixed(2)}M`:v>1e3?`$${(v/1e3).toFixed(1)}K`:`$${v.toFixed(0)}`;

  if(!asset) return <div style={{height:"100%",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:"12px"}}><div style={{fontSize:"40px",opacity:0.1}}>⬡</div><div style={{fontSize:"10px",letterSpacing:"5px",color:"var(--text-muted)"}}>SELECT ASSET</div></div>;
  if(loading) return <LoadingDots label="LOADING MARKET DATA"/>;

  return (
    <div className="fade-in" style={{display:"flex",flexDirection:"column",height:"100%"}}>
      {/* Header */}
      <div style={{background:"var(--bg-panel)",borderBottom:"1px solid var(--border)",padding:"10px 16px",display:"flex",flexWrap:"wrap",gap:"12px",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap"}}>
          <span style={{fontSize:"22px",color:"var(--neon)",fontWeight:800,letterSpacing:"3px",textShadow:"0 0 15px var(--neon-glow)"}}>{meta.symbol||asset.symbol}</span>
          <span style={{fontSize:"9px",color:"var(--text-muted)"}}>{meta.name||asset.name}</span>
          <Badge label={meta.type?.toUpperCase()||"EVM"} color="var(--purple)"/>
          {data&&<SourceBadge source={data.source}/>}
        </div>
        <div style={{display:"flex",gap:"14px",alignItems:"center",flexWrap:"wrap"}}>
          <div><div style={{fontSize:"7px",color:"var(--text-muted)",letterSpacing:"2px"}}>PRICE</div><div style={{fontSize:"18px",color:"var(--neon)",fontWeight:700}}>${fmtP(meta.price)}</div><div style={{fontSize:"9px",color:(meta.change24h||0)>=0?"var(--neon)":"var(--red)"}}>{(meta.change24h||0)>=0?"▲":"▼"}{Math.abs(meta.change24h||0).toFixed(2)}%</div></div>
          {meta.volume24h>0&&<div><div style={{fontSize:"7px",color:"var(--text-muted)",letterSpacing:"2px"}}>VOL 24H</div><div style={{fontSize:"13px",color:"var(--amber)",fontWeight:600}}>{fmtV(meta.volume24h)}</div></div>}
          {meta.liquidity>0&&<div><div style={{fontSize:"7px",color:"var(--text-muted)",letterSpacing:"2px"}}>LIQUIDITY</div><div style={{fontSize:"13px",color:"var(--blue)",fontWeight:600}}>{fmtV(meta.liquidity)}</div></div>}
          {analysis&&(
            <div style={{padding:"8px 14px",textAlign:"center",background:analysis.scoreData.score>=60?"var(--neon-ghost)":analysis.scoreData.score<30?"var(--red-ghost)":"var(--amber-ghost)",border:`2px solid ${analysis.scoreData.score>=60?"var(--neon-dim)":analysis.scoreData.score<30?"var(--red)":"var(--amber)"}`}}>
              <div style={{fontSize:"7px",color:"var(--text-muted)",letterSpacing:"3px"}}>BLACK HORSE</div>
              <div style={{fontSize:"26px",fontWeight:800,color:analysis.scoreData.score>=60?"var(--neon)":analysis.scoreData.score<30?"var(--red)":"var(--amber)",textShadow:analysis.scoreData.score>=70?"0 0 20px var(--neon-glow)":"none"}}>{analysis.scoreData.score}</div>
              <div style={{fontSize:"8px",letterSpacing:"1px",color:"var(--text-secondary)"}}>{analysis.scoreData.grade}</div>
            </div>
          )}
        </div>
      </div>

      {/* Timeframe + Tabs */}
      <div style={{display:"flex",background:"var(--bg-deep)",borderBottom:"1px solid var(--border)",alignItems:"center"}}>
        <div style={{display:"flex",borderRight:"1px solid var(--border)",padding:"0 4px"}}>
          {TIMEFRAMES.map(t=>(
            <button key={t.label} onClick={()=>setTf(t)} style={{padding:"8px 8px",background:"none",border:"none",borderBottom:`2px solid ${tf.label===t.label?"var(--amber)":"transparent"}`,color:tf.label===t.label?"var(--amber)":"var(--text-muted)",fontSize:"8px",letterSpacing:"1px"}}>{t.label}</button>
          ))}
        </div>
        {TABS.map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"9px 4px",background:"none",border:"none",borderBottom:`2px solid ${tab===t?"var(--neon)":"transparent"}`,color:tab===t?"var(--neon)":"var(--text-muted)",fontSize:"8px",letterSpacing:"2px"}}>{t}</button>
        ))}
      </div>

      <div style={{flex:1,overflow:"auto",padding:"12px"}}>
        {data?.source==="mock"&&<SimWarning source="mock"/>}

        {tab==="OVERVIEW"&&(
          <>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"8px",marginBottom:"12px"}}>
              {[
                {label:"HURST H(2)",val:analysis?.H?.toFixed(4)||"—",color:(analysis?.H||0.5)>0.55?"var(--neon)":(analysis?.H||0.5)<0.45?"var(--red)":"var(--amber)",sub:(analysis?.H||0.5)>0.55?"PERSISTENT":(analysis?.H||0.5)<0.45?"ANTI-PERSIST":"RANDOM WALK"},
                {label:"FRACTAL DIM",val:analysis?.fd?.toFixed(4)||"—",color:"var(--blue)",sub:"D = 2 − H(2)"},
                {label:"Δα WIDTH",val:analysis?.width?.toFixed(4)||"—",color:"var(--purple)",sub:"MULTIFRACTAL"},
                {label:"BEHAVIOR",val:analysis?.beh?.label||"—",color:"var(--amber)",sub:analysis?.vol?.regime||""},
              ].map(m=>(
                <Panel key={m.label}><div style={{fontSize:"7px",color:"var(--text-muted)",letterSpacing:"2px",marginBottom:"4px"}}>{m.label}</div><div style={{fontSize:"18px",color:m.color,fontWeight:700}}>{m.val}</div><div style={{fontSize:"8px",color:"var(--text-muted)",marginTop:"2px"}}>{m.sub}</div></Panel>
              ))}
            </div>
            {analysis?.scoreData?.trade&&<SignalCard trade={analysis.scoreData.trade} symbol={meta.symbol||asset.symbol}/>}
            <Panel style={{height:"260px",margin:"8px 0",padding:"10px"}}>
              <PanelLabel>PRICE ACTION [{tf.label}] — BOS/CHOCH OVERLAY</PanelLabel>
              <div style={{height:"calc(100% - 28px)"}}><CandleChart ohlcv={data?.ohlcv} structure={analysis?.struct}/></div>
            </Panel>
            {analysis&&(
              <Panel>
                <PanelLabel>CONFLUENCE SCANNER — MIN 3 SIGNALS FOR ENTRY</PanelLabel>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:"6px"}}>
                  {analysis.scoreData.signals.map((s,i)=>(
                    <div key={i} style={{padding:"7px 10px",background:s.active?(s.weight>0?"var(--neon-ghost)":"var(--red-ghost)"):"var(--bg-deep)",border:`1px solid ${s.active?(s.weight>0?"var(--neon-dim)":"var(--red)"):"var(--border)"}33`,display:"flex",justifyContent:"space-between"}}>
                      <span style={{fontSize:"9px",color:s.active?"var(--text-primary)":"var(--text-muted)"}}>{s.label}</span>
                      <span style={{fontSize:"10px",fontWeight:800,color:s.weight>0?"var(--neon)":s.weight<0?"var(--red)":"var(--text-muted)"}}>{s.weight>0?"+":""}{s.weight}</span>
                    </div>
                  ))}
                </div>
              </Panel>
            )}
          </>
        )}

        {tab==="FRACTAL"&&analysis&&(
          <>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"8px",marginBottom:"12px"}}>
              {[
                {label:"HURST H(2)",val:analysis.H?.toFixed(4),color:analysis.H>0.55?"var(--neon)":analysis.H<0.45?"var(--red)":"var(--amber)",sub:analysis.H>0.55?"PERSISTENT":analysis.H<0.45?"ANTI-PERSIST":"RANDOM WALK"},
                {label:"FRACTAL DIM D",val:analysis.fd?.toFixed(4),color:"var(--blue)",sub:"MF-DFA based"},
                {label:"Δα MULTIFRACTAL",val:analysis.width?.toFixed(4),color:"var(--purple)",sub:analysis.width>0.3?"STRONG MF":analysis.width>0.1?"WEAK MF":"MONOFRACTAL"},
                {label:"BREAKDOWNS",val:analysis.breakdown?.length,color:analysis.breakdown?.length>2?"var(--red)":"var(--neon)",sub:"LAST PERIOD"},
              ].map(m=>(
                <Panel key={m.label}><div style={{fontSize:"7px",color:"var(--text-muted)",letterSpacing:"2px",marginBottom:"4px"}}>{m.label}</div><div style={{fontSize:"22px",fontWeight:800,color:m.color}}>{m.val}</div><div style={{fontSize:"8px",color:"var(--text-muted)",marginTop:"2px"}}>{m.sub}</div></Panel>
              ))}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginBottom:"12px"}}>
              <Panel style={{height:"200px",padding:"10px"}}>
                <PanelLabel>H(q) DECAY — MF-DFA GENERALIZED HURST</PanelLabel>
                <div style={{height:"calc(100% - 28px)"}}><HqChart hqArr={analysis.hqArr}/></div>
              </Panel>
              <Panel style={{height:"200px",padding:"10px"}}>
                <PanelLabel color="var(--purple)">f(α) MULTIFRACTAL SPECTRUM — LEGENDRE</PanelLabel>
                <div style={{height:"calc(100% - 28px)"}}><FAlphaChart fAlphaArr={analysis.fAlphaArr}/></div>
              </Panel>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:"8px"}}>
              <Panel>
                <PanelLabel>ZONE LEGEND</PanelLabel>
                {[{r:"H > 0.55",l:"PERSISTENT",d:"Trending. Momentum.",c:"var(--neon)"},{r:"H ≈ 0.5",l:"RANDOM WALK",d:"No edge. Quarantine.",c:"var(--amber)"},{r:"H < 0.45",l:"ANTI-PERSIST",d:"Mean-reverting.",c:"var(--red)"}].map(z=>(
                  <div key={z.l} style={{padding:"8px",marginBottom:"5px",background:"var(--bg-deep)",border:`1px solid ${z.c}22`}}><div style={{fontSize:"9px",color:z.c,fontWeight:700,letterSpacing:"2px"}}>{z.l}</div><div style={{fontSize:"7px",color:"var(--text-muted)"}}>{z.r} — {z.d}</div></div>
                ))}
                <div style={{padding:"8px",background:"var(--purple-ghost)",border:"1px solid rgba(170,68,255,0.2)",marginTop:"8px"}}>
                  <div style={{fontSize:"9px",color:"var(--purple)",fontWeight:700}}>Δα = {analysis.width?.toFixed(3)}</div>
                  <div style={{fontSize:"7px",color:"var(--text-muted)",marginTop:"3px"}}>{analysis.width>0.3?"Strong multifractal — complex dynamics":analysis.width>0.1?"Moderate multifractal behavior":"Near monofractal — uniform scaling"}</div>
                </div>
              </Panel>
              <Panel>
                <PanelLabel>BREAKDOWN LOG — POLYNOMIAL DETRENDED</PanelLabel>
                {analysis.breakdown.length===0?<div style={{fontSize:"9px",color:"var(--text-muted)"}}>NO BREAKDOWNS DETECTED IN CURRENT WINDOW</div>:(
                  <div style={{display:"flex",flexDirection:"column",gap:"3px",maxHeight:"180px",overflow:"auto"}}>
                    {analysis.breakdown.slice(-15).reverse().map((b,i)=>(
                      <div key={i} style={{display:"flex",gap:"10px",padding:"4px 8px",background:b.type==="ANTI_PERSISTENT"?"var(--red-ghost)":"var(--neon-ghost)",border:`1px solid ${b.type==="ANTI_PERSISTENT"?"var(--red)":"var(--neon)"}22`,fontSize:"9px"}}>
                        <span style={{color:b.type==="ANTI_PERSISTENT"?"var(--red)":"var(--neon)"}}>{b.type==="ANTI_PERSISTENT"?"▼":"▲"} {b.label}</span>
                        <span style={{color:"var(--text-muted)"}}>H={b.H.toFixed(3)}</span>
                        <span style={{color:"var(--text-dead)"}}>bar#{b.i}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </div>
          </>
        )}

        {tab==="STRUCTURE"&&analysis&&(
          <>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginBottom:"12px"}}>
              <Panel>
                <PanelLabel color="var(--amber)">VOLATILITY REGIME</PanelLabel>
                <div style={{textAlign:"center",padding:"12px 0"}}>
                  <div style={{fontSize:"28px",fontWeight:800,letterSpacing:"5px",color:analysis.vol.regime==="EXTREME"?"var(--red)":analysis.vol.regime==="HIGH"?"var(--amber)":analysis.vol.regime==="MEDIUM"?"var(--neon)":"var(--text-secondary)"}}>{analysis.vol.regime}</div>
                  <div style={{fontSize:"9px",color:"var(--text-muted)",marginTop:"6px"}}>ATR: ${analysis.vol.atr?.toFixed(6)} ({analysis.vol.pct?.toFixed(2)}%)</div>
                  <div style={{fontSize:"10px",color:"var(--text-secondary)",marginTop:"4px"}}>POSITION MULT: {analysis.vol.sizeMult}×</div>
                  <div style={{display:"flex",justifyContent:"center",gap:"4px",marginTop:"10px"}}>
                    {["LOW","MEDIUM","HIGH","EXTREME"].map(r=>(
                      <div key={r} style={{padding:"3px 8px",fontSize:"7px",background:analysis.vol.regime===r?"var(--neon-ghost)":"var(--bg-deep)",border:`1px solid ${analysis.vol.regime===r?"var(--neon)":"var(--border)"}`,color:analysis.vol.regime===r?"var(--neon)":"var(--text-dead)"}}>{r}</div>
                    ))}
                  </div>
                </div>
              </Panel>
              <Panel>
                <PanelLabel color="var(--purple)">SWING STRUCTURE HH/HL/LH/LL</PanelLabel>
                <div style={{maxHeight:"200px",overflow:"auto"}}>
                  {analysis.struct.swings.slice(-10).reverse().map((s,i)=>(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"5px 8px",marginBottom:"3px",background:s.type==="HH"||s.type==="HL"?"rgba(0,255,65,0.05)":"rgba(255,42,42,0.05)",border:`1px solid ${s.type==="HH"||s.type==="HL"?"var(--neon)":"var(--red)"}22`}}>
                      <span style={{fontSize:"11px",fontWeight:800,letterSpacing:"3px",color:s.type==="HH"||s.type==="HL"?"var(--neon)":"var(--red)"}}>{s.type}</span>
                      <span style={{fontSize:"9px",color:"var(--text-secondary)"}}>${s.price?.toFixed(s.price<1?6:2)}</span>
                    </div>
                  ))}
                  {analysis.struct.swings.length===0&&<div style={{fontSize:"9px",color:"var(--text-muted)"}}>INSUFFICIENT BARS</div>}
                </div>
              </Panel>
            </div>
            <Panel style={{marginBottom:"12px"}}>
              <PanelLabel color="var(--red)">BOS / CHOCH EVENTS</PanelLabel>
              <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
                {[...(analysis.struct.bos||[]),...(analysis.struct.choch||[])].slice(-10).map((e,i)=>(
                  <div key={i} style={{padding:"8px 14px",background:e.label?.includes("CHOCH")?"rgba(170,68,255,0.1)":"var(--amber-ghost)",border:`1px solid ${e.label?.includes("CHOCH")?"#aa44ff":"var(--amber)"}55`,fontSize:"10px",letterSpacing:"2px",color:e.label?.includes("CHOCH")?"#aa44ff":"var(--amber)"}}>
                    <div style={{fontWeight:700}}>{e.label}</div>
                    <div style={{fontSize:"8px",opacity:0.7,marginTop:"2px"}}>@ ${e.price?.toFixed(e.price<1?6:3)}</div>
                  </div>
                ))}
                {analysis.struct.bos?.length===0&&analysis.struct.choch?.length===0&&<div style={{fontSize:"9px",color:"var(--text-muted)",padding:"8px"}}>NO STRUCTURE BREAKS DETECTED</div>}
              </div>
            </Panel>
            <Panel>
              <PanelLabel color="var(--blue)">LIQUIDITY PRESSURE</PanelLabel>
              <div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:"16px"}}>
                <div><div style={{fontSize:"7px",color:"var(--text-muted)",marginBottom:"4px"}}>SCORE</div><div style={{fontSize:"36px",fontWeight:800,color:analysis.liq.score>70?"var(--red)":analysis.liq.score>40?"var(--amber)":"var(--neon)"}}>{analysis.liq.score}</div><div style={{fontSize:"8px",color:"var(--text-muted)"}}>/100</div></div>
                <div>
                  <div style={{height:"8px",background:"var(--bg-deep)",border:"1px solid var(--border)",marginBottom:"8px"}}><div style={{height:"100%",width:`${analysis.liq.score}%`,background:`linear-gradient(90deg,var(--neon-dim),${analysis.liq.score>70?"var(--red)":"var(--neon)"})`}}/></div>
                  <div style={{fontSize:"8px",color:"var(--text-muted)",marginBottom:"6px",letterSpacing:"2px"}}>HIGH-VOLUME ZONES</div>
                  {analysis.liq.zones.map((z,i)=>{const dist=meta.price?Math.abs(z-meta.price)/meta.price:0;const col=dist<0.02?"var(--red)":dist<0.05?"var(--amber)":"var(--neon)";return(<div key={i} style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"3px"}}><div style={{height:"10px",width:`${60+i*5}%`,background:`${col}33`,border:`1px solid ${col}44`}}/><span style={{fontSize:"9px",color:col}}>${z.toFixed(z<0.01?8:4)}</span>{dist<0.02&&<Badge label="NEAR" color="var(--red)"/>}</div>);})}
                </div>
              </div>
            </Panel>
          </>
        )}

        {tab==="BACKTEST"&&(
          <>
            {!analysis?.bt?(
              <Panel><div style={{padding:"30px",textAlign:"center"}}><div style={{fontSize:"24px",opacity:0.2,marginBottom:"12px"}}>⚠</div><div style={{fontSize:"10px",color:"var(--amber)",letterSpacing:"3px",marginBottom:"6px"}}>INSUFFICIENT DATA</div><div style={{fontSize:"8px",color:"var(--text-muted)"}}>Requires ≥ 120 OHLCV bars. Try a longer timeframe.</div></div></Panel>
            ):(
              <>
                <div style={{padding:"8px 12px",background:"rgba(255,170,0,0.06)",border:"1px solid rgba(255,170,0,0.25)",marginBottom:"12px"}}>
                  <div style={{fontSize:"10px",color:"var(--amber)",letterSpacing:"2px",fontWeight:700}}>PURGED CROSS-VALIDATION — {analysis.bt.cost} — EMBARGO {analysis.bt.embargo} BARS</div>
                  <div style={{fontSize:"8px",color:"var(--text-muted)",marginTop:"3px"}}>IS: 0→{analysis.bt.splitIdx} | Embargo: {analysis.bt.embargo}b | OOS: blind test | Confluence ≥3 signals | Slippage+Fee: {((TRADE_FEE+SLIPPAGE)*2*100).toFixed(3)}% RT</div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"12px"}}>
                  {[{label:"IN-SAMPLE",d:analysis.bt.inSample,color:"var(--neon-dim)",badge:"TRAINING"},{label:"OUT-OF-SAMPLE",d:analysis.bt.oos,color:"var(--neon)",badge:"BLIND TEST"}].map(({label,d,color,badge})=>(
                    <Panel key={label} style={{borderColor:color+"44"}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:"10px"}}><PanelLabel color={color}>{label}</PanelLabel><Badge label={badge} color={color}/></div>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
                        <Metric label="WIN RATE" value={`${d.wr?.toFixed(1)}%`} color={d.wr>=50?"var(--neon)":"var(--red)"}/>
                        <Metric label="PROFIT FACTOR" value={d.pf>=99?"∞":d.pf?.toFixed(2)} color={d.pf>=1.5?"var(--neon)":"var(--amber)"}/>
                        <Metric label="MAX DRAWDOWN" value={`${d.mdd?.toFixed(1)}%`} color={d.mdd<=20?"var(--neon)":"var(--red)"}/>
                        <Metric label="SHARPE RATIO" value={d.sharpe?.toFixed(2)} color={d.sharpe>=1?"var(--neon)":"var(--amber)"}/>
                        <Metric label="EXPECTANCY" value={`$${d.expectancy?.toFixed(2)}`} color={d.expectancy>0?"var(--neon)":"var(--red)"}/>
                        <Metric label="TRADES" value={d.trades} color="var(--text-secondary)"/>
                      </div>
                      <div style={{marginTop:"8px",padding:"5px 8px",background:"var(--bg-deep)",border:"1px solid var(--border)",display:"flex",justifyContent:"space-between",fontSize:"8px",color:"var(--text-muted)"}}>
                        <span>BLOCKED (QUARANTINE): {d.quarantineCount}</span>
                      </div>
                    </Panel>
                  ))}
                </div>
                <Panel style={{height:"170px",padding:"10px",marginBottom:"12px"}}>
                  <PanelLabel>EQUITY CURVE // IS (dim) → PURGE EMBARGO → OOS (bright)</PanelLabel>
                  <div style={{height:"calc(100% - 28px)"}}><EquityChart isData={analysis.bt.inSample.equityCurve} oosData={analysis.bt.oos.equityCurve}/></div>
                </Panel>
                <Panel>
                  <PanelLabel color="var(--red)">QUARANTINE RULES — ENTRY BLOCKED WHEN:</PanelLabel>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px"}}>
                    {[{r:"H ∈ [0.38, 0.45]",d:"Hurst ambiguity zone — boundary of random walk. No statistical edge."},{r:"EXTREME VOLATILITY",d:"ATR% > 8%. Position sizing collapses to 0.25×. Tail risk too high."},{r:"BOS + CHOCH CONFLICT",d:"Simultaneous bullish BOS + CHOCH bearish. Conflicting market structure."}].map(x=>(
                      <div key={x.r} style={{padding:"10px",background:"var(--red-ghost)",border:"1px solid rgba(255,42,42,0.2)"}}><div style={{fontSize:"9px",color:"var(--red)",fontWeight:700,marginBottom:"4px"}}>⛔ {x.r}</div><div style={{fontSize:"8px",color:"var(--text-muted)",lineHeight:1.5}}>{x.d}</div></div>
                    ))}
                  </div>
                </Panel>
              </>
            )}
          </>
        )}

        {tab==="V2 REGIME"&&(
          <>
            {!v2?(
              <Panel><div style={{padding:"30px",textAlign:"center"}}><div style={{fontSize:"10px",color:"var(--amber)",letterSpacing:"3px"}}>INSUFFICIENT DATA FOR V2 ANALYSIS</div></div></Panel>
            ):(
              <>
                {/* Level 1 — Chaos Gate */}
                <Panel style={{marginBottom:"8px",borderColor:v2.chaos.hardKill?"var(--red)":v2.chaos.softKill?"var(--amber)":"var(--neon)"}}>
                  <PanelLabel color={v2.chaos.hardKill?"var(--red)":v2.chaos.softKill?"var(--amber)":"var(--neon)"}>LVL 1 — CHAOS GATE</PanelLabel>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:"8px"}}>
                    <div style={{padding:"10px",background:v2.chaos.hardKill?"var(--red-ghost)":v2.chaos.softKill?"var(--amber-ghost)":"var(--neon-ghost)",border:`1px solid ${v2.chaos.hardKill?"var(--red)":v2.chaos.softKill?"var(--amber)":"var(--neon-dim)"}`,textAlign:"center"}}>
                      <div style={{fontSize:"7px",color:"var(--text-muted)",letterSpacing:"2px",marginBottom:"4px"}}>STATUS</div>
                      <div style={{fontSize:"9px",fontWeight:800,color:v2.chaos.hardKill?"var(--red)":v2.chaos.softKill?"var(--amber)":"var(--neon)",letterSpacing:"2px"}}>{v2.chaos.status.replace(/_/g," ")}</div>
                    </div>
                    <div style={{padding:"10px",background:"var(--bg-deep)",border:"1px solid var(--border)",textAlign:"center"}}>
                      <div style={{fontSize:"7px",color:"var(--text-muted)",letterSpacing:"2px",marginBottom:"4px"}}>PERM ENTROPY</div>
                      <div style={{fontSize:"18px",fontWeight:800,color:v2.chaos.pe>0.75?"var(--red)":v2.chaos.pe>0.6?"var(--amber)":"var(--neon)"}}>{v2.chaos.pe.toFixed(3)}</div>
                      <div style={{fontSize:"7px",color:"var(--text-muted)"}}>threshold 0.75</div>
                    </div>
                    <div style={{padding:"10px",background:"var(--bg-deep)",border:"1px solid var(--border)",textAlign:"center"}}>
                      <div style={{fontSize:"7px",color:"var(--text-muted)",letterSpacing:"2px",marginBottom:"4px"}}>LYAPUNOV λ</div>
                      <div style={{fontSize:"18px",fontWeight:800,color:v2.chaos.lambda>ChaosEngine.LYAPUNOV_BUFFER?"var(--red)":"var(--neon)"}}>{v2.chaos.lambda.toFixed(4)}</div>
                      <div style={{fontSize:"7px",color:"var(--text-muted)"}}>buffer {ChaosEngine.LYAPUNOV_BUFFER}</div>
                    </div>
                    <div style={{padding:"10px",background:"var(--bg-deep)",border:"1px solid var(--border)",textAlign:"center"}}>
                      <div style={{fontSize:"7px",color:"var(--text-muted)",letterSpacing:"2px",marginBottom:"4px"}}>CHAOS MULT</div>
                      <div style={{fontSize:"18px",fontWeight:800,color:"var(--blue)"}}>{v2.chaos.chaosMult.toFixed(3)}</div>
                      <div style={{fontSize:"7px",color:"var(--text-muted)"}}>→ sizing</div>
                    </div>
                  </div>
                </Panel>

                {/* Level 2 — Regime */}
                <Panel style={{marginBottom:"8px",borderColor:v2.regime.confLabel==="STRONG"?"var(--neon)":v2.regime.confLabel==="WEAK"?"var(--amber)":"var(--red)"}}>
                  <PanelLabel color={v2.regime.confLabel==="STRONG"?"var(--neon)":v2.regime.confLabel==="WEAK"?"var(--amber)":"var(--red)"}>LVL 2 — REGIME DETECTION</PanelLabel>
                  <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:"8px"}}>
                    <div style={{padding:"12px",textAlign:"center",background:v2.regime.regime==="TREND"?"var(--neon-ghost)":v2.regime.regime==="SIDEWAYS"?"var(--blue-ghost)":"var(--amber-ghost)",border:`1px solid ${v2.regime.regime==="TREND"?"var(--neon-dim)":v2.regime.regime==="SIDEWAYS"?"var(--blue)":"var(--amber)"}`}}>
                      <div style={{fontSize:"20px",fontWeight:800,letterSpacing:"4px",color:v2.regime.regime==="TREND"?"var(--neon)":v2.regime.regime==="SIDEWAYS"?"var(--blue)":"var(--amber)"}}>{v2.regime.regime}</div>
                      <div style={{fontSize:"8px",color:"var(--text-muted)",marginTop:"4px"}}>{v2.regime.confLabel}</div>
                    </div>
                    <div style={{padding:"10px",background:"var(--bg-deep)",border:"1px solid var(--border)",textAlign:"center"}}>
                      <div style={{fontSize:"7px",color:"var(--text-muted)",marginBottom:"4px"}}>CONFIDENCE</div>
                      <div style={{fontSize:"22px",fontWeight:800,color:v2.regime.confidence>0.7?"var(--neon)":v2.regime.confidence>=0.55?"var(--amber)":"var(--red)"}}>{(v2.regime.confidence*100).toFixed(0)}%</div>
                    </div>
                    <div style={{padding:"10px",background:"var(--bg-deep)",border:"1px solid var(--border)",textAlign:"center"}}>
                      <div style={{fontSize:"7px",color:"var(--text-muted)",marginBottom:"4px"}}>REGIME MULT</div>
                      <div style={{fontSize:"22px",fontWeight:800,color:"var(--blue)"}}>{v2.regime.regimeMult.toFixed(3)}</div>
                    </div>
                  </div>
                  <div style={{marginTop:"8px",display:"flex",gap:"6px"}}>
                    {["TREND","MEAN_REVERT","SIDEWAYS"].map(r=>(
                      <div key={r} style={{flex:1,padding:"5px",textAlign:"center",background:v2.regime.regime===r?"var(--neon-ghost)":"var(--bg-deep)",border:`1px solid ${v2.regime.regime===r?"var(--neon-dim)":"var(--border)"}`,fontSize:"8px",color:v2.regime.regime===r?"var(--neon)":"var(--text-muted)"}}>{r.replace("_"," ")}</div>
                    ))}
                  </div>
                </Panel>

                {/* Level 3 — Execution Scoring */}
                <Panel style={{marginBottom:"8px",borderColor:v2.exec.execute?"var(--neon)":"var(--border)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"10px"}}>
                    <PanelLabel color={v2.exec.execute?"var(--neon)":"var(--amber)"}>LVL 3 — EXECUTION SCORING [{v2.exec.score}/6]</PanelLabel>
                    <Badge label={v2.exec.execute?"EXECUTE ≥4":"HOLD <4"} color={v2.exec.execute?"var(--neon)":"var(--red)"}/>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:"4px",marginBottom:"10px"}}>
                    {v2.exec.details.map((d,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:"8px",padding:"7px 10px",background:d.active?"var(--neon-ghost)":"var(--bg-deep)",border:`1px solid ${d.active?"var(--neon-dim)33":"var(--border)"}`,}}>
                        <span style={{color:d.active?"var(--neon)":"var(--text-dead)",fontSize:"10px"}}>{d.active?"●":"○"}</span>
                        <span style={{flex:1,fontSize:"9px",color:d.active?"var(--text-primary)":"var(--text-muted)",letterSpacing:"1px"}}>{d.label}</span>
                        <span style={{fontSize:"9px",fontWeight:800,color:d.active?"var(--neon)":"var(--text-muted)"}}>+{d.weight}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                    <div style={{padding:"8px",background:"var(--bg-deep)",border:"1px solid var(--border)"}}>
                      <div style={{fontSize:"7px",color:"var(--text-muted)",marginBottom:"3px"}}>KALMAN CLEAN PRICE</div>
                      <div style={{fontSize:"13px",color:"var(--blue)",fontWeight:700}}>${fmtP(v2.kalmanClean)}</div>
                    </div>
                    <div style={{padding:"8px",background:"var(--bg-deep)",border:"1px solid var(--border)"}}>
                      <div style={{fontSize:"7px",color:"var(--text-muted)",marginBottom:"3px"}}>RLS SLOPE</div>
                      <div style={{fontSize:"13px",color:v2.rlsSlope==="UP"?"var(--neon)":v2.rlsSlope==="DOWN"?"var(--red)":"var(--amber)",fontWeight:700}}>{v2.rlsSlope}</div>
                    </div>
                  </div>
                </Panel>

                {/* Level 4 — Position Sizing */}
                <Panel style={{marginBottom:"8px",borderColor:v2.sizing.blocked?"var(--red)":"var(--blue)"}}>
                  <PanelLabel color="var(--blue)">LVL 4 — POSITION SIZING ENGINE</PanelLabel>
                  {v2.sizing.blocked?(
                    <div style={{padding:"12px",textAlign:"center",background:"var(--red-ghost)",border:"1px solid var(--red)33",fontSize:"10px",color:"var(--red)",letterSpacing:"3px"}}>⛔ BLOCKED — {v2.sizing.blocked.replace(/_/g," ")}</div>
                  ):(
                    <>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"8px",marginBottom:"8px"}}>
                        {[
                          {label:"RISK",val:v2.sizing.risk,color:"var(--amber)"},
                          {label:"REGIME MULT",val:v2.sizing.regimeMult,color:"var(--neon)"},
                          {label:"VOL MULT",val:v2.sizing.volMult,color:"var(--blue)"},
                          {label:"FINAL SIZE",val:`${v2.sizing.pct}%`,color:v2.sizing.pct>60?"var(--neon)":v2.sizing.pct>30?"var(--amber)":"var(--red)"},
                        ].map(m=>(
                          <div key={m.label} style={{padding:"10px",background:"var(--bg-deep)",border:"1px solid var(--border)",textAlign:"center"}}>
                            <div style={{fontSize:"7px",color:"var(--text-muted)",marginBottom:"4px"}}>{m.label}</div>
                            <div style={{fontSize:"16px",fontWeight:800,color:m.color}}>{typeof m.val==="number"?m.val.toFixed(3):m.val}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{height:"8px",background:"var(--bg-deep)",border:"1px solid var(--border)"}}>
                        <div style={{height:"100%",width:`${v2.sizing.pct}%`,background:`linear-gradient(90deg,var(--blue),var(--neon))`,transition:"width 0.5s"}}/>
                      </div>
                      <div style={{fontSize:"8px",color:"var(--text-muted)",marginTop:"4px",textAlign:"center"}}>risk=(1-PE)×(1-λ_norm) × regime × vol_adj — no double penalty</div>
                    </>
                  )}
                </Panel>

                {/* Level 5 — Exit Logic */}
                <Panel style={{borderColor:v2.exitSignal.shouldExit?"var(--red)":"var(--border)"}}>
                  <PanelLabel color={v2.exitSignal.shouldExit?"var(--red)":"var(--neon)"}>LVL 5 — EXIT LOGIC MONITOR</PanelLabel>
                  <div style={{padding:"12px",textAlign:"center",background:v2.exitSignal.shouldExit?"var(--red-ghost)":"var(--neon-ghost)",border:`1px solid ${v2.exitSignal.shouldExit?"var(--red)":"var(--neon-dim)"}33`,marginBottom:"8px"}}>
                    <div style={{fontSize:"14px",fontWeight:800,letterSpacing:"4px",color:v2.exitSignal.shouldExit?"var(--red)":"var(--neon)"}}>{v2.exitSignal.shouldExit?"⚠ EXIT SIGNAL ACTIVE":"✓ HOLD — NO EXIT TRIGGER"}</div>
                  </div>
                  {v2.exitSignal.reasons.length>0&&(
                    <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
                      {v2.exitSignal.reasons.map((r,i)=>(
                        <div key={i} style={{padding:"6px 10px",background:"var(--red-ghost)",border:"1px solid var(--red)22",fontSize:"9px",color:"var(--red)",letterSpacing:"2px"}}>⛔ {r}</div>
                      ))}
                    </div>
                  )}
                  <div style={{marginTop:"8px",fontSize:"8px",color:"var(--text-muted)",lineHeight:1.8,padding:"6px",background:"var(--bg-deep)"}}>
                    Dynamic Trailing: Close if Price &lt; Kalman OR RLS flips DOWN<br/>
                    Regime Invalidation: Reduce/Close if regime shifts mid-trade
                  </div>
                </Panel>
              </>
            )}
          </>
        )}

          <>
            <SignalCard trade={analysis.scoreData.trade} symbol={meta.symbol||asset.symbol}/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginTop:"8px"}}>
              <Panel>
                <PanelLabel color="var(--amber)">ACTIVE BEHAVIOR</PanelLabel>
                <div style={{padding:"20px",textAlign:"center",marginBottom:"10px",background:analysis.beh.type==="fomo"?"var(--amber-ghost)":analysis.beh.type==="accum"?"var(--neon-ghost)":analysis.beh.type!=="neutral"?"var(--red-ghost)":"var(--bg-deep)",border:"1px solid var(--border-bright)"}}>
                  <div style={{fontSize:"16px",fontWeight:800,letterSpacing:"3px",color:analysis.beh.type==="fomo"?"var(--amber)":analysis.beh.type==="accum"?"var(--neon)":analysis.beh.type!=="neutral"?"var(--red)":"var(--text-muted)"}}>{analysis.beh.label}</div>
                </div>
                {[{type:"accum",label:"ACCUMULATION",color:"var(--neon)",desc:"Smart money building position."},{type:"dist",label:"DISTRIBUTION",color:"var(--red)",desc:"Exits in progress. Vol spike."},{type:"fomo",label:"FOMO SPIKE",color:"var(--amber)",desc:"Late retail. Vol 2.5×avg."},{type:"stophunt",label:"STOP HUNT",color:"var(--purple)",desc:"Liquidity grab + sharp reversal."},{type:"neutral",label:"NEUTRAL/RANGE",color:"var(--text-muted)",desc:"No clear behavioral pattern."}].map(b=>(
                  <div key={b.type} style={{padding:"6px 10px",marginBottom:"3px",display:"flex",justifyContent:"space-between",alignItems:"center",background:analysis.beh.type===b.type?`${b.color}11`:"var(--bg-deep)",border:`1px solid ${analysis.beh.type===b.type?b.color:"var(--border)"}44`,opacity:analysis.beh.type===b.type?1:0.4}}>
                    <div><span style={{fontSize:"9px",color:b.color,fontWeight:700,letterSpacing:"2px"}}>{b.label}</span><div style={{fontSize:"7px",color:"var(--text-muted)"}}>{b.desc}</div></div>
                    {analysis.beh.type===b.type&&<span style={{color:b.color,fontSize:"14px"}}>●</span>}
                  </div>
                ))}
              </Panel>
              <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                <Panel>
                  <PanelLabel color="var(--blue)">VOLATILITY SCALING</PanelLabel>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                    <Metric label="ATR VALUE" value={`$${analysis.vol.atr?.toFixed(6)}`} color="var(--blue)"/>
                    <Metric label="ATR %" value={`${analysis.vol.pct?.toFixed(2)}%`} color="var(--blue)"/>
                    <Metric label="REGIME" value={analysis.vol.regime} color={analysis.vol.regime==="EXTREME"?"var(--red)":"var(--amber)"}/>
                    <Metric label="SIZE MULT" value={`${analysis.vol.sizeMult}×`} color="var(--neon)"/>
                  </div>
                  <div style={{marginTop:"8px",fontSize:"8px",color:"var(--text-muted)",lineHeight:1.8,padding:"6px",background:"var(--bg-deep)"}}>
                    Stop = 2× ATR × SizeMult<br/>Target = 3× stop (3:1 R:R)<br/>Fee+Slip = {((TRADE_FEE+SLIPPAGE)*2*100).toFixed(3)}% per trade
                  </div>
                </Panel>
                <Panel style={{flex:1}}>
                  <PanelLabel>CONFLUENCE SCORE</PanelLabel>
                  {analysis.scoreData.signals.map((s,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:"8px",padding:"5px 0",borderBottom:"1px solid var(--border)"}}>
                      <span style={{color:s.active&&s.weight>0?"var(--neon)":s.active&&s.weight<0?"var(--red)":"var(--text-dead)",fontSize:"10px",width:"12px",textAlign:"center"}}>{s.active&&s.weight>0?"●":s.active&&s.weight<0?"✕":"○"}</span>
                      <span style={{fontSize:"8px",color:s.active?"var(--text-primary)":"var(--text-muted)",flex:1,letterSpacing:"1px"}}>{s.label}</span>
                      <span style={{fontSize:"9px",fontWeight:700,color:s.weight>0?"var(--neon)":s.weight<0?"var(--red)":"var(--text-muted)"}}>{s.weight>0?"+":""}{s.weight}</span>
                    </div>
                  ))}
                  <div style={{marginTop:"8px",padding:"8px",background:"var(--bg-deep)",border:"1px solid var(--border-bright)",textAlign:"center"}}>
                    <div style={{fontSize:"8px",color:"var(--text-muted)"}}>TOTAL SCORE</div>
                    <div style={{fontSize:"30px",fontWeight:800,color:analysis.scoreData.score>=60?"var(--neon)":analysis.scoreData.score<30?"var(--red)":"var(--amber)",textShadow:analysis.scoreData.score>=70?"0 0 20px var(--neon-glow)":"none"}}>{analysis.scoreData.score}</div>
                    <div style={{fontSize:"10px",letterSpacing:"3px",color:"var(--text-secondary)"}}>{analysis.scoreData.grade}</div>
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
// ROOT APP
// ============================================================
export default function App() {
  const [watchlist,setWatchlist]=useState([
    {address:"0x6b175474e89094c44da98b954eedeac495271d0f",symbol:"DAI",name:"Dai Stablecoin",type:"evm",chain:"ethereum"},
    {address:"0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",symbol:"WETH",name:"Wrapped Ether",type:"evm",chain:"ethereum"},
  ]);
  const [selected,setSelected]=useState(null);
  const [tf,setTf]=useState(TIMEFRAMES[3]);
  const [time,setTime]=useState("");
  const [cache,setCache]=useState({});

  const {data,loading}=useAssetData(selected,tf);

  useEffect(()=>{
    if(data&&selected){const k=selected.address||selected.symbol;setCache(p=>({...p,[k]:data}));}
  },[data]);

  useEffect(()=>{
    const style=document.createElement("style");style.textContent=GLOBAL_CSS;document.head.appendChild(style);
    return()=>document.head.removeChild(style);
  },[]);

  useEffect(()=>{
    const t=setInterval(()=>setTime(new Date().toISOString().replace("T"," ").slice(0,19)+" UTC"),1000);
    setTime(new Date().toISOString().replace("T"," ").slice(0,19)+" UTC");
    return()=>clearInterval(t);
  },[]);

  const addToWatchlist=useCallback((a)=>{
    if(watchlist.length>=5)return;
    const k=a.address||a.symbol;
    if(watchlist.find(t=>(t.address||t.symbol)===k))return;
    setWatchlist(p=>[...p,a]);
  },[watchlist]);

  const removeFromWatchlist=useCallback((k)=>{
    setWatchlist(p=>p.filter(t=>(t.address||t.symbol)!==k));
    if(selected&&(selected.address||selected.symbol)===k)setSelected(null);
  },[selected]);

  const inWatchlist=selected?!!watchlist.find(t=>(t.address||t.symbol)===(selected.address||selected.symbol)):false;

  return (
    <div style={{minHeight:"100vh",height:"100vh",background:"var(--bg-void)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <style>{`@keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <ScanLine/>

      {/* Top Bar */}
      <div style={{background:"var(--bg-void)",borderBottom:"1px solid var(--border)",padding:"6px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:"16px"}}>
          <span onClick={()=>setSelected(null)} style={{fontSize:"13px",fontWeight:800,color:"var(--neon)",letterSpacing:"4px",textShadow:"0 0 10px var(--neon-glow)",cursor:"pointer"}}>⬡ CHAINWATCH</span>
          <span style={{fontSize:"8px",color:"var(--text-muted)",letterSpacing:"3px"}}>MULTI-MARKET SURVEILLANCE v3.0</span>
          {selected&&<><span style={{fontSize:"8px",color:"var(--text-muted)"}}>/ {selected.symbol}</span>{!inWatchlist&&<button onClick={()=>addToWatchlist(selected)} style={{padding:"3px 8px",background:"none",border:"1px solid var(--border-bright)",color:"var(--text-muted)",fontSize:"8px",letterSpacing:"1px"}}>☆ WATCH</button>}{inWatchlist&&<Badge label="★ WATCHING" color="var(--neon)"/>}</>}
        </div>
        <div style={{display:"flex",gap:"10px",alignItems:"center"}}>
          <span style={{fontSize:"7px",color:"var(--neon)",animation:"pulse 2s infinite",letterSpacing:"2px"}}>● LIVE</span>
          <span style={{fontSize:"8px",color:"var(--text-muted)",letterSpacing:"1px"}}>{time}</span>
          <Badge label="MF-DFA" color="var(--purple)"/>
          <Badge label="OOS" color="var(--blue)"/>
          <Badge label="v4" color="var(--neon)"/>
        </div>
      </div>

      <AlertTicker watchlist={watchlist} cache={cache}/>

      <div style={{flex:1,display:"grid",gridTemplateColumns:"180px 1fr",overflow:"hidden"}}>
        <div style={{borderRight:"1px solid var(--border)",background:"var(--bg-deep)",overflow:"hidden"}}>
          <Sidebar watchlist={watchlist} active={selected} onSelect={setSelected} onHome={()=>setSelected(null)} onAdd={addToWatchlist} onRemove={removeFromWatchlist}/>
        </div>
        <div style={{overflow:"auto",background:"var(--bg-void)"}}>
          {!selected
            ?<HomeScreen onSelect={setSelected} watchlist={watchlist}/>
            :<Dashboard asset={selected} data={data} loading={loading}/>
          }
        </div>
      </div>
    </div>
  );
}
