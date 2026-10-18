import { type ReactNode, Children, isValidElement, cloneElement } from "react";
import { m, type Variants } from "framer-motion";
import { useReducedMotion } from "@/hooks/useReducedMotion";

/**
 * EditorialReveal — staggered rise+blur reveal for headlines, hero stacks,
 * card grids. Wraps children with framer-motion variants tuned for the bold
 * editorial direction (spring 260/28, 60ms stagger).
 *
 * Usage:
 *   <EditorialReveal>
 *     <h1>Title</h1>
 *     <p>Subhead</p>
 *     <Button>CTA</Button>
 *   </EditorialReveal>
 */
const container: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.06, delayChildren: 0.05 },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 22, filter: "blur(6px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { type: "spring", stiffness: 260, damping: 28, mass: 0.9 },
  },
};

interface Props {
  children: ReactNode;
  className?: string;
  /** Delay (s) before sequence starts. Default 0. */
  delay?: number;
  /** When true, run on viewport-enter instead of mount. */
  whileInView?: boolean;
  as?: "div" | "section" | "header" | "ul";
}

export function EditorialReveal({ children, className, delay = 0, whileInView = false, as = "div" }: Props) {
  const reduced = useReducedMotion();

  if (reduced) {
    const Tag = as as any;
    return <Tag className={className}>{children}</Tag>;
  }

  const Comp = m[as] as any;
  const items = Children.toArray(children).map((child, i) => {
    if (!isValidElement(child)) {
      return (
        <m.div key={i} variants={item}>
          {child}
        </m.div>
      );
    }
    return (
      <m.div key={i} variants={item} className="contents">
        {child}
      </m.div>
    );
  });

  const containerWithDelay: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 + delay } },
  };

  const motionProps = whileInView
    ? { initial: "hidden", whileInView: "show", viewport: { once: true, margin: "-60px" } }
    : { initial: "hidden", animate: "show" };

  return (
    <Comp
      className={className}
      variants={containerWithDelay}
      {...motionProps}
    >
      {items}
    </Comp>
  );
}
