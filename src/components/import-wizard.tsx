import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  FileSearch,
  Files,
  FolderOpen,
  LoaderCircle,
  LockKeyhole,
  SlidersHorizontal,
  TableProperties,
  X,
} from "lucide-react";

import {
  inspectSources,
  selectSourceFiles,
  selectSourceFolder,
  type FieldType,
  type FileInspection,
  type ImportOptions,
  type ImportPlan,
} from "../lib/desktop";
import { formatBytes } from "../lib/utils";
import { Button } from "./ui/button";
import { Field, Input } from "./ui/field";

type WizardStage = "select" | "review" | "mapping" | "configure";

const stages: Array<{ id: WizardStage; label: string }> = [
  { id: "select", label: "Select source" },
  { id: "review", label: "Review files" },
  { id: "mapping", label: "Map fields" },
  { id: "configure", label: "Configure" },
];

const fieldTypes: Array<{ value: FieldType; label: string }> = [
  { value: "email", label: "Email" },
  { value: "username", label: "Username" },
  { value: "full_name", label: "Full name" },
  { value: "phone", label: "Phone" },
  { value: "ip_address", label: "IP address" },
  { value: "domain", label: "Domain" },
  { value: "url", label: "URL" },
  { value: "password", label: "Password" },
  { value: "password_hash", label: "Password hash" },
  { value: "user_id", label: "User ID" },
  { value: "timestamp", label: "Timestamp" },
  { value: "unknown", label: "Unknown text" },
];

const defaultOptions: ImportOptions = {
  skipInvalidRows: true,
  stopOnSevereError: true,
  extractUrls: true,
  extractDomains: true,
  groupIdentities: true,
  deduplicate: true,
  storeOffsets: true,
};

interface ImportWizardProps {
  onClose: () => void;
  onStart: (plan: ImportPlan) => Promise<void>;
}

export function ImportWizard({ onClose, onStart }: ImportWizardProps) {
  const [stage, setStage] = useState<WizardStage>("select");
  const [files, setFiles] = useState<FileInspection[]>([]);
  const [selectedFile, setSelectedFile] = useState(0);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [datasetLabel, setDatasetLabel] = useState("");
  const [authorizationNote, setAuthorizationNote] = useState("");
  const [options, setOptions] = useState(defaultOptions);

  const currentFile = files[selectedFile];
  const stageIndex = stages.findIndex((item) => item.id === stage);
  const totalBytes = useMemo(
    () => files.reduce((sum, file) => sum + file.fileSize, 0),
    [files],
  );

  async function chooseSource(kind: "files" | "folder") {
    setError("");
    const paths =
      kind === "files" ? await selectSourceFiles() : await selectSourceFolder();
    if (!paths.length) return;
    setLoading(true);
    try {
      const result = await inspectSources(paths);
      if (!result.files.length) {
        setError("No supported dataset files were found.");
        return;
      }
      setFiles(result.files);
      setDatasetLabel(
        result.files.length === 1
          ? (result.files[0]?.fileName.replace(/\.[^.]+$/, "") ??
              "Local dataset")
          : "Local dataset collection",
      );
      setStage("review");
    } catch {
      setError(
        "Aletheia could not inspect the selected source. The source was not changed.",
      );
    } finally {
      setLoading(false);
    }
  }

  function updateMapping(index: number, fieldType: FieldType) {
    setFiles((current) =>
      current.map((file, fileIndex) => {
        if (fileIndex !== selectedFile) return file;
        return {
          ...file,
          mappings: file.mappings.map((mapping, mappingIndex) =>
            mappingIndex === index
              ? {
                  ...mapping,
                  fieldType,
                  confidence: 1,
                  isSensitive: [
                    "password",
                    "password_hash",
                    "salt",
                    "phone",
                    "address",
                    "date_of_birth",
                  ].includes(fieldType),
                }
              : mapping,
          ),
        };
      }),
    );
  }

  async function beginImport() {
    if (!datasetLabel.trim()) {
      setError("Add a dataset label.");
      return;
    }
    if (!authorizationNote.trim()) {
      setError("Add a short authorization note.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onStart({
        datasetLabel: datasetLabel.trim(),
        authorizationNote: authorizationNote.trim(),
        files,
        options,
      });
    } catch {
      setError("The local import could not start. No source file was changed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="import-wizard" aria-labelledby="import-title">
      <header className="import-wizard__header">
        <div>
          <p className="font-mono text-[10px] text-text-tertiary">
            LOCAL IMPORT
          </p>
          <h1 id="import-title">Add an authorized dataset</h1>
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Close import"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </Button>
      </header>

      <nav className="import-steps" aria-label="Import progress">
        {stages.map((item, index) => (
          <div
            key={item.id}
            data-active={item.id === stage}
            data-complete={index < stageIndex}
          >
            <span>{index < stageIndex ? <Check size={12} /> : index + 1}</span>
            {item.label}
          </div>
        ))}
      </nav>

      <div className="import-wizard__body">
        {stage === "select" ? (
          <div className="source-choice">
            <div className="source-choice__intro">
              <LockKeyhole size={21} strokeWidth={1.5} aria-hidden="true" />
              <div>
                <h2>Select local sources</h2>
                <p>
                  Aletheia reads a bounded sample to detect structure. It does
                  not modify, move, or upload the source.
                </p>
              </div>
            </div>
            <div className="source-choice__grid">
              <button
                onClick={() => void chooseSource("files")}
                disabled={loading}
              >
                <Files size={21} strokeWidth={1.5} aria-hidden="true" />
                <strong>Choose files</strong>
                <span>TXT, CSV, TSV, JSONL, NDJSON, GZIP</span>
              </button>
              <button
                onClick={() => void chooseSource("folder")}
                disabled={loading}
              >
                <FolderOpen size={21} strokeWidth={1.5} aria-hidden="true" />
                <strong>Choose folder</strong>
                <span>Discover supported files recursively</span>
              </button>
            </div>
            {loading ? (
              <p className="import-inline-state">
                <LoaderCircle className="animate-spin" size={15} />
                Inspecting a bounded sample
              </p>
            ) : null}
          </div>
        ) : null}

        {stage === "review" && currentFile ? (
          <div className="review-layout">
            <aside className="file-list" aria-label="Discovered files">
              <div className="file-list__summary">
                <strong>{files.length} eligible</strong>
                <span>{formatBytes(totalBytes)}</span>
              </div>
              {files.map((file, index) => (
                <button
                  key={file.absolutePath}
                  data-active={selectedFile === index}
                  onClick={() => setSelectedFile(index)}
                >
                  <FileSearch size={15} aria-hidden="true" />
                  <span>
                    <strong>{file.fileName}</strong>
                    <small>
                      {file.format.toUpperCase()} · {formatBytes(file.fileSize)}
                    </small>
                  </span>
                </button>
              ))}
            </aside>
            <div className="file-inspection">
              <div className="inspection-facts">
                <div>
                  <span>Encoding</span>
                  <strong>{currentFile.encoding}</strong>
                </div>
                <div>
                  <span>Delimiter</span>
                  <strong>{currentFile.delimiter ?? "none"}</strong>
                </div>
                <div>
                  <span>Columns</span>
                  <strong>{currentFile.columnCount}</strong>
                </div>
                <div>
                  <span>Estimated rows</span>
                  <strong>
                    {currentFile.estimatedRecords?.toLocaleString() ??
                      "unknown"}
                  </strong>
                </div>
              </div>
              {currentFile.warnings.map((warning) => (
                <div className="import-warning" key={warning}>
                  <AlertTriangle size={15} aria-hidden="true" />
                  {warning}
                </div>
              ))}
              <MaskedPreview file={currentFile} />
            </div>
          </div>
        ) : null}

        {stage === "mapping" && currentFile ? (
          <div className="mapping-layout">
            <div className="mapping-heading">
              <TableProperties size={19} strokeWidth={1.5} aria-hidden="true" />
              <div>
                <h2>Confirm the field mapping</h2>
                <p>
                  Unknown fields remain searchable only as explicitly mapped
                  safe text. Secret fields stay outside general full-text
                  search.
                </p>
              </div>
            </div>
            <div className="mapping-table">
              <div className="mapping-table__head">
                <span>Source column</span>
                <span>Detected type</span>
                <span>Confidence</span>
              </div>
              {currentFile.mappings.map((mapping, index) => (
                <div className="mapping-row" key={mapping.sourceName}>
                  <code>{mapping.sourceName}</code>
                  <select
                    aria-label={`Map ${mapping.sourceName}`}
                    value={mapping.fieldType}
                    onChange={(event) =>
                      updateMapping(index, event.target.value as FieldType)
                    }
                  >
                    {fieldTypes.map((type) => (
                      <option value={type.value} key={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                  <span>
                    {Math.round(mapping.confidence * 100)}%
                    {mapping.isSensitive ? " · masked" : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {stage === "configure" ? (
          <div className="configure-layout">
            <div className="configure-form">
              <Field label="Dataset label" htmlFor="dataset-label">
                <Input
                  id="dataset-label"
                  value={datasetLabel}
                  onChange={(event) => setDatasetLabel(event.target.value)}
                />
              </Field>
              <Field
                label="Authorization note"
                htmlFor="authorization-note"
                helper="Describe why you are authorized to analyze this local source."
              >
                <Input
                  id="authorization-note"
                  value={authorizationNote}
                  onChange={(event) => setAuthorizationNote(event.target.value)}
                  placeholder="Example: internal incident response case"
                />
              </Field>
            </div>
            <div className="import-options">
              <div className="mapping-heading">
                <SlidersHorizontal
                  size={19}
                  strokeWidth={1.5}
                  aria-hidden="true"
                />
                <div>
                  <h2>Import protections</h2>
                  <p>Safe defaults can be changed before indexing.</p>
                </div>
              </div>
              {(
                [
                  ["skipInvalidRows", "Skip invalid rows"],
                  ["stopOnSevereError", "Stop on severe parser errors"],
                  ["extractUrls", "Extract normalized URLs"],
                  ["extractDomains", "Group registrable domains"],
                  ["groupIdentities", "Build deterministic identities"],
                  ["deduplicate", "Deduplicate exact records"],
                  ["storeOffsets", "Store source offsets"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={options[key]}
                    onChange={(event) =>
                      setOptions((current) => ({
                        ...current,
                        [key]: event.target.checked,
                      }))
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="import-error">
            {error}
          </p>
        ) : null}
      </div>

      <footer className="import-wizard__footer">
        <Button
          variant="ghost"
          disabled={stageIndex === 0 || submitting}
          onClick={() => setStage(stages[stageIndex - 1]?.id ?? "select")}
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Back
        </Button>
        {stage === "configure" ? (
          <Button
            variant="primary"
            disabled={submitting}
            onClick={() => void beginImport()}
          >
            {submitting ? (
              <LoaderCircle className="animate-spin" size={15} />
            ) : (
              <Check size={15} />
            )}
            Begin indexing
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={stage === "select"}
            onClick={() => setStage(stages[stageIndex + 1]?.id ?? "configure")}
          >
            Continue
            <ArrowRight size={15} aria-hidden="true" />
          </Button>
        )}
      </footer>
    </section>
  );
}

function MaskedPreview({ file }: { file: FileInspection }) {
  return (
    <div className="masked-preview">
      <div className="masked-preview__header">
        <span>Masked preview</span>
        <small>Sensitive and unknown values hidden</small>
      </div>
      <div className="masked-preview__scroll">
        <table>
          <thead>
            <tr>
              <th>Row</th>
              {file.mappings.map((mapping) => (
                <th key={mapping.sourceName}>{mapping.sourceName}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {file.preview.slice(0, 6).map((row) => (
              <tr key={row.sourceLocation}>
                <td>{row.sourceLocation}</td>
                {row.values.map((value, index) => (
                  <td key={`${row.sourceLocation}-${index}`}>
                    <code>{value || "empty"}</code>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
