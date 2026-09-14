import { useEffect, useState } from "react"

const MOBILE_BREAKPOINT = 768

export function useMobile() {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)

    const updateMatch = () => {
      setIsMobile(mediaQuery.matches)
    }

    updateMatch()
    mediaQuery.addEventListener("change", updateMatch)

    return () => {
      mediaQuery.removeEventListener("change", updateMatch)
    }
  }, [])

  return isMobile
}
