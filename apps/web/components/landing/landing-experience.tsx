"use client";

import { ArrowRight, Check, Eye, Path, Play, Receipt, ShieldCheck, Target, Timer } from "@phosphor-icons/react";
import { STRATEGY_TEMPLATES } from "@ghost/domain";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SignalEngineScene, type SignalId } from "../signal-engine/signal-engine";

const GUIDE = [
  { title: "Choose your moment", body: "Use one signal for a simple trigger, or combine signals when context matters.", status: "YOUR RULES", stage: 0 },
  { title: "Let Triggerlane wait", body: "It reads one complete market frame and acts only when every rule you selected is true together.", status: "WATCHING", stage: 2 },
  { title: "Get one clear result", body: "Virtual capital moves once, then the observations, quote, and outcome are stored in a receipt.", status: "RECEIPT STORED", stage: 4 },
] as const;

const SIGNALS = [
  { id: "price", label: "SOL price", value: "$284.14", target: "$280 or more" },
  { id: "funding", label: "Funding", value: "+0.061%", target: "0.050% or more" },
  { id: "pnl", label: "Position profit", value: "+12.8%", target: "10.0% or more" },
] as const satisfies ReadonlyArray<{ id: SignalId; label: string; value: string; target: string }>;

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function LandingExperience() {
  const [stage, setStage] = useState(0);
  const [focused, setFocused] = useState<SignalId | null>(null);
  const [running, setRunning] = useState(false);
  const reducedMotion = useReducedMotion();
  const guideIndex = stage >= 4 ? 2 : stage >= 2 ? 1 : 0;
  const guide = GUIDE[guideIndex]!;
  const readyCount = Math.min(stage, 3);
  const status = useMemo(() => stage >= 4 ? "FILLED ONCE" : stage >= 3 ? "READY TO ACT" : `${readyCount} OF 3 READY`, [readyCount, stage]);

  useEffect(() => {
    if (!running) return;
    if (stage >= 4) { setRunning(false); return; }
    const timer = window.setTimeout(() => setStage((value) => Math.min(4, value + 1)), reducedMotion ? 120 : 900);
    return () => window.clearTimeout(timer);
  }, [reducedMotion, running, stage]);

  const run = () => { setStage(0); setFocused(null); setRunning(true); };
  const showGuide = (index: number) => { setRunning(false); setStage(GUIDE[index]!.stage); };

  return <main className={`landing-page phase-24 stage-${stage}`}>
    <header className="landing-nav">
      <Link href="/" className="landing-brand" aria-label="Triggerlane home"><Path weight="duotone" size={22} /> TRIGGERLANE</Link>
      <span>CONDITIONAL TRADING SIMULATION</span>
      <Link href="/trade" className="nav-entry">CREATE A TRIGGER <ArrowRight size={15} /></Link>
    </header>

    <section className="landing-hero landing-signal-hero" aria-labelledby="landing-title">
      <SignalEngineScene context="landing" stage={stage} focused={focused} onFocus={setFocused} />
      <div className="landing-engine-vignette" aria-hidden="true" />
      <div className="hero-copy">
        <span className="landing-kicker">TRIGGERLANE</span>
        <h1 id="landing-title">Trade the whole moment.</h1>
        <p>Choose one signal or combine several. Triggerlane watches them, then makes one simulated trade when every active rule is true.</p>
        <div className="hero-actions"><Link href="/trade" className="landing-primary">CREATE A TRIGGER <ArrowRight size={17} /></Link><a href="#beginner-guide">SEE HOW IT WORKS</a></div>
      </div>
      <div className="hero-signal-console" aria-label="Signal Engine demonstration">
        <div className="hero-signal-row" role="group" aria-label="Signals in this demonstration">
          {SIGNALS.map((signal, index) => <button key={signal.id} className={`${stage >= index + 1 ? "ready" : ""} ${focused === signal.id ? "focused" : ""}`} aria-pressed={focused === signal.id} onClick={() => setFocused(signal.id)}><span>0{index + 1} {signal.label}</span><b>{signal.value}</b><small>{signal.target}</small></button>)}
        </div>
        <button className={`hero-engine-action ${stage >= 4 ? "fired" : ""}`} onClick={run} disabled={running}><span>{status}</span><b>SELL 25% SOL</b><small>{running ? "WATCHING THE FRAME" : stage >= 4 ? "RECEIPT STORED" : "PLAY THE EXAMPLE"}</small><Play size={15} weight="fill" /></button>
      </div>
    </section>

    <section className="capability-proof" aria-label="What Triggerlane can do">
      <div><Target size={20} /><span><b>ONE OR MANY SIGNALS</b><small>Use only the rules you need.</small></span></div>
      <div><ShieldCheck size={20} /><span><b>VIRTUAL CAPITAL FIRST</b><small>Commitment is visible before starting.</small></span></div>
      <div><Timer size={20} /><span><b>ONE-SHOT EXECUTION</b><small>A qualifying trigger fires once.</small></span></div>
      <div><Receipt size={20} /><span><b>STORED EVIDENCE</b><small>Every outcome keeps its frame and receipt.</small></span></div>
    </section>

    <section id="beginner-guide" className="landing-section beginner-section" aria-labelledby="beginner-title">
      <div className="section-heading"><span className="landing-kicker">START HERE</span><h2 id="beginner-title">Conditional trading in three human steps.</h2><p>You describe the moment. Triggerlane does the waiting. The simulation shows exactly what happened.</p></div>
      <div className="beginner-walkthrough">
        <div className="guide-tabs" role="tablist" aria-label="How Triggerlane works">
          {GUIDE.map((item, index) => <button key={item.title} role="tab" aria-selected={guideIndex === index} aria-controls="guide-panel" id={`guide-tab-${index}`} onClick={() => showGuide(index)}><i>{index + 1}</i><span><b>{item.title}</b><small>{item.status}</small></span><ArrowRight size={17} /></button>)}
        </div>
        <div id="guide-panel" className="guide-panel" role="tabpanel" aria-labelledby={`guide-tab-${guideIndex}`}>
          <span className="guide-status"><i />{guide.status}</span><h3>{guide.title}</h3><p>{guide.body}</p>
          <div className="guide-frame" aria-label={`${readyCount} of 3 demonstration signals ready`}>
            {SIGNALS.map((signal, index) => <div key={signal.id} className={stage >= index + 1 ? "ready" : ""}><i>{stage >= index + 1 ? <Check size={13} weight="bold" /> : index + 1}</i><span><b>{signal.label}</b><small>{signal.target}</small></span><strong>{signal.value}</strong></div>)}
            <div className={`guide-result ${stage >= 4 ? "fired" : ""}`}><span>ONE ACTION</span><b>SELL 25% SOL</b><small>{stage >= 4 ? "FILLED ONCE, RECEIPT STORED" : "WAITING FOR YOUR RULES"}</small></div>
          </div>
          <button className="guide-play" onClick={run} disabled={running}><Play size={15} weight="fill" />{running ? "WATCHING THE MOMENT" : stage >= 4 ? "PLAY AGAIN" : "PLAY THE FULL EXAMPLE"}</button>
        </div>
      </div>
    </section>

    <section className="landing-section trust-section" aria-labelledby="trust-title">
      <div className="trust-statement"><span className="landing-kicker">BUILT TO SHOW ITS WORK</span><h2 id="trust-title">No mystery between your rules and the result.</h2><p>Triggerlane keeps the observation, capital commitment, simulated quote, and final outcome connected.</p></div>
      <div className="trust-ledger">
        <article><Eye size={22} /><span><b>See why it is waiting</b><small>Current values and your targets stay side by side.</small></span></article>
        <article><ShieldCheck size={22} /><span><b>Know what is committed</b><small>Virtual capital is reserved before any simulated execution.</small></span></article>
        <article><Receipt size={22} /><span><b>Inspect what happened</b><small>Filled, blocked, and stopped outcomes keep their evidence.</small></span></article>
      </div>
    </section>

    <section className="landing-section examples-section"><div className="section-heading"><span className="landing-kicker">TRY A REAL CONFIGURATION</span><h2>Start simple. Add context only when it helps.</h2><p>Each example opens as an editable draft. Nothing is saved, armed, or funded until you review it.</p></div><div className="landing-strategies">{STRATEGY_TEMPLATES.slice(0, 3).map((strategy, index) => <Link key={strategy.id} href={`/trade?strategy=${strategy.id}`}><span>0{index + 1} {strategy.category.toUpperCase()}</span><h3>{strategy.name}</h3><p>{strategy.description}</p><div>{strategy.metrics.map((metric) => <b key={metric}>{metric}</b>)}<ArrowRight size={16} /></div></Link>)}</div></section>

    <section className="landing-section simulation-boundary" aria-labelledby="boundary-title">
      <div><span className="landing-kicker">THE SIMULATION BOUNDARY</span><h2 id="boundary-title">Useful now. Precise about what is not live.</h2><p>Explore conditional trading without real funds while Triggerlane keeps future execution claims separate.</p></div>
      <div className="boundary-ledger">
        <article className="available"><i /><span>AVAILABLE NOW</span><h3>Triggerlane Simulation</h3><p>Demo market frames, virtual capital, simulated quotes, one-shot outcomes, and local receipts.</p><b>READY TO TRY</b></article>
        <article><i /><span>FUTURE TARGET</span><h3>Rialo execution</h3><p>No Rialo network access, deployment, connected wallet, or real asset execution is claimed.</p><b>NOT CONFIGURED</b></article>
      </div>
      <p className="boundary-note"><ShieldCheck size={18} /> Simulated capital only. Market data may be live, but no real assets are moved.</p>
    </section>

    <section className="landing-final"><Path size={28} weight="duotone" /><span>SET THE MOMENT ONCE</span><h2>Let Triggerlane do the waiting.</h2><Link href="/trade">CREATE YOUR TRIGGER <ArrowRight size={17} /></Link><small>SIMULATED CAPITAL · SIMULATED EXECUTION · NO REAL ASSETS MOVED</small></section>
  </main>;
}
