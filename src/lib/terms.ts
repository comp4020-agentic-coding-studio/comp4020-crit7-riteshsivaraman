// The fixed term list the plan builder places courses into. Shared between
// the page (rendering columns) and the API routes (validating termIndex) so
// there's one place that defines "how many terms" and "what to call them".
export const TERMS = ["Y1S1", "Y1S2", "Y2S1", "Y2S2", "Y3S1", "Y3S2"] as const;
