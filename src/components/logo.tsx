import type React from "react";

/**
 * Aletheia's "open aperture" mark: four pieces part around a revealed core.
 * The simple, currentColor geometry stays crisp in the 16 px collapsed sidebar.
 */
export const LogoIcon = (props: React.ComponentProps<"svg">) => (
  <svg
    aria-hidden="true"
    fill="none"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <path d="M3 3h8v3H6v5H3V3Z" fill="currentColor" />
    <path d="M13 3h8v8h-3V6h-5V3Z" fill="currentColor" />
    <path d="M3 13h3v5h5v3H3v-8Z" fill="currentColor" />
    <path d="M18 13h3v8h-8v-3h5v-5Z" fill="currentColor" />
    <path
      d="m12 8.25 3.75 3.75L12 15.75 8.25 12 12 8.25Z"
      fill="currentColor"
      opacity="0.42"
    />
  </svg>
);

export const Logo = (props: React.ComponentProps<"svg">) => (
  <svg
    aria-label="Aletheia"
    fill="none"
    role="img"
    viewBox="0 0 132 24"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <g>
      <path d="M3 3h8v3H6v5H3V3Z" fill="currentColor" />
      <path d="M13 3h8v8h-3V6h-5V3Z" fill="currentColor" />
      <path d="M3 13h3v5h5v3H3v-8Z" fill="currentColor" />
      <path d="M18 13h3v8h-8v-3h5v-5Z" fill="currentColor" />
      <path
        d="m12 8.25 3.75 3.75L12 15.75 8.25 12 12 8.25Z"
        fill="currentColor"
        opacity="0.42"
      />
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
