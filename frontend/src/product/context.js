/* global __APP_VERSION__ */
import { createContext, useContext } from "react";

export const ProductContext = createContext(null);
export const useProduct = () => useContext(ProductContext);
export const SUPPORT_EMAIL = "shivanshg2510@gmail.com";
export const APP_VERSION = __APP_VERSION__;
export function supportLink() {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`HSR support · v${APP_VERSION}`)}&body=${encodeURIComponent(`Page: ${window.location.pathname}\nVersion: ${APP_VERSION}\n\nWhat happened?\n\nPlease do not include passwords or customer/payment details.`)}`;
}
