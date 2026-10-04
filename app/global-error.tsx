"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-IN">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <h1 style={{ fontSize: 20 }}>FinSight360 hit an unexpected error</h1>
          <p style={{ color: "#64748b" }}>Please reload the page.</p>
          <button onClick={reset} style={{ padding: "10px 16px", borderRadius: 8, border: "1px solid #cbd5e1", cursor: "pointer" }}>
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
