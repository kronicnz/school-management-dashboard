import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useCallback,
  useDeferredValue,
  forwardRef,
  useImperativeHandle,
  useId,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react"
import { createPortal } from "react-dom"
import { cn } from "../../utils/cn"

export interface SelectOption {
  label: ReactNode
  value: string | number
  icon?: ReactNode
  description?: ReactNode
  disabled?: boolean
  searchText?: string
}

export interface SelectProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "value" | "defaultValue"> {
  options?: SelectOption[]
  value?: string | number
  defaultValue?: string | number
  onChange?: (event: React.ChangeEvent<HTMLSelectElement>) => void
  onSearchChange?: (query: string) => void
  placeholder?: string
  label?: string
  helperText?: string
  error?: string
  startIcon?: ReactNode
  sizeVariant?: "sm" | "md" | "lg"
  containerClassName?: string
  menuClassName?: string
  optionClassName?: string
  searchInputClassName?: string
  children?: ReactNode
  name?: string
  required?: boolean
  searchable?: boolean
  searchPlaceholder?: string
  noOptionsText?: string
  loading?: boolean
  loadingText?: string
  filterOption?: (option: SelectOption, query: string) => boolean
}

const getOptionValue = (
  value: string | number | readonly string[] | undefined,
  children: ReactNode
): string | number => {
  if (typeof value === "string" || typeof value === "number") return value
  if (typeof children === "string" || typeof children === "number") return children
  return ""
}

const nodeToText = (node: ReactNode): string => {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(nodeToText).join(" ")
  if (React.isValidElement<{ children?: ReactNode }>(node)) return nodeToText(node.props.children)
  return ""
}

// Parses standard <option> and <optgroup> React children
const parseOptionsFromChildren = (childrenNode: ReactNode): SelectOption[] => {
  const parsedOptions: SelectOption[] = []

  React.Children.forEach(childrenNode, (child) => {
    if (!React.isValidElement(child)) return

    if (child.type === "option") {
      const props = child.props as React.OptionHTMLAttributes<HTMLOptionElement>
      const val = getOptionValue(props.value, props.children)
      parsedOptions.push({
        value: val,
        label: props.children ?? String(val),
        disabled: props.disabled,
      })
    } else if (child.type === "optgroup") {
      const props = child.props as React.OptgroupHTMLAttributes<HTMLOptGroupElement>
      if (props.children) {
        React.Children.forEach(props.children, (groupChild) => {
          if (React.isValidElement(groupChild) && groupChild.type === "option") {
            const gProps = groupChild.props as React.OptionHTMLAttributes<HTMLOptionElement>
            const val = getOptionValue(gProps.value, gProps.children)
            parsedOptions.push({
              value: val,
              label: gProps.children ?? String(val),
              disabled: gProps.disabled || props.disabled,
            })
          }
        })
      }
    }
  })

  return parsedOptions
}

const getFirstEnabledIndex = (options: SelectOption[]) => options.findIndex((option) => !option.disabled)

const getNextEnabledIndex = (options: SelectOption[], startIndex: number, direction: 1 | -1) => {
  if (options.length === 0) return -1

  let index = startIndex
  for (let i = 0; i < options.length; i += 1) {
    index = (index + direction + options.length) % options.length
    if (!options[index]?.disabled) return index
  }

  return -1
}

const sizeConfig = {
  sm: {
    button: "h-9 text-xs pl-3 pr-8 rounded-lg",
    buttonWithIcon: "pl-8",
    iconLeft: "left-2.5",
    iconSize: "h-3.5 w-3.5",
    option: "px-3 py-1.5 text-xs",
  },
  md: {
    button: "h-10 text-sm pl-3.5 pr-10 rounded-xl",
    buttonWithIcon: "pl-10",
    iconLeft: "left-3",
    iconSize: "h-4 w-4",
    option: "px-3.5 py-2 text-sm",
  },
  lg: {
    button: "h-12 text-base pl-4 pr-11 rounded-xl",
    buttonWithIcon: "pl-11",
    iconLeft: "left-3.5",
    iconSize: "h-5 w-5",
    option: "px-4 py-2.5 text-base",
  },
}

type MenuPosition = {
  top: number
  left: number
  width: number
  maxHeight: number
}

const Select = forwardRef<HTMLButtonElement, SelectProps>(
  (
    {
      options: providedOptions,
      children,
      value: controlledValue,
      defaultValue,
      onChange,
      placeholder = "Select...",
      label,
      helperText,
      error,
      startIcon,
      sizeVariant = "md",
      disabled = false,
      className,
      containerClassName,
      menuClassName,
      optionClassName,
      searchInputClassName,
      name,
      id,
      onClick,
      onKeyDown,
      searchable,
      searchPlaceholder = "Search...",
      noOptionsText = "No options available",
      loading = false,
      loadingText = "Loading...",
      onSearchChange,
      filterOption,
      ...props
    },
    ref
  ) => {
    const generatedId = useId()
    const selectId = id || generatedId
    const listboxId = `${selectId}-listbox`
    const searchInputId = `${selectId}-search`
    const containerRef = useRef<HTMLDivElement>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)
    const menuRef = useRef<HTMLDivElement>(null)
    const searchRef = useRef<HTMLInputElement>(null)

    useImperativeHandle(ref, () => buttonRef.current!)

    const options: SelectOption[] = useMemo(
      () => providedOptions ?? (children ? parseOptionsFromChildren(children) : []),
      [children, providedOptions]
    )
    const shouldShowSearch = searchable ?? options.length > 6

    const [internalValue, setInternalValue] = useState<string | number | undefined>(
      defaultValue ?? (controlledValue !== undefined ? controlledValue : "")
    )
    const [isOpen, setIsOpen] = useState(false)
    const [focusedIndex, setFocusedIndex] = useState<number>(-1)
    const [searchQuery, setSearchQuery] = useState("")
    const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)

    const deferredSearchQuery = useDeferredValue(searchQuery)

    const selectedValue = controlledValue !== undefined ? controlledValue : internalValue
    const selectedOption = options.find((opt) => String(opt.value) === String(selectedValue))

    const filteredOptions = useMemo(() => {
      if (!shouldShowSearch) return options

      const trimmedQuery = deferredSearchQuery.trim()
      if (!trimmedQuery) return options

      const query = trimmedQuery.toLowerCase()

      return options.filter((option) => {
        if (filterOption) return filterOption(option, trimmedQuery)

        const haystack = [
          option.searchText,
          nodeToText(option.label),
          nodeToText(option.description),
          String(option.value),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()

        return haystack.includes(query)
      })
    }, [deferredSearchQuery, filterOption, options, shouldShowSearch])

    const closeMenu = useCallback(() => {
      setIsOpen(false)
      setSearchQuery("")
      setFocusedIndex(-1)
      setMenuPosition(null)
    }, [])

    const selectOption = useCallback(
      (val: string | number) => {
        if (controlledValue === undefined) {
          setInternalValue(val)
        }

        if (onChange) {
          const syntheticEvent = {
            target: { value: val, name: name ?? "" },
            currentTarget: { value: val, name: name ?? "" },
            preventDefault: () => {},
            stopPropagation: () => {},
          } as unknown as React.ChangeEvent<HTMLSelectElement>

          onChange(syntheticEvent)
        }

        closeMenu()
      },
      [closeMenu, controlledValue, name, onChange]
    )

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as Node
        const isInsideTrigger = containerRef.current?.contains(target)
        const isInsideMenu = menuRef.current?.contains(target)

        if (!isInsideTrigger && !isInsideMenu) {
          closeMenu()
        }
      }
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [closeMenu])

    useLayoutEffect(() => {
      if (!isOpen) {
        setMenuPosition(null)
        return
      }

      const updateMenuPosition = () => {
        const button = buttonRef.current
        const menu = menuRef.current
        if (!button || !menu || typeof window === "undefined") return

        const padding = 8
        const gap = 6
        const buttonRect = button.getBoundingClientRect()
        const menuRect = menu.getBoundingClientRect()
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight

        const maxWidth = Math.max(0, viewportWidth - padding * 2)
        const width = Math.min(Math.max(buttonRect.width, menuRect.width), maxWidth)

        const spaceBelow = Math.max(0, viewportHeight - buttonRect.bottom - padding - gap)
        const spaceAbove = Math.max(0, buttonRect.top - padding - gap)
        const placeBelow = spaceBelow >= menuRect.height || spaceBelow >= spaceAbove
        const maxHeight = Math.max(0, Math.min(menuRect.height, placeBelow ? spaceBelow : spaceAbove))

        const left = Math.min(
          Math.max(buttonRect.left, padding),
          Math.max(padding, viewportWidth - width - padding)
        )
        const top = placeBelow
          ? buttonRect.bottom + gap
          : Math.max(padding, buttonRect.top - gap - maxHeight)

        setMenuPosition({ top, left, width, maxHeight })
      }

      updateMenuPosition()

      window.addEventListener("resize", updateMenuPosition)
      window.addEventListener("scroll", updateMenuPosition, true)

      return () => {
        window.removeEventListener("resize", updateMenuPosition)
        window.removeEventListener("scroll", updateMenuPosition, true)
      }
    }, [filteredOptions, isOpen, loading, searchQuery, shouldShowSearch])

    useEffect(() => {
      if (!isOpen || !shouldShowSearch) return

      queueMicrotask(() => searchRef.current?.focus())
    }, [isOpen, shouldShowSearch])

    const handleSearchChange = (value: string) => {
      setSearchQuery(value)
      onSearchChange?.(value)
    }

    const handleButtonClick = (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event)
      if (event.defaultPrevented) return
      setIsOpen((prev) => {
        const next = !prev
        if (!next) {
          setSearchQuery("")
          setFocusedIndex(-1)
        } else {
          setFocusedIndex(getFirstEnabledIndex(filteredOptions))
        }
        return next
      })
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (disabled) return

      onKeyDown?.(e)
      if (e.defaultPrevented) return

      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        if (isOpen && focusedIndex >= 0 && focusedIndex < filteredOptions.length) {
          const opt = filteredOptions[focusedIndex]
          if (!opt.disabled) selectOption(opt.value)
        } else {
          setIsOpen((prev) => {
            const next = !prev
            if (!next) {
              setSearchQuery("")
              setFocusedIndex(-1)
            } else {
              setFocusedIndex(getFirstEnabledIndex(filteredOptions))
            }
            return next
          })
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault()
        if (!isOpen) {
          setIsOpen(true)
          setFocusedIndex(getFirstEnabledIndex(filteredOptions))
        } else {
          setFocusedIndex((prev) => getNextEnabledIndex(filteredOptions, prev < 0 ? -1 : prev, 1))
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        if (!isOpen) {
          setIsOpen(true)
          setFocusedIndex(() => {
            for (let i = filteredOptions.length - 1; i >= 0; i -= 1) {
              if (!filteredOptions[i]?.disabled) return i
            }
            return -1
          })
        } else {
          setFocusedIndex((prev) => getNextEnabledIndex(filteredOptions, prev < 0 ? 0 : prev, -1))
        }
      } else if (e.key === "Escape") {
        closeMenu()
      }
    }

    const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault()
        closeMenu()
        return
      }

      if (e.key === "Enter") {
        e.preventDefault()
        if (focusedIndex >= 0 && focusedIndex < filteredOptions.length) {
          const option = filteredOptions[focusedIndex]
          if (!option.disabled) selectOption(option.value)
        }
        return
      }

      if (e.key === "ArrowDown") {
        e.preventDefault()
        setFocusedIndex((prev) => getNextEnabledIndex(filteredOptions, prev < 0 ? -1 : prev, 1))
        return
      }

      if (e.key === "ArrowUp") {
        e.preventDefault()
        setFocusedIndex((prev) => getNextEnabledIndex(filteredOptions, prev < 0 ? 0 : prev, -1))
      }
    }

    const isError = Boolean(error)
    const currentSize = sizeConfig[sizeVariant]
    const activeOptionId = focusedIndex >= 0 ? `${selectId}-option-${focusedIndex}` : undefined

    return (
      <div
        ref={containerRef}
        className={cn("relative inline-flex flex-col gap-4 w-full", className, containerClassName)}
      >
        {name && <input type="hidden" name={name} value={selectedValue ?? ""} />}

        {label && (
          <label
            htmlFor={selectId}
            className="text-xs font-semibold tracking-wider text-[var(--color-muted)] uppercase select-none"
          >
            {label}
          </label>
        )}

        <div className="relative flex items-center w-full">
          {startIcon && (
            <div
              className={cn(
                "absolute z-10 pointer-events-none flex items-center justify-center text-[var(--color-muted)] transition-colors duration-200",
                currentSize.iconLeft,
                isOpen && "text-[var(--color-accent)]",
                isError && "text-rose-400"
              )}
            >
              <span className={currentSize.iconSize}>{startIcon}</span>
            </div>
          )}

          <button
            id={selectId}
            ref={buttonRef}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            aria-controls={isOpen ? listboxId : undefined}
            disabled={disabled}
            onClick={handleButtonClick}
            onKeyDown={handleKeyDown}
              className={cn(
                "relative flex items-center justify-between w-full font-medium transition-all duration-200 text-left outline-none cursor-pointer",
                currentSize.button,
                startIcon ? currentSize.buttonWithIcon : undefined,
                "bg-[var(--color-surface-soft)] text-[var(--color-text)] border border-[var(--color-border)] shadow-sm backdrop-blur-sm",
                "hover:border-[var(--color-border-muted)] hover:bg-[var(--color-row-hover)]",
                isOpen
                  ? "border-[var(--color-accent)] ring-2 ring-[var(--color-ring)] bg-[var(--color-surface-elevated)]"
                  : "focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-ring)]",
                isError && "border-rose-500/60 hover:border-rose-500 focus:border-rose-500 focus:ring-rose-500/20",
                "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[var(--color-border)]"
              )}
            {...props}
          >
              <div className="flex items-center gap-2 truncate pr-2">
                {selectedOption?.icon && (
                  <span className={cn("flex-shrink-0 text-[var(--color-accent)]", currentSize.iconSize)}>
                    {selectedOption.icon}
                  </span>
                )}

                {selectedOption ? (
                  <span className="truncate font-medium text-[var(--color-text)]">{selectedOption.label}</span>
                ) : (
                  <span className="truncate text-[var(--color-muted)] select-none">{placeholder}</span>
                )}
              </div>

            <div
              className={cn(
                "absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none flex items-center justify-center text-[var(--color-muted)] transition-transform duration-200",
                isOpen && "rotate-180 text-[var(--color-accent)]",
                isError && "text-rose-400"
              )}
            >
              <svg
                className={currentSize.iconSize}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2.2"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>
        </div>

        {isOpen && typeof document !== "undefined" && createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-labelledby={selectId}
            className={cn(
              "fixed z-50 flex flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] text-[var(--color-text)] shadow-xl backdrop-blur-xl",
              "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
              menuClassName
            )}
            style={{
              top: menuPosition?.top ?? 0,
              left: menuPosition?.left ?? 0,
              width: menuPosition?.width ?? "auto",
              maxHeight: menuPosition ? `${menuPosition.maxHeight}px` : undefined,
              visibility: menuPosition ? "visible" : "hidden",
            }}
          >
            {shouldShowSearch && (
              <div className="border-b border-[var(--color-border-muted)] p-2">
                <label className="sr-only" htmlFor={searchInputId}>
                  Search options
                </label>
                <div className="relative">
                  <svg
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-subtle)]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.3-4.3m1.8-5.2a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z" />
                  </svg>
                  <input
                    ref={searchRef}
                    id={searchInputId}
                    type="text"
                    role="combobox"
                    aria-autocomplete="list"
                    aria-expanded={isOpen}
                    aria-controls={listboxId}
                    aria-activedescendant={activeOptionId}
                    value={searchQuery}
                    onChange={(event) => handleSearchChange(event.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    placeholder={searchPlaceholder}
                    className={cn(
                      "w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-canvas)] py-2 pl-9 pr-3 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-muted)]",
                      "focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-ring)]",
                      searchInputClassName
                    )}
                  />
                </div>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto p-1.5 no-scrollbar">
              {filteredOptions.map((opt, index) => {
                const isSelected = String(opt.value) === String(selectedValue)
                const isFocused = index === focusedIndex

                return (
                  <div
                    id={`${selectId}-option-${index}`}
                    key={opt.value}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={opt.disabled}
                    onClick={() => !opt.disabled && selectOption(opt.value)}
                    onMouseEnter={() => setFocusedIndex(index)}
                    className={cn(
                      "my-0.5 flex cursor-pointer select-none items-center justify-between rounded-lg transition-colors duration-150",
                      currentSize.option,
                      isFocused && "bg-[var(--color-row-hover)] text-[var(--color-text)]",
                      isSelected && "bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-[var(--color-accent)] font-semibold",
                      !isSelected && !isFocused && "text-[var(--color-text)]",
                      opt.disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
                      optionClassName
                    )}
                  >
                    <div className="flex items-center gap-2.5 truncate pr-2">
                      {opt.icon && (
                        <span className={cn("flex-shrink-0", isSelected ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]")}>
                          {opt.icon}
                        </span>
                      )}
                      <div className="flex flex-col truncate">
                        <span className="truncate leading-normal">{opt.label}</span>
                        {opt.description && (
                          <span className="truncate text-xs font-normal text-[var(--color-muted)]">
                            {opt.description}
                          </span>
                        )}
                      </div>
                    </div>

                    {isSelected && (
                      <svg
                        className="ml-2 h-4 w-4 flex-shrink-0 text-[var(--color-accent)]"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                )
              })}

              {!loading && filteredOptions.length === 0 && (
                <div className="select-none px-4 py-3 text-center text-xs text-[var(--color-muted)]">
                  {searchQuery ? "No results found" : noOptionsText}
                </div>
              )}

              {loading && (
                <div className="select-none px-4 py-3 text-center text-xs text-[var(--color-muted)]">
                  {loadingText}
                </div>
              )}
            </div>
          </div>,
          document.body
        )}

        {(error || helperText) && (
          <p
            className={cn(
              "text-xs transition-opacity duration-150",
              isError ? "text-rose-400 font-medium" : "text-[var(--color-muted)]"
            )}
          >
            {error || helperText}
          </p>
        )}
      </div>
    )
  }
)

Select.displayName = "Select"

export { Select }
