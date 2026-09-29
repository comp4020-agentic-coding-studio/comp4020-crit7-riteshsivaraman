// The routes the invariants run against. When you add a page, add its route
// here, or the invariants stop covering it. `/graph/` is a 301 to
// `/?view=graph` now (asserted in spec/graph-model.test.ts).
export const ROUTES = ["/", "/readme/", "/?view=graph"];
