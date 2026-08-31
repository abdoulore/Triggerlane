"use client";

import { ArrowDown, ArrowRight, Check, Clock, Path, Play, ShieldCheck } from "@phosphor-icons/react";
import { DEMO_FRAMES, STRATEGY_TEMPLATES } from "@ghost/domain";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ConditionLattice } from "./condition-lattice";

const steps = [
  ["Watching market state", "The trigger observes a complete Demo Feed frame."],
  ["Capital reserved", "25% of the SOL position is committed before execution."],
  ["Conditions aligned", "Price, funding, and portfolio P&L qualify together."],
  ["Execution settled", "A deterministic Sandbox quote fills once."],
  ["Receipt generated", "The observations, quote, and ledger movement are recorded."],
] as const;

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => { const query = matchMedia("(prefers-reduced-motion: reduce)"); const update = () => setReduced(query.matches); update(); query.addEventListener("change", update); return () => query.removeEventListener("change", update); }, []);
  return reduced;
}

export function LandingExperience() {
  const [stage, setStage] = useState(0), [running, setRunning] = useState(false);
  const reducedMotion = useReducedMotion();
  const frame = DEMO_FRAMES[Math.min(stage + 1, DEMO_FRAMES.length - 1)]!;
  const currentStep = steps[stage]!;
  useEffect(() => { if (!running || stage >= 4) { if (stage >= 4) setRunning(false); return; } const timer = setTimeout(() => setStage((value) => value + 1), reducedMotion ? 450 : 1250); return () => clearTimeout(timer); }, [running, stage, reducedMotion]);
  const watch = () => { setStage(0); setRunning(true); document.querySelector("#guided-cycle")?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" }); };

  return <main className="landing-page">
    <header className="landing-nav">
      <Link href="/" className="landing-brand" aria-label="Triggerlane home"><Path weight="duotone" size={20} /> TRIGGERLANE</Link>
      <span>TRIGGERLANE SANDBOX · SIMULATED EXECUTION</span>
      <Link href="/trade" className="nav-entry">ENTER SANDBOX <ArrowRight size={14} /></Link>
    </header>

    <section className="landing-hero" aria-labelledby="landing-title">
      <ConditionLattice stage={stage} reducedMotion={reducedMotion} /><div className="hero-scanlines" aria-hidden="true" />
      <div className="hero-copy"><span className="landing-kicker">CONDITIONAL TRADING, ON YOUR TERMS</span><h1 id="landing-title">TRIGGERLANE</h1><p>Set the signals. Enter when they align. Triggerlane watches the market conditions you choose, reserves simulated capital, and executes once.</p><div className="hero-actions"><Link href="/trade" className="landing-primary">CREATE A TRIGGER <ArrowRight size={16} /></Link><button type="button" onClick={watch}><Play weight="fill" size={14} /> WATCH A TRIGGER</button></div></div>
      <div className="hero-readout" aria-label="Current SOL / USDC demonstration conditions"><span className="hero-market-pair">OBSERVING · SOL / USDC</span><div><span>01 · PRICE</span><b>${frame.price}</b><small>target ≥ $280</small></div><div><span>02 · FUNDING</span><b>{(Number(frame.funding) * 100).toFixed(3)}%</b><small>target ≥ 0.050%</small></div><div><span>03 · POSITION P&amp;L</span><b>+12.8%</b><small>target ≥ 10.0%</small></div></div>
      <a href="#guided-cycle" className="hero-next" aria-label="Explore how a trigger executes"><ArrowDown size={18} /></a>
    </section>

    <section id="guided-cycle" className="landing-section cycle-section">
      <div className="section-heading"><span className="landing-kicker">ONE INTENT · FIVE PROVABLE STATES</span><h2>Watch the order think before it acts.</h2><p>This deterministic demonstration uses the same Demo Feed sequence as the Sandbox terminal.</p></div>
      <div className="cycle-layout">
        <div className="cycle-command"><span className="cycle-index">0{stage + 1} / 05</span><div className="cycle-state"><i className={stage === 4 ? "settled" : "watching"} /><span>{currentStep[0]}</span></div><h3>{stage < 3 ? "A complete market state is forming." : stage === 3 ? "The trigger crosses the execution boundary." : "One fill. One receipt. No ambiguity."}</h3><p>{currentStep[1]}</p><div className="cycle-controls"><button type="button" onClick={() => { setStage(0); setRunning(true); }}><Play weight="fill" size={14} /> {stage === 4 ? "RUN AGAIN" : running ? "RUNNING" : "RUN CYCLE"}</button><button type="button" aria-label="Advance demonstration one step" onClick={() => { setRunning(false); setStage((value) => Math.min(4, value + 1)); }} disabled={stage === 4}><ArrowRight size={15} /></button></div></div>
        <ol className="cycle-timeline">{steps.map((step, index) => <li key={step[0]} className={index <= stage ? "reached" : ""}><i>{index < stage || stage === 4 ? <Check size={12} weight="bold" /> : index + 1}</i><div><b>{step[0]}</b><span>{step[1]}</span></div></li>)}</ol>
        <aside className={`landing-receipt ${stage === 4 ? "visible" : ""}`} aria-live="polite"><span>EXECUTION RECEIPT</span><ShieldCheck size={30} weight="duotone" /><strong>SELL 25% SOL</strong><small>FILLED AT $284.14 · 16 BPS</small><dl><div><dt>FRAME</dt><dd>DEMO-005</dd></div><div><dt>CAPITAL</dt><dd>4.875 SOL</dd></div><div><dt>MODE</dt><dd>SANDBOX</dd></div></dl></aside>
      </div>
    </section>

    <section className="landing-section comparison-section"><div className="section-heading"><span className="landing-kicker">WHY TRIGGERLANE</span><h2>Price alone is not the moment.</h2></div><div className="comparison-grid"><article><span>TRADITIONAL ORDER</span><h3>“Sell SOL at $280.”</h3><p>Sees one number. It cannot distinguish healthy momentum from a crowded, overheated market.</p><div className="single-signal"><i /><b>PRICE ≥ $280</b><ArrowRight size={16} /><strong>EXECUTE</strong></div></article><article className="ghost-comparison"><span>TRIGGERLANE ORDER</span><h3>“Sell when the full state agrees.”</h3><p>Waits for price, funding, and position profit to qualify in one complete observation frame.</p><div className="triple-signal"><b>PRICE</b><b>FUNDING</b><b>P&amp;L</b><ArrowRight size={16} /><strong>EXECUTE ONCE</strong></div></article></div></section>

    <section className="landing-section examples-section"><div className="section-heading"><span className="landing-kicker">SUPPORTED TRIGGERS</span><h2>Real configurations. No imaginary features.</h2><p>Every example validates against the current Composer and opens as an editable Sandbox intent.</p></div><div className="landing-strategies">{STRATEGY_TEMPLATES.slice(0, 3).map((strategy, index) => <Link key={strategy.id} href={`/trade?strategy=${strategy.id}`}><span>0{index + 1} · {strategy.category.toUpperCase()}</span><h3>{strategy.name}</h3><p>{strategy.description}</p><div>{strategy.metrics.map((metric) => <b key={metric}>{metric}</b>)}<ArrowRight size={16} /></div></Link>)}</div></section>

    <section className="landing-section architecture-section"><div><span className="landing-kicker">EXECUTION ARCHITECTURE</span><h2>Working now. Honest about what comes next.</h2></div><div className="architecture-path"><article><i className="active" /><span>CURRENT</span><h3>Triggerlane Sandbox</h3><p>Deterministic Demo Feed, simulated capital reservation, simulated quotes, immutable local receipts.</p><b>AVAILABLE</b></article><ArrowRight size={24} /><article className="future"><i /><span>TARGET</span><h3>Rialo execution</h3><p>Future reactive execution target. No network access or deployment is claimed in this build.</p><b>NOT CONFIGURED</b></article></div></section>
    <section className="landing-final"><Clock size={24} weight="duotone" /><span>YOUR ORDER CAN WAIT.</span><h2>You should not have to.</h2><Link href="/trade">ENTER TRIGGERLANE <ArrowRight size={17} /></Link><small>SIMULATED CAPITAL · SIMULATED EXECUTION · NO REAL ASSETS MOVED</small></section>
  </main>;
}
