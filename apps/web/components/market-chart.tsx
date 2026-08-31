"use client";

import { useEffect, useRef } from "react";
import { AreaSeries, ColorType, createChart, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";

function buildData(current: number) {
  const now = Math.floor(Date.now() / 1000);
  const start = current - Math.max(14, current * 0.075);
  return Array.from({ length: 72 }, (_, index) => {
    const progress = index / 71;
    const wave = Math.sin(index * 0.67) * 1.45 + Math.cos(index * 0.21) * 0.75;
    const value = index === 71 ? current : start + (current - start) * progress + wave * Math.sin(progress * Math.PI);
    return { time: (now - (71 - index) * 60) as Time, value };
  });
}

export function MarketChart({ price }: { price: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const chart = createChart(hostRef.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#737a78", fontFamily: "var(--font-geist-mono)" },
      grid: { vertLines: { color: "rgba(255,255,255,.035)" }, horzLines: { color: "rgba(255,255,255,.035)" } },
      rightPriceScale: { borderColor: "rgba(255,255,255,.08)", scaleMargins: { top: 0.16, bottom: 0.12 } },
      timeScale: { borderColor: "rgba(255,255,255,.08)", timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: "rgba(112,242,204,.35)", labelBackgroundColor: "#1e7460" }, horzLine: { color: "rgba(112,242,204,.35)", labelBackgroundColor: "#1e7460" } },
      handleScroll: true,
      handleScale: true,
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: "#70f2cc",
      topColor: "rgba(112,242,204,.18)",
      bottomColor: "rgba(112,242,204,0)",
      lineWidth: 2,
      priceLineColor: "rgba(112,242,204,.45)",
      crosshairMarkerBackgroundColor: "#70f2cc",
    });
    series.setData(buildData(price));
    chart.timeScale().fitContent();
    chartRef.current = chart;
    seriesRef.current = series;
    return () => chart.remove();
  }, []);

  useEffect(() => {
    seriesRef.current?.setData(buildData(price));
    chartRef.current?.timeScale().scrollToRealTime();
  }, [price]);

  return <div ref={hostRef} className="market-chart" aria-label="SOL price chart" />;
}
