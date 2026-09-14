import { useCallback, useState } from "react"

type AsyncTaskOptions = {
  onError?: (error: unknown) => void
}

export function useAsyncTask() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const run = useCallback(async <T,>(task: () => Promise<T>, options?: AsyncTaskOptions) => {
    setLoading(true)
    setError(null)

    try {
      return await task()
    } catch (taskError) {
      setError(taskError)
      options?.onError?.(taskError)
      return undefined
    } finally {
      setLoading(false)
    }
  }, [])

  const resetError = useCallback(() => {
    setError(null)
  }, [])

  return { loading, error, run, resetError }
}
