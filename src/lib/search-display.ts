const protectedPlaceholder = /\[redacted\]/gi;

export function formatSearchDisplay(value: string) {
  return value.replace(protectedPlaceholder, "••••••");
}
