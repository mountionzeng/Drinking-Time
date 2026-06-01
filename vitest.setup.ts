import os from "node:os";
import path from "node:path";

process.env.LOCAL_PERSIST_PATH ??= path.join(
  os.tmpdir(),
  `drinking-time-vitest-${process.pid}.json`,
);
