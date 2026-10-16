import { Component } from "react";
import RetryNotice from "./RetryNotice.jsx";
import { supportLink } from "../product/context.js";

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
      return <div className="page"><RetryNotice message="This page could not open." detail="Your other pages are still available. Retry, or contact support with what happened." onRetry={() => this.setState({ failed: false })} /><a className="product-support-link" href={supportLink()}>Contact support</a></div>;
    }
    return this.props.children;
  }
}
