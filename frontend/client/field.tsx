"use client";

import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

export function Field({
  label,
  htmlFor,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid gap-1", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-[0.625rem] text-destructive">{error}</p>
      ) : null}
    </div>
  );
}

type SelectOption = {
  value: string;
  label: string;
  disabled: boolean;
};

function optionText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }
  if (Array.isArray(children)) return children.map(optionText).join("");
  return "";
}

function readOptions(children: ReactNode): SelectOption[] {
  const options: SelectOption[] = [];
  const visit = (nodes: ReactNode) => {
    Children.forEach(nodes, (child) => {
      if (!isValidElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>(child)) {
        return;
      }
      if (child.type === "option") {
        const label = optionText(child.props.children);
        const value =
          child.props.value === undefined || child.props.value === null
            ? label
            : String(child.props.value);
        options.push({
          value,
          label: label || value,
          disabled: Boolean(child.props.disabled),
        });
        return;
      }
      if (child.props.children) visit(child.props.children);
    });
  };
  visit(children);
  return options;
}

function assignRef<T>(ref: Ref<T> | undefined, node: T | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}

function initialSelectValue(
  defaultValue: ComponentProps<"select">["defaultValue"],
  options: SelectOption[],
) {
  if (Array.isArray(defaultValue)) return String(defaultValue[0] ?? "");
  if (defaultValue !== undefined && defaultValue !== null) return String(defaultValue);
  return options[0]?.value ?? "";
}

export function NativeSelect({
  className,
  children,
  id,
  disabled,
  value,
  defaultValue,
  onChange,
  onBlur,
  ref,
  ...props
}: ComponentProps<"select">) {
  const options = useMemo(() => readOptions(children), [children]);
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState(() =>
    initialSelectValue(defaultValue, options),
  );
  const current = isControlled
    ? String(Array.isArray(value) ? value[0] ?? "" : value ?? "")
    : internal;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuBox, setMenuBox] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === current);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const anchor = buttonRef.current;
    function place() {
      const rect = anchor.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const openUp = spaceBelow < 160 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(96, Math.min(240, (openUp ? spaceAbove : spaceBelow) - 12));
      setMenuBox({
        top: openUp ? Math.max(8, rect.top - maxHeight - 4) : rect.bottom + 4,
        left: rect.left,
        width: rect.width,
        maxHeight,
      });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.focus();
    const option = document.getElementById(`${listId}-opt-${activeIndex}`);
    option?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, listId]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function emitChange(next: string) {
    const select = selectRef.current;
    if (!select) return;
    if (!isControlled) setInternal(next);
    select.value = next;
    onChange?.({
      target: select,
      currentTarget: select,
      type: "change",
    } as ChangeEvent<HTMLSelectElement>);
  }

  function choose(next: string) {
    emitChange(next);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function openMenu() {
    if (disabled) return;
    const index = options.findIndex((option) => option.value === current && !option.disabled);
    setActiveIndex(index >= 0 ? index : Math.max(0, options.findIndex((option) => !option.disabled)));
    setOpen(true);
  }

  function moveActive(step: number) {
    if (options.length === 0) return;
    setActiveIndex((index) => {
      let next = index;
      for (let attempt = 0; attempt < options.length; attempt += 1) {
        next = (next + step + options.length) % options.length;
        if (!options[next]?.disabled) return next;
      }
      return index;
    });
  }

  function onButtonKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) openMenu();
      else if (event.key === "ArrowDown") moveActive(1);
      else if (event.key === "ArrowUp") moveActive(-1);
      else {
        const option = options[activeIndex];
        if (option && !option.disabled) choose(option.value);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      const index = options.findIndex((option) => !option.disabled);
      if (index >= 0) setActiveIndex(index);
    } else if (event.key === "End") {
      event.preventDefault();
      for (let index = options.length - 1; index >= 0; index -= 1) {
        if (!options[index]?.disabled) {
          setActiveIndex(index);
          break;
        }
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options[activeIndex];
      if (option && !option.disabled) choose(option.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  const menu =
    open && menuBox
      ? createPortal(
          <div
            ref={menuRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={id}
            onKeyDown={onMenuKeyDown}
            className="fixed z-50 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none"
            style={{
              top: menuBox.top,
              left: menuBox.left,
              minWidth: menuBox.width,
              maxHeight: menuBox.maxHeight,
              backgroundColor: "var(--popover)",
              color: "var(--popover-foreground)",
            }}
          >
            {options.map((option, index) => {
              const active = index === activeIndex;
              return (
                <div
                  key={`${option.value}-${index}`}
                  id={`${listId}-opt-${index}`}
                  role="option"
                  aria-selected={option.value === current}
                  aria-disabled={option.disabled || undefined}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    if (!option.disabled) choose(option.value);
                  }}
                  className={cn(
                    "cursor-default rounded-md px-2 py-1.5 text-xs",
                    option.disabled && "pointer-events-none opacity-50",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "bg-popover text-popover-foreground",
                  )}
                  style={
                    active
                      ? {
                          backgroundColor: "var(--accent)",
                          color: "var(--accent-foreground)",
                        }
                      : {
                          backgroundColor: "var(--popover)",
                          color: "var(--popover-foreground)",
                        }
                  }
                >
                  {option.label}
                </div>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className={cn("relative min-w-0 w-full", className)}>
      <button
        type="button"
        id={id}
        ref={buttonRef}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onButtonKeyDown}
        onBlur={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && menuRef.current?.contains(next)) return;
          const select = selectRef.current;
          if (!select || !onBlur) return;
          onBlur({
            target: select,
            currentTarget: select,
            type: "blur",
            relatedTarget: null,
          } as FocusEvent<HTMLSelectElement>);
        }}
        className="flex h-7 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-input/20 px-2 text-left text-xs/relaxed text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
      >
        <span className="truncate">{selected?.label || "Select"}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          strokeWidth={2}
          className="size-3.5 shrink-0 text-muted-foreground"
        />
      </button>
      <select
        {...props}
        ref={(node) => {
          selectRef.current = node;
          assignRef(ref, node);
        }}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        value={current}
        onChange={(event) => {
          if (!isControlled) setInternal(event.target.value);
          onChange?.(event);
        }}
        className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0"
      >
        {children}
      </select>
      {menu}
    </div>
  );
}
