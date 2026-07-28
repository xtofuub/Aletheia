import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Database,
  FilePlus2,
  Globe2,
  History,
  IdCard,
  Moon,
  Search,
  Settings,
  Sun,
  X,
  type LucideIcon,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import { useTheme } from "./theme-provider";
import { Button } from "./ui/button";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Command {
  label: string;
  hint: string;
  icon: LucideIcon;
  run: () => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const reduceMotion = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  const commands = useMemo<Command[]>(
    () => [
      {
        label: "Search records",
        hint: "S",
        icon: Search,
        run: () => void navigate({ to: "/search" }),
      },
      {
        label: "Start local import",
        hint: "I",
        icon: FilePlus2,
        run: () => void navigate({ to: "/datasets" }),
      },
      {
        label: "Open datasets",
        hint: "D",
        icon: Database,
        run: () => void navigate({ to: "/datasets" }),
      },
      {
        label: "Browse identities",
        hint: "",
        icon: IdCard,
        run: () => void navigate({ to: "/identities" }),
      },
      {
        label: "Browse domains",
        hint: "",
        icon: Globe2,
        run: () => void navigate({ to: "/domains" }),
      },
      {
        label: "Open saved views",
        hint: "",
        icon: History,
        run: () => void navigate({ to: "/saved-views" }),
      },
      {
        label: "Open settings",
        hint: ",",
        icon: Settings,
        run: () => void navigate({ to: "/settings" }),
      },
      {
        label: theme === "light" ? "Use dark theme" : "Use light theme",
        hint: "",
        icon: theme === "light" ? Moon : Sun,
        run: () => void setTheme(theme === "light" ? "dark" : "light"),
      },
    ],
    [navigate, setTheme, theme],
  );

  const filtered = commands.filter((command) =>
    command.label.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
      if (event.key === "Enter" && filtered[0]) {
        filtered[0].run();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filtered, onOpenChange, open]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="palette-backdrop"
          role="presentation"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onOpenChange(false);
          }}
        >
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="command-palette"
            initial={reduceMotion ? false : { opacity: 0, y: -10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.995 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="command-palette__input">
              <Search size={17} strokeWidth={1.6} aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a command"
                aria-label="Find a command"
              />
              <Button
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label="Close command palette"
                onClick={() => onOpenChange(false)}
              >
                <X size={15} aria-hidden="true" />
              </Button>
            </div>
            <div className="command-palette__label">Commands</div>
            <div className="command-palette__results">
              {filtered.length ? (
                filtered.map((command, index) => (
                  <button
                    key={command.label}
                    className="command-row"
                    data-active={index === 0}
                    onClick={() => {
                      command.run();
                      onOpenChange(false);
                    }}
                  >
                    <command.icon
                      size={16}
                      strokeWidth={1.6}
                      aria-hidden="true"
                    />
                    <span>{command.label}</span>
                    {command.hint ? <kbd>{command.hint}</kbd> : null}
                  </button>
                ))
              ) : (
                <p className="px-3 py-8 text-center text-sm text-text-tertiary">
                  No matching command
                </p>
              )}
            </div>
            <div className="command-palette__footer">
              <span>Enter to open</span>
              <span>Esc to close</span>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
