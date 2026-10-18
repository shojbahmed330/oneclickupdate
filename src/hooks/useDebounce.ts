import { useEffect, useState } from "react";

/**
 * useDebounce — returns `value` only after it stops changing for `delay` ms.
 *
 *   const [q, setQ] = useState("");
 *   const debounced = useDebounce(q, 300);
 *   useEffect(() => { search(debounced); }, [debounced]);
 *
 * Default 300ms (matches design rule for search inputs).
 */
export function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
