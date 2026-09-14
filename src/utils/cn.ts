export type ClassNameValue = string | number | boolean | null | undefined | ClassNameArray
interface ClassNameArray extends Array<ClassNameValue> {}

export function cn(...inputs: ClassNameValue[]): string {
  const classes: string[] = []

  function process(value: ClassNameValue) {
    if (typeof value === "string" || typeof value === "number") {
      classes.push(String(value))
    } else if (Array.isArray(value)) {
      value.forEach(process)
    } else if (typeof value === "object" && value !== null) {
      for (const [key, val] of Object.entries(value)) {
        if (val) classes.push(key)
      }
    }
  }

  inputs.forEach(process)
  return classes.join(" ")
}