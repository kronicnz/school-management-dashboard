export function logError(message: string, error: unknown, context?: Record<string, unknown>) {
  if (context) {
    console.error(message, { ...context, error })
    return
  }

  console.error(message, error)
}
