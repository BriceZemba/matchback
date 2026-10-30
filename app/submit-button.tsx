"use client";

import { useState, type ReactNode } from "react";

/** A submit button that shows a spinner while the form posts (the forms post to route handlers). */
export function SubmitButton({ children, pendingLabel, className = "btn btn-primary", formAction, noValidate = false }: {
  children: ReactNode; pendingLabel: string; className?: string;
  /** Post the form somewhere else than its action (a second button on the same form). */
  formAction?: string;
  noValidate?: boolean;
}) {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="submit"
      className={className}
      aria-busy={pending}
      {...(formAction ? { formAction } : {})}
      formNoValidate={noValidate}
      onClick={(e) => {
        const form = e.currentTarget.form;
        if (form && !noValidate && !form.checkValidity()) return;
        // Let the submit go through first, then show the pending state.
        setTimeout(() => setPending(true), 0);
      }}
    >
      {pending ? (
        <>
          <span className="spinner" aria-hidden="true" /> {pendingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
