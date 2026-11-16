import type { TaskHandlerRegistry } from "./types.ts";
import { marketWatchHandler } from "../market-watch/market-watch.ts";

export const taskHandlers: TaskHandlerRegistry = {
  MARKET_WATCH: marketWatchHandler,
};
