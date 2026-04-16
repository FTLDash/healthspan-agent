import { useState, useEffect, useRef } from "react";

const DEEP_HEALTH_PHASES = [
  { id: "physical",      label: "Physical",      icon: "⚡", color: "#E8F5E9", accent: "#2E7D32", description: "Body composition, movement, sleep, nutrition",        gmailLabel: "Healthspan/Physical"      },
  { id: "mental",        label: "Mental",        icon: "🧠", color: "#E3F2FD", accent: "#1565C0", description: "Cognitive health, clarity, neuroplasticity",          gmailLabel: "Healthspan/Mental"        },
  { id: "emotional",     label: "Emotional",     icon: "💚", color: "#FCE4EC", accent: "#880E4F", description: "Emotional regulation, resilience, wellbeing",         gmailLabel: "Healthspan/Emotional"     },
  { id: "existential",   label: "Existential",   icon: "✨", color: "#F3E5F5", accent: "#6A1B9A", description: "Purpose, meaning, values, identity",                  gmailLabel: "Healthspan/Existential"   },
  { id: "relational",    label: "Relational",    icon: "🤝", color: "#FFF8E1", accent: "#E65100", description: "Social connection, relationships, community",         gmailLabel: "Healthspan/Relational"    },
  { id: "environmental", label: "Environmental", icon: "🌿", color: "#E0F7FA", accent: "#006064", description: "Surroundings, nature, built environment",             gmailLabel: "Healthspan/Environmental" },
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

  // Countdown ticker
  useEffect(() => {
    clearInterval(timerRef.current);
    if (!schedulerOn || !nextRun) { setCountdown(""); return; }
    timerRef.current = setInterval(() => setCountdown(formatCountdown(nextRun - Date.now())), 1000);
    return () => clearInterval(timerRef.current);
  }, [schedulerOn, nextRun]);

  // Scheduler arm/disarm
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

    for (const phase of DEEP_HEALTH_PHASES) {
      addLog(`🔍 Searching: ${phase.label} Health...`, "info");
      try {
        const res = await fetch("/api/claude", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1000,
            tools: [{ type: "web_search_20250305", name: "web_search" }],
            system: `You are a health content researcher for a Healthspan project on Deep Health.
Find 3 recent, credible trending articles or studies about the given health domain.
Respond ONLY with valid JSON — no markdown, no backticks, no preamble.
Format exactly:
{"phase":"string","trends":[{"headline":"string","summary":["bullet 1","bullet 2","bullet 3"],"url":"string","source":"string"}]}`,
            messages: [{ role: "user", content: `Find 3 recent trending articles about "${phase.label} Health" for healthspan/longevity. Focus: ${phase.description}. Return JSON only.` }],
          }),
        });
        const d = await res.json();
        const text = d.content?.find((b) => b.type === "text")?.text || "";
        const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
        allResults.push({ phase, data: parsed });
        addLog(`✅ ${parsed.trends?.length || 0} trends found — ${phase.label}`, "success");
      } catch (err) {
        addLog(`⚠️ Skipped ${phase.label}: ${err.message}`, "warn");
      }
    }

    setResults(allResults);
    setStatus(STATUS.DRAFTING);
    addLog("📧 Creating tagged Gmail drafts...", "info");

    let created = 0;
    const weekLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

    for (const { phase, data } of allResults) {
      try {
        const trendsHtml = (data.trends || []).map((t, i) => `
<div style="margin-bottom:16px;padding:12px 16px;background:#fafafa;border-left:4px solid ${phase.accent};border-radius:6px;">
  <strong style="font-size:14px;color:#111;">${i + 1}. ${t.headline}</strong><br/>
  <span style="color:#888;font-size:11px;">📰 ${t.source}</span>
  <ul style="margin:8px 0 6px;padding-left:18px;">
    ${(t.summary || []).map((s) => `<li style="font-size:13px;color:#333;margin-bottom:3px;">${s}</li>`).join("")}
  </ul>
  <a href="${t.url}" style="font-size:12px;color:${phase.accent};text-decoration:none;">🔗 Read full article →</a>
</div>`).join("");

        const emailBody = `<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;color:#222;padding:24px;">
  <div style="background:${phase.color};border-radius:12px;padding:20px 24px;margin-bottom:22px;">
    <div style="font-size:30px;margin-bottom:4px;">${phase.icon}</div>
    <h2 style="margin:0 0 4px;color:${phase.accent};font-size:19px;">${phase.label} Health</h2>
    <div style="font-size:12px;color:#666;">LinkedIn Content Brief · Week of ${weekLabel}</div>
    <div style="margin-top:8px;display:inline-block;background:${phase.accent};color:white;font-size:11px;padding:3px 10px;border-radius:20px;font-weight:600;">🏷️ ${phase.gmailLabel}</div>
  </div>
  <p style="color:#555;font-size:13px;margin-bottom:18px;">Top trending insights for your <strong>${phase.label} Health</strong> LinkedIn post this week. Pick an angle and write your content.</p>
  ${trendsHtml}
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0 14px;"/>
  <p style="font-size:11px;color:#bbb;text-align:center;">Healthspan Deep Health Agent · Auto-generated Sunday briefing · ${phase.gmailLabel}</p>
</div>`;

        const gr = await fetch("/api/claude", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1000,
            mcp_servers: [{ type: "url", url: "https://gmail.mcp.claude.com/mcp", name: "gmail-mcp" }],
            system: `You create Gmail drafts and apply labels. Create the draft, then apply the label "${phase.gmailLabel}" (create label if it doesn't exist). Confirm when done.`,
            messages: [{ role: "user", content: `Create a Gmail draft:\nTo: ${email}\nSubject: [Healthspan] ${phase.icon} ${phase.label} Health — LinkedIn Brief (${weekLabel})\nBody (HTML): ${emailBody}\n\nThen apply the Gmail label "${phase.gmailLabel}" to this draft.` }],
          }),
        });
        const gd = await gr.json();
        const gt = gd.content?.find((b) => b.type === "text")?.text || "";
        if (gt.toLowerCase().includes("draft") || gt.toLowerCase().includes("creat") || gt.toLowerCase().includes("label")) {
          created++;
          addLog(`📬 Draft + label saved: ${phase.gmailLabel}`, "success");
        } else {
          addLog(`⚠️ Verify manually in Gmail: ${phase.label}`, "warn");
        }
      } catch (err) {
        addLog(`❌ Gmail error (${phase.label}): ${err.message}`, "error");
      }
    }

    setDraftsSent(created);
    setStatus(STATUS.DONE);
    addLog(`🎉 Done! ${created}/6 drafts created with Gmail labels.`, "success");
    if (created > 0) setActiveTab("results");
  };

  const reset = () => { setStatus(STATUS.IDLE); setLog([]); setResults([]); setDraftsSent(0); setActiveTab("setup"); };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg,#f0fdf4 0%,#ecfeff 60%,#f0f4ff 100%)", fontFamily: "Georgia,serif", padding: "28px 16px 48px" }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 42, marginBottom: 8 }}>🌿</div>
          <h1 style={{ fontSize: 25, fontWeight: 700, color: "#1a3a2a", margin: "0 0 6px", letterSpacing: "-0.5px" }}>Healthspan Content Agent</h1>
          <p style={{ color: "#4a7060", fontSize: 14, margin: 0 }}>Researches all 6 Deep Health pillars every Sunday &amp; sends tagged Gmail drafts</p>
        </div>

        {/* Label chips */}
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

        {/* Tabs */}
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

        {/* ── SETUP ── */}
        {activeTab === "setup" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Email input */}
            <div style={{ background: "white", borderRadius: 14, padding: "18px 22px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)", border: "1px solid #e0f0e8" }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: "#2e5e40", display: "block", marginBottom: 7 }}>📬 Recipient Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" disabled={isRunning}
                style={{ width: "100%", padding: "10px 13px", borderRadius: 8, border: "1.5px solid #c8e6c9", fontSize: 14, outline: "none", boxSizing: "border-box", color: "#1a3a2a", background: isRunning ? "#f5f5f5" : "white" }} />
            </div>

            {/* Scheduler */}
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

            {/* Run / Done */}
            {status !== STATUS.DONE ? (
              <button onClick={runAgent} disabled={isRunning} style={{
                width: "100%", padding: "15px", borderRadius: 12, border: "none",
                background: isRunning ? "#ccc" : "linear-gradient(135deg,#2E7D32,#006064)",
                color: "white", fontSize: 15, fontWeight: 700, cursor: isRunning ? "not-allowed" : "pointer",
              }}>
                {isRunning
                  ? (status === STATUS.SEARCHING ? "🔍 Searching all 6 pillars..." : "📧 Creating Gmail drafts...")
                  : "▶ Run Now — All 6 Pillars"}
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

        {/* ── LOG ── */}
        {activeTab === "log" && (
          <div style={{ background: "#0f1f0f", borderRadius: 14, padding: "18px 20px", minHeight: 220, boxShadow: "0 2px 10px rgba(0,0,0,0.1)" }}>
            <div style={{ fontSize: 11, color: "#6fcf7f", fontWeight: 700, marginBottom: 10, fontFamily: "monospace", letterSpacing: "1px" }}>● AGENT LOG</div>
            {log.length === 0 && <div style={{ color: "#4a6a4a", fontSize: 13, fontFamily: "monospace" }}>No activity yet.</div>}
            {log.map((e, i) => (
              <div key={i} style={{
                fontFamily: "monospace", fontSize: 12, marginBottom: 5, lineHeight: 1.5,
                color: e.type === "error" ? "#ff6b6b" : e.type === "success" ? "#6fcf7f" : e.type === "warn" ? "#ffd166" : "#9ecfa8",
              }}>{e.msg}</div>
            ))}
          </div>
        )}

        {/* ── BRIEFS ── */}
        {activeTab === "results" && (
          <div>
            {results.length === 0 && (
              <div style={{ background: "white", borderRadius: 14, padding: "32px", textAlign: "center", color: "#aaa", fontSize: 14 }}>No results yet — run the agent first.</div>
            )}
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
                      {(trend.summary || []).map((s, j) => (
                        <li key={j} style={{ fontSize: 12, color: "#444", marginBottom: 2 }}>{s}</li>
                      ))}
                    </ul>
                    {trend.url && (
                      <a href={trend.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: phase.accent, textDecoration: "none" }}>
                        🔗 {trend.url.length > 65 ? trend.url.slice(0, 65) + "…" : trend.url}
                      </a>
                    )}
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
