"use client";

import { ArrowRight, ShieldCheck, X } from "@phosphor-icons/react";
import { motion } from "motion/react";

export type ProductView = "trade" | "ghosts" | "portfolio" | "history" | "discover" | "detail";

const onboardingByView: Record<ProductView, { title: string; intro: string; steps: [string, string, string] }> = {
  trade: { title: "Build one clear trigger", intro: "Choose the market moment first. Triggerlane will keep watching until every condition you add is true together.", steps: ["Choose one signal or combine several", "Review the capital commitment", "Save, then start monitoring"] },
  ghosts: { title: "Read triggers by attention", intro: "The closest trigger is the one whose current signals are nearest to agreeing.", steps: ["Check the plain-language state", "Compare current values with targets", "Pause, resume, or inspect safely"] },
  detail: { title: "Start with the answer", intro: "The current answer explains why this trigger is waiting, blocked, or complete before showing technical evidence.", steps: ["Read the current state", "See which signal still disagrees", "Open evidence only when needed"] },
  portfolio: { title: "Follow every virtual dollar", intro: "Available capital is free to use. Reserved capital belongs to a named active trigger.", steps: ["Reconcile available plus reserved", "Trace each reservation to its owner", "Open ledger evidence for movements"] },
  history: { title: "Read the outcome first", intro: "Every row begins with what happened to the trigger and its capital, then keeps the stored proof behind it.", steps: ["Identify the outcome", "Confirm the capital result", "Expand the receipt or attempt"] },
  discover: { title: "Learn before you build", intro: "Strategies here are teaching examples. Replay explores demo history; Composer lets you edit the idea yourself.", steps: ["Understand why the signals belong together", "Replay without changing your account", "Load an editable draft for review"] },
};

export function OnboardingPanel({ view, close }: { view: ProductView; close: () => void }) {
  const guide = onboardingByView[view];
  return <motion.aside id="onboarding-panel" className="onboarding-panel" role="dialog" aria-modal="true" aria-labelledby="onboarding-title" initial={{ x: 32, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 32, opacity: 0 }}>
    <div className="onboarding-heading"><div><span>NEW HERE?</span><h2 id="onboarding-title">{guide.title}</h2></div><button className="icon-button" title="Close guide" onClick={close}><X size={18} /></button></div>
    <p>{guide.intro}</p>
    <ol>{guide.steps.map((step, index) => <li key={step}><i>{index + 1}</i><span>{step}</span></li>)}</ol>
    <div className="onboarding-boundary"><ShieldCheck size={18} /><span><b>Simulation stays in your control</b><small>Help never creates, starts, stops, or changes a trigger.</small></span></div>
    {view !== "discover" && <a href="/discover">LEARN WITH A STRATEGY<ArrowRight size={15} /></a>}
  </motion.aside>;
}
