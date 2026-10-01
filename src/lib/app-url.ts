export function getAppUrl() {
  const configuredUrl = import.meta.env.VITE_APP_URL as string | undefined

  if (typeof window !== "undefined") {
    const { hostname, origin } = window.location

    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".nip.io")) {
      return origin
    }
  }

  if (configuredUrl) {
    return configuredUrl
  }

  return "http://localhost:5173"
}
