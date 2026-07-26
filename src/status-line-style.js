import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";

const TARGET_THEME = process.env.OMP_STATUSLINE_THEME ?? "titanium-dracula";
const BRANCH_MAX_LENGTH = 18;
const CONTEXT_ERROR_THRESHOLD = 60;
const CONTEXT_WARNING_THRESHOLD = 40;
const USAGE_ERROR_THRESHOLD = 85;
const USAGE_WARNING_THRESHOLD = 70;
const ORIGINAL_PATH_RENDER = Symbol.for("omp.status-line-style.original-path-render");
const ORIGINAL_GIT_RENDER = Symbol.for("omp.status-line-style.original-git-render");
const ORIGINAL_CONTEXT_RENDER = Symbol.for("omp.context-window-style.original-render");
const ORIGINAL_USAGE_RENDER = Symbol.for("omp.status-line-style.original-usage-render");
const MINIMAX_PROVIDER = "minimax";
const MINIMAX_USAGE_PROVIDER = "minimax-code";
const MINIMAX_WEEKLY_WINDOW_ID = "7d";
const MINIMAX_REFRESH_INTERVAL_MS = 60_000;
const MINIMAX_REQUEST_TIMEOUT_MS = 4_000;
const MINIMAX_RENDER_STATUS_KEY = "minimax-quota-refresh";
const GIT_DIVERGENCE_REFRESH_INTERVAL_MS = 30_000;
const GIT_DIVERGENCE_TTL_MS = 5_000;
const GIT_COMMAND_TIMEOUT_MS = 2_000;

let minimaxUsage = null;
let minimaxRefreshPromise = null;
let gitDivergence = null;
let gitDivergencePromise = null;
let gitDivergenceCheckedAt = 0;

const getOriginalRender = (segment, renderSymbol) => {
	if (!segment[renderSymbol]) {
		Object.defineProperty(segment, renderSymbol, {
			value: segment.render,
		});
	}

	return segment[renderSymbol];
};

const isTargetTheme = pi => pi.pi.getCurrentThemeName() === TARGET_THEME;

const truncateBranch = branch => {
	const characters = Array.from(branch);

	if (characters.length <= BRANCH_MAX_LENGTH) {
		return branch;
	}

	return `${characters.slice(0, BRANCH_MAX_LENGTH - 1).join("")}…`;
};

const isGitDirty = status =>
	Boolean(status && (status.staged > 0 || status.unstaged > 0 || status.untracked > 0));

const getDivergenceFor = cwd => (gitDivergence && gitDivergence.cwd === cwd ? gitDivergence : null);

const patchPathSegment = pi => {
	const pathSegment = pi.pi.SEGMENTS.path;
	const originalRender = getOriginalRender(pathSegment, ORIGINAL_PATH_RENDER);

	pathSegment.render = ctx => {
		if (!isTargetTheme(pi)) {
			return originalRender.call(pathSegment, ctx);
		}

		const cwd = ctx.session.sessionManager.getCwd();
		const currentDirectory = basename(cwd);

		if (!currentDirectory) {
			return originalRender.call(pathSegment, ctx);
		}

		const theme = pi.pi.theme;
		const directoryContent = theme.fg("statusLinePath", currentDirectory);

		if (!ctx.git.branch) {
			return { content: directoryContent, visible: true };
		}

		const isDirty = isGitDirty(ctx.git.status);
		const branch = `${truncateBranch(ctx.git.branch)}${isDirty ? "*" : ""}`;
		const color = isDirty ? "statusLineGitDirty" : "statusLineGitClean";
		const divergence = getDivergenceFor(cwd);
		const worktreeName = ctx.worktree?.worktreeName;
		const worktreeTag = worktreeName ? `@${worktreeName}` : "";
		const branchParts = [theme.fg(color, `(${branch}`)];

		if (divergence?.ahead) {
			branchParts.push(theme.fg("muted", ` ↑${divergence.ahead}`));
		}

		if (divergence?.behind) {
			branchParts.push(theme.fg("muted", ` ↓${divergence.behind}`));
		}

		branchParts.push(theme.fg(color, `${worktreeTag})`));

		return {
			content: `${directoryContent} ${branchParts.join("")}`,
			visible: true,
		};
	};
};

const patchGitSegment = pi => {
	const gitSegment = pi.pi.SEGMENTS.git;
	const originalRender = getOriginalRender(gitSegment, ORIGINAL_GIT_RENDER);

	gitSegment.render = ctx => {
		if (isTargetTheme(pi)) {
			return { content: "", visible: false };
		}

		return originalRender.call(gitSegment, ctx);
	};
};

const getContextColor = percent => {
	if (percent >= CONTEXT_ERROR_THRESHOLD) {
		return "error";
	}

	if (percent >= CONTEXT_WARNING_THRESHOLD) {
		return "warning";
	}

	return "success";
};

const formatContextWindow = contextWindow => {
	if (contextWindow >= 1_000_000) {
		const millions = contextWindow / 1_000_000;
		return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
	}
	return contextWindow >= 1000 ? `${Math.round(contextWindow / 1000)}K` : `${contextWindow}`;
};

const patchContextSegment = pi => {
	const contextSegment = pi.pi.SEGMENTS.context_pct;
	const originalRender = getOriginalRender(contextSegment, ORIGINAL_CONTEXT_RENDER);

	contextSegment.render = ctx => {
		if (!isTargetTheme(pi)) {
			return originalRender.call(contextSegment, ctx);
		}

		const { autoCompactEnabled, contextPercent, contextWindow } = ctx;
		const theme = pi.pi.theme;
		const hasPercent = Number.isFinite(contextPercent);
		const percent = hasPercent ? Math.min(100, Math.max(0, Math.round(contextPercent))) : null;
		const autoIcon = autoCompactEnabled && theme.icon.auto ? ` ${theme.icon.auto}` : "";
		const percentContent = theme.fg(
			percent === null ? "muted" : getContextColor(percent),
			`${percent === null ? "?" : `${percent}%`}${autoIcon}`,
		);
		const windowContent = theme.fg(
			"muted",
			Number.isFinite(contextWindow) && contextWindow > 0
				? `/${formatContextWindow(contextWindow)}`
				: "/?",
		);
		const icon = theme.icon.context;

		return {
			content: `${icon ? `${icon} ` : ""}${percentContent} ${windowContent}`,
			visible: true,
		};
	};
};

const getUsageColor = percent => {
	if (percent >= USAGE_ERROR_THRESHOLD) {
		return "error";
	}

	if (percent >= USAGE_WARNING_THRESHOLD) {
		return "warning";
	}

	return "success";
};

const formatResetMinutes = totalMinutes => {
	const normalizedMinutes = Math.max(0, Math.round(totalMinutes));
	const days = Math.floor(normalizedMinutes / 1440);
	const hours = Math.floor((normalizedMinutes % 1440) / 60);
	const minutes = normalizedMinutes % 60;
	const parts = [];

	if (days > 0) {
		parts.push(`${days}d`);
	}

	if (hours > 0) {
		parts.push(`${hours}h`);
	}

	if (minutes > 0 || parts.length === 0) {
		parts.push(`${minutes}m`);
	}

	return parts.join("");
};

const isMinimaxProvider = provider => provider === MINIMAX_PROVIDER;

const getRenderedProvider = ctx => ctx.session.state.model?.provider ?? ctx.session.model?.provider;

const getRuntimeProvider = ctx => ctx.models.current()?.provider ?? ctx.model?.provider;

const getResetMinutes = (resetTimestamp, now) => {
	const timestamp = Number(resetTimestamp);

	if (!Number.isFinite(timestamp) || timestamp <= 0) {
		return undefined;
	}

	return Math.max(0, Math.round((timestamp - now) / 60_000));
};

const toUsageWindow = (limit, now) => {
	const usedFraction = Number(limit?.amount?.usedFraction);
	const label = limit?.scope?.windowId ?? limit?.window?.id;

	if (!Number.isFinite(usedFraction) || !label) {
		return undefined;
	}

	return {
		label,
		percent: Math.min(100, Math.max(0, usedFraction * 100)),
		resetMinutes: getResetMinutes(limit.window?.resetsAt, now),
	};
};

const parseMinimaxReports = (reports, now = Date.now()) => {
	if (!Array.isArray(reports)) {
		return null;
	}

	let rolling;
	let weekly;

	for (const report of reports) {
		if (report?.provider !== MINIMAX_USAGE_PROVIDER || !Array.isArray(report.limits)) {
			continue;
		}

		for (const limit of report.limits) {
			if (limit?.scope?.shared !== true) {
				continue;
			}

			const usageWindow = toUsageWindow(limit, now);

			if (!usageWindow) {
				continue;
			}

			if (usageWindow.label === MINIMAX_WEEKLY_WINDOW_ID) {
				weekly ??= usageWindow;
			} else {
				rolling ??= usageWindow;
			}
		}
	}

	if (!rolling && !weekly) {
		return null;
	}

	return { rolling, weekly };
};

const fetchNativeUsageReports = async ctx => {
	const authStorage = ctx.modelRegistry?.authStorage;

	if (typeof authStorage?.fetchUsageReports !== "function") {
		return null;
	}

	try {
		return await authStorage.fetchUsageReports({
			signal: AbortSignal.timeout(MINIMAX_REQUEST_TIMEOUT_MS),
		});
	} catch {
		return null;
	}
};

const requestStatusLineRender = ctx => {
	if (ctx.hasUI) {
		ctx.ui.setStatus(MINIMAX_RENDER_STATUS_KEY, undefined);
	}
};

const refreshMinimaxUsage = async ctx => {
	if (!isMinimaxProvider(getRuntimeProvider(ctx))) {
		return;
	}

	if (minimaxRefreshPromise) {
		await minimaxRefreshPromise;
		return;
	}

	minimaxRefreshPromise = (async () => {
		const usage = parseMinimaxReports(await fetchNativeUsageReports(ctx));

		if (usage) {
			minimaxUsage = usage;
			requestStatusLineRender(ctx);
		}
	})();

	try {
		await minimaxRefreshPromise;
	} finally {
		minimaxRefreshPromise = null;
	}
};

const scheduleMinimaxRefresh = ctx => {
	ctx.setTimeout(() => refreshMinimaxUsage(ctx), 0);
};

const registerMinimaxUsage = pi => {
	pi.on("session_start", (_event, ctx) => {
		scheduleMinimaxRefresh(ctx);
		ctx.setInterval(() => refreshMinimaxUsage(ctx), MINIMAX_REFRESH_INTERVAL_MS);
	});

	pi.on("turn_start", (_event, ctx) => {
		scheduleMinimaxRefresh(ctx);
	});
};

const execFileAsync = promisify(execFile);

const readGitDivergence = async cwd => {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
			{ cwd, timeout: GIT_COMMAND_TIMEOUT_MS },
		);
		const [ahead, behind] = stdout.trim().split(/\s+/u).map(Number);

		if (!Number.isFinite(ahead) || !Number.isFinite(behind)) {
			return null;
		}

		return { ahead, behind, cwd };
	} catch {
		return null;
	}
};

const isSameDivergence = (left, right) =>
	left?.cwd === right?.cwd && left?.ahead === right?.ahead && left?.behind === right?.behind;

const refreshGitDivergence = async ctx => {
	if (gitDivergencePromise) {
		await gitDivergencePromise;
		return;
	}

	if (Date.now() - gitDivergenceCheckedAt < GIT_DIVERGENCE_TTL_MS) {
		return;
	}

	const cwd = ctx.sessionManager?.getCwd() ?? ctx.cwd;

	if (!cwd) {
		return;
	}

	gitDivergencePromise = (async () => {
		const refreshed = await readGitDivergence(cwd);

		gitDivergenceCheckedAt = Date.now();

		if (isSameDivergence(gitDivergence, refreshed)) {
			return;
		}

		gitDivergence = refreshed;
		requestStatusLineRender(ctx);
	})();

	try {
		await gitDivergencePromise;
	} finally {
		gitDivergencePromise = null;
	}
};

const scheduleGitDivergenceRefresh = ctx => {
	ctx.setTimeout(() => refreshGitDivergence(ctx), 0);
};

const registerGitDivergence = pi => {
	pi.on("session_start", (_event, ctx) => {
		scheduleGitDivergenceRefresh(ctx);
		ctx.setInterval(() => refreshGitDivergence(ctx), GIT_DIVERGENCE_REFRESH_INTERVAL_MS);
	});

	pi.on("turn_start", (_event, ctx) => {
		scheduleGitDivergenceRefresh(ctx);
	});

	pi.on("turn_end", (_event, ctx) => {
		scheduleGitDivergenceRefresh(ctx);
	});
};

const renderUsageWindow = ({ label, percent, resetMinutes, theme }) => {
	const roundedPercent = Math.round(percent);
	const percentage = theme.fg(getUsageColor(roundedPercent), `${roundedPercent}%`);
	const reset =
		resetMinutes === undefined ? "" : ` ${theme.fg("muted", formatResetMinutes(resetMinutes))}`;

	return `${theme.fg("text", label)}: ${percentage}${reset}`;
};

const toNativeUsageWindows = usage => {
	const rolling = usage?.fiveHour
		? { label: "5h", percent: usage.fiveHour.percent, resetMinutes: usage.fiveHour.resetMinutes }
		: undefined;
	const weekly = usage?.sevenDay
		? {
				label: "7d",
				percent: usage.sevenDay.percent,
				resetMinutes:
					usage.sevenDay.resetMinutes ??
					(usage.sevenDay.resetHours === undefined ? undefined : usage.sevenDay.resetHours * 60),
			}
		: undefined;

	if (!rolling && !weekly) {
		return null;
	}

	return { rolling, weekly };
};

const getUsageWindows = ctx => {
	if (isMinimaxProvider(getRenderedProvider(ctx)) && minimaxUsage) {
		return minimaxUsage;
	}

	return toNativeUsageWindows(ctx.usage);
};

const patchUsageSegment = pi => {
	const usageSegment = pi.pi.SEGMENTS.usage;
	const originalRender = getOriginalRender(usageSegment, ORIGINAL_USAGE_RENDER);

	usageSegment.render = ctx => {
		if (!isTargetTheme(pi)) {
			return originalRender.call(usageSegment, ctx);
		}

		const windows = getUsageWindows(ctx);

		if (!windows) {
			return { content: "", visible: false };
		}

		const theme = pi.pi.theme;
		const parts = [windows.rolling, windows.weekly]
			.filter(Boolean)
			.map(usageWindow => renderUsageWindow({ ...usageWindow, theme }));
		const separator = theme.fg("muted", ` ${(theme.sep?.pipe ?? "│").trim()} `);

		return {
			content: parts.join(separator),
			visible: parts.length > 0,
		};
	};
};

export default function statusLineStyle(pi) {
	registerMinimaxUsage(pi);
	registerGitDivergence(pi);
	patchPathSegment(pi);
	patchGitSegment(pi);
	patchContextSegment(pi);
	patchUsageSegment(pi);
}
