import type React from "react";

import { cn } from "@/lib/utils";

export function LogoIcon({
  className,
  ...props
}: React.ComponentProps<"img">) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={cn("size-5 rounded-sm object-cover", className)}
      src="/aletheia-logo.png"
      {...props}
    />
  );
}

export function Logo({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      aria-label="Aletheia"
      className={cn("flex items-center gap-2.5", className)}
      role="img"
      {...props}
    >
      <LogoIcon />
      <span className="font-medium">Aletheia</span>
    </div>
  );
}
