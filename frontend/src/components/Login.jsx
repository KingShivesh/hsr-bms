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
      localStorage.setItem("role", res.data.role || "admin");
      localStorage.setItem("username", res.data.username || username);
      onLogin(res.data.role || "admin", res.data.username || username);
    } catch (err) {
      if (err.response?.status === 401) {
        setError("Invalid username or password");
      } else {
        setError(err.userMessage || "Backend is not reachable. Try again.");
      }
      setTimeout(() => setError(""), 3000);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-container cf-login-container">
      <div className="login-shell cf-login-shell">
        <section className="login-showcase" aria-label={APP_NAME}>
          <div className="login-brand">
            <div className="login-brand-mark">
              HSR
            </div>
            <div>
              <div className="login-kicker">Bengaluru Pro Edition</div>
              <div className="login-title">{APP_NAME}</div>
            </div>
          </div>

          <div className="cf-login-copy">
            <span>Cloud BMS console</span>
            <h2>Run tables, food, bookings and closing from one screen.</h2>
            <p>
              Built for fast counter operations: live timers, LP billing, cafe POS,
              reservations, billing audit and owner-ready shift closing.
            </p>
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
            <div>
              <span>24/7</span>
              <small>Live Ops</small>
            </div>
          </div>
        </section>

        <section className="login-box cf-login-box">
          <div className="login-card-head">
            <div>
              <div className="login-card-eyebrow">Secure staff access</div>
              <h1>Welcome back</h1>
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
              className="btn-login cf-btn-login"
              disabled={loading}
              data-testid="login-button"
            >
              <span>{loading ? "Signing in..." : "Sign in"}</span>
              <i className="ti ti-arrow-right" aria-hidden="true" />
            </button>
            <div className="error-message">{error}</div>
          </form>

          <div className="login-footer">
            Authorized owner and staff access only · Sessions sync through the live backend
          </div>
        </section>
      </div>
    </div>
  );
}
