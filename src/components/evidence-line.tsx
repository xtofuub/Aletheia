import { BracesIcon, SmartphoneIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { parseAndroidEvidenceLine } from "@/lib/evidence-line";
import { cn } from "@/lib/utils";

interface EvidenceLineProps {
  className?: string;
  value: string;
}

export function EvidenceLine({ className, value }: EvidenceLineProps) {
  const android = parseAndroidEvidenceLine(value);

  if (!android) {
    return (
      <p
        className={cn(
          "font-mono text-xs leading-5 break-words whitespace-pre-wrap [overflow-wrap:anywhere]",
          className,
        )}
      >
        {value}
      </p>
    );
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant="secondary">
          <SmartphoneIcon data-icon="inline-start" />
          Android app
        </Badge>
        <code className="min-w-0 text-xs break-all">{android.packageName}</code>
      </div>

      <dl className="grid grid-cols-1 gap-px bg-border p-px sm:grid-cols-2">
        <div className="min-w-0 bg-background p-2">
          <dt className="text-[11px] text-muted-foreground">Account</dt>
          <dd className="mt-1 font-mono text-xs break-all">
            {android.account ?? "Not present"}
          </dd>
        </div>
        <div className="min-w-0 bg-background p-2">
          <dt className="text-[11px] text-muted-foreground">Stored value</dt>
          <dd className="mt-1 font-mono text-xs break-all">
            {android.storedValue ?? "Not present"}
          </dd>
        </div>
      </dl>

      <Collapsible>
        <CollapsibleTrigger
          render={<Button className="-ms-2" size="xs" variant="ghost" />}
        >
          <BracesIcon data-icon="inline-start" />
          Technical details
        </CollapsibleTrigger>
        <CollapsibleContent className="collapsible-motion pt-2">
          <dl className="flex min-w-0 flex-col gap-2 bg-muted/40 p-3 text-xs">
            <div className="min-w-0">
              <dt className="text-muted-foreground">App certificate</dt>
              <dd className="mt-1 font-mono break-all">
                {android.appCertificate}
              </dd>
            </div>
            {android.relatedReference ? (
              <div className="min-w-0">
                <dt className="text-muted-foreground">Related reference</dt>
                <dd className="mt-1 font-mono break-all">
                  {android.relatedReference}
                </dd>
              </div>
            ) : null}
            <div className="min-w-0">
              <dt className="text-muted-foreground">Raw source row</dt>
              <dd className="mt-1 font-mono break-all whitespace-pre-wrap">
                {value}
              </dd>
            </div>
          </dl>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
