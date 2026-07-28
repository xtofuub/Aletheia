import { render, screen } from "@testing-library/react";
import { Search } from "lucide-react";

import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("renders a useful title and explanation", () => {
    render(
      <EmptyState
        icon={Search}
        title="No local results"
        description="Import a synthetic dataset first."
      />,
    );

    expect(
      screen.getByRole("heading", { name: "No local results" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Import a synthetic dataset first."),
    ).toBeInTheDocument();
  });
});
