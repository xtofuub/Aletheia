import type React from "react";

export const LOGO_VARIANTS = [
  { id: "ribbon", label: "Ribbon" },
  { id: "shards", label: "Shards" },
  { id: "swoop", label: "Swoop" },
  { id: "orbit", label: "Orbit" },
] as const;

export type LogoVariant = (typeof LOGO_VARIANTS)[number]["id"];

const logoPaths: Record<LogoVariant, readonly string[]> = {
  ribbon: [
    "M4.2 8.2 8.8 3.3c1.3-1.4 3.5-1.4 4.8.1l2.8 3.2-3.1 2.5-3.2-3.3-2.8 3.1Z",
    "M2.8 11.1 7.4 7.5l2.6 2.6-3.6 2.9 4.9 4.8-2.8 2.7-5.7-5.7Z",
    "M12.7 9.5 17.2 6l3.5 4.6c1.3 1.8 1.1 4.3-.6 5.8l-3.3 3-2.7-2.6 3.1-2.9c.5-.5.6-1.2.2-1.8l-2.1-2.7-2.6 2Z",
  ],
  shards: [
    "M3 8.8 10.8 3l2.7 2.4-4.8 4.1 3.1 2.8-2.7 2.6L3 10.2Z",
    "M10.8 11.4 17.2 5l3.8 2.5-5 4.8 3.1 2.8-3 3.1-5.3-4.6Z",
    "M4.4 15.1 8.4 12l2.4 2.5-3.2 2.7 3.3 3.3-4 1.5-3.8-4.3Z",
  ],
  swoop: [
    "M3.2 8.6 7.3 4.2l3.4 3.2-2.1 2.2-2.2-2.1-1.7 1.8Z",
    "M6.1 11.2c3.2-3.4 7.3-5.1 11.8-4.2l2.9.6-2.4 3.2c-3.2-.5-6 .6-8.2 2.9l-2.5 2.6-3.1-2.7Z",
    "M10.2 17.1c2.8-2.9 6.3-4.3 10.1-3.7l-2.8 3.3c-1.9-.1-3.6.6-4.9 2l-2.3 2.4-1.7-2.1Z",
  ],
  orbit: [
    "M4 7.4 8.3 3l4.1.3-1.1 4.3-2.9 2.5Z",
    "M12.6 3.4 20.7 6.7l-3.1 4.5-3.2-1.1-2.9-2.8Z",
    "M20.8 10.6 17.1 7l-4.2 1.1-2.5 3 3.3 2.1Z",
    "M20.6 16.7 15.8 21l-4-.6 1-4.2 3-2.7Z",
    "M11.2 20.6 4.3 17l2.3-3.9 3.8.3 2.8 3.1Z",
  ],
};

export const isLogoVariant = (value: string | null): value is LogoVariant =>
  LOGO_VARIANTS.some((variant) => variant.id === value);

export const LogoIcon = ({
  variant = "ribbon",
  ...props
}: React.ComponentProps<"svg"> & { variant?: LogoVariant }) => (
  <svg
    aria-hidden="true"
    fill="none"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    {logoPaths[variant].map((path) => (
      <path d={path} fill="currentColor" key={path} />
    ))}
  </svg>
);

export const Logo = ({
  variant = "ribbon",
  ...props
}: React.ComponentProps<"svg"> & { variant?: LogoVariant }) => (
  <svg
    aria-label="Aletheia"
    fill="none"
    role="img"
    viewBox="0 0 132 24"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <g>
      {logoPaths[variant].map((path) => (
        <path d={path} fill="currentColor" key={path} />
      ))}
    </g>
    <text
      fill="currentColor"
      fontFamily="Geist, Arial, sans-serif"
      fontSize="17"
      fontWeight="600"
      letterSpacing="-0.45"
      x="31"
      y="18"
    >
      Aletheia
    </text>
  </svg>
);
