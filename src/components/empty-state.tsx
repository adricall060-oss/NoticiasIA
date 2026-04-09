import { Card } from "@/components/ui/card";

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <Card className="p-8 text-center">
      <div className="text-lg font-semibold">{title}</div>
      {description ? <div className="mt-2 text-sm text-muted-foreground">{description}</div> : null}
    </Card>
  );
}