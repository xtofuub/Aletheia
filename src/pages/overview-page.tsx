import { RefreshCwIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { Dashboard } from "@/components/dashboard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

export function OverviewPage() {
  const queryClient = useQueryClient();
  return (
    <div>
      <PageHeader
        actions={
          <Button
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: ["overview"] })
            }
            size="sm"
            variant="outline"
          >
            <RefreshCwIcon data-icon="inline-start" />
            Refresh
          </Button>
        }
        description="Local indexes, Live scans, grouped evidence, and workspace health."
        title="Overview"
      />
      <Dashboard />
    </div>
  );
}
