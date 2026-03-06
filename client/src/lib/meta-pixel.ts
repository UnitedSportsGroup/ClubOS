declare global {
  interface Window {
    fbq: any;
    _fbq: any;
  }
}

export function initPixel(pixelId: string) {
  if (typeof window === "undefined" || !pixelId) return;
  if (window.fbq) return;

  const n: any = (window.fbq = function (...args: any[]) {
    n.callMethod ? n.callMethod.apply(n, args) : n.queue.push(args);
  });
  if (!window._fbq) window._fbq = n;
  n.push = n;
  n.loaded = true;
  n.version = "2.0";
  n.queue = [];

  const s = document.createElement("script");
  s.async = true;
  s.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(s);

  window.fbq("init", pixelId);
  window.fbq("track", "PageView");
}

export function trackEvent(eventName: string, params?: Record<string, any>, eventId?: string) {
  if (typeof window === "undefined" || !window.fbq) return;
  if (eventId) {
    window.fbq("track", eventName, params || {}, { eventID: eventId });
  } else {
    window.fbq("track", eventName, params || {});
  }
}

export function getFbp(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/_fbp=([^;]+)/);
  return match ? match[1] : null;
}

export function getFbc(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/_fbc=([^;]+)/);
  if (match) return match[1];
  const url = new URL(window.location.href);
  const fbclid = url.searchParams.get("fbclid");
  if (fbclid) {
    return `fb.1.${Date.now()}.${fbclid}`;
  }
  return null;
}

export function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
