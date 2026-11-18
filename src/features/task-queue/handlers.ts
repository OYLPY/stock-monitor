import type { TaskHandlerRegistry } from "./types.ts";
import { marketWatchHandler } from "../market-watch/market-watch.ts";
import { researchReportHandler } from "../reports/task.ts";

export const taskHandlers: TaskHandlerRegistry = {
  MARKET_WATCH: marketWatchHandler,
  RESEARCH_REPORT: researchReportHandler,
};
