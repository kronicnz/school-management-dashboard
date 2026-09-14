export function getAppUrl() {
  const configuredUrl = import.meta.env.VITE_APP_URL as string | undefined

  if (configuredUrl) {
    return configuredUrl
  }

  if (typeof window !== "undefined") {
    return window.location.origin
  }

  return "http://localhost:5173"
}
