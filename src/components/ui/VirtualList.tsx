import { List, type RowComponentProps } from "react-window";
import type { ReactNode } from "react";

/**
 * VirtualList — fixed-height row virtualizer. Use whenever a list could exceed
 * ~20 items (rule from system prompt: "Virtualize lists 20+ items").
 *
 *   <VirtualList items={projects} rowHeight={72} height={500}>
 *     {(p, i) => <ProjectRow key={p.id} project={p} />}
 *   </VirtualList>
 *
 * For variable-height rows use react-window's <List> directly.
 */
interface Props<T> {
  items: T[];
  rowHeight: number;
  height: number;
  children: (item: T, index: number) => ReactNode;
  className?: string;
  overscan?: number;
}

export function VirtualList<T>({
  items,
  rowHeight,
  height,
  children,
  className,
  overscan = 4,
}: Props<T>) {
  const Row = ({ index, style }: RowComponentProps) => (
    <div style={style}>{children(items[index], index)}</div>
  );

  return (
    <List
      className={className}
      style={{ height }}
      rowComponent={Row}
      rowCount={items.length}
      rowHeight={rowHeight}
      overscanCount={overscan}
      rowProps={{}}
    />
  );
}
