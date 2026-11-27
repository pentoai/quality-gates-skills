import { expect, test } from "vitest";
import { greet } from "./greet.js";

test("greet names the person", () => {
	expect(greet("Ada")).toBe("Hello, Ada!");
});
