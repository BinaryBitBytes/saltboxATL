import { T } from "@/frontend/client/language";
import type { WarehouseNode } from "@/lib/sites/database";

export function WarehouseTree({
  nodes,
  heading = true,
}: {
  nodes: WarehouseNode[];
  heading?: boolean;
}) {
  if (nodes.length === 0) return null;
  return (
    <div className="grid gap-2">
      {heading ? (
        <h2 className="text-sm font-medium">
          <T>Warehouse hierarchy</T>
        </h2>
      ) : null}
      <p className="text-xs text-muted-foreground">
        <T>Site, then building, zone, aisle, bay, and location.</T>
      </p>
      <ul className="grid gap-2 text-sm">
        {nodes.map((node) => (
          <TreeNode key={node.id} node={node} />
        ))}
      </ul>
    </div>
  );
}

function TreeNode({ node }: { node: WarehouseNode }) {
  return (
    <li>
      <span className="font-mono text-xs">{node.label}</span>
      {node.children.length > 0 ? (
        <ul className="ms-4 grid gap-1 border-s border-border ps-3">
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
