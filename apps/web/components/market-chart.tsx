"use client";

import { useEffect, useRef } from "react";
import { AreaSeries, ColorType, createChart, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import type { MarketHistoryPoint, MarketViewStatus } from "@ghost/domain";

function chartData(points: MarketHistoryPoint[]) {
  return points
    .map((point) => ({ time: Math.floor(new Date(point.at).getTime() / 1000) as Time, value: Number(point.value) }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))
    .sort((a, b) => Number(a.time) - Number(b.time))
    .filter((point, index, all) => index === 0 || point.time !== all[index - 1]?.time);
}

export function MarketChart({ points, status }: { points: MarketHistoryPoint[]; status: MarketViewStatus }) {
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
    series.setData(chartData(points));
    chart.timeScale().fitContent();
    chartRef.current = chart;
    seriesRef.current = series;
    return () => chart.remove();
  }, []);

  useEffect(() => {
    seriesRef.current?.setData(chartData(points));
    chartRef.current?.timeScale().fitContent();
  }, [points]);

  return <div className="market-chart-shell">
    <div ref={hostRef} className="market-chart" aria-label="Stored SOL market price history" />
    {points.length === 0 && <div className="market-chart-empty" role="status"><b>{status === "LOADING" ? "Loading market history" : "Market history unavailable"}</b><span>No price path is drawn without source-backed observations.</span></div>}
  </div>;
}
