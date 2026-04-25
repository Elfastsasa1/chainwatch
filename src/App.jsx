import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ============================================================
// CONFIG — Ganti TWELVE_API_KEY dengan key kamu
// ============================================================
const TWELVE_API_KEY = "ea45542dc91f43eb9eb2ce2e83d518da";
const DEXSCREENER_BASE = "https://api.dexscreener.com/latest/dex";
const GECKO_BASE = "https://api.geckoterminal.com/api/v2";
const TWELVE_BASE = "https://api.twelvedata.com";

// ============================================================
// POPULAR ASSETS — Home Screen Grid
// ============================================================
const POPULAR_CRYPTO = [
  { symbol: "BTC/USD", name: "Bitcoin", type: "crypto12", icon: "₿" },
  { symbol: "ETH/USD", name: "Ethereum", type: "crypto12", icon: "Ξ" },
  { symbol: "BNB/USD", name: "BNB", type: "crypto12", icon: "◈" },
  { symbol: "SOL/USD", name: "Solana", type: "crypto12", icon: "◎" },
  { symbol: "ARB/USD", name: "Arbitrum", type: "crypto12", icon: "△" },
  { symbol: "MATIC/USD", name: "Polygon", type: "crypto12", icon: "⬡" },
];
const POPULAR_STOCKS = [
  { symbol: "AAPL", name: "Apple", type: "stock", icon: "" },
  { symbol: "TSLA", name: "Tesla", type: "stock", icon: "⚡" },
  { symbol: "NVDA", name: "Nvidia", type: "stock", icon: "◧" },
  { symbol: "MSFT", name: "Microsoft", type: "stock", icon: "⊞" },
  { symbol: "AMZN", name: "Amazon", type: "stock", icon: "◉" },
  { symbol: "META", name: "Meta", type: "stock", icon: "∞" },
];
const POPULAR_FOREX = [
  { symbol: "EUR/USD", name: "Euro/Dollar", type: "forex", icon: "€" },
  { symbol: "GBP/USD", name: "Pound/Dollar", type: "forex", icon: "£" },
  { symbol: "USD/JPY", name: "Dollar/Yen", type: "forex", icon: "¥" },
  { symbol: "XAU/USD", name: "Gold", type: "forex", icon: "◆" },
];

// ============================================================
// GLOBAL CSS
// ============================================================
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700;800&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg-void: #000000; --bg-deep: #050505; --bg-panel: #0a0a0a;
    --bg-card: #0d0d0d; --bg-hover: #141414; --border: #1a1a1a;
    --border-bright: #252525; --neon: #00ff41; --neon-dim: #00cc33;
    --neon-ghost: rgba(0,255,65,0.08); --neon-glow: rgba(0,255,65,0.25);
    --red: #ff2a2a; --red-ghost: rgba(255,42,42,0.08);
    --amber: #ffaa00; --amber-ghost: rgba(255,170,0,0.08);
    --blue: #00aaff; --blue-ghost: rgba(0,170,255,0.08);
    --purple: #aa44ff; --purple-ghost: rgba(170,68,255,0.08);
    --text-primary: #e0ffe0; --text-secondary: #7aaa7a;
    --text-muted: #3a5a3a; --text-dead: #1a2a1a;
    --font: 'JetBrains Mono', 'Courier New', monospace;
    --scanline: repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,255,65,0.012) 2px,rgba(0,255,65,0.012) 4px);
    --card-radius: 2px;
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
  @keyframes scanIn{from{opacity:0}to{opacity:1}}
  .fade-in{animation:fadeIn 0.3s ease forwards;}
  .card-hover{transition:border-color 0.15s,background 0.15s;}
  .card-hover:hover{background:var(--bg-hover)!important;border-color:var(--neon-dim)!important;}
`;

// ============================================================
// MATH UTILS (Fractal Engine — unchanged from v1)
// ============================================================
const MathUtils = {
  generateMockOHLCV(days=180, basePrice=1.0) {
    const data=[]; let price=basePrice, vol=0.03;
    const now=Date.now(), ms=86400000;
    for(let i=days;i>=0;i--) {
      vol=Math.max(0.005,Math.min(0.15,vol*(0.95+Math.random()*0.15)));
      const open=price, change=(Math.random()-0.48)*vol*price;
      const high=open+Math.abs(change)*(1+Math.random()*0.5);
      const low=open-Math.abs(change)*(1+Math.random()*0.5);
      const close=open+change; price=Math.max(0.0001,close);
      const volume=basePrice*1e6*(0.5+Math.random()*2)*(1+Math.abs(change/price)*10);
      data.push({time:Math.floor((now-i*ms)/1000),open:Math.max(0.0001,open),high:Math.max(open,Math.max(0.0001,high)),low:Math.min(open,Math.max(0.0001,low)),close:Math.max(0.0001,close),volume});
    }
    return data;
  },
  hurstRS(series) {
    if(series.length<20) return 0.5;
    const n=series.length, mean=series.reduce((a,b)=>a+b,0)/n;
    const dev=series.map(x=>x-mean); let cum=0,mx=-Infinity,mn=Infinity;
    for(const d of dev){cum+=d;if(cum>mx)mx=cum;if(cum<mn)mn=cum;}
    const R=mx-mn, S=Math.sqrt(dev.reduce((a,b)=>a+b*b,0)/n);
    return S===0?0.5:Math.log(R/S)/Math.log(n/2);
  },
  computeHq(returns,qRange=[-3,-2,-1,0,1,2,3]) {
    if(returns.length<30) return qRange.map(q=>({q,h:0.5}));
    return qRange.map(q=>{
      if(q===0) return {q,h:this.hurstRS(returns)};
      const absR=returns.map(r=>Math.abs(r)+1e-10);
      const moments=absR.map(r=>Math.pow(r,q));
      const mm=moments.reduce((a,b)=>a+b,0)/moments.length;
      return {q,h:Math.max(0.05,Math.min(0.95,0.5+(Math.log(mm+1e-10)/(q*3+1e-10))*0.1))};
    });
  },
  fractalDimension(prices) {
    if(prices.length<10) return 1.5;
    const H=this.hurstRS(prices.map((p,i)=>i>0?Math.log(p/prices[i-1]):0).slice(1));
    return Math.max(1.0,Math.min(2.0,2-H));
  },
  detectFractalBreakdown(returns,winSize=30) {
    const signals=[];
    for(let i=winSize;i<returns.length;i++){
      const H=this.hurstRS(returns.slice(i-winSize,i));
      if(H<0.35) signals.push({i,type:"ANTI_PERSISTENT",H,label:"BREAKDOWN"});
      else if(H>0.72) signals.push({i,type:"PERSISTENT",H,label:"TRENDING"});
    }
    return signals;
  },
  atr(ohlcv,period=14) {
    if(ohlcv.length<period+1) return 0;
    const trs=[];
    for(let i=1;i<ohlcv.length;i++){const h=ohlcv[i].high,l=ohlcv[i].low,pc=ohlcv[i-1].close;trs.push(Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc)));}
    return trs.slice(-period).reduce((a,b)=>a+b,0)/period;
  },
  detectStructure(ohlcv,lookback=10) {
    if(ohlcv.length<lookback*2) return {swings:[],bos:[],choch:[]};
    const highs=ohlcv.map(c=>c.high), lows=ohlcv.map(c=>c.low);
    const sH=[],sL=[];
    for(let i=lookback;i<ohlcv.length-lookback;i++){
      if(highs[i]===Math.max(...highs.slice(i-lookback,i+lookback))) sH.push({i,price:highs[i]});
      if(lows[i]===Math.min(...lows.slice(i-lookback,i+lookback))) sL.push({i,price:lows[i]});
    }
    const swings=[],bos=[],choch=[]; let pH=null,pL=null,trend="neutral";
    for(const sh of sH.slice(-8)){if(pH){const t=sh.price>pH.price?"HH":"LH";swings.push({...sh,type:t});if(t==="HH"&&trend==="down"){choch.push({...sh,label:"CHOCH"});trend="up";}else if(t==="HH"){bos.push({...sh,label:"BOS"});trend="up";}}pH=sh;}
    for(const sl of sL.slice(-8)){if(pL){const t=sl.price<pL.price?"LL":"HL";swings.push({...sl,type:t});if(t==="LL"&&trend==="up"){choch.push({...sl,label:"CHOCH"});trend="down";}else if(t==="LL"){bos.push({...sl,label:"BOS"});trend="down";}}pL=sl;}
    return {swings:swings.slice(-20),bos:bos.slice(-5),choch:choch.slice(-5)};
  },
  volRegime(ohlcv) {
    if(ohlcv.length<30) return {regime:"UNKNOWN",atr:0,pct:0};
    const a=this.atr(ohlcv), p=(a/ohlcv[ohlcv.length-1].close)*100;
    return {regime:p>8?"EXTREME":p>4?"HIGH":p>1.5?"MEDIUM":"LOW",atr:a,pct:p};
  },
  detectBehavior(ohlcv) {
    if(ohlcv.length<30) return {label:"SCANNING",type:"neutral"};
    const r=ohlcv.slice(-20), vols=r.map(c=>c.volume);
    const avgV=vols.reduce((a,b)=>a+b,0)/vols.length, lastV=vols[vols.length-1];
    const prices=r.map(c=>c.close), pt=(prices[prices.length-1]-prices[0])/prices[0];
    const vs=lastV/avgV;
    if(vs>2.5&&pt>0.05) return {label:"FOMO SPIKE",type:"fomo"};
    if(vs>2.0&&pt<-0.05) return {label:"STOP HUNT",type:"stophunt"};
    if(pt>0.02&&vs>1.3) return {label:"ACCUMULATION",type:"accum"};
    if(pt<-0.02&&vs>1.3) return {label:"DISTRIBUTION",type:"dist"};
    return {label:"RANGING / NEUTRAL",type:"neutral"};
  },
  liquidityPressure(ohlcv) {
    if(ohlcv.length<30) return {score:50,zones:[]};
    const r=ohlcv.slice(-50), pr=r.map(c=>({price:(c.high+c.low)/2,vol:c.volume}));
    const sorted=[...pr].sort((a,b)=>b.vol-a.vol).slice(0,5);
    const avgV=r.map(c=>c.volume).reduce((a,b)=>a+b,0)/r.length;
    return {score:Math.min(100,Math.floor((r[r.length-1].volume/avgV)*50)),zones:sorted.map(z=>z.price)};
  },
  blackHorseScore(ohlcv) {
    if(ohlcv.length<50) return {score:0,signals:[],grade:"SCANNING",H:0.5,vol:{regime:"UNKNOWN",atr:0,pct:0},struct:{swings:[],bos:[],choch:[]},behavior:{label:"SCANNING",type:"neutral"},liq:{score:0,zones:[]}};
    const returns=ohlcv.map((c,i)=>i>0?Math.log(c.close/ohlcv[i-1].close):0).slice(1);
    const H=this.hurstRS(returns.slice(-60)), vol=this.volRegime(ohlcv);
    const struct=this.detectStructure(ohlcv), behavior=this.detectBehavior(ohlcv), liq=this.liquidityPressure(ohlcv);
    const signals=[]; let score=0;
    if(H>0.6){signals.push({label:"PERSISTENT HURST",weight:20,active:true});score+=20;}
    else if(H<0.4){signals.push({label:"ANTI-PERSISTENT",weight:-10,active:true});score-=10;}
    else signals.push({label:"HURST NEUTRAL",weight:0,active:false});
    if(vol.regime==="MEDIUM"){signals.push({label:"OPTIMAL VOL",weight:15,active:true});score+=15;}
    else if(vol.regime==="EXTREME"){signals.push({label:"EXTREME VOL",weight:-20,active:true});score-=20;}
    else signals.push({label:"VOL: "+vol.regime,weight:0,active:false});
    if(struct.bos.length>0){signals.push({label:"BOS DETECTED",weight:25,active:true});score+=25;}
    if(struct.choch.length>0){signals.push({label:"CHOCH SIGNAL",weight:15,active:true});score+=15;}
    if(behavior.type==="accum"){signals.push({label:"ACCUMULATION",weight:20,active:true});score+=20;}
    if(behavior.type==="fomo"){signals.push({label:"FOMO CAUTION",weight:-15,active:true});score-=15;}
    if(behavior.type==="dist"){signals.push({label:"DISTRIBUTION",weight:-20,active:true});score-=20;}
    if(liq.score>70){signals.push({label:"HIGH LIQ PRESSURE",weight:10,active:true});score+=10;}
    const c=Math.max(0,Math.min(100,score));
    return {score:c,signals,grade:c>=80?"BLACK HORSE":c>=60?"STRONG":c>=40?"MODERATE":c<20?"AVOID":"WEAK",H,vol,struct,behavior,liq};
  },
  runBacktest(ohlcv,embargoDays=5) {
    if(ohlcv.length<100) return null;
    const si=Math.floor(ohlcv.length*0.65), IS=ohlcv.slice(0,si), OOS=ohlcv.slice(si+embargoDays);
    const runSim=(data)=>{
      const trades=[]; let equity=1000,inTrade=false,entryPrice=0,entryIdx=0,qc=0;
      const ec=[equity];
      for(let i=50;i<data.length-1;i++){
        const sl=data.slice(Math.max(0,i-60),i+1);
        const ret=sl.map((c,j)=>j>0?Math.log(c.close/sl[j-1].close):0).slice(1);
        const H=this.hurstRS(ret.slice(-30)), vol=this.volRegime(sl);
        const beh=this.detectBehavior(sl), str=this.detectStructure(sl,5);
        const isQ=(H<0.45&&H>0.38)||vol.regime==="EXTREME"||(str.bos.length>0&&str.choch.length>0);
        if(isQ){qc++;ec.push(equity);continue;}
        const ls=[H>0.58,vol.regime==="MEDIUM"||vol.regime==="LOW",beh.type==="accum",str.bos.some(b=>b.type==="HH")].filter(Boolean).length;
        if(!inTrade&&ls>=3){inTrade=true;entryPrice=data[i+1].open;entryIdx=i;}
        else if(inTrade){
          const hd=i-entryIdx, cp=data[i].close, pp=(cp-entryPrice)/entryPrice;
          const av=this.atr(sl), sd=av*2/entryPrice;
          if(pp<-sd||pp>sd*3||hd>20){const pnl=equity*pp*0.95;equity=Math.max(0.01,equity+pnl);trades.push({pnl,pnlPct:pp,win:pnl>0,holdDays:hd});inTrade=false;}
        }
        ec.push(equity);
      }
      return {trades,equity,equityCurve:ec,quarantineCount:qc};
    };
    const metrics=(sim)=>{
      if(!sim||sim.trades.length===0) return {wr:0,pf:0,mdd:0,sharpe:0,trades:0,quarantineCount:0,equityCurve:[1000]};
      const wins=sim.trades.filter(t=>t.win), wr=wins.length/sim.trades.length;
      const gp=wins.reduce((a,t)=>a+t.pnl,0), gl=Math.abs(sim.trades.filter(t=>!t.win).reduce((a,t)=>a+t.pnl,0));
      const pf=gl===0?99:gp/gl; let peak=1000,mdd=0;
      for(const e of sim.equityCurve){if(e>peak)peak=e;const d=(peak-e)/peak;if(d>mdd)mdd=d;}
      const dr=sim.equityCurve.map((e,i)=>i>0?(e-sim.equityCurve[i-1])/sim.equityCurve[i-1]:0).slice(1);
      const avg=dr.reduce((a,b)=>a+b,0)/(dr.length||1), std=Math.sqrt(dr.reduce((a,b)=>a+Math.pow(b-avg,2),0)/(dr.length||1));
      return {wr:wr*100,pf,mdd:mdd*100,sharpe:std===0?0:(avg/std)*Math.sqrt(252),trades:sim.trades.length,quarantineCount:sim.quarantineCount,equityCurve:sim.equityCurve};
    };
    return {inSample:metrics(runSim(IS)),oos:metrics(runSim(OOS)),splitIdx:si,totalBars:ohlcv.length};
  },
};

// ============================================================
// DATA FETCHER — Multi-source
// ============================================================
const DataFetcher = {
  // EVM Token via DexScreener + GeckoTerminal
  async fetchEVM(address) {
    const dsRes = await fetch(`${DEXSCREENER_BASE}/tokens/${address}`);
    const dsJson = await dsRes.json();
    const pair = dsJson.pairs?.[0];
    if (!pair) throw new Error("no_pair");
    const networkMap = {ethereum:"eth",bsc:"bsc",polygon:"polygon_pos",arbitrum:"arbitrum",base:"base",solana:"solana",avalanche:"avax",optimism:"optimism"};
    const net = networkMap[pair.chainId] || pair.chainId || "eth";
    let ohlcv = null;
    try {
      const gRes = await fetch(`${GECKO_BASE}/networks/${net}/pools/${pair.pairAddress}/ohlcv/day?limit=180&currency=usd`);
      const gJson = await gRes.json();
      const raw = gJson?.data?.attributes?.ohlcv_list;
      if (raw && raw.length > 10) {
        ohlcv = raw.map(([t,o,h,l,c,v])=>({time:t,open:parseFloat(o),high:parseFloat(h),low:parseFloat(l),close:parseFloat(c),volume:parseFloat(v)})).filter(c=>c.close>0).sort((a,b)=>a.time-b.time);
      }
    } catch {}
    if (!ohlcv) ohlcv = MathUtils.generateMockOHLCV(180, parseFloat(pair.priceUsd||1));
    return {
      pair, ohlcv,
      source: ohlcv.length > 10 ? "live" : "mock",
      meta: { symbol: pair.baseToken?.symbol, name: pair.baseToken?.name, type: "evm", price: parseFloat(pair.priceUsd||0), change24h: pair.priceChange?.h24||0, volume24h: pair.volume?.h24||0, liquidity: pair.liquidity?.usd||0, txns: pair.txns?.h24 }
    };
  },

  // TwelveData — Crypto, Stock, Forex
  async fetchTwelve(symbol, type) {
    if (!TWELVE_API_KEY || TWELVE_API_KEY === "ea45542dc91f43eb9eb2ce2e83d518da") {
      const price = type==="forex" ? (0.9+Math.random()*0.5) : type==="stock" ? (50+Math.random()*300) : (100+Math.random()*50000);
      const ohlcv = MathUtils.generateMockOHLCV(180, price);
      return { ohlcv, source:"mock", meta:{ symbol, name:symbol, type, price:ohlcv[ohlcv.length-1].close, change24h:(Math.random()-0.5)*5, volume24h:ohlcv.slice(-1)[0].volume, liquidity:0, txns:null }};
    }
    try {
      const interval = "1day", outputsize = 180;
      const url = `${TWELVE_BASE}/time_series?symbol=${symbol}&interval=${interval}&outputsize=${outputsize}&apikey=${TWELVE_API_KEY}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.status === "error" || !json.values) throw new Error(json.message || "twelve_error");
      const ohlcv = json.values.map(v=>({
        time: Math.floor(new Date(v.datetime).getTime()/1000),
        open: parseFloat(v.open), high: parseFloat(v.high),
        low: parseFloat(v.low), close: parseFloat(v.close),
        volume: parseFloat(v.volume||0),
      })).reverse().filter(c=>c.close>0);
      const last = ohlcv[ohlcv.length-1];
      const prev = ohlcv[ohlcv.length-2];
      const change24h = prev ? ((last.close-prev.close)/prev.close)*100 : 0;
      // Quote for latest price
      let livePrice = last.close;
      try {
        const qRes = await fetch(`${TWELVE_BASE}/quote?symbol=${symbol}&apikey=${TWELVE_API_KEY}`);
        const qJson = await qRes.json();
        if (qJson.close) livePrice = parseFloat(qJson.close);
      } catch {}
      return { ohlcv, source:"twelvedata", meta:{ symbol, name:json.meta?.symbol||symbol, type, price:livePrice, change24h, volume24h:last.volume, liquidity:0, txns:null }};
    } catch(e) {
      const price = type==="forex"?(0.9+Math.random()*0.5):type==="stock"?(50+Math.random()*300):(100+Math.random()*50000);
      const ohlcv = MathUtils.generateMockOHLCV(180, price);
      return { ohlcv, source:"mock", meta:{ symbol, name:symbol, type, price:ohlcv[ohlcv.length-1].close, change24h:(Math.random()-0.5)*5, volume24h:0, liquidity:0, txns:null }};
    }
  },

  // Trending tokens from DexScreener
  async fetchTrending() {
    try {
      const res = await fetch("https://api.dexscreener.com/token-profiles/latest/v1");
      const json = await res.json();
      return (Array.isArray(json) ? json : []).slice(0, 12).map(t=>({
        address: t.tokenAddress, symbol: t.symbol||"???", name: t.description||t.symbol||"Unknown",
        chain: t.chainId||"ethereum", type:"evm",
        icon: t.icon || null,
      }));
    } catch { return []; }
  },
};

// ============================================================
// HOOKS
// ============================================================
function useAssetData(asset) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  // Stable key — string, not object reference
  const assetKey = asset ? (asset.address || asset.symbol || "") : "";

  const fetch_ = useCallback(async () => {
    if (!assetKey) return;
    setLoading(true);
    const ctrl = new AbortController();
    try {
      let result;
      if (asset.type === "evm") result = await DataFetcher.fetchEVM(asset.address);
      else result = await DataFetcher.fetchTwelve(asset.symbol, asset.type);
      setData(result);
    } catch {
      const ohlcv = MathUtils.generateMockOHLCV(180, 1);
      setData({ ohlcv, source:"mock", meta:{ symbol:asset?.symbol||"???", name:asset?.name||"Unknown", type:asset?.type||"evm", price:ohlcv[ohlcv.length-1].close, change24h:0, volume24h:0, liquidity:0, txns:null }});
    }
    setLoading(false);
    return () => ctrl.abort();
  }, [assetKey]); // stable string key — no object reference

  useEffect(() => {
    setData(null); // clear stale data on asset change
    fetch_();
    const t = setInterval(fetch_, 60000);
    return () => clearInterval(t);
  }, [fetch_]);
  return { data, loading, refetch: fetch_ };
}

function useTrending() {
  const [trending, setTrending] = useState([]);
  useEffect(() => { DataFetcher.fetchTrending().then(setTrending); }, []);
  return trending;
}

// ============================================================
// MINI UI COMPONENTS
// ============================================================
function ScanLine() { return <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:9999,background:"var(--scanline)",opacity:0.4}}/>; }

function PanelLabel({ children, color="var(--neon)" }) {
  return <div style={{fontSize:"9px",letterSpacing:"3px",color,fontWeight:700,textTransform:"uppercase",borderBottom:`1px solid ${color}22`,paddingBottom:"6px",marginBottom:"10px",display:"flex",alignItems:"center",gap:"8px"}}><span style={{opacity:0.5}}>▸</span>{children}</div>;
}

function StatusBadge({ label, color="var(--neon)" }) {
  return <span style={{fontSize:"9px",padding:"2px 6px",border:`1px solid ${color}44`,color,background:`${color}11`,letterSpacing:"2px"}}>{label}</span>;
}

function Metric({ label, value, color="var(--neon)", sub }) {
  return <div style={{marginBottom:"8px"}}><div style={{fontSize:"8px",color:"var(--text-muted)",letterSpacing:"2px"}}>{label}</div><div style={{fontSize:"16px",color,fontWeight:700,lineHeight:1.2}}>{value}</div>{sub&&<div style={{fontSize:"9px",color:"var(--text-muted)"}}>{sub}</div>}</div>;
}

function LoadingDots({ label="SCANNING" }) {
  const [d,setD]=useState(""); useEffect(()=>{const t=setInterval(()=>setD(p=>p.length>=3?"":p+"."),400);return()=>clearInterval(t);},[]);
  return <div style={{color:"var(--neon-dim)",fontSize:"11px",letterSpacing:"3px",padding:"40px",textAlign:"center"}}><div style={{marginBottom:"8px",fontSize:"9px",color:"var(--text-muted)"}}>{"[ "+"=".repeat(d.length*4)+" ".repeat(12-d.length*4)+" ]"}</div>{label}{d}</div>;
}

function Panel({ children, style={} }) {
  return <div style={{background:"var(--bg-panel)",border:"1px solid var(--border)",padding:"14px",position:"relative",overflow:"hidden",...style}}><div style={{position:"absolute",top:0,left:0,right:0,height:"1px",background:"linear-gradient(90deg,transparent,var(--neon-dim),transparent)",opacity:0.3}}/>{children}</div>;
}

function Card({ children, onClick, active, style={} }) {
  return <div onClick={onClick} className="card-hover" style={{background:active?"var(--neon-ghost)":"var(--bg-card)",border:`1px solid ${active?"var(--neon-dim)":"var(--border)"}`,padding:"12px",cursor:onClick?"pointer":"default",borderRadius:"var(--card-radius)",position:"relative",overflow:"hidden",...style}}><div style={{position:"absolute",top:0,left:0,right:0,height:"1px",background:`linear-gradient(90deg,transparent,${active?"var(--neon)":"var(--border-bright)"},transparent)`,opacity:0.5}}/>{children}</div>;
}

function SourceBadge({ source }) {
  const cfg = { live:{label:"LIVE",color:"var(--neon)"}, twelvedata:{label:"12DATA",color:"var(--blue)"}, mock:{label:"SIM",color:"var(--amber)"}, dexscreener:{label:"DEX",color:"var(--purple)"} };
  const c = cfg[source] || cfg.mock;
  return <StatusBadge label={c.label} color={c.color} />;
}

function TypeBadge({ type }) {
  const cfg = { evm:{label:"EVM",color:"var(--purple)"}, stock:{label:"STOCK",color:"var(--blue)"}, forex:{label:"FOREX",color:"var(--amber)"}, crypto12:{label:"CRYPTO",color:"var(--neon)"} };
  const c = cfg[type] || cfg.evm;
  return <StatusBadge label={c.label} color={c.color} />;
}

// ============================================================
// CANVAS CHARTS
// ============================================================
function CandleChart({ ohlcv, structure }) {
  const canvasRef = useRef(null);
  const draw = useCallback(() => {
    if(!ohlcv||!canvasRef.current) return;
    const canvas=canvasRef.current, ctx=canvas.getContext("2d");
    const W=canvas.offsetWidth, H=canvas.offsetHeight;
    if(W===0||H===0) return;
    canvas.width=W; canvas.height=H;
    const data=ohlcv.slice(-80);
    const prices=data.flatMap(c=>[c.high,c.low]);
    const minP=Math.min(...prices)*0.998, maxP=Math.max(...prices)*1.002;
    const pY=p=>H*0.85*(1-(p-minP)/(maxP-minP))+H*0.02;
    const cW=Math.max(2,Math.floor((W-20)/data.length)-1);
    ctx.fillStyle="#050505"; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle="#0f0f0f"; ctx.lineWidth=1;
    for(let i=0;i<5;i++){const y=(H*0.87/5)*i+H*0.02;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
    const maxVol=Math.max(...data.map(c=>c.volume));
    data.forEach((c,i)=>{const x=10+i*(cW+1),vH=(c.volume/maxVol)*H*0.13;ctx.fillStyle=c.close>=c.open?"rgba(0,255,65,0.15)":"rgba(255,42,42,0.15)";ctx.fillRect(x,H-vH,cW,vH);});
    data.forEach((c,i)=>{
      const x=10+i*(cW+1)+Math.floor(cW/2),isG=c.close>=c.open,col=isG?"#00ff41":"#ff2a2a";
      const bT=pY(Math.max(c.open,c.close)),bB=pY(Math.min(c.open,c.close)),bH=Math.max(1,bB-bT);
      ctx.strokeStyle=col;ctx.lineWidth=1;ctx.globalAlpha=0.7;ctx.beginPath();ctx.moveTo(x,pY(c.high));ctx.lineTo(x,pY(c.low));ctx.stroke();
      ctx.globalAlpha=1;ctx.fillStyle=isG?"rgba(0,255,65,0.7)":"rgba(255,42,42,0.7)";ctx.fillRect(x-Math.floor(cW/2),bT,cW,bH);
    });
    if(structure){[...(structure.bos||[]),...(structure.choch||[])].forEach(s=>{const idx=Math.min(data.length-1,Math.max(0,s.i-(ohlcv.length-data.length)));if(idx<0||idx>=data.length)return;const x=10+idx*(cW+1),y=pY(s.price);ctx.strokeStyle=s.label?.includes("CHOCH")?"#aa44ff":"#ffaa00";ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(W,y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=s.label?.includes("CHOCH")?"#aa44ff":"#ffaa00";ctx.font="8px JetBrains Mono,monospace";ctx.fillText(s.label,x+2,y-3);});}
    const lp=data[data.length-1].close,ly=pY(lp);
    ctx.strokeStyle="rgba(0,255,65,0.4)";ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(0,ly);ctx.lineTo(W-62,ly);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle="#00ff41";ctx.font="bold 9px JetBrains Mono,monospace";
    ctx.fillText("$"+(lp<0.001?lp.toExponential(3):lp<1?lp.toFixed(6):lp.toFixed(2)),W-60,ly+3);
  },[ohlcv,structure]);
  useEffect(()=>{draw();const ro=new ResizeObserver(draw);if(canvasRef.current)ro.observe(canvasRef.current.parentElement||canvasRef.current);return()=>ro.disconnect();},[draw]);
  return <canvas ref={canvasRef} style={{width:"100%",height:"100%",display:"block"}}/>;
}

function HqChart({ hqData }) {
  const canvasRef = useRef(null);
  const draw = useCallback(()=>{
    if(!hqData||!canvasRef.current)return;
    const canvas=canvasRef.current,ctx=canvas.getContext("2d");
    const W=canvas.offsetWidth,H=canvas.offsetHeight;
    if(W===0||H===0)return;
    canvas.width=W;canvas.height=H;
    ctx.fillStyle="#050505";ctx.fillRect(0,0,W,H);
    const pad={l:32,r:12,t:12,b:28},cW=W-pad.l-pad.r,cH=H-pad.t-pad.b;
    const qVals=hqData.map(d=>d.q),minQ=Math.min(...qVals),maxQ=Math.max(...qVals);
    const qRange=maxQ-minQ||1;
    const xS=q=>pad.l+((q-minQ)/qRange)*cW,yS=h=>pad.t+(1-h)*cH;
    ctx.strokeStyle="#111";ctx.lineWidth=1;
    [0,0.25,0.5,0.75,1].forEach(h=>{const y=yS(h);ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(W-pad.r,y);ctx.stroke();ctx.fillStyle="#2a4a2a";ctx.font="8px monospace";ctx.fillText(h.toFixed(2),2,y+3);});
    ctx.strokeStyle="rgba(255,170,0,0.3)";ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(pad.l,yS(0.5));ctx.lineTo(W,yS(0.5));ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle="rgba(0,255,65,0.04)";ctx.fillRect(pad.l,pad.t,cW,yS(0.5)-pad.t);
    ctx.fillStyle="rgba(255,42,42,0.04)";ctx.fillRect(pad.l,yS(0.5),cW,cH-(yS(0.5)-pad.t));
    ctx.strokeStyle="#00ff41";ctx.lineWidth=2;ctx.beginPath();hqData.forEach((d,i)=>{i===0?ctx.moveTo(xS(d.q),yS(d.h)):ctx.lineTo(xS(d.q),yS(d.h));});ctx.stroke();
    hqData.forEach(d=>{const x=xS(d.q),y=yS(d.h),col=d.h>0.55?"#00ff41":d.h<0.45?"#ff2a2a":"#ffaa00";ctx.fillStyle=col;ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill();ctx.fillStyle="#3a5a3a";ctx.font="7px monospace";ctx.fillText("q="+d.q,x-6,y-7);});
    ctx.fillStyle="#ffaa00";ctx.font="7px monospace";ctx.fillText("RANDOM H=0.5",W-80,yS(0.5)-3);
    ctx.fillStyle="#2a4a2a";qVals.forEach(q=>{ctx.fillText(q,xS(q)-4,H-8);});ctx.fillStyle="#3a6a3a";ctx.fillText("H(q)",2,14);
  },[hqData]);
  useEffect(()=>{draw();const ro=new ResizeObserver(draw);if(canvasRef.current)ro.observe(canvasRef.current.parentElement||canvasRef.current);return()=>ro.disconnect();},[draw]);
  return <canvas ref={canvasRef} style={{width:"100%",height:"100%",display:"block"}}/>;
}

function EquityCurve({ isData, oosData }) {
  const canvasRef = useRef(null);
  const draw = useCallback(()=>{
    if(!isData||!canvasRef.current)return;
    const canvas=canvasRef.current,ctx=canvas.getContext("2d");
    const W=canvas.offsetWidth,H=canvas.offsetHeight;
    if(W===0||H===0)return;
    canvas.width=W;canvas.height=H;ctx.fillStyle="#050505";ctx.fillRect(0,0,W,H);
    const dC=(curve,color,label,x0,x1)=>{if(!curve||curve.length<2)return;const minE=Math.min(...curve),maxE=Math.max(...curve);const yS=e=>H*0.9*(1-(e-minE)/(maxE-minE+1))+H*0.05,xS=i=>x0+(i/(curve.length-1))*(x1-x0-4);ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.beginPath();curve.forEach((e,i)=>{i===0?ctx.moveTo(xS(i),yS(e)):ctx.lineTo(xS(i),yS(e));});ctx.stroke();ctx.fillStyle=color;ctx.font="8px monospace";ctx.fillText(label,x0+4,12);};
    ctx.strokeStyle="#ffaa0044";ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(W*0.65,0);ctx.lineTo(W*0.65,H);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle="#ffaa00";ctx.font="7px monospace";ctx.fillText("PURGE",W*0.65+2,H-4);
    dC(isData,"#00cc33","IS",0,W*0.63); if(oosData)dC(oosData,"#00ff41","OOS",W*0.67,W);
  },[isData,oosData]);
  useEffect(()=>{draw();const ro=new ResizeObserver(draw);if(canvasRef.current)ro.observe(canvasRef.current.parentElement||canvasRef.current);return()=>ro.disconnect();},[draw]);
  return <canvas ref={canvasRef} style={{width:"100%",height:"100%",display:"block"}}/>;
}

// Mini sparkline for home cards
function Sparkline({ ohlcv, color="#00ff41" }) {
  const canvasRef = useRef(null);
  useEffect(()=>{
    if(!ohlcv||!canvasRef.current)return;
    const canvas=canvasRef.current,ctx=canvas.getContext("2d");
    const W=canvas.offsetWidth,H=canvas.offsetHeight;
    if(W===0||H===0)return;
    canvas.width=W;canvas.height=H;
    const data=ohlcv.slice(-30).map(c=>c.close);
    const mn=Math.min(...data),mx=Math.max(...data),range=mx-mn||1;
    ctx.clearRect(0,0,W,H);
    ctx.strokeStyle=color;ctx.lineWidth=1.5;
    ctx.beginPath();
    data.forEach((v,i)=>{const x=(i/(data.length-1))*W,y=H-(((v-mn)/range)*H*0.8+H*0.1);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);});
    ctx.stroke();
    // Fill under line
    ctx.lineTo(W,H);ctx.lineTo(0,H);ctx.closePath();
    ctx.fillStyle=color.replace(")",",0.08)").replace("rgb","rgba");
    ctx.fill();
  },[ohlcv,color]);
  return <canvas ref={canvasRef} style={{width:"100%",height:"40px",display:"block"}}/>;
}

// ============================================================
// HOME SCREEN
// ============================================================
function HomeScreen({ onSelectAsset, watchlist }) {
  const trending = useTrending();
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [activeSection, setActiveSection] = useState("trending");

  const handleSearch = useCallback(async (q) => {
    setSearch(q);
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      // Search DexScreener for EVM tokens
      const res = await fetch(`${DEXSCREENER_BASE}/search?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      const evmResults = (json.pairs||[]).slice(0,6).map(p=>({
        address: p.baseToken?.address, symbol: p.baseToken?.symbol||"???",
        name: p.baseToken?.name||"Unknown", type:"evm", chain:p.chainId||"ethereum",
        price: parseFloat(p.priceUsd||0), change24h: p.priceChange?.h24||0,
        volume24h: p.volume?.h24||0,
      }));
      // Also search TwelveData symbols
      const tdResults = [
        ...[...POPULAR_CRYPTO,...POPULAR_STOCKS,...POPULAR_FOREX].filter(a=>a.symbol.toLowerCase().includes(q.toLowerCase())||a.name.toLowerCase().includes(q.toLowerCase()))
      ];
      setSearchResults([...evmResults,...tdResults].slice(0,8));
    } catch { setSearchResults([]); }
    setSearching(false);
  }, []);

  const fmt = v => v>1e9?`$${(v/1e9).toFixed(2)}B`:v>1e6?`$${(v/1e6).toFixed(2)}M`:v>1e3?`$${(v/1e3).toFixed(1)}K`:`$${v.toFixed(2)}`;

  return (
    <div className="fade-in" style={{padding:"16px",overflow:"auto",height:"100%"}}>

      {/* Search Bar */}
      <div style={{marginBottom:"20px"}}>
        <div style={{position:"relative"}}>
          <span style={{position:"absolute",left:"12px",top:"50%",transform:"translateY(-50%)",color:"var(--neon-dim)",fontSize:"12px"}}>⌕</span>
          <input
            value={search}
            onChange={e=>handleSearch(e.target.value)}
            placeholder="Search token, symbol, address, stock, forex..."
            style={{width:"100%",background:"var(--bg-panel)",border:"1px solid var(--border-bright)",borderRadius:"var(--card-radius)",color:"var(--text-primary)",padding:"10px 12px 10px 32px",fontSize:"11px",letterSpacing:"1px",outline:"none",transition:"border-color 0.15s"}}
            onFocus={e=>e.target.style.borderColor="var(--neon-dim)"}
            onBlur={e=>e.target.style.borderColor="var(--border-bright)"}
          />
          {searching && <span style={{position:"absolute",right:"12px",top:"50%",transform:"translateY(-50%)",color:"var(--text-muted)",fontSize:"9px",letterSpacing:"2px"}}>SCANNING...</span>}
        </div>

        {/* Search Results */}
        {searchResults.length > 0 && (
          <div style={{marginTop:"4px",background:"var(--bg-panel)",border:"1px solid var(--border-bright)",overflow:"hidden"}}>
            {searchResults.map((r,i)=>(
              <div key={i} onClick={()=>{onSelectAsset(r);setSearch("");setSearchResults([]);}} className="card-hover"
                style={{padding:"8px 12px",borderBottom:"1px solid var(--border)",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
                <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                  <TypeBadge type={r.type}/>
                  <div>
                    <div style={{fontSize:"11px",color:"var(--neon)",fontWeight:700,letterSpacing:"2px"}}>{r.symbol}</div>
                    <div style={{fontSize:"8px",color:"var(--text-muted)"}}>{r.name}</div>
                  </div>
                </div>
                {r.price>0&&<div style={{textAlign:"right"}}>
                  <div style={{fontSize:"11px",color:"var(--text-primary)"}}>${r.price<0.0001?r.price.toExponential(2):r.price<1?r.price.toFixed(6):r.price.toFixed(2)}</div>
                  {r.change24h!==undefined&&<div style={{fontSize:"9px",color:r.change24h>=0?"var(--neon)":"var(--red)"}}>{r.change24h>=0?"▲":"▼"}{Math.abs(r.change24h||0).toFixed(2)}%</div>}
                </div>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section Tabs */}
      <div style={{display:"flex",gap:"4px",marginBottom:"16px"}}>
        {[["trending","🔥 TRENDING"],["crypto","◎ CRYPTO"],["stocks","◧ STOCKS"],["forex","€ FOREX"]].map(([k,label])=>(
          <button key={k} onClick={()=>setActiveSection(k)} style={{padding:"5px 10px",background:activeSection===k?"var(--neon-ghost)":"var(--bg-panel)",border:`1px solid ${activeSection===k?"var(--neon-dim)":"var(--border)"}`,color:activeSection===k?"var(--neon)":"var(--text-muted)",fontSize:"8px",letterSpacing:"2px",flex:1}}>
            {label}
          </button>
        ))}
      </div>

      {/* Trending Section */}
      {activeSection==="trending" && (
        <div>
          <div style={{fontSize:"9px",color:"var(--text-muted)",letterSpacing:"3px",marginBottom:"10px"}}>▸ TRENDING ON DEXSCREENER</div>
          {trending.length===0&&<div style={{textAlign:"center",padding:"20px",fontSize:"9px",color:"var(--text-muted)",letterSpacing:"2px"}}>LOADING TRENDING DATA...</div>}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:"8px"}}>
            {trending.map((t,i)=>(
              <Card key={i} onClick={()=>onSelectAsset({...t,type:"evm"})} style={{animation:`fadeIn 0.3s ease ${i*0.05}s both`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"6px"}}>
                  <div style={{fontSize:"12px",color:"var(--neon)",fontWeight:800,letterSpacing:"2px"}}>{t.symbol}</div>
                  <StatusBadge label={`#${i+1}`} color="var(--amber)"/>
                </div>
                <div style={{fontSize:"8px",color:"var(--text-muted)",marginBottom:"8px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.name}</div>
                <div style={{fontSize:"7px",color:"var(--text-dead)",letterSpacing:"1px"}}>{t.chain?.toUpperCase()} CHAIN</div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Crypto Section */}
      {activeSection==="crypto" && (
        <div>
          <div style={{fontSize:"9px",color:"var(--text-muted)",letterSpacing:"3px",marginBottom:"10px"}}>▸ MAJOR CRYPTO // TWELVEDATA</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:"8px"}}>
            {POPULAR_CRYPTO.map((a,i)=>(
              <CryptoCard key={i} asset={a} onSelect={onSelectAsset} delay={i*0.05}/>
            ))}
          </div>
        </div>
      )}

      {/* Stocks Section */}
      {activeSection==="stocks" && (
        <div>
          <div style={{fontSize:"9px",color:"var(--text-muted)",letterSpacing:"3px",marginBottom:"10px"}}>▸ US STOCKS // TWELVEDATA</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:"8px"}}>
            {POPULAR_STOCKS.map((a,i)=>(
              <CryptoCard key={i} asset={a} onSelect={onSelectAsset} delay={i*0.05}/>
            ))}
          </div>
        </div>
      )}

      {/* Forex Section */}
      {activeSection==="forex" && (
        <div>
          <div style={{fontSize:"9px",color:"var(--text-muted)",letterSpacing:"3px",marginBottom:"10px"}}>▸ FOREX & COMMODITIES // TWELVEDATA</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:"8px"}}>
            {POPULAR_FOREX.map((a,i)=>(
              <CryptoCard key={i} asset={a} onSelect={onSelectAsset} delay={i*0.05}/>
            ))}
          </div>
        </div>
      )}

      {/* Watchlist Quick Access */}
      {watchlist.length>0&&(
        <div style={{marginTop:"20px"}}>
          <div style={{fontSize:"9px",color:"var(--text-muted)",letterSpacing:"3px",marginBottom:"10px"}}>▸ YOUR WATCHLIST</div>
          <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
            {watchlist.map((t,i)=>(
              <div key={i} onClick={()=>onSelectAsset(t)} className="card-hover" style={{padding:"6px 12px",background:"var(--bg-panel)",border:"1px solid var(--neon-dim)",cursor:"pointer"}}>
                <span style={{fontSize:"10px",color:"var(--neon)",fontWeight:700,letterSpacing:"2px"}}>{t.symbol}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Card with live price fetch
function CryptoCard({ asset, onSelect, delay=0 }) {
  const [price, setPrice] = useState(null);
  const [change, setChange] = useState(null);
  useEffect(()=>{
    if(!TWELVE_API_KEY||TWELVE_API_KEY==="ea45542dc91f43eb9eb2ce2e83d518da"){
      setPrice((Math.random()*1000+10).toFixed(2));
      setChange(((Math.random()-0.5)*10).toFixed(2));
      return;
    }
    fetch(`${TWELVE_BASE}/quote?symbol=${asset.symbol}&apikey=${TWELVE_API_KEY}`)
      .then(r=>r.json()).then(j=>{if(j.close){setPrice(parseFloat(j.close).toFixed(j.close<1?6:2));setChange(parseFloat(j.percent_change||0).toFixed(2));}}).catch(()=>{});
  },[asset.symbol]);

  return (
    <Card onClick={()=>onSelect(asset)} style={{animation:`fadeIn 0.3s ease ${delay}s both`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"8px"}}>
        <div style={{fontSize:"18px",opacity:0.6}}>{asset.icon}</div>
        <TypeBadge type={asset.type}/>
      </div>
      <div style={{fontSize:"13px",color:"var(--neon)",fontWeight:800,letterSpacing:"2px",marginBottom:"2px"}}>{asset.symbol.split("/")[0]}</div>
      <div style={{fontSize:"8px",color:"var(--text-muted)",marginBottom:"8px"}}>{asset.name}</div>
      <div style={{fontSize:"12px",color:"var(--text-primary)",fontWeight:600}}>{price?`$${price}`:"—"}</div>
      {change&&<div style={{fontSize:"9px",color:parseFloat(change)>=0?"var(--neon)":"var(--red)"}}>{parseFloat(change)>=0?"▲":"▼"}{Math.abs(parseFloat(change)).toFixed(2)}%</div>}
    </Card>
  );
}

// ============================================================
// WATCHLIST SIDEBAR
// ============================================================
function WatchlistSidebar({ watchlist, active, onSelect, onAdd, onRemove, onHome }) {
  const [input, setInput] = useState("");
  const [symInput, setSymInput] = useState("");
  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",overflow:"hidden"}}>
      {/* Home Button */}
      <button onClick={onHome} style={{padding:"10px",background:"var(--neon-ghost)",border:"none",borderBottom:"1px solid var(--neon-dim)",color:"var(--neon)",fontSize:"10px",letterSpacing:"3px",fontWeight:700,textAlign:"left"}}>
        ⬡ HOME
      </button>

      <div style={{padding:"10px",flex:1,overflow:"auto"}}>
        <div style={{fontSize:"8px",color:"var(--text-muted)",letterSpacing:"3px",marginBottom:"8px"}}>▸ WATCHLIST [{watchlist.length}/5]</div>

        {/* Add token input */}
        <input value={input} onChange={e=>setInput(e.target.value)} placeholder="0x... or SYMBOL" style={{width:"100%",background:"var(--bg-deep)",border:"1px solid var(--border-bright)",color:"var(--neon)",padding:"5px 8px",fontSize:"9px",letterSpacing:"1px",outline:"none",marginBottom:"3px"}}/>
        <div style={{display:"flex",gap:"3px",marginBottom:"8px"}}>
          <input value={symInput} onChange={e=>setSymInput(e.target.value)} placeholder="SYM" style={{flex:1,background:"var(--bg-deep)",border:"1px solid var(--border-bright)",color:"var(--amber)",padding:"5px 6px",fontSize:"9px",outline:"none"}}/>
          <button onClick={()=>{
            if(input.trim().length>2&&watchlist.length<5){
              const isEVM=input.startsWith("0x");
              onAdd({address:isEVM?input.trim():undefined,symbol:symInput.trim()||input.trim().toUpperCase(),name:symInput.trim()||"Custom",type:isEVM?"evm":"crypto12",chain:"ethereum"});
              setInput("");setSymInput("");
            }
          }} disabled={watchlist.length>=5} style={{background:watchlist.length>=5?"var(--bg-deep)":"var(--neon-ghost)",border:"1px solid var(--neon-dim)",color:"var(--neon)",padding:"5px 8px",fontSize:"9px",opacity:watchlist.length>=5?0.3:1}}>+</button>
        </div>

        {/* Watchlist items */}
        {watchlist.map((t,i)=>(
          <div key={t.address||t.symbol} onClick={()=>onSelect(t)}
            style={{padding:"8px",marginBottom:"3px",cursor:"pointer",background:active?.symbol===t.symbol&&active?.address===t.address?"var(--neon-ghost)":"var(--bg-deep)",border:`1px solid ${active?.symbol===t.symbol&&active?.address===t.address?"var(--neon-dim)":"var(--border)"}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontSize:"10px",color:"var(--neon)",fontWeight:700,letterSpacing:"2px"}}>{t.symbol}</div>
              <TypeBadge type={t.type||"evm"}/>
            </div>
            <div style={{display:"flex",gap:"4px",alignItems:"center"}}>
              <span style={{fontSize:"7px",color:"var(--text-muted)"}}>#{i+1}</span>
              {watchlist.length>0&&<button onClick={e=>{e.stopPropagation();onRemove(t.address||t.symbol);}} style={{background:"none",border:"none",color:"var(--red)",fontSize:"10px",padding:"0 2px"}}>✕</button>}
            </div>
          </div>
        ))}
        {watchlist.length===0&&<div style={{fontSize:"8px",color:"var(--text-dead)",textAlign:"center",padding:"10px",letterSpacing:"1px"}}>ADD TOKEN TO WATCH</div>}
      </div>

      {/* Sys status */}
      <div style={{padding:"8px 10px",borderTop:"1px solid var(--border)"}}>
        {["FRACTAL","H(q)","BOS/CHOCH","VOL SCALE","OOS TEST","QUANT GUARD"].map(s=>(
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
// ASSET DASHBOARD (Chart + Analysis Tabs)
// ============================================================
function AssetDashboard({ asset, data, loading, onAddToWatchlist, inWatchlist }) {
  const [tab, setTab] = useState("OVERVIEW");
  const TABS = ["OVERVIEW","FRACTAL","STRUCTURE","BACKTEST","BEHAVIOR"];

  const analysis = useMemo(()=>{
    if(!data?.ohlcv) return null;
    const returns=data.ohlcv.map((c,i)=>i>0?Math.log(c.close/data.ohlcv[i-1].close):0).slice(1);
    return { hq:MathUtils.computeHq(returns), score:MathUtils.blackHorseScore(data.ohlcv), backtest:MathUtils.runBacktest(data.ohlcv), fd:MathUtils.fractalDimension(data.ohlcv.map(c=>c.close)), breakdown:MathUtils.detectFractalBreakdown(returns) };
  },[data]);

  if(!asset) return null;
  if(loading) return <LoadingDots label="LOADING SURVEILLANCE DATA"/>;

  const meta = data?.meta || {};
  const fmtP = p=>p<0.0001?p.toExponential(3):p<0.01?p.toFixed(8):p<1?p.toFixed(6):p.toFixed(2);
  const fmtV = v=>v>1e9?`$${(v/1e9).toFixed(2)}B`:v>1e6?`$${(v/1e6).toFixed(2)}M`:v>1e3?`$${(v/1e3).toFixed(1)}K`:`$${v.toFixed(0)}`;

  return (
    <div className="fade-in" style={{display:"flex",flexDirection:"column",height:"100%"}}>
      {/* Header */}
      <div style={{background:"var(--bg-panel)",borderBottom:"1px solid var(--border)",padding:"10px 16px",display:"flex",flexWrap:"wrap",gap:"12px",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap"}}>
          <span style={{fontSize:"22px",color:"var(--neon)",fontWeight:800,letterSpacing:"3px",textShadow:"0 0 15px var(--neon-glow)"}}>{meta.symbol||asset.symbol}</span>
          <span style={{fontSize:"9px",color:"var(--text-muted)",letterSpacing:"1px"}}>{meta.name||asset.name}</span>
          <TypeBadge type={meta.type||asset.type}/>
          {data&&<SourceBadge source={data.source}/>}
        </div>
        <div style={{display:"flex",gap:"14px",alignItems:"center",flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:"7px",color:"var(--text-muted)",letterSpacing:"2px"}}>PRICE</div>
            <div style={{fontSize:"18px",color:"var(--neon)",fontWeight:700}}>${fmtP(meta.price||0)}</div>
            <div style={{fontSize:"9px",color:(meta.change24h||0)>=0?"var(--neon)":"var(--red)"}}>{(meta.change24h||0)>=0?"▲":"▼"}{Math.abs(meta.change24h||0).toFixed(2)}% 24H</div>
          </div>
          {meta.volume24h>0&&<div><div style={{fontSize:"7px",color:"var(--text-muted)",letterSpacing:"2px"}}>VOL 24H</div><div style={{fontSize:"13px",color:"var(--amber)",fontWeight:600}}>{fmtV(meta.volume24h)}</div></div>}
          {meta.liquidity>0&&<div><div style={{fontSize:"7px",color:"var(--text-muted)",letterSpacing:"2px"}}>LIQUIDITY</div><div style={{fontSize:"13px",color:"var(--blue)",fontWeight:600}}>{fmtV(meta.liquidity)}</div></div>}
          {meta.txns&&<div><div style={{fontSize:"7px",color:"var(--text-muted)",letterSpacing:"2px"}}>BUYS/SELLS</div><div style={{fontSize:"13px",fontWeight:600,color:meta.txns.buys>meta.txns.sells?"var(--neon)":"var(--red)"}}>{meta.txns.buys}/{meta.txns.sells}</div></div>}
          {/* Black Horse Score */}
          {analysis&&(
            <div style={{padding:"8px 14px",textAlign:"center",background:analysis.score.score>=60?"var(--neon-ghost)":analysis.score.score<30?"var(--red-ghost)":"var(--amber-ghost)",border:`2px solid ${analysis.score.score>=60?"var(--neon-dim)":analysis.score.score<30?"var(--red)":"var(--amber)"}`}}>
              <div style={{fontSize:"7px",color:"var(--text-muted)",letterSpacing:"3px"}}>BLACK HORSE</div>
              <div style={{fontSize:"26px",fontWeight:800,color:analysis.score.score>=60?"var(--neon)":analysis.score.score<30?"var(--red)":"var(--amber)",textShadow:analysis.score.score>=70?"0 0 20px var(--neon-glow)":"none"}}>{analysis.score.score}</div>
              <div style={{fontSize:"8px",letterSpacing:"1px",color:"var(--text-secondary)"}}>{analysis.score.grade}</div>
            </div>
          )}
          {/* Add to Watchlist */}
          <button onClick={()=>onAddToWatchlist(asset)} disabled={inWatchlist}
            style={{padding:"8px 12px",background:inWatchlist?"var(--neon-ghost)":"var(--bg-panel)",border:`1px solid ${inWatchlist?"var(--neon)":"var(--border-bright)"}`,color:inWatchlist?"var(--neon)":"var(--text-muted)",fontSize:"8px",letterSpacing:"2px",opacity:inWatchlist?0.6:1}}>
            {inWatchlist?"★ WATCHING":"☆ WATCH"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{display:"flex",background:"var(--bg-deep)",borderBottom:"1px solid var(--border)"}}>
        {TABS.map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"9px 4px",background:"none",border:"none",borderBottom:`2px solid ${tab===t?"var(--neon)":"transparent"}`,color:tab===t?"var(--neon)":"var(--text-muted)",fontSize:"8px",letterSpacing:"2px",transition:"all 0.15s"}}>{t}</button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{flex:1,overflow:"auto",padding:"12px"}}>

        {tab==="OVERVIEW"&&(
          <>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"8px",marginBottom:"12px"}}>
              {[
                {label:"HURST EXP",val:analysis?.score.H?.toFixed(3)||"—",color:(analysis?.score.H||0.5)>0.55?"var(--neon)":"var(--amber)"},
                {label:"FRACTAL DIM",val:analysis?.fd?.toFixed(3)||"—",color:"var(--blue)"},
                {label:"VOL REGIME",val:analysis?.score.vol.regime||"—",color:analysis?.score.vol.regime==="EXTREME"?"var(--red)":"var(--amber)"},
                {label:"BEHAVIOR",val:analysis?.score.behavior.label||"—",color:"var(--purple)"},
              ].map(m=>(
                <Panel key={m.label}>
                  <div style={{fontSize:"7px",color:"var(--text-muted)",letterSpacing:"2px",marginBottom:"4px"}}>{m.label}</div>
                  <div style={{fontSize:"13px",color:m.color,fontWeight:700}}>{m.val}</div>
                </Panel>
              ))}
            </div>
            <Panel style={{height:"260px",marginBottom:"12px",padding:"10px"}}>
              <PanelLabel>PRICE ACTION // 80D — BOS/CHOCH OVERLAY</PanelLabel>
              <div style={{height:"calc(100% - 28px)"}}><CandleChart ohlcv={data?.ohlcv} structure={analysis?.score?.struct}/></div>
            </Panel>
            {analysis&&(
              <Panel>
                <PanelLabel>CONFLUENCE SIGNAL SCANNER</PanelLabel>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:"6px"}}>
                  {analysis.score.signals.map((s,i)=>(
                    <div key={i} style={{padding:"7px 10px",background:s.active?(s.weight>0?"var(--neon-ghost)":"var(--red-ghost)"):"var(--bg-deep)",border:`1px solid ${s.active?(s.weight>0?"var(--neon-dim)":"var(--red)"):"var(--border)"}33`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <span style={{fontSize:"9px",color:s.active?"var(--text-primary)":"var(--text-muted)",letterSpacing:"1px"}}>{s.label}</span>
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
                {label:"HURST EXPONENT",val:analysis.score.H?.toFixed(4),color:analysis.score.H>0.55?"var(--neon)":analysis.score.H<0.45?"var(--red)":"var(--amber)",sub:analysis.score.H>0.55?"PERSISTENT":analysis.score.H<0.45?"ANTI-PERSIST":"RANDOM WALK"},
                {label:"FRACTAL DIM D",val:analysis.fd?.toFixed(4),color:"var(--blue)",sub:"D = 2 − H"},
                {label:"BREAKDOWNS",val:analysis.breakdown.length,color:analysis.breakdown.length>2?"var(--red)":"var(--neon)",sub:"LAST 180 DAYS"},
                {label:"Δ H(q) WIDTH",val:analysis.hq.length>0?(Math.max(...analysis.hq.map(d=>d.h))-Math.min(...analysis.hq.map(d=>d.h))).toFixed(3):"—",color:"var(--purple)",sub:"MULTIFRACTAL"},
              ].map(m=>(
                <Panel key={m.label}><div style={{fontSize:"7px",color:"var(--text-muted)",letterSpacing:"2px",marginBottom:"4px"}}>{m.label}</div><div style={{fontSize:"22px",fontWeight:800,color:m.color}}>{m.val}</div><div style={{fontSize:"8px",color:"var(--text-muted)",marginTop:"2px"}}>{m.sub}</div></Panel>
              ))}
            </div>
            <Panel style={{height:"210px",marginBottom:"12px",padding:"10px"}}>
              <PanelLabel>H(q) MULTIFRACTAL SPECTRUM // q ∈ [-3, +3]</PanelLabel>
              <div style={{height:"calc(100% - 28px)"}}><HqChart hqData={analysis.hq}/></div>
            </Panel>
            <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:"8px"}}>
              <Panel>
                <PanelLabel>ZONE LEGEND</PanelLabel>
                {[{range:"H > 0.55",label:"PERSISTENT",desc:"Trending. Follow momentum.",color:"var(--neon)"},{range:"H ≈ 0.5",label:"RANDOM WALK",desc:"No edge. Avoid entry.",color:"var(--amber)"},{range:"H < 0.45",label:"ANTI-PERSIST",desc:"Mean-reverting. Reversal.",color:"var(--red)"}].map(z=>(
                  <div key={z.label} style={{padding:"8px",marginBottom:"5px",background:"var(--bg-deep)",border:`1px solid ${z.color}22`}}><div style={{fontSize:"9px",color:z.color,fontWeight:700,letterSpacing:"2px"}}>{z.label}</div><div style={{fontSize:"7px",color:"var(--text-muted)"}}>{z.range} — {z.desc}</div></div>
                ))}
              </Panel>
              <Panel>
                <PanelLabel>BREAKDOWN LOG</PanelLabel>
                {analysis.breakdown.length===0?<div style={{fontSize:"9px",color:"var(--text-muted)"}}>NO BREAKDOWNS DETECTED</div>:(
                  <div style={{display:"flex",flexDirection:"column",gap:"3px",maxHeight:"150px",overflow:"auto"}}>
                    {analysis.breakdown.slice(-15).reverse().map((b,i)=>(
                      <div key={i} style={{display:"flex",gap:"10px",padding:"4px 8px",background:b.type==="ANTI_PERSISTENT"?"var(--red-ghost)":"var(--neon-ghost)",border:`1px solid ${b.type==="ANTI_PERSISTENT"?"var(--red)":"var(--neon)"}22`,fontSize:"9px"}}>
                        <span style={{color:b.type==="ANTI_PERSISTENT"?"var(--red)":"var(--neon)"}}>{b.type==="ANTI_PERSISTENT"?"▼":"▲"} {b.label}</span>
                        <span style={{color:"var(--text-muted)"}}>H={b.H.toFixed(3)}</span>
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
                  <div style={{fontSize:"28px",fontWeight:800,letterSpacing:"5px",color:analysis.score.vol.regime==="EXTREME"?"var(--red)":analysis.score.vol.regime==="HIGH"?"var(--amber)":analysis.score.vol.regime==="MEDIUM"?"var(--neon)":"var(--text-secondary)"}}>{analysis.score.vol.regime}</div>
                  <div style={{fontSize:"9px",color:"var(--text-muted)",marginTop:"6px"}}>ATR: ${analysis.score.vol.atr?.toFixed(6)} ({analysis.score.vol.pct?.toFixed(2)}%)</div>
                  <div style={{fontSize:"10px",color:"var(--text-secondary)",marginTop:"4px"}}>SIZE: {analysis.score.vol.regime==="LOW"?"1.5×":analysis.score.vol.regime==="MEDIUM"?"1.0×":analysis.score.vol.regime==="HIGH"?"0.6×":"0.25×"}</div>
                  <div style={{display:"flex",justifyContent:"center",gap:"4px",marginTop:"10px"}}>
                    {["LOW","MEDIUM","HIGH","EXTREME"].map(r=>(
                      <div key={r} style={{padding:"3px 8px",fontSize:"7px",letterSpacing:"1px",background:analysis.score.vol.regime===r?"var(--neon-ghost)":"var(--bg-deep)",border:`1px solid ${analysis.score.vol.regime===r?"var(--neon)":"var(--border)"}`,color:analysis.score.vol.regime===r?"var(--neon)":"var(--text-dead)"}}>{r}</div>
                    ))}
                  </div>
                </div>
              </Panel>
              <Panel>
                <PanelLabel color="var(--purple)">SWING STRUCTURE HH/HL/LH/LL</PanelLabel>
                <div style={{maxHeight:"200px",overflow:"auto"}}>
                  {analysis.score.struct.swings.slice(-10).reverse().map((s,i)=>(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"5px 8px",marginBottom:"3px",background:s.type==="HH"||s.type==="HL"?"rgba(0,255,65,0.05)":"rgba(255,42,42,0.05)",border:`1px solid ${s.type==="HH"||s.type==="HL"?"var(--neon)":"var(--red)"}22`}}>
                      <span style={{fontSize:"11px",fontWeight:800,letterSpacing:"3px",color:s.type==="HH"||s.type==="HL"?"var(--neon)":"var(--red)"}}>{s.type}</span>
                      <span style={{fontSize:"9px",color:"var(--text-secondary)"}}>${s.price?.toFixed(s.price<1?6:2)}</span>
                    </div>
                  ))}
                  {analysis.score.struct.swings.length===0&&<div style={{fontSize:"9px",color:"var(--text-muted)"}}>COMPUTING...</div>}
                </div>
              </Panel>
            </div>
            <Panel style={{marginBottom:"12px"}}>
              <PanelLabel color="var(--red)">BOS / CHOCH EVENTS</PanelLabel>
              <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
                {[...(analysis.score.struct.bos||[]),...(analysis.score.struct.choch||[])].slice(-10).map((e,i)=>(
                  <div key={i} style={{padding:"8px 14px",background:e.label?.includes("CHOCH")?"rgba(170,68,255,0.1)":"var(--amber-ghost)",border:`1px solid ${e.label?.includes("CHOCH")?"#aa44ff":"var(--amber)"}55`,fontSize:"10px",letterSpacing:"2px",color:e.label?.includes("CHOCH")?"#aa44ff":"var(--amber)"}}>
                    <div style={{fontWeight:700}}>{e.label}</div>
                    <div style={{fontSize:"8px",opacity:0.7,marginTop:"2px"}}>@ ${e.price?.toFixed(e.price<1?6:3)}</div>
                  </div>
                ))}
                {analysis.score.struct.bos?.length===0&&analysis.score.struct.choch?.length===0&&<div style={{fontSize:"9px",color:"var(--text-muted)",padding:"8px"}}>NO STRUCTURE BREAKS DETECTED</div>}
              </div>
            </Panel>
            <Panel>
              <PanelLabel color="var(--blue)">LIQUIDITY PRESSURE</PanelLabel>
              <div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:"16px",alignItems:"start"}}>
                <div><div style={{fontSize:"7px",color:"var(--text-muted)",marginBottom:"4px"}}>SCORE</div><div style={{fontSize:"36px",fontWeight:800,color:analysis.score.liq.score>70?"var(--red)":analysis.score.liq.score>40?"var(--amber)":"var(--neon)"}}>{analysis.score.liq.score}</div><div style={{fontSize:"8px",color:"var(--text-muted)"}}>/100</div></div>
                <div>
                  <div style={{height:"8px",background:"var(--bg-deep)",border:"1px solid var(--border)",marginBottom:"8px"}}><div style={{height:"100%",width:`${analysis.score.liq.score}%`,background:`linear-gradient(90deg,var(--neon-dim),${analysis.score.liq.score>70?"var(--red)":"var(--neon)"})`}}/></div>
                  <div style={{fontSize:"8px",color:"var(--text-muted)",marginBottom:"6px",letterSpacing:"2px"}}>HIGH-VOL ZONES</div>
                  {analysis.score.liq.zones.map((z,i)=>{const dist=meta.price?Math.abs(z-meta.price)/meta.price:0;const col=dist<0.02?"var(--red)":dist<0.05?"var(--amber)":"var(--neon)";return(<div key={i} style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"3px"}}><div style={{height:"10px",width:`${(60+i*5).toFixed(0)}%`,background:`${col}33`,border:`1px solid ${col}44`}}/><span style={{fontSize:"9px",color:col}}>${z.toFixed(z<0.01?8:4)}</span>{dist<0.02&&<StatusBadge label="NEAR" color="var(--red)"/>}</div>);})}
                </div>
              </div>
            </Panel>
          </>
        )}

        {tab==="BACKTEST"&&analysis&&!analysis.backtest&&(
          <Panel><div style={{padding:"30px",textAlign:"center"}}><div style={{fontSize:"24px",opacity:0.2,marginBottom:"12px"}}>⚠</div><div style={{fontSize:"10px",color:"var(--amber)",letterSpacing:"3px",marginBottom:"6px"}}>INSUFFICIENT DATA</div><div style={{fontSize:"8px",color:"var(--text-muted)"}}>Backtest requires ≥ 100 OHLCV bars.</div></div></Panel>
        )}

        {tab==="BACKTEST"&&analysis?.backtest&&(
          <>
            <div style={{padding:"8px 12px",background:"rgba(255,170,0,0.06)",border:"1px solid rgba(255,170,0,0.25)",marginBottom:"12px"}}>
              <div style={{fontSize:"10px",color:"var(--amber)",letterSpacing:"2px",fontWeight:700}}>PURGED CROSS-VALIDATION — EMBARGO 5 BARS — ZERO LOOKAHEAD BIAS</div>
              <div style={{fontSize:"8px",color:"var(--text-muted)",marginTop:"3px"}}>IS: 0→{analysis.backtest.splitIdx} | Purge: 5 bars | OOS: {analysis.backtest.splitIdx+5}→{analysis.backtest.totalBars} | Min confluence: 3/4 signals</div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"12px"}}>
              {[{label:"IN-SAMPLE",data:analysis.backtest.inSample,color:"var(--neon-dim)",badge:"TRAINING"},{label:"OUT-OF-SAMPLE",data:analysis.backtest.oos,color:"var(--neon)",badge:"BLIND TEST"}].map(({label,data:d,color,badge})=>(
                <Panel key={label} style={{borderColor:color+"44"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:"10px"}}><PanelLabel color={color}>{label}</PanelLabel><StatusBadge label={badge} color={color}/></div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
                    <Metric label="WIN RATE" value={`${d.wr?.toFixed(1)}%`} color={d.wr>=50?"var(--neon)":"var(--red)"}/>
                    <Metric label="PROFIT FACTOR" value={d.pf>=99?"∞":d.pf?.toFixed(2)} color={d.pf>=1.5?"var(--neon)":"var(--amber)"}/>
                    <Metric label="MAX DRAWDOWN" value={`${d.mdd?.toFixed(1)}%`} color={d.mdd<=20?"var(--neon)":"var(--red)"}/>
                    <Metric label="SHARPE RATIO" value={d.sharpe?.toFixed(2)} color={d.sharpe>=1?"var(--neon)":"var(--amber)"}/>
                  </div>
                  <div style={{marginTop:"8px",padding:"5px 8px",background:"var(--bg-deep)",border:"1px solid var(--border)",display:"flex",justifyContent:"space-between",fontSize:"8px",color:"var(--text-muted)"}}>
                    <span>TRADES: {d.trades}</span><span style={{color:"var(--red)"}}>BLOCKED: {d.quarantineCount}</span>
                  </div>
                </Panel>
              ))}
            </div>
            <Panel style={{height:"170px",padding:"10px",marginBottom:"12px"}}>
              <PanelLabel>EQUITY CURVE // IS → PURGE → OOS</PanelLabel>
              <div style={{height:"calc(100% - 28px)"}}><EquityCurve isData={analysis.backtest.inSample.equityCurve} oosData={analysis.backtest.oos.equityCurve}/></div>
            </Panel>
            <Panel>
              <PanelLabel color="var(--red)">QUARANTINE ZONE RULES</PanelLabel>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"8px"}}>
                {[{rule:"H ∈ [0.38, 0.45]",desc:"Hurst ambiguity. No edge."},{rule:"EXTREME VOL",desc:"ATR% > 8%. Size → 0.25×."},{rule:"BOS + CHOCH CONFLICT",desc:"Structure conflict. Blocked."}].map(r=>(
                  <div key={r.rule} style={{padding:"10px",background:"var(--red-ghost)",border:"1px solid rgba(255,42,42,0.2)"}}><div style={{fontSize:"9px",color:"var(--red)",fontWeight:700,marginBottom:"4px"}}>⛔ {r.rule}</div><div style={{fontSize:"8px",color:"var(--text-muted)",lineHeight:1.5}}>{r.desc}</div></div>
                ))}
              </div>
            </Panel>
          </>
        )}

        {tab==="BEHAVIOR"&&analysis&&(
          <>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginBottom:"12px"}}>
              <Panel>
                <PanelLabel color="var(--amber)">ACTIVE BEHAVIOR PATTERN</PanelLabel>
                <div style={{padding:"20px",textAlign:"center",marginBottom:"10px",background:analysis.score.behavior.type==="fomo"?"var(--amber-ghost)":analysis.score.behavior.type==="accum"?"var(--neon-ghost)":analysis.score.behavior.type!=="neutral"?"var(--red-ghost)":"var(--bg-deep)",border:"1px solid var(--border-bright)"}}>
                  <div style={{fontSize:"16px",fontWeight:800,letterSpacing:"3px",color:analysis.score.behavior.type==="fomo"?"var(--amber)":analysis.score.behavior.type==="accum"?"var(--neon)":analysis.score.behavior.type!=="neutral"?"var(--red)":"var(--text-muted)"}}>{analysis.score.behavior.label}</div>
                </div>
                {[{type:"accum",label:"ACCUMULATION",color:"var(--neon)",desc:"Smart money building."},{type:"dist",label:"DISTRIBUTION",color:"var(--red)",desc:"Exits in progress."},{type:"fomo",label:"FOMO SPIKE",color:"var(--amber)",desc:"Late retail. Vol 2.5×avg."},{type:"stophunt",label:"STOP HUNT",color:"var(--purple)",desc:"Liquidity grab + reversal."},{type:"neutral",label:"NEUTRAL/RANGE",color:"var(--text-muted)",desc:"No clear pattern."}].map(b=>(
                  <div key={b.type} style={{padding:"6px 10px",marginBottom:"3px",display:"flex",justifyContent:"space-between",alignItems:"center",background:analysis.score.behavior.type===b.type?`${b.color}11`:"var(--bg-deep)",border:`1px solid ${analysis.score.behavior.type===b.type?b.color:"var(--border)"}44`,opacity:analysis.score.behavior.type===b.type?1:0.4}}>
                    <div><span style={{fontSize:"9px",color:b.color,fontWeight:700,letterSpacing:"2px"}}>{b.label}</span><div style={{fontSize:"7px",color:"var(--text-muted)"}}>{b.desc}</div></div>
                    {analysis.score.behavior.type===b.type&&<span style={{color:b.color,fontSize:"14px"}}>●</span>}
                  </div>
                ))}
              </Panel>
              <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
                <Panel>
                  <PanelLabel color="var(--blue)">VOLATILITY SCALING</PanelLabel>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                    <Metric label="ATR VALUE" value={`$${analysis.score.vol.atr?.toFixed(analysis.score.vol.atr<0.001?8:4)}`} color="var(--blue)"/>
                    <Metric label="ATR %" value={`${analysis.score.vol.pct?.toFixed(2)}%`} color="var(--blue)"/>
                    <Metric label="REGIME" value={analysis.score.vol.regime} color={analysis.score.vol.regime==="EXTREME"?"var(--red)":"var(--amber)"}/>
                    <Metric label="SIZE MULT" value={analysis.score.vol.regime==="LOW"?"1.50×":analysis.score.vol.regime==="MEDIUM"?"1.00×":analysis.score.vol.regime==="HIGH"?"0.60×":"0.25×"} color="var(--neon)"/>
                  </div>
                  <div style={{marginTop:"8px",fontSize:"8px",color:"var(--text-muted)",lineHeight:1.8,padding:"6px",background:"var(--bg-deep)"}}>Stop = 2× ATR | Target = 3× stop (3:1 R:R)</div>
                </Panel>
                <Panel style={{flex:1}}>
                  <PanelLabel>CONFLUENCE SCORE</PanelLabel>
                  {analysis.score.signals.map((s,i)=>(
                    <div key={i} style={{display:"flex",alignItems:"center",gap:"8px",padding:"5px 0",borderBottom:"1px solid var(--border)"}}>
                      <span style={{color:s.active&&s.weight>0?"var(--neon)":s.active&&s.weight<0?"var(--red)":"var(--text-dead)",fontSize:"10px",width:"12px",textAlign:"center"}}>{s.active&&s.weight>0?"●":s.active&&s.weight<0?"✕":"○"}</span>
                      <span style={{fontSize:"8px",color:s.active?"var(--text-primary)":"var(--text-muted)",flex:1,letterSpacing:"1px"}}>{s.label}</span>
                      <span style={{fontSize:"9px",fontWeight:700,color:s.weight>0?"var(--neon)":s.weight<0?"var(--red)":"var(--text-muted)"}}>{s.weight>0?"+":""}{s.weight}</span>
                    </div>
                  ))}
                  <div style={{marginTop:"8px",padding:"8px",background:"var(--bg-deep)",border:"1px solid var(--border-bright)",textAlign:"center"}}>
                    <div style={{fontSize:"8px",color:"var(--text-muted)"}}>TOTAL</div>
                    <div style={{fontSize:"30px",fontWeight:800,color:analysis.score.score>=60?"var(--neon)":analysis.score.score<30?"var(--red)":"var(--amber)",textShadow:analysis.score.score>=70?"0 0 20px var(--neon-glow)":"none"}}>{analysis.score.score}</div>
                    <div style={{fontSize:"10px",letterSpacing:"3px",color:"var(--text-secondary)"}}>{analysis.score.grade}</div>
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
function AlertTicker({ watchlist, dataCache }) {
  const [pos, setPos] = useState(0);
  useEffect(()=>{const t=setInterval(()=>setPos(p=>p+1),55);return()=>clearInterval(t);},[]);
  const alerts = useMemo(()=>{
    const a=[];
    watchlist.forEach(t=>{
      const d=dataCache[t.address||t.symbol];
      if(!d?.ohlcv) return;
      const sc=MathUtils.blackHorseScore(d.ohlcv);
      if(sc.score>=70) a.push(`🐴 ${t.symbol}: BLACK HORSE [${sc.score}]`);
      if(sc.struct.choch?.length>0) a.push(`⚡ ${t.symbol}: CHOCH`);
      if(sc.vol.regime==="EXTREME") a.push(`⚠ ${t.symbol}: EXTREME VOL`);
      if(sc.behavior.type==="stophunt") a.push(`🎯 ${t.symbol}: STOP HUNT`);
      if(sc.H<0.35) a.push(`▼ ${t.symbol}: FRACTAL BREAKDOWN H=${sc.H?.toFixed(3)}`);
    });
    return a.length>0?a:["SURVEILLANCE ACTIVE","SCANNING ALL ASSETS","WAITING FOR CONFLUENCE","NO CRITICAL SIGNALS"];
  },[watchlist,dataCache]);
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
// ROOT APP
// ============================================================
export default function App() {
  const [watchlist, setWatchlist] = useState([
    {address:"0x6b175474e89094c44da98b954eedeac495271d0f",symbol:"DAI",name:"Dai Stablecoin",type:"evm",chain:"ethereum"},
    {address:"0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",symbol:"WETH",name:"Wrapped Ether",type:"evm",chain:"ethereum"},
  ]);
  const [selectedAsset, setSelectedAsset] = useState(null); // null = show home
  const [time, setTime] = useState("");
  const [dataCache, setDataCache] = useState({});

  // Single fetch for selected asset — passed as props
  const { data: activeData, loading: activeLoading } = useAssetData(selectedAsset);
  useEffect(()=>{
    if(activeData&&selectedAsset){
      const key=selectedAsset.address||selectedAsset.symbol;
      setDataCache(p=>({...p,[key]:activeData}));
    }
  },[activeData]); // activeData ref change = fetch done, selectedAsset stable via assetKey

  useEffect(()=>{
    const style=document.createElement("style");
    style.textContent=GLOBAL_CSS;
    document.head.appendChild(style);
    return()=>document.head.removeChild(style);
  },[]);

  useEffect(()=>{
    const t=setInterval(()=>setTime(new Date().toISOString().replace("T"," ").slice(0,19)+" UTC"),1000);
    setTime(new Date().toISOString().replace("T"," ").slice(0,19)+" UTC");
    return()=>clearInterval(t);
  },[]);

  const handleAddToWatchlist = useCallback((asset)=>{
    if(watchlist.length>=5) return;
    const key=asset.address||asset.symbol;
    if(watchlist.find(t=>(t.address||t.symbol)===key)) return;
    setWatchlist(p=>[...p,asset]);
  },[watchlist]);

  const handleRemove = useCallback((key)=>{
    setWatchlist(p=>p.filter(t=>(t.address||t.symbol)!==key));
    if(selectedAsset&&(selectedAsset.address||selectedAsset.symbol)===key) setSelectedAsset(null);
  },[selectedAsset]);

  const inWatchlist = selectedAsset ? !!watchlist.find(t=>(t.address||t.symbol)===(selectedAsset.address||selectedAsset.symbol)) : false;

  return (
    <div style={{minHeight:"100vh",height:"100vh",background:"var(--bg-void)",display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <style>{`@keyframes pulse{0%,100%{opacity:.3}50%{opacity:1}}@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <ScanLine/>

      {/* Top Bar */}
      <div style={{background:"var(--bg-void)",borderBottom:"1px solid var(--border)",padding:"6px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:"16px"}}>
          <span onClick={()=>setSelectedAsset(null)} style={{fontSize:"13px",fontWeight:800,color:"var(--neon)",letterSpacing:"4px",textShadow:"0 0 10px var(--neon-glow)",cursor:"pointer"}}>⬡ CHAINWATCH</span>
          <span style={{fontSize:"8px",color:"var(--text-muted)",letterSpacing:"3px"}}>MULTI-MARKET SURVEILLANCE v2.0</span>
          {selectedAsset&&<span style={{fontSize:"8px",color:"var(--text-muted)"}}>/ {selectedAsset.symbol}</span>}
        </div>
        <div style={{display:"flex",gap:"10px",alignItems:"center"}}>
          <span style={{fontSize:"7px",color:"var(--neon)",animation:"pulse 2s infinite",letterSpacing:"2px"}}>● LIVE</span>
          <span style={{fontSize:"8px",color:"var(--text-muted)",letterSpacing:"1px"}}>{time}</span>
          <StatusBadge label="EVM" color="var(--purple)"/>
          <StatusBadge label="STOCK" color="var(--blue)"/>
          <StatusBadge label="FOREX" color="var(--amber)"/>
        </div>
      </div>

      <AlertTicker watchlist={watchlist} dataCache={dataCache}/>

      {/* Main Layout */}
      <div style={{flex:1,display:"grid",gridTemplateColumns:"180px 1fr",overflow:"hidden"}}>
        {/* Sidebar */}
        <div style={{borderRight:"1px solid var(--border)",background:"var(--bg-deep)",overflow:"hidden"}}>
          <WatchlistSidebar
            watchlist={watchlist} active={selectedAsset}
            onSelect={setSelectedAsset} onHome={()=>setSelectedAsset(null)}
            onAdd={handleAddToWatchlist} onRemove={handleRemove}
          />
        </div>

        {/* Content */}
        <div style={{overflow:"auto",background:"var(--bg-void)"}}>
          {!selectedAsset
            ? <HomeScreen onSelectAsset={setSelectedAsset} watchlist={watchlist}/>
            : <AssetDashboard asset={selectedAsset} data={activeData} loading={activeLoading} onAddToWatchlist={handleAddToWatchlist} inWatchlist={inWatchlist}/>
          }
        </div>
      </div>
    </div>
  );
}
