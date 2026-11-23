// Advanced HBS2 bounds. A paged recording consumes at least one 4 KiB
// cache slot from the audio processor's 8 MiB PSRAM. Device admission
// also checks the actual starts, bookkeeping and refill reserve.
export const pagedLimits = { recordings: 2048, zones: 4096 };
export const residentLimits = { recordings: 128, zones: 256, levels: 1536 };
