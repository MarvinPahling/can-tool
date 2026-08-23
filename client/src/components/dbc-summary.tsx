import type { DbcFile } from "@/api/dbc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function DbcSummary({ dbc }: { dbc: DbcFile }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>DBC version "{dbc.version}"</CardTitle>
			</CardHeader>
			<CardContent className="text-muted-foreground">
				{dbc.nodes.length} node(s) and {dbc.messages.length} message(s).
			</CardContent>
		</Card>
	);
}
