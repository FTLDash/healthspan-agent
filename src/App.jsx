import { useState, useEffect, useRef } from "react";

const DEEP_HEALTH_PHASES = [
  { id: "physical",      label: "Physical",      icon: "⚡", color: "#E8F5E9", accent: "#2E7D32", description: "exercise, sleep, nutrition, body composition",      gmailLabel: "Healthspan/Physical"      },
  { id: "mental",        label: "Mental",        icon: "🧠", color: "#E3F2FD", accent: "#1565C0", description: "cognitive health, brain training, neuroplasticity",  gmailLabel: "Healthspan/Mental"        },
  { id: "emotional",     label: "Emotional",     icon: "💚", color: "#FCE4EC", accent: "#880E4F", description: "emotional regulation, resilience, stress management", gmailLabel: "Healthspan/Emotional"     },
  { id: "existential",   label: "Existential",   icon: "✨", color: "#F3E5F5", accent: "#6A1B9A", description: "purpose, meaning, values, identity, life direction",  gmailLabel: "Healthspan/Existential"   },
  { id: "relational",    label: "Relational",    icon: "🤝", color: "#FFF8E1", accent: "#E65100", description: "social connection, relationships, community",        gmailLabel: "Healthspan/Relational"    },
  { id: "environmental", label: "Environmental", icon: "🌿", color: "#E0F7FA", accent: "#006064", description: "surroundings, nature, built environment, light",     gmailLabel: "Healthspan/Environmental" },
];

const STATUS = { IDLE: "idle", SEARCHING: "searching", DRAFTING: "drafting", DONE: "done" };

function getNextSunday(timeStr) {
  const now = new Date();
  const [hours, minutes] = timeStr.split(":").map(Number);
  const day = now.getDay();
  if (day === 0) {
    const todaySunday = new Date(now);
    todaySunday.setHours(hours, minutes, 0, 0);
    if (todaySunday > now) return todaySunday;
  }
  const daysUntil = day === 0 ? 7 : 7 - day;
  const next = new Date(now);
  next.setDate(now.getDate() + daysUntil);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

function formatCountdown(ms) {
  if (ms <= 0) return "Running now...";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  return `${m}m ${sec}s`;
}

async function callClaude(payload) {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default function HealthspanAgent() {
  const [email, setEmail]               = useState("");
  const [scheduleTime, setScheduleTime] = useState("08:00");
  const [schedulerOn, setSchedulerOn]   = useState(false);
  const [status, setStatus]             = useState(STATUS.IDLE);
  const [log, setLog]                   = useState([]);
  const [results, setResults]           = useState([]);
  const [draftsSent, setDraftsSent]     = useState(0);
  const [countdown, setCountdown]       = useState("");
  const [nextRun, setNextRun]           = useState(null);
  const [activeTab, setActiveTab]       = useState("setup");
  const timerRef = useRef(null);
  const schedRef = useRef(null);
  const isRunning = status === STATUS.SEARCHING || status === STATUS.DRAFTING;

  useEffect(() => {
    clearInterval(timerRef.current);
    if (!schedulerOn || !nextRun) { setCountdown(""); return; }
    timerRef.current = setInterval(() => setCountdown(formatCountdown(nextRun - Date.now())), 1000);
    return () => clearInterval(timerRef.current);
  }, [schedulerOn, nextRun]);

  useEffect(() => {
    clearTimeout(schedRef.current);
    if (!schedulerOn) { setNextRun(null); return; }
    const next = getNextSunday(scheduleTime);
    setNextRun(next);
    const delay = next - Date.now();
    if (delay > 0) {
      schedRef.current = setTimeout(() => {
        runAgent();
        setSchedulerOn(false);
        setTimeout(() => setSchedulerOn(true), 3000);
      }, delay);
    }
    return () => clearTimeout(schedRef.current);
  }, [schedulerOn, scheduleTime]);

  const addLog = (msg, type = "info") =>
    setLog((prev) => [...prev, { msg, type }]);

  const runAgent = async () => {
    if (!email.trim()) { addLog("Please enter a recipient email.", "error"); return; }
    setStatus(STATUS.SEARCHING);
    setLog([]);
    setResults([]);
    setDraftsSent(0);
    setActiveTab("log");

    const allResults = [];
    const weekLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    for (const phase of DEEP_HEALTH_PHASES) {
      addLog(`🔍 Generating brief: ${phase.label} Health...`, "info");
      await sleep(2000);
      try {
        const d = await callClaude({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: `You are a health content researcher for a Healthspan project. Generate 3 insightful content ideas about the given health topic for LinkedIn posts aimed at people interested in longevity and deep health. Return ONLY a raw JSON object with no markdown, no backticks, no explanation. Use this exact format: {"trends":[{"headline":"string","summary":["point 1","point 2"],"url":"https://pubmed.ncbi.nlm.nih.gov/","source":"string"},{"headline":"string","summary":["point 1","point 2"],"url":"https://pubmed.ncbi.nlm.nih.gov/","source":"string"},{"headline":"string","summary":["point 1","point 2"],"url":"https://pubmed.ncbi.nlm.nih.gov/","source":"string"}]}`,
          messages: [{ role: "user", content: `Generate 3 LinkedIn content ideas about "${phase.label} Health" covering: ${phase.description}. Focus on practical insights for healthspan and longevity. Return JSON only.` }],
        });
        const text = d.content?.find((b) => b.type === "text")?.text || "";
        const clean = text.replace(/```json|```/g, "").trim();
        const start = clean.indexOf("{");
        const end = clean.lastIndexOf("}");
        if (start === -1 || end === -1) throw new Error("No JSON in response");
        const parsed = JSON.parse(clean.slice(start, end + 1));
        if (!parsed.trends) throw new Error("Invalid format");
        allResults.push({ phase, data: parsed });
        addLog(`✅ ${parsed.trends.length} ideas generated — ${phase.label}`, "success");
      } catch (err) {
        addLog(`⚠️ Skipped ${phase.label}: ${err.message}`, "warn");
      }
    }

    setResults(allResults);
    setStatus(STATUS.DRAFTING);
    addLog("📧 Creating Gmail drafts...", "info");

    let created = 0;

    for (const { phase, data } of allResults) {
      try {
        const trendsText = (data.trends || []).map((t, i) => {
          const bullets = (t.summary || []).map(s => `  • ${s}`).join("\n");
          return `${i + 1}. ${t.headline}\n   Source: ${t.source}\n${bullets}\n   Reference: ${t.url}`;
        }).join("\n\n");

        const subject = `[Healthspan] ${phase.icon} ${phase.label} Health — LinkedIn Content Brief (${weekLabel})`;
        const body = `${phase.icon} ${phase.label} Health — LinkedIn Content Brief\nWeek of ${weekLabel}\n${"─".repeat(48)}\n\n${trendsText}\n\n${"─".repeat(48)}\nHealthspan Deep Health Agent · ${phase.gmailLabel}`;

        const gd = await callClaude({
          model: "claude-sonnet-4-20250514",
          max_tokens: 500,
          mcp_servers: [{ type: "url", url: "https://gmail.mcp.claude.com/mcp", name: "gmail-mcp" }],
          system: `You are a Gmail assistant. Use Gmail tools to create draft emails and apply labels.`,
          messages: [{ role: "user", content: `Create a Gmail draft:\nTo: ${email}\nSubject: ${subject}\nBody:\n${body}\n\nThen apply the Gmail label "${phase.gmailLabel}" to the draft. Create the label if it does not exist.` }],
        });
        const gt = gd.content?.find((b) => b.type === "text")?.text || "";
        if (gt.toLowerCase().includes("draft") || gt.toLowerCase().includes("creat") || gt.toLowerCase().includes("label")) {
          created++;
          addLog(`📬 Draft saved: ${phase.gmailLabel}`, "success");
        } else {
          addLog(`⚠️ Check Gmail manually: ${phase.label}`, "warn");
        }
      } catch (err) {
        addLog(`❌ Gmail error (${phase.label}): ${err.message}`, "error");
      }
    }

    setDraftsSent(created);
    setStatus(STATUS.DONE);
    addLog(`🎉 Done! ${created}/6 drafts saved to Gmail.`, "success");
    if (created > 0) setActiveTab("results");
  };

  const reset = () => { setStatus(STATUS.IDLE); setLog([]); setResults([]); setDraftsSent(0); setActiveTab("setup"); };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#f0fdf4 0%,#ecfeff 60%,#f0f4ff 100%)", fontFamily: "Georgia,serif", padding: "28px 16px 48px" }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 42, marginBottom: 8 }}>🌿</div>
          <h1 style={{ fontSize: 25, fontWeight: 700, color: "#1a3a2a", margin: "0 0 6px", letterSpacing: "-0.5px" }}>Healthspan Content Agent</h1>
          <p style={{ color: "#4a7060", fontSize: 14, margin: 0 }}>Generates content briefs for all 6 Deep Health pillars &amp; sends to Gmail</p>
        </div>

        <div style={{ background: "white", borderRadius: 14, padding: "14px 20px", marginBottom: 14, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", border: "1px solid #e0f0e8" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#6a6a6a", marginBottom: 9, textTransform: "uppercase", letterSpacing: "0.5px" }}>📌 Gmail Labels — auto-created per pillar</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {DEEP_HEALTH_PHASES.map((p) => (
              <span key={p.id} style={{ background: p.color, border: `1.5px solid ${p.accent}`, borderRadius: 20, padding: "3px 11px", fontSize: 11, color: p.accent, fontWeight: 600 }}>
                {p.icon} {p.gmailLabel}
              </span>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
          {[["setup","⚙️ Setup"],["log","📟 Log"],["results","📋 Briefs"]].map(([id, label]) => (
            <button key={id} onClick={() => setActiveTab(id)} style={{
              padding: "8px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
              background: activeTab === id ? "#2E7D32" : "white",
              color: activeTab === id ? "white" : "#4a7060",
              boxShadow: activeTab === id ? "0 2px 8px rgba(46,125,50,0.25)" : "0 1px 4px rgba(0,0,0,0.06)",
            }}>{label}</button>
          ))}
        </div>

        {activeTab === "setup" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: "white", borderRadius: 14, padding: "18px 22px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)", border: "1px solid #e0f0e8" }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: "#2e5e40", display: "block", marginBottom: 7 }}>📬 Recipient Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" disabled={isRunning}
                style={{ width: "100%", padding: "10px 13px", borderRadius: 8, border: "1.5px solid #c8e6c9", fontSize: 14, outline: "none", boxSizing: "border-box", color: "#1a3a2a", background: isRunning ? "#f5f5f5" : "white" }} />
            </div>

            <div style={{ background: "white", borderRadius: 14, padding: "18px 22px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)", border: "1px solid #e0f0e8" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div>
                  <div style={{ fontWeight: 700, color: "#1a3a2a", fontSize: 14 }}>🗓️ Sunday Auto-Scheduler</div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>Runs automatically every Sunday morning</div>
                </div>
                <div onClick={() => !isRunning && setSchedulerOn(v => !v)} style={{
                  width: 46, height: 25, borderRadius: 13, cursor: isRunning ? "not-allowed" : "pointer",
                  background: schedulerOn ? "#2E7D32" : "#ccc", position: "relative", transition: "background 0.2s", flexShrink: 0,
                }}>
                  <div style={{ position: "absolute", top: 3, left: schedulerOn ? 24 : 3, width: 19, height: 19, borderRadius: "50%", background: "white", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <label style={{ fontSize: 13, color: "#555", whiteSpace: "nowrap" }}>Run at:</label>
                <input type="time" value={scheduleTime} onChange={(e) => setScheduleTime(e.target.value)} disabled={isRunning}
                  style={{ padding: "8px 12px", borderRadius: 8, border: "1.5px solid #c8e6c9", fontSize: 14, color: "#1a3a2a", outline: "none", background: isRunning ? "#f5f5f5" : "white" }} />
                <span style={{ fontSize: 12, color: "#888" }}>(your local time)</span>
              </div>
              {schedulerOn && nextRun && (
                <div style={{ marginTop: 13, background: "#f0fdf4", borderRadius: 8, padding: "10px 14px", border: "1px solid #a5d6a7", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#2E7D32" }}>⏰ Next run scheduled</div>
                    <div style={{ fontSize: 11, color: "#4a7060", marginTop: 2 }}>
                      {nextRun.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} at {nextRun.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: "#2E7D32", fontFamily: "monospace" }}>{countdown}</div>
                </div>
              )}
              {!schedulerOn && <div style={{ marginTop: 11, fontSize: 12, color: "#bbb", fontStyle: "italic" }}>Scheduler off — toggle to auto-run every Sunday</div>}
            </div>

            {status !== STATUS.DONE ? (
              <button onClick={runAgent} disabled={isRunning} style={{
                width: "100%", padding: "15px", borderRadius: 12, border: "none",
                background: isRunning ? "#ccc" : "linear-gradient(135deg,#2E7D32,#006064)",
                color: "white", fontSize: 15, fontWeight: 700, cursor: isRunning ? "not-allowed" : "pointer",
              }}>
                {isRunning ? (status === STATUS.SEARCHING ? "✍️ Generating briefs..." : "📧 Creating Gmail drafts...") : "▶ Run Now — All 6 Pillars"}
              </button>
            ) : (
              <div style={{ background: "linear-gradient(135deg,#e8f5e9,#e0f7fa)", border: "1.5px solid #81c784", borderRadius: 12, padding: "20px 24px", textAlign: "center" }}>
                <div style={{ fontSize: 30, marginBottom: 6 }}>🎉</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#2E7D32", marginBottom: 4 }}>{draftsSent}/6 drafts saved to Gmail!</div>
                <p style={{ color: "#4a7060", fontSize: 13, margin: "0 0 14px" }}>Check Gmail Drafts — each pillar is tagged under <strong>Healthspan/[Pillar]</strong>.</p>
                <button onClick={reset} style={{ padding: "9px 22px", borderRadius: 8, border: "1.5px solid #2E7D32", background: "white", color: "#2E7D32", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>↺ Reset</button>
              </div>
            )}
          </div>
        )}

        {activeTab === "log" && (
          <div style={{ background: "#0f1f0f", borderRadius: 14, padding: "18px 20px", minHeight: 220, boxShadow: "0 2px 10px rgba(0,0,0,0.1)" }}>
            <div style={{ fontSize: 11, color: "#6fcf7f", fontWeight: 700, marginBottom: 10, fontFamily: "monospace", letterSpacing: "1px" }}>● AGENT LOG</div>
            {log.length === 0 && <div style={{ color: "#4a6a4a", fontSize: 13, fontFamily: "monospace" }}>No activity yet.</div>}
            {log.map((e, i) => (
              <div key={i} style={{ fontFamily: "monospace", fontSize: 12, marginBottom: 5, lineHeight: 1.5, color: e.type === "error" ? "#ff6b6b" : e.type === "success" ? "#6fcf7f" : e.type === "warn" ? "#ffd166" : "#9ecfa8" }}>{e.msg}</div>
            ))}
          </div>
        )}

        {activeTab === "results" && (
          <div>
            {results.length === 0 && <div style={{ background: "white", borderRadius: 14, padding: "32px", textAlign: "center", color: "#aaa", fontSize: 14 }}>No results yet — run the agent first.</div>}
            {results.map(({ phase, data }) => (
              <div key={phase.id} style={{ background: "white", borderRadius: 12, padding: "18px 20px", marginBottom: 14, borderLeft: `4px solid ${phase.accent}`, boxShadow: "0 2px 8px rgba(0,0,0,0.05)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ fontWeight: 700, color: phase.accent, fontSize: 15 }}>{phase.icon} {phase.label} Health</div>
                  <span style={{ background: phase.color, border: `1px solid ${phase.accent}`, borderRadius: 20, padding: "2px 10px", fontSize: 11, color: phase.accent, fontWeight: 600 }}>🏷️ {phase.gmailLabel}</span>
                </div>
                {(data.trends || []).map((trend, i) => (
                  <div key={i} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: i < data.trends.length - 1 ? "1px solid #f0f0f0" : "none" }}>
                    <div style={{ fontWeight: 600, color: "#222", fontSize: 13, marginBottom: 3 }}>{i + 1}. {trend.headline}</div>
                    <div style={{ fontSize: 11, color: "#888", marginBottom: 5 }}>{trend.source}</div>
                    <ul style={{ margin: "0 0 5px", paddingLeft: 18 }}>
                      {(trend.summary || []).map((s, j) => <li key={j} style={{ fontSize: 12, color: "#444", marginBottom: 2 }}>{s}</li>)}
                    </ul>
                    {trend.url && <a href={trend.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: phase.accent, textDecoration: "none" }}>🔗 {trend.url.length > 65 ? trend.url.slice(0, 65) + "…" : trend.url}</a>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        <p style={{ textAlign: "center", fontSize: 11, color: "#bbb", marginTop: 30 }}>Healthspan Project · Deep Health Content Agent</p>
      </div>
    </div>
  );
}
