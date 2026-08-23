import { barX, defineChart } from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DbcMessage } from "@/api/dbc";

type SignalBitRange = {
  name: string;
  x1: number;
  x2: number;
};

export function DbcSignalLayoutChart({ message }: { message: DbcMessage }) {
  const rows: SignalBitRange[] = message.signals.map((signal) => ({
    name: signal.name,
    x1: signal.start_bit,
    x2: signal.start_bit + signal.size,
  }));

  const bitCount = message.size * 8;

  const definition = defineChart({
    marks: [
      barX(rows, {
        x1: "x1",
        x2: "x2",
        y: "name",
        key: "name",
        fill: "#2563eb",
      }),
    ],
    x: {
      scale: scaleLinear().domain([0, bitCount]),
      grid: true,
      axis: { label: "Bit position" },
    },
    y: {
      scale: () => scaleBand<string>().padding(0.3),
    },
    tooltip,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Signal bit layout — {message.name}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length > 0 ? (
          <Chart
            definition={definition}
            height={Math.max(120, rows.length * 32)}
            ariaLabel={`Signal bit layout for ${message.name}`}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            This message has no signals to lay out.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
