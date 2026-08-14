import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type HistoryRangeDays = 7 | 30 | 90;

const ranges: Array<{ label: string; value: HistoryRangeDays }> = [
  { label: "7D", value: 7 },
  { label: "30D", value: 30 },
  { label: "90D", value: 90 },
];

export function HistoryRangeToggle({
  onChange,
  value,
}: {
  onChange: (value: HistoryRangeDays) => void;
  value: HistoryRangeDays;
}) {
  return (
    <ToggleGroup
      aria-label="History range"
      onValueChange={(values) => {
        const next = Number(values[0]);
        if (next === 7 || next === 30 || next === 90) onChange(next);
      }}
      size="sm"
      spacing={0}
      value={[String(value)]}
      variant="outline"
    >
      {ranges.map((range) => (
        <ToggleGroupItem
          aria-label={`Show ${range.value} days`}
          key={range.value}
          value={String(range.value)}
        >
          {range.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
