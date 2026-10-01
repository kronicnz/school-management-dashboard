const countFormatter = new Intl.NumberFormat("en-NZ")
const nzdFormatter = new Intl.NumberFormat("en-NZ", {
  style: "currency",
  currency: "NZD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatCount(value: number) {
  return countFormatter.format(value)
}

export function formatNZD(value: number) {
  return nzdFormatter.format(value)
}
