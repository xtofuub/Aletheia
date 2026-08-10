import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { SearchPage } from "./search-page";

function renderSearch(initialSource = "index:all") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SearchPage initialSource={initialSource} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("SearchPage query composer", () => {
  it("uses a compact input and submits an indexed query with Enter", async () => {
    const user = userEvent.setup();
    renderSearch();

    const query = await screen.findByRole("textbox", { name: "Search query" });
    expect(query.tagName).toBe("INPUT");

    await user.type(query, "zzzz-not-present{Enter}");
    expect(await screen.findByText("No matches")).toBeTruthy();
  });

  it("reserves the multiline batch composer for a saved Live source", async () => {
    window.localStorage.setItem(
      "aletheia.browser.live-sources",
      JSON.stringify([
        {
          id: "source-1",
          name: "Synthetic archive",
          paths: ["C:\\Synthetic\\fixture.zip"],
          includeArchives: true,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ]),
    );
    renderSearch("live:source-1");

    const query = await screen.findByRole("textbox", { name: "Search query" });
    expect(query.tagName).toBe("TEXTAREA");
    expect(screen.getByText("Up to 512 values")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Scan" })).toBeTruthy();
  });
});
