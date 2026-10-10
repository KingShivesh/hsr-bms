import { Component } from "react";
import RetryNotice from "./RetryNotice.jsx";

export default class RouteErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("Page could not render", error);
  }

  render() {
    if (this.state.failed) {
      return <div className="page"><RetryNotice message="This page could not open." detail="Your other pages are still available. Check your connection and retry." onRetry={() => window.location.reload()} /></div>;
    }
    return this.props.children;
  }
}
