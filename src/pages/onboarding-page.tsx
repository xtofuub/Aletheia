import { useState } from "react";
import { FolderOpenIcon, LockKeyholeIcon } from "lucide-react";

import { DashboardCard } from "@/components/dashboard-card";
import { LogoIcon } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { saveOnboarding, selectStorageFolder } from "@/lib/desktop";

export function OnboardingPage({
  initialStorageRoot,
  onComplete,
}: {
  initialStorageRoot: string;
  onComplete: () => void;
}) {
  const [authorized, setAuthorized] = useState(false);
  const [storageRoot, setStorageRoot] = useState(initialStorageRoot);
  const [saving, setSaving] = useState(false);

  return (
    <main className="grid min-h-screen place-items-center bg-muted/30 p-4">
      <div className="w-full max-w-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <LogoIcon className="size-6" />
            <span className="font-medium">Aletheia</span>
          </div>
          <Badge variant="outline">
            <LockKeyholeIcon />
            Local only
          </Badge>
        </div>
        <div className="grid gap-px bg-border p-px md:grid-cols-2">
          <DashboardCard>
            <CardHeader>
              <CardTitle>Authorized evidence only</CardTitle>
              <CardDescription>
                Aletheia is designed for defensive analysis of data you are
                permitted to process.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field orientation="horizontal">
                  <Checkbox
                    checked={authorized}
                    id="authorization"
                    onCheckedChange={setAuthorized}
                  />
                  <FieldLabel htmlFor="authorization">
                    I confirm I am authorized to analyze the datasets I add.
                  </FieldLabel>
                </Field>
              </FieldGroup>
            </CardContent>
          </DashboardCard>
          <DashboardCard>
            <CardHeader>
              <CardTitle>Generated storage</CardTitle>
              <CardDescription>
                Choose where SQLite metadata and Tantivy indexes are stored.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="storage-root">Storage root</FieldLabel>
                  <InputGroup>
                    <InputGroupInput
                      id="storage-root"
                      onChange={(event) => setStorageRoot(event.target.value)}
                      value={storageRoot}
                    />
                    <InputGroupAddon align="inline-end">
                      <Button
                        aria-label="Choose storage folder"
                        onClick={() =>
                          void selectStorageFolder(storageRoot).then(
                            setStorageRoot,
                          )
                        }
                        size="icon-xs"
                        type="button"
                        variant="ghost"
                      >
                        <FolderOpenIcon />
                      </Button>
                    </InputGroupAddon>
                  </InputGroup>
                  <FieldDescription>
                    Source files remain in their original locations.
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </CardContent>
          </DashboardCard>
          <DashboardCard className="md:col-span-2">
            <CardFooter className="justify-between gap-3 border-0 bg-background">
              <p className="text-xs text-muted-foreground">
                No dataset content is uploaded.
              </p>
              <Button
                disabled={!authorized || !storageRoot.trim() || saving}
                onClick={() => {
                  setSaving(true);
                  void saveOnboarding({
                    authorizationConfirmed: true,
                    storageRoot: storageRoot.trim(),
                  })
                    .then(onComplete)
                    .finally(() => setSaving(false));
                }}
              >
                Continue
              </Button>
            </CardFooter>
          </DashboardCard>
        </div>
      </div>
    </main>
  );
}
