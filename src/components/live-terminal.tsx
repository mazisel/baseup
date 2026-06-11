"use client";

import { useEffect, useMemo, useState } from "react";
import type { AppCopy } from "@/lib/i18n";

type TerminalLine = AppCopy["home"]["terminalLines"][number];

export function LiveTerminal({ copy }: { copy: AppCopy["home"] }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTick(value => (value + 1) % 96);
    }, 1200);

    return () => window.clearInterval(id);
  }, []);

  const visibleLines = useMemo(() => {
    const count = Math.min(copy.terminalLines.length, 4 + Math.floor(tick / 2));
    return copy.terminalLines.slice(0, count);
  }, [copy.terminalLines, tick]);

  const progress = Math.min(98, 18 + tick * 2);
  const elapsed = 42 + tick * 7;
  const rows = 128400 + tick * 2380;
  const objects = 4300 + tick * 64;
  const currentStep = Math.min(copy.terminalLines.length, visibleLines.length);

  return (
    <div className="terminal-panel" aria-label="Migration log preview">
      <div className="terminal-head">
        <div className="window-dots">
          <span />
          <span />
          <span />
        </div>
        <div className="terminal-title">
          <span>{copy.terminalTitle}</span>
        </div>
      </div>

      <div className="terminal-body">
        <div className="terminal-status">
          <div>
            <span className="terminal-label">workflow</span>
            <strong>cloud-to-self-hosted</strong>
          </div>
          <div>
            <span className="terminal-label">step</span>
            <strong>{currentStep}/{copy.terminalLines.length}</strong>
          </div>
          <div>
            <span className="terminal-label">elapsed</span>
            <strong>{formatElapsed(elapsed)}</strong>
          </div>
        </div>

        <div className="terminal-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>

        <div className="terminal-metrics">
          <div>
            <span>{rows.toLocaleString("en-US")}</span>
            <small>rows checked</small>
          </div>
          <div>
            <span>{objects.toLocaleString("en-US")}</span>
            <small>storage objects</small>
          </div>
          <div>
            <span>{Math.min(100, progress + 1)}%</span>
            <small>verification</small>
          </div>
        </div>

        <div className="terminal-log">
          {visibleLines.map(([tone, line], index) => (
            <TerminalLogLine index={index} key={`${line}-${index}`} line={line} tone={tone} />
          ))}
          <div className="terminal-cursor">
            <span>$</span> waiting for next event<span className="cursor-block" />
          </div>
        </div>
      </div>
    </div>
  );
}

function TerminalLogLine({ index, line, tone }: { index: number; line: string; tone: TerminalLine[0] }) {
  const timestamp = `10:${String(14 + index).padStart(2, "0")}:${String(6 + index * 7).padStart(2, "0")}`;

  return (
    <div className={`terminal-row ${tone === "ok" ? "ok" : tone === "warn" ? "warn" : ""}`}>
      <span className="terminal-time">{timestamp}</span>
      <span className="terminal-symbol">{tone === "ok" ? "✓" : tone === "warn" ? "!" : "→"}</span>
      <span>{line}</span>
    </div>
  );
}

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}
