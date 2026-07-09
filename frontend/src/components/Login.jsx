import { useState } from "react";
import { login } from "../api/index.js";
import { APP_NAME, TABLE_RANGE, TOTAL_TABLES } from "../config/hsrTables.js";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await login(username, password);
      localStorage.setItem("token", res.data.token);
      onLogin();
    } catch {
      setError("Invalid username or password");
      setTimeout(() => setError(""), 3000);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-container">
      <div className="login-shell">
        <section className="login-showcase" aria-label={APP_NAME}>
          <div className="login-brand">
            <div className="login-brand-mark">
              <i className="ti ti-circle-dot" aria-hidden="true" />
            </div>
            <div>
              <div className="login-kicker">Venue Control</div>
              <div className="login-title">{APP_NAME}</div>
            </div>
          </div>

          <div className="login-table-visual" aria-hidden="true">
            <div className="login-table-felt">
              <span className="login-pocket top-left" />
              <span className="login-pocket top-right" />
              <span className="login-pocket mid-left" />
              <span className="login-pocket mid-right" />
              <span className="login-pocket bottom-left" />
              <span className="login-pocket bottom-right" />
              <span className="login-cue-line" />
              <span className="login-ball cue" />
              <span className="login-ball red" />
              <span className="login-ball yellow" />
              <span className="login-ball blue" />
            </div>
          </div>

          <div className="login-showcase-footer">
            <div>
              <span>{TOTAL_TABLES}</span>
              <small>Tables</small>
            </div>
            <div>
              <span>₹</span>
              <small>Billing</small>
            </div>
            <div>
              <span>{TABLE_RANGE}</span>
              <small>HSR Setup</small>
            </div>
          </div>
        </section>

        <section className="login-box">
          <div className="login-card-head">
            <div>
              <div className="login-card-eyebrow">Admin access</div>
              <h1>Sign in</h1>
            </div>
            <div className="login-lock">
              <i className="ti ti-lock" aria-hidden="true" />
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Username</label>
              <div className="login-input-wrap">
                <i className="ti ti-user" aria-hidden="true" />
                <input
                  type="text"
                  className="input-field login-input"
                  placeholder="Enter username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  data-testid="username-input"
                />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <div className="login-input-wrap">
                <i className="ti ti-key" aria-hidden="true" />
                <input
                  type="password"
                  className="input-field login-input"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  data-testid="password-input"
                />
              </div>
            </div>
            <button
              type="submit"
              className="btn-login"
              disabled={loading}
              data-testid="login-button"
            >
              <span>{loading ? "Signing in..." : "Sign in"}</span>
              <i className="ti ti-arrow-right" aria-hidden="true" />
            </button>
            <div className="error-message">{error}</div>
          </form>

          <div className="login-footer">
            Default credentials: admin / admin123
          </div>
        </section>
      </div>
    </div>
  );
}
