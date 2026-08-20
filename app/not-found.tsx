import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="grid gap-3">
      <h1 className="font-heading text-xl font-semibold">Not found</h1>
      <p className="text-sm text-muted-foreground">
        That inventory record does not exist.
      </p>
      <div>
        <Button nativeButton={false} render={<Link href="/" />}>
          Back to dashboard
        </Button>
      </div>
    </div>
  );
}
