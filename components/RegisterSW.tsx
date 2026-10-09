"use client";

// Registers the service worker that makes the site installable as an app.
// Production only: in dev it would cache hot-reloaded bundles.
import { useEffect } from "react";

export default function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
