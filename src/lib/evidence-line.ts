export interface AndroidEvidenceLine {
  account: string | null;
  appCertificate: string;
  packageName: string;
  relatedReference: string | null;
  storedValue: string | null;
}

export function parseAndroidEvidenceLine(
  rawValue: string,
): AndroidEvidenceLine | null {
  const value = rawValue.trim();
  const match = /^android:\/\/(.+?)@([a-z0-9._-]+)\/(.*)$/i.exec(value);
  if (!match) return null;

  const appCertificate = match[1];
  const packageName = match[2];
  const remainder = match[3];
  if (!appCertificate || !packageName || remainder === undefined) return null;

  const referenceSeparator = remainder.indexOf(" | ");
  const rawPayload = (
    referenceSeparator >= 0 ? remainder.slice(0, referenceSeparator) : remainder
  ).trim();
  const relatedReference =
    referenceSeparator >= 0
      ? remainder.slice(referenceSeparator + 3).trim() || null
      : null;
  const payload = rawPayload.startsWith(":") ? rawPayload.slice(1) : rawPayload;
  const valueSeparator = payload.indexOf(":");
  const account = (
    valueSeparator >= 0 ? payload.slice(0, valueSeparator) : payload
  ).trim();
  const storedValue =
    valueSeparator >= 0 ? payload.slice(valueSeparator + 1).trim() : null;

  return {
    account: account || null,
    appCertificate,
    packageName,
    relatedReference,
    storedValue: storedValue || null,
  };
}
