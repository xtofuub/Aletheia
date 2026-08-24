import { describe, expect, it } from "vitest";

import { parseAndroidEvidenceLine } from "@/lib/evidence-line";

describe("parseAndroidEvidenceLine", () => {
  it("separates an Android app row into readable fields", () => {
    expect(
      parseAndroidEvidenceLine(
        "android://QUJDREVGR0g=@com.example.mobile/:sample-user:sample-value-42 | //qujdrevgr0g=@com.example.mobile",
      ),
    ).toEqual({
      account: "sample-user",
      appCertificate: "QUJDREVGR0g=",
      packageName: "com.example.mobile",
      relatedReference: "//qujdrevgr0g=@com.example.mobile",
      storedValue: "sample-value-42",
    });
  });

  it("preserves additional separators in the stored value", () => {
    expect(
      parseAndroidEvidenceLine(
        "android://U1lOVEhFVElD@org.example.app/:account:value:with:separators",
      )?.storedValue,
    ).toBe("value:with:separators");
  });

  it("keeps rows without a stored value readable", () => {
    expect(
      parseAndroidEvidenceLine(
        "android://U1lOVEhFVElD@org.example.app/:account-only",
      ),
    ).toMatchObject({ account: "account-only", storedValue: null });
  });

  it("leaves ordinary source rows unchanged", () => {
    expect(
      parseAndroidEvidenceLine(
        "https://example.invalid/login:sample-user:sample-value",
      ),
    ).toBeNull();
  });
});
