import { useState } from "react";
import { HardDrive, LockKeyhole, ShieldCheck } from "lucide-react";

import {
  saveOnboarding,
  selectStorageFolder,
  type Settings,
} from "../lib/desktop";
import { Button } from "./ui/button";
import { Field, Input } from "./ui/field";

interface OnboardingProps {
  initialStorageRoot: string;
  onComplete: (settings: Settings) => void;
}

export function Onboarding({
  initialStorageRoot,
  onComplete,
}: OnboardingProps) {
  const [storageRoot, setStorageRoot] = useState(initialStorageRoot);
  const [authorized, setAuthorized] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function chooseStorage() {
    const selected = await selectStorageFolder(storageRoot);
    setStorageRoot(selected);
  }

  async function continueToWorkspace() {
    setError("");
    if (!authorized) {
      setError("Confirm authorization before continuing.");
      return;
    }
    if (!storageRoot.trim()) {
      setError("Choose a local folder for generated indexes.");
      return;
    }

    setSubmitting(true);
    try {
      const settings = await saveOnboarding({
        authorizationConfirmed: authorized,
        storageRoot,
      });
      onComplete(settings);
    } catch {
      setError(
        "Aletheia could not prepare that folder. Choose a writable local folder.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="onboarding-shell">
      <section className="onboarding-intro" aria-labelledby="onboarding-title">
        <div>
          <div className="brand-lockup">
            <div className="brand-mark brand-mark--large" aria-hidden="true">
              A
            </div>
            <span>Aletheia</span>
          </div>
          <p className="mt-16 font-mono text-xs text-signal">
            LOCAL TRUST BOUNDARY
          </p>
          <h1
            id="onboarding-title"
            className="mt-4 max-w-xl text-4xl leading-[1.08] font-semibold tracking-[-0.035em] text-text-primary"
          >
            Investigate local data without surrendering it.
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-text-secondary">
            Aletheia creates a search index on this computer. Source files stay
            unchanged and dataset contents are not transmitted.
          </p>
        </div>

        <div className="trust-list">
          <div>
            <LockKeyhole aria-hidden="true" />
            <span>Core workflows require no network connection</span>
          </div>
          <div>
            <HardDrive aria-hidden="true" />
            <span>Imports open source files with read-only access</span>
          </div>
          <div>
            <ShieldCheck aria-hidden="true" />
            <span>Sensitive values are masked by default</span>
          </div>
        </div>
      </section>

      <section className="onboarding-setup" aria-label="Initial setup">
        <div className="w-full max-w-lg">
          <p className="font-mono text-[11px] text-text-tertiary">
            FIRST-RUN SETUP
          </p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-text-primary">
            Set the local workspace
          </h2>
          <p className="mt-2 text-sm leading-6 text-text-secondary">
            Generated metadata and search indexes live here. Removing an index
            never deletes the original dataset.
          </p>

          <div className="mt-8 grid gap-6">
            <Field
              label="Index storage folder"
              htmlFor="storage-root"
              helper="Use a local drive with enough free space for indexes."
            >
              <div className="flex gap-2">
                <Input
                  id="storage-root"
                  value={storageRoot}
                  onChange={(event) => setStorageRoot(event.target.value)}
                  spellCheck={false}
                  className="font-mono text-xs"
                />
                <Button onClick={() => void chooseStorage()}>Browse</Button>
              </div>
            </Field>

            <label className="authorization-check">
              <input
                type="checkbox"
                checked={authorized}
                onChange={(event) => setAuthorized(event.target.checked)}
              />
              <span>
                <strong>
                  I am authorized to possess and analyze my selected data.
                </strong>
                <small>
                  Aletheia is for defensive research, incident response, and
                  authorized exposure analysis. It does not test credentials or
                  automate logins.
                </small>
              </span>
            </label>

            {error ? (
              <p role="alert" className="text-sm text-danger-strong">
                {error}
              </p>
            ) : null}

            <Button
              variant="primary"
              className="w-full"
              disabled={submitting}
              onClick={() => void continueToWorkspace()}
            >
              {submitting ? "Preparing local workspace" : "Enter Aletheia"}
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}
