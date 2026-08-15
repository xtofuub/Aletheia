import { CircleCheckIcon, HardDriveIcon } from "lucide-react";

import type { SystemStatus } from "@/lib/desktop";
import { formatBytes } from "@/lib/format";
import { DashboardCard } from "@/components/dashboard-card";
import { Badge } from "@/components/ui/badge";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function BillingHealth({
  system,
}: {
  system: SystemStatus | undefined;
}) {
  return (
    <DashboardCard className="gap-0">
      <CardHeader className="border-b">
        <CardTitle>Workspace health</CardTitle>
        <CardDescription>Native storage and network boundary.</CardDescription>
      </CardHeader>
      <CardContent className="flex h-full items-center px-0">
        <Empty className="rounded-none border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {system?.databaseReady ? <CircleCheckIcon /> : <HardDriveIcon />}
            </EmptyMedia>
            <EmptyTitle>
              {!system
                ? "Checking workspace"
                : system.databaseReady
                  ? "Engine ready"
                  : "Storage unavailable"}
            </EmptyTitle>
            <EmptyDescription>
              {system
                ? `${formatBytes(system.metadataBytes + system.indexBytes)} generated locally.`
                : "Loading local storage totals without blocking the dashboard."}
            </EmptyDescription>
            <Badge variant="outline">
              {!system || system.offline ? "Offline" : "Network available"}
            </Badge>
          </EmptyHeader>
        </Empty>
      </CardContent>
    </DashboardCard>
  );
}
