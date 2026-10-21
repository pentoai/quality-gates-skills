import { configDefaults, defineConfig } from "vitest/config";

/**
 * Coverage is gated where unit tests are the proof: the logic layers. Files whose only job is
 * to drive an external service are integration surfaces and are listed out here. The visual
 * and routing layers are pinned by the build and by e2e tests, so they are not counted.
 */
const EXTERNAL_SERVICE_DRIVERS: string[] = [];

export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		environment: "node",
		passWithNoTests: true,
		exclude: [
			...configDefaults.exclude,
			".agents/**",
			".claude/**",
			".next/**",
		],
		coverage: {
			provider: "v8",
			reporter: ["text-summary"],
			include: ["src/lib/**/*.ts"],
			exclude: ["**/*.test.ts", "**/*.d.ts", ...EXTERNAL_SERVICE_DRIVERS],
			thresholds: {
				"src/lib/**": { lines: 85, functions: 85 },
			},
		},
	},
});
