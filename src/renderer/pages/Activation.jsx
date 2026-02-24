import { useEffect, useState } from "react";

export default function Activation({ onLicensed }) {
  const [licenseKey, setLicenseKey] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState(null);
  const [deviceId, setDeviceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(null);

  useEffect(() => {
    loadStatus();
  }, []);

  async function waitForCivicFlow() {
    return new Promise((resolve) => {
      const check = () => {
        if (window.civicflow && window.civicflow.license) {
          resolve(window.civicflow);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  async function loadStatus() {
    try {
      const api = await waitForCivicFlow();
      const status = await api.license.getStatus();
      setStatus(status);
      const d = await api.getDeviceId();
      setDeviceId(d?.deviceId || "");
    } catch (err) {
      console.error("Failed to load license status", err);
    }
  }

  const handleActivate = async () => {
    setLoading(true);
    setError(null);
    try {
      const api = await waitForCivicFlow();
      const res = await api.license.activate({ serial: licenseKey, email });
      if (res?.success) {
        setMessage("License activated.");
        await loadStatus();
        if (onLicensed) onLicensed();
      } else {
        setError(res?.error || "Activation failed.");
      }
    } catch (err) {
      console.error("Activation failed:", err);
      setError(err?.message || "Activation failed.");
    } finally {
      setLoading(false);
    }
  };

  async function deactivate() {
    await window.civicflow.license.deactivate();
    await loadStatus();
    setMessage("License removed");
  }

  return (
    <div style={{ padding: 40, maxWidth: 500, margin: "0 auto" }}>
      <h2>CivicFlow Activation</h2>

      <div style={{ marginBottom: 20 }}>
        <strong>Device ID:</strong>
        <div style={{ fontSize: 12, wordBreak: "break-all" }}>
          {deviceId}
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <strong>Status:</strong>
        <div>
          {status?.valid ? (
            <span style={{ color: "green" }}>Activated ({status.type})</span>
          ) : (
            <span style={{ color: "red" }}>Not Activated</span>
          )}
        </div>
        {(status?.mode === "trial" || status?.trialDaysLeft != null) && (
          <div style={{ fontSize: 12, marginTop: 4 }}>
            Trial days left: {status?.trialDaysLeft ?? 0}
          </div>
        )}
      </div>

      {!status?.valid && (
        <>
          <input
            placeholder="Email (optional)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: "100%", padding: 10, marginBottom: 10 }}
          />

          <input
            placeholder="Enter license key (e.g. XXXX-XXXX-XXXX-XXXX)"
            value={licenseKey}
            onChange={(e) => setLicenseKey(e.target.value)}
            style={{ width: "100%", padding: 10, marginBottom: 10 }}
          />

          <button onClick={handleActivate} disabled={loading} style={{ width: "100%", padding: 10 }}>
            {loading ? "Activating..." : "Activate License"}
          </button>
        </>
      )}

      {status?.valid && (
        <button onClick={deactivate} style={{ width: "100%", padding: 10 }}>
          Deactivate License
        </button>
      )}

      {message && (
        <div style={{ marginTop: 20, fontWeight: "bold" }}>{message}</div>
      )}
      {error && (
        <div style={{ marginTop: 10, color: "red", fontWeight: "bold" }}>{error}</div>
      )}
    </div>
  );
}
