import { ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";
import { useEffect, useRef } from "react";

export const TOUR_STORAGE_KEY = "gql-window-playground.tourSeen";

export interface TourStep {
  title: string;
  body: string;
  syntax?: string;
  targetClass: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    title: "Why this exists",
    body:
      "The paper asks what a window function means over a property graph. This playground makes that concrete by turning paper-style syntax into executable backend plans.",
    targetClass: "tour-step-topbar"
  },
  {
    title: "Queries are fixtures",
    body:
      "Each dropdown entry pairs a query with a preloaded demo database. The database is fixed; the interesting part is how the window syntax changes the bindings and rewrite.",
    targetClass: "tour-step-topbar"
  },
  {
    title: "Rows, not groups",
    body:
      "A MATCH produces a binding table. A row window preserves those rows and appends values from rank(), row_number(), or sum(...) using partitioning, ordering, and optional frames.",
    syntax: "rank() OVER (PARTITION BY a ORDER BY t.amount DESC)",
    targetClass: "tour-step-editor"
  },
  {
    title: "Graph values are values",
    body:
      "Partition keys can be nodes, edges, paths, or scalar properties. A bound path is still one atomic binding value unless the query explicitly unfolds it.",
    targetClass: "tour-step-meta"
  },
  {
    title: "Path-element windows",
    body:
      "OVER PATH switches the domain from rows containing a path to ordered node or edge occurrences inside that path, so frames can move along the path itself.",
    syntax: "sum(e.amount) OVER PATH p EDGES AS e (...)",
    targetClass: "tour-step-editor"
  },
  {
    title: "Rewrite, then execute",
    body:
      "The APOC backend shows the procedure call used today. Neo4j + SQLite runs a reference row-window translation where the selected syntax is supported.",
    targetClass: "tour-step-rewrite"
  },
  {
    title: "Inspect the effect",
    body:
      "Run keeps the source rows visible, adds the computed window column, and reports timing so you can compare the windowed query with the source query.",
    targetClass: "tour-step-results"
  }
];

interface GuidedTourProps {
  open: boolean;
  stepIndex: number;
  onStepChange: (stepIndex: number) => void;
  onDismiss: () => void;
}

export function GuidedTour({ open, stepIndex, onStepChange, onDismiss }: GuidedTourProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const safeStepIndex = Math.min(Math.max(stepIndex, 0), TOUR_STEPS.length - 1);
  const step = TOUR_STEPS[safeStepIndex];
  const isFirstStep = safeStepIndex === 0;
  const isLastStep = safeStepIndex === TOUR_STEPS.length - 1;

  useEffect(() => {
    if (!open) {
      return;
    }

    dialogRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss, open]);

  if (!open) {
    return null;
  }

  return (
    <>
      <div className="tour-backdrop" aria-hidden="true" />
      <section
        ref={dialogRef}
        className="tour-popover"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
      >
        <div className="tour-header">
          <div>
            <span className="tour-kicker">
              <Sparkles aria-hidden="true" size={14} />
              Guided tour
            </span>
            <h2 id="tour-title">{step.title}</h2>
          </div>
          <button className="tour-close" type="button" onClick={onDismiss} aria-label="Close guided tour">
            <X aria-hidden="true" size={17} />
          </button>
        </div>

        <p id="tour-body">{step.body}</p>
        {step.syntax ? <code className="tour-syntax">{step.syntax}</code> : null}

        <div className="tour-progress" aria-label={`Tour step ${safeStepIndex + 1} of ${TOUR_STEPS.length}`}>
          <span>
            {safeStepIndex + 1} / {TOUR_STEPS.length}
          </span>
          <div className="tour-progress-track" aria-hidden="true">
            <div
              className="tour-progress-fill"
              style={{ width: `${((safeStepIndex + 1) / TOUR_STEPS.length) * 100}%` }}
            />
          </div>
        </div>

        <div className="tour-actions">
          <button className="icon-button subtle" type="button" onClick={onDismiss}>
            <X aria-hidden="true" size={15} />
            <span>Skip</span>
          </button>
          <div className="tour-step-actions">
            <button
              className="icon-button subtle"
              type="button"
              onClick={() => onStepChange(safeStepIndex - 1)}
              disabled={isFirstStep}
            >
              <ChevronLeft aria-hidden="true" size={15} />
              <span>Back</span>
            </button>
            <button
              className="run-button"
              type="button"
              onClick={() => {
                if (isLastStep) {
                  onDismiss();
                  return;
                }
                onStepChange(safeStepIndex + 1);
              }}
            >
              <span>{isLastStep ? "Done" : "Next"}</span>
              {!isLastStep ? <ChevronRight aria-hidden="true" size={15} /> : null}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

export function shouldOpenGuidedTour() {
  try {
    return window.localStorage.getItem(TOUR_STORAGE_KEY) !== "1";
  } catch {
    return true;
  }
}

export function rememberGuidedTourSeen() {
  try {
    window.localStorage.setItem(TOUR_STORAGE_KEY, "1");
  } catch {
    // The tour can still run if browser storage is unavailable.
  }
}
