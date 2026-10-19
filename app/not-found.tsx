import { T } from "@/frontend/client/language";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="grid gap-3">
      <h1 className="font-heading text-xl font-semibold"><T>Not found</T></h1>
      <p className="text-sm text-muted-foreground"><T>That inventory record does not exist.</T></p>
      <div>
        <Button nativeButton={false} render={<Link href="/" />}>
          Back to dashboard
        </Button>
      </div>
    </div>
  );
}
