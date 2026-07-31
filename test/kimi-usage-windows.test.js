import assert from "node:assert/strict";
import test from "node:test";

import statusLineStyle from "../src/status-line-style.js";

const hiddenSegment = () => ({ content: "", visible: false });

test("normalizes Kimi 5h and 7d usage windows", async () => {
	const handlers = new Map();
	const segments = {
		path: { render: hiddenSegment },
		git: { render: hiddenSegment },
		mode: { render: hiddenSegment },
		context_pct: { render: hiddenSegment },
		usage: { render: hiddenSegment },
	};
	const pi = {
		on(event, handler) {
			const eventHandlers = handlers.get(event) ?? [];
			eventHandlers.push(handler);
			handlers.set(event, eventHandlers);
		},
		pi: {
			SEGMENTS: segments,
			getCurrentThemeName: () => "titanium-dracula",
			theme: {
				fg: (_color, value) => value,
				icon: { agents: true },
				sep: { pipe: "│" },
			},
		},
	};

	statusLineStyle(pi);

	const now = Date.now();
	const reports = [
		{
			provider: "kimi-code",
			limits: [
				{
					label: "Total quota",
					scope: { shared: true, windowId: "default" },
					window: {
						id: "default",
						resetsAt: now + (6 * 24 * 60 + 21 * 60 + 22) * 60 * 1000,
					},
					amount: { usedFraction: 0.01 },
				},
				{
					label: "5h limit",
					scope: { shared: true, windowId: "300time_unit_minute" },
					window: {
						id: "300time_unit_minute",
						durationMs: 5 * 60 * 60 * 1000,
						resetsAt: now + 3 * 60 * 60 * 1000,
					},
					amount: { usedFraction: 0.04 },
				},
			],
		},
	];
	const scheduled = [];
	const context = {
		models: { current: () => ({ provider: "kimi-code" }) },
		model: { provider: "kimi-code" },
		modelRegistry: {
			authStorage: {
				fetchUsageReports: async () => reports,
			},
		},
		setTimeout(callback) {
			scheduled.push(Promise.resolve().then(callback));
		},
		setInterval() {},
		hasUI: false,
	};

	const sessionStart = handlers.get("session_start")?.[0];
	assert.ok(sessionStart);
	sessionStart({}, context);
	await Promise.all(scheduled);

	const rendered = segments.usage.render({
		session: {
			state: { model: { provider: "kimi-code" } },
			model: { provider: "kimi-code" },
		},
		usage: null,
	});

	assert.deepEqual(rendered, {
		content: "5h: 4% 3h │ 7d: 1% 6d21h",
		visible: true,
	});
});
