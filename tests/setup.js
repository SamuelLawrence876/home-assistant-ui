/* Global test setup.

   Two jobs:
     1. jest-dom matchers (toBeInTheDocument, toHaveTextContent, …).
     2. Reset the two pieces of ambient state this app actually reads —
        localStorage and the URL query string — between every test, so a
        hostile-input test cannot leak a poisoned value into the next one.
        That failure mode is the whole of LESSONS.md pattern 3. */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});
